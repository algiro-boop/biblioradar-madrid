"use client";

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { Circle, CircleMarker, MapContainer, Marker, TileLayer, useMap, useMapEvents, ZoomControl } from "react-leaflet";
import { MADRID_CENTER, REPORT_RADIUS_M } from "@/lib/geo";
import { recentAt } from "@/lib/community";
import { getOccupancyLevel } from "@/lib/occupancy";
import { pinClassName, pinHtml, type PinState } from "@/lib/pins";
import { observeMapSize } from "@/lib/map-resize";
import { getTileConfig, OSM_TILES, type TileConfig } from "@/lib/tiles";
import { useTheme } from "@/hooks/useTheme";
import type { LibraryWithOccupancy, UserPosition } from "@/lib/types";

const PIN_SIZE: [number, number] = [56, 44];
const iconCache = new Map<string, L.DivIcon>();

/** divIcon con Tailwind; se cachea por estado para no recrear el DOM del pin sin motivo. */
function pinIcon(id: string, state: PinState): L.DivIcon {
  const key = `${id}|${state.level}|${state.pct}|${state.selected}|${state.live}|${state.changed}|${state.name}`;
  const cached = iconCache.get(key);
  if (cached) return cached;
  const icon = L.divIcon({
    html: pinHtml(state),
    // Clase estable: Leaflet reutiliza el contenedor y la entrada no se repite al cambiar el icono.
    className: pinClassName(id),
    iconSize: PIN_SIZE,
    iconAnchor: [PIN_SIZE[0] / 2, PIN_SIZE[1] - 4],
  });
  iconCache.set(key, icon);
  return icon;
}

function MapController({
  selected,
  userPosition,
  focusUserKey,
  onBackgroundClick,
  onUserPan,
}: {
  selected: LibraryWithOccupancy | null;
  userPosition: UserPosition | null;
  focusUserKey: number;
  onBackgroundClick: () => void;
  onUserPan?: () => void;
}) {
  const map = useMap();
  useEffect(() => observeMapSize(map), [map]);
  const userRef = useRef(userPosition);
  userRef.current = userPosition;

  // `dragstart` solo lo dispara el usuario al arrastrar (no los flyTo de selección o «Cerca de mí»).
  useMapEvents({ click: onBackgroundClick, dragstart: () => onUserPan?.() });

  // Centra la biblioteca seleccionada dejando hueco al drawer (abajo en móvil, derecha en escritorio).
  useEffect(() => {
    if (!selected) return;
    const centerSelected = (animate: boolean) => {
      const zoom = Math.max(map.getZoom(), 15);
      const size = map.getSize();
      // El mismo breakpoint que el drawer; el ancho DEL MAPA no equivale al de pantalla.
      const desktop = window.matchMedia("(min-width: 1024px)").matches;
      const halfDrawer = window.matchMedia("(min-width: 1280px)").matches ? 210 : 180;
      const offset = desktop ? L.point(Math.min(halfDrawer, size.x * 0.35), 0) : L.point(0, size.y * 0.22);
      const target = map.unproject(map.project([selected.lat, selected.lng], zoom).add(offset), zoom);
      map.flyTo(target, zoom, { duration: 0.6, animate });
    };
    centerSelected(true);
    const resized = () => centerSelected(false);
    map.on("resize", resized);
    return () => { map.off("resize", resized); };
    // Recolocar al rotar o cambiar de panel, sin reaccionar a cada actualización de ocupación.
  }, [selected?.id, map]);

  useEffect(() => {
    const pos = userRef.current;
    if (focusUserKey === 0 || !pos) return;
    map.flyTo([pos.lat, pos.lng], Math.max(map.getZoom(), 15), { duration: 0.8 });
  }, [focusUserKey, map]);

  return null;
}

/** Errores de tesela seguidos tras los que se abandona un proveedor (clave rechazada, cupo agotado…). */
const TILE_ERRORS_BEFORE_FALLBACK = 4;

/**
 * Capa base según el tema. Al cambiar de proveedor la capa anterior sigue debajo hasta que la nueva
 * termina de cargar (sin hueco durante la animación del tema), y si el proveedor configurado falla
 * se vuelve a OpenStreetMap con filtro para que el mapa nunca quede en negro.
 */
function ThemedTiles() {
  const { theme } = useTheme();
  const [failed, setFailed] = useState(false);
  const wanted = failed ? OSM_TILES : getTileConfig(theme);
  const [layers, setLayers] = useState<TileConfig[]>([wanted]);
  if (layers.at(-1)?.url !== wanted.url) {
    setLayers([...layers.filter((l) => l.url !== wanted.url), wanted]);
  }
  const errors = useRef(0);

  return layers.map((tiles, i) => {
    const current = i === layers.length - 1;
    return (
      <TileLayer
        key={tiles.url}
        attribution={tiles.attribution}
        url={tiles.url}
        maxNativeZoom={19}
        maxZoom={19}
        zIndex={current ? 2 : 1}
        className={tiles.softened ? "biblio-tiles-soft" : undefined}
        eventHandlers={
          current
            ? {
                load: () => setLayers((all) => (all.length > 1 ? [tiles] : all)),
                tileload: () => (errors.current = 0),
                tileerror: () => {
                  if (tiles.url === OSM_TILES.url) return;
                  errors.current += 1;
                  if (errors.current >= TILE_ERRORS_BEFORE_FALLBACK) setFailed(true);
                },
              }
            : undefined
        }
      />
    );
  });
}

export default function MapView({
  libraries,
  selectedId,
  userPosition,
  focusUserKey,
  onSelect,
  onDeselect,
  onUserPan,
}: {
  libraries: LibraryWithOccupancy[];
  selectedId: string | null;
  userPosition: UserPosition | null;
  focusUserKey: number;
  onSelect: (id: string) => void;
  onDeselect: () => void;
  /** El usuario empezó a arrastrar el mapa. */
  onUserPan?: () => void;
}) {
  const selected = useMemo(
    () => libraries.find((l) => l.id === selectedId) ?? null,
    [libraries, selectedId],
  );
  // Último porcentaje pintado por biblioteca: si Realtime lo cambia, el pin rebota una vez.
  const shownPct = useRef(new Map<string, number | null>());
  useEffect(() => {
    for (const lib of libraries) shownPct.current.set(lib.id, lib.occupancy?.final_occupancy_pct ?? null);
  }, [libraries]);
  const now = Date.now();

  return (
    <MapContainer
      center={MADRID_CENTER}
      zoom={13}
      minZoom={10}
      maxZoom={19}
      zoomControl={false}
      tapHold={false}
      className="h-full min-h-0 w-full min-w-0 bg-slate-100"
      attributionControl
    >
      <ThemedTiles />
      <ZoomControl position="topright" />

      {selected && (
        <Circle
          center={[selected.lat, selected.lng]}
          radius={REPORT_RADIUS_M}
          interactive={false}
          pathOptions={{ color: "#64748b", weight: 1, opacity: 0.6, dashArray: "4 6", fillOpacity: 0.05 }}
        />
      )}

      {libraries.map((lib) => {
        const pct = lib.occupancy?.final_occupancy_pct ?? null;
        const isSelected = lib.id === selectedId;
        const previous = shownPct.current.get(lib.id);
        const live = lib.occupancy?.is_open_now === true && recentAt(lib.occupancy.latest_report_at, now, 90);
        return (
          <Marker
            key={lib.id}
            position={[lib.lat, lib.lng]}
            icon={pinIcon(lib.id, {
              level: getOccupancyLevel(lib.occupancy),
              pct,
              name: lib.name,
              selected: isSelected,
              live,
              changed: previous !== undefined && previous !== pct,
            })}
            zIndexOffset={isSelected ? 1000 : pct === null ? -100 : 0}
            title={lib.name}
            alt={lib.name}
            keyboard
            eventHandlers={{ click: () => onSelect(lib.id) }}
          />
        );
      })}

      {userPosition && (
        <>
          {userPosition.accuracy < 1500 && (
            <Circle
              center={[userPosition.lat, userPosition.lng]}
              radius={userPosition.accuracy}
              interactive={false}
              pathOptions={{ color: "#3b82f6", weight: 0, fillColor: "#3b82f6", fillOpacity: 0.12 }}
            />
          )}
          <CircleMarker
            center={[userPosition.lat, userPosition.lng]}
            radius={7}
            interactive={false}
            pathOptions={{ color: "#ffffff", weight: 3, fillColor: "#2563eb", fillOpacity: 1 }}
          />
        </>
      )}

      <MapController
        selected={selected}
        userPosition={userPosition}
        focusUserKey={focusUserKey}
        onBackgroundClick={onDeselect}
        onUserPan={onUserPan}
      />
    </MapContainer>
  );
}
