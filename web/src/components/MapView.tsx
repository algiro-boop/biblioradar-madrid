"use client";

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef } from "react";
import { Circle, CircleMarker, MapContainer, Marker, TileLayer, useMap, useMapEvents, ZoomControl } from "react-leaflet";
import { MADRID_CENTER, REPORT_RADIUS_M } from "@/lib/geo";
import { formatPinText, getOccupancyLevel, LEVEL_STYLES, LEVEL_TEXT } from "@/lib/occupancy";
import { getTileConfig } from "@/lib/tiles";
import type { LibraryWithOccupancy, OccupancyLevel, UserPosition } from "@/lib/types";

const PIN_SIZE: [number, number] = [56, 44];
const TILES = getTileConfig();
const iconCache = new Map<string, L.DivIcon>();

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** divIcon con Tailwind: píldora con el porcentaje (o "?") y una punta del mismo color. */
function pinIcon(level: OccupancyLevel, pct: number | null, selected: boolean, name: string): L.DivIcon {
  const key = `${level}|${pct}|${selected}|${name}`;
  const cached = iconCache.get(key);
  if (cached) return cached;
  const s = LEVEL_STYLES[level];
  const label = pct === null ? `${name}: sin datos` : `${name}: ${pct}%, ${LEVEL_TEXT[level]}`;
  const html = `
    <div class="flex flex-col items-center transition-transform duration-150 ${selected ? "scale-125" : "hover:scale-110"}" role="img" aria-label="${escapeHtml(label)}">
      <div class="relative z-10 flex h-8 min-w-11 items-center justify-center rounded-full px-2 text-[13px] leading-none font-bold tabular-nums shadow-md ring-2 ${selected ? "ring-slate-900" : "ring-white"} ${s.bg} ${s.text}">${formatPinText(pct)}</div>
      <div class="-mt-1.5 size-3 rotate-45 rounded-[2px] shadow-md ${s.bg}"></div>
    </div>`;
  const icon = L.divIcon({
    html,
    className: "biblio-pin",
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
}: {
  selected: LibraryWithOccupancy | null;
  userPosition: UserPosition | null;
  focusUserKey: number;
  onBackgroundClick: () => void;
}) {
  const map = useMap();
  const userRef = useRef(userPosition);
  userRef.current = userPosition;

  useMapEvents({ click: onBackgroundClick });

  // Centra la biblioteca seleccionada dejando hueco al drawer (abajo en móvil, derecha en escritorio).
  useEffect(() => {
    if (!selected) return;
    const zoom = Math.max(map.getZoom(), 15);
    const size = map.getSize();
    const mobile = size.x < 768;
    const offset = mobile ? L.point(0, size.y * 0.28) : L.point(Math.min(210, size.x * 0.25), 0);
    const target = map.unproject(map.project([selected.lat, selected.lng], zoom).add(offset), zoom);
    map.flyTo(target, zoom, { duration: 0.6 });
    // Solo al cambiar de selección, no con cada actualización de ocupación.
  }, [selected?.id, map]);

  useEffect(() => {
    const pos = userRef.current;
    if (focusUserKey === 0 || !pos) return;
    map.flyTo([pos.lat, pos.lng], Math.max(map.getZoom(), 15), { duration: 0.8 });
  }, [focusUserKey, map]);

  return null;
}

export default function MapView({
  libraries,
  selectedId,
  userPosition,
  focusUserKey,
  onSelect,
  onDeselect,
}: {
  libraries: LibraryWithOccupancy[];
  selectedId: string | null;
  userPosition: UserPosition | null;
  focusUserKey: number;
  onSelect: (id: string) => void;
  onDeselect: () => void;
}) {
  const selected = useMemo(
    () => libraries.find((l) => l.id === selectedId) ?? null,
    [libraries, selectedId],
  );

  return (
    <MapContainer
      center={MADRID_CENTER}
      zoom={13}
      minZoom={10}
      maxZoom={19}
      zoomControl={false}
      className="h-full w-full bg-slate-100"
      attributionControl
    >
      <TileLayer
        attribution={TILES.attribution}
        url={TILES.url}
        maxNativeZoom={19}
        maxZoom={19}
        className={TILES.softened ? "biblio-tiles-soft" : undefined}
      />
      <ZoomControl position="bottomright" />

      {selected && (
        <Circle
          center={[selected.lat, selected.lng]}
          radius={REPORT_RADIUS_M}
          interactive={false}
          pathOptions={{ color: "#0f172a", weight: 1, opacity: 0.35, dashArray: "4 6", fillOpacity: 0.04 }}
        />
      )}

      {libraries.map((lib) => {
        const pct = lib.occupancy?.final_occupancy_pct ?? null;
        const isSelected = lib.id === selectedId;
        return (
          <Marker
            key={lib.id}
            position={[lib.lat, lib.lng]}
            icon={pinIcon(getOccupancyLevel(lib.occupancy), pct, isSelected, lib.name)}
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
      />
    </MapContainer>
  );
}
