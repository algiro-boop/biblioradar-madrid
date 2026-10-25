"use client";

import dynamic from "next/dynamic";
import { useCallback, useDeferredValue, useMemo, useRef, useState } from "react";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useLibraries } from "@/hooks/useLibraries";
import { useNow } from "@/hooks/useNow";
import { withCurrentOccupancy } from "@/lib/estimate";
import { applyFilters, EMPTY_FILTERS, hasActiveFilters, type FilterInstitution, type LibraryFilters } from "@/lib/filters";
import { GeolocationFailure, geolocationError, haversineMeters, PERMISSION_DENIED } from "@/lib/geo";
import { isPermissionDenied, locateWithHelp, type LocationPurpose } from "@/lib/location";
import type { UserPosition } from "@/lib/types";
import { Header, type ViewMode } from "./Header";
import { LibraryDrawer } from "./LibraryDrawer";
import { LibraryList } from "./LibraryList";
import { LocationHelpModal } from "./LocationHelpModal";
import { ProximityBanner } from "./ProximityBanner";

const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center bg-slate-100 text-sm text-slate-400">Cargando mapa…</div>
  ),
});

function ConfigNotice({ message }: { message: string }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-slate-50 p-6">
      <div className="max-w-md rounded-3xl bg-white p-6 shadow-lg ring-1 ring-slate-200">
        <h1 className="text-lg font-bold text-slate-900">Falta configurar Supabase</h1>
        <p className="mt-2 text-sm text-slate-600">{message}</p>
        <pre className="mt-4 overflow-x-auto rounded-xl bg-slate-900 p-3 text-xs text-slate-100">
          {"NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co\nNEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ..."}
        </pre>
      </div>
    </main>
  );
}

export function AppShell() {
  const { libraries: snapshot, loading, error, configError, connection, reload, refreshLibrary } = useLibraries();
  const geo = useGeolocation();
  const now = useNow();
  // Si la base del cron caducó (p. ej. a las 09:00, al abrir) se muestra la estimación horaria
  // vigente calculada aquí, sin esperar a la siguiente ejecución ni avisar de desactualización.
  const libraries = useMemo(() => withCurrentOccupancy(snapshot, now), [snapshot, now]);

  const [filters, setFilters] = useState<LibraryFilters>(EMPTY_FILTERS);
  const [nearMe, setNearMe] = useState(false);
  const [view, setView] = useState<ViewMode>("map");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusUserKey, setFocusUserKey] = useState(0);
  const [geoMessage, setGeoMessage] = useState<string | null>(null);
  /** El aviso de «Cerca de mí» admite reintento (tiempo agotado, ubicación no disponible). */
  const [geoRetryable, setGeoRetryable] = useState(false);
  const deferredQuery = useDeferredValue(filters.query);

  // "Cerca de mí" sigue la posición en vivo mientras está activo.
  const effectiveFilters = useMemo<LibraryFilters>(
    () => ({
      ...filters,
      query: deferredQuery,
      near: nearMe && geo.position ? { lat: geo.position.lat, lng: geo.position.lng } : null,
    }),
    [filters, deferredQuery, nearMe, geo.position],
  );
  const items = useMemo(() => applyFilters(libraries, effectiveFilters), [libraries, effectiveFilters]);
  const mapLibraries = useMemo(() => items.map((i) => i.library), [items]);

  const selected = useMemo(() => libraries.find((l) => l.id === selectedId) ?? null, [libraries, selectedId]);

  // Ubicación bloqueada: la ayuda queda abierta hasta que un reintento funcione o se cierre.
  type Blocked = { purpose: LocationPurpose; resolve: (p: UserPosition) => void; reject: (e: unknown) => void };
  const blockedRef = useRef<Blocked | null>(null);
  const [blockedPurpose, setBlockedPurpose] = useState<LocationPurpose | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const { locate } = geo;

  const requestLocation = useCallback(
    (purpose: LocationPurpose) =>
      locateWithHelp(locate, purpose, (p) => {
        blockedRef.current?.reject(new GeolocationFailure(geolocationError({ code: PERMISSION_DENIED }), PERMISSION_DENIED));
        setRetryError(null);
        setBlockedPurpose(p);
        return new Promise<UserPosition>((resolve, reject) => {
          blockedRef.current = { purpose: p, resolve, reject };
        });
      }),
    [locate],
  );
  const locateForReport = useCallback(() => requestLocation("report"), [requestLocation]);

  const closeLocationHelp = useCallback(() => {
    blockedRef.current?.reject(new GeolocationFailure(geolocationError({ code: PERMISSION_DENIED }), PERMISSION_DENIED));
    blockedRef.current = null;
    setBlockedPurpose(null);
  }, []);

  const retryLocation = useCallback(async () => {
    setRetrying(true);
    setRetryError(null);
    try {
      // Tras un bloqueo sí se exige una lectura nueva (maximumAge: 0).
      const position = await locate({ fresh: true });
      blockedRef.current?.resolve(position);
      blockedRef.current = null;
      setBlockedPurpose(null);
    } catch (err) {
      if (isPermissionDenied(err)) {
        setRetryError("La ubicación sigue bloqueada. Revisa el paso de arriba y vuelve a intentarlo.");
      } else {
        // El permiso ya no está bloqueado (p. ej. TIMEOUT): cerrar la ayuda y que la acción
        // pendiente muestre su propio aviso con «Reintentar».
        blockedRef.current?.reject(err);
        blockedRef.current = null;
        setBlockedPurpose(null);
      }
    } finally {
      setRetrying(false);
    }
  }, [locate]);
  const selectedDistance = selected && geo.position ? haversineMeters(geo.position, selected) : null;

  const findNearMe = useCallback(async () => {
    setGeoMessage(null);
    setGeoRetryable(false);
    try {
      await requestLocation("near");
      setNearMe(true);
      setFocusUserKey((k) => k + 1);
    } catch (err) {
      setGeoRetryable(!isPermissionDenied(err));
      setGeoMessage(
        isPermissionDenied(err)
          ? "Sin ubicación no podemos ordenar por cercanía. Pulsa «Cerca de mí» cuando quieras activarla."
          : err instanceof GeolocationFailure
            ? err.message
            : "No se pudo obtener tu ubicación.",
      );
    }
  }, [requestLocation]);

  const toggleNear = useCallback(async () => {
    if (nearMe) {
      setNearMe(false);
      return;
    }
    await findNearMe();
  }, [nearMe, findNearMe]);

  const toggleInstitution = useCallback((i: FilterInstitution) => {
    setFilters((f) => ({
      ...f,
      institutions: f.institutions.includes(i) ? f.institutions.filter((x) => x !== i) : [...f.institutions, i],
    }));
  }, []);

  const clearFilters = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    setNearMe(false);
  }, []);

  const handleReported = useCallback(
    (libraryId: string) => {
      // Respaldo por si el WebSocket no está conectado: Realtime normalmente llega antes.
      window.setTimeout(() => void refreshLibrary(libraryId), 800);
    },
    [refreshLibrary],
  );

  const closeDrawer = useCallback(() => setSelectedId(null), []);

  if (configError) return <ConfigNotice message={error ?? ""} />;

  return (
    <main className="relative flex h-dvh w-full overflow-hidden bg-slate-100 text-slate-900">
      {/* Panel lateral: en móvil cabecera flotante + lista a pantalla completa; en escritorio barra fija. */}
      <section
        className={`absolute inset-0 z-[1000] flex flex-col md:static md:z-auto md:w-[400px] md:shrink-0 md:border-r md:border-slate-200 md:bg-slate-50 ${
          view === "list" ? "bg-slate-50" : "pointer-events-none md:pointer-events-auto"
        }`}
      >
        <div className="p-3 pt-[max(0.75rem,env(safe-area-inset-top))] md:p-0">
          <Header
            filters={filters}
            onQueryChange={(query) => setFilters((f) => ({ ...f, query }))}
            onToggleRoom={() => setFilters((f) => ({ ...f, onlyWithRoom: !f.onlyWithRoom }))}
            onToggleInstitution={toggleInstitution}
            onToggleNear={() => void toggleNear()}
            locating={geo.status === "locating"}
            geoMessage={geoMessage}
            onGeoRetry={geoRetryable ? () => void findNearMe() : undefined}
            connection={connection}
            view={view}
            onViewChange={setView}
          />
        </div>
        <div className={`min-h-0 flex-1 flex-col ${view === "list" ? "flex" : "hidden"} md:flex`}>
          <LibraryList
            items={items}
            total={libraries.length}
            loading={loading}
            error={error}
            now={now}
            selectedId={selectedId}
            filtersActive={nearMe || hasActiveFilters(filters)}
            onSelect={setSelectedId}
            onClearFilters={clearFilters}
            onRetry={reload}
          />
        </div>
      </section>

      <section className="absolute inset-0 isolate md:static md:flex-1" aria-label="Mapa de bibliotecas">
        <MapView
          libraries={mapLibraries}
          selectedId={selectedId}
          userPosition={geo.position}
          focusUserKey={focusUserKey}
          onSelect={setSelectedId}
          onDeselect={closeDrawer}
        />
      </section>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[1050] px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:left-[400px]">
        <ProximityBanner
          libraries={libraries}
          position={geo.position}
          hidden={selectedId !== null}
          now={now}
          locate={locateForReport}
          onReported={handleReported}
          onOpen={setSelectedId}
        />
      </div>

      <LibraryDrawer
        library={selected}
        distanceM={selectedDistance}
        now={now}
        locate={locateForReport}
        locationGranted={geo.status === "granted"}
        onReported={handleReported}
        onClose={closeDrawer}
      />

      {blockedPurpose && (
        <LocationHelpModal
          purpose={blockedPurpose}
          retrying={retrying}
          retryError={retryError}
          onRetry={() => void retryLocation()}
          onClose={closeLocationHelp}
        />
      )}
    </main>
  );
}
