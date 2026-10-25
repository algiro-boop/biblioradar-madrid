"use client";

import { List, LoaderCircle, LocateFixed, Map as MapIcon, RotateCw, Search, X } from "lucide-react";
import { BRAND_ICON_SRC } from "@/lib/brand";
import type { FilterInstitution, LibraryFilters } from "@/lib/filters";
import type { RealtimeConnection } from "@/lib/types";
import { InstallAppButton } from "./InstallAppButton";
import { ShareAppButton } from "./ShareAppButton";

export type ViewMode = "map" | "list";

const INSTITUTION_PILLS: ReadonlyArray<{ value: FilterInstitution; label: string }> = [
  { value: "ayuntamiento", label: "Ayuntamiento" },
  { value: "comunidad", label: "Comunidad" },
  { value: "ucm", label: "UCM" },
];

const CONNECTION_TEXT: Record<RealtimeConnection, { label: string; dot: string }> = {
  connecting: { label: "Conectando", dot: "bg-slate-400" },
  live: { label: "En vivo", dot: "bg-emerald-500" },
  reconnecting: { label: "Reconectando", dot: "bg-amber-400" },
  offline: { label: "Sin conexión", dot: "bg-red-500" },
};

function Pill({
  active,
  onClick,
  children,
  busy = false,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      disabled={busy}
      className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium whitespace-nowrap ring-1 transition focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:outline-none ${
        active
          ? "bg-slate-900 text-white ring-slate-900"
          : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}

export function Header({
  filters,
  onQueryChange,
  onToggleRoom,
  onToggleInstitution,
  onToggleNear,
  locating,
  geoMessage,
  onGeoRetry,
  connection,
  view,
  onViewChange,
}: {
  filters: LibraryFilters;
  onQueryChange: (q: string) => void;
  onToggleRoom: () => void;
  onToggleInstitution: (i: FilterInstitution) => void;
  onToggleNear: () => void;
  locating: boolean;
  geoMessage: string | null;
  /** Solo para fallos que no son un bloqueo de permisos (tiempo agotado, sin señal). */
  onGeoRetry?: () => void;
  connection: RealtimeConnection;
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
}) {
  const conn = CONNECTION_TEXT[connection];
  return (
    <header className="pointer-events-auto relative z-10 rounded-3xl bg-white/95 p-3 shadow-lg ring-1 ring-slate-900/5 backdrop-blur md:rounded-none md:bg-transparent md:px-4 md:pt-4 md:pb-2 md:shadow-none md:ring-0">
      <div className="flex items-center justify-between gap-2 px-1 pb-2.5">
        <h1 className="flex min-w-0 items-center gap-2 text-base font-extrabold tracking-tight text-slate-900">
          <img src={BRAND_ICON_SRC} alt="" width={28} height={28} className="size-7 shrink-0 rounded-lg" />
          <span className="truncate">
            BiblioRadar <span className="font-semibold text-slate-400 max-[379px]:hidden">Madrid</span>
          </span>
        </h1>
        <div className="flex shrink-0 items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500" role="status" title={conn.label}>
            <span className="relative flex size-2">
              {connection === "live" && (
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              )}
              <span className={`relative inline-flex size-2 rounded-full ${conn.dot}`} />
            </span>
            {/* En la columna fija de 400 px (md+) o en móviles estrechos basta el punto. */}
            <span className="max-[429px]:sr-only md:sr-only">{conn.label}</span>
          </span>
          <ShareAppButton />
          <InstallAppButton />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <label className="relative flex-1">
          <span className="sr-only">Buscar biblioteca o distrito</span>
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            value={filters.query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Nombre o distrito…"
            className="h-11 w-full rounded-2xl bg-slate-100 pr-10 pl-10 text-[16px] text-slate-900 placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-900 focus:outline-none md:text-sm [&::-webkit-search-cancel-button]:hidden"
          />
          {filters.query && (
            <button
              type="button"
              onClick={() => onQueryChange("")}
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
              aria-label="Borrar búsqueda"
            >
              <X className="size-4" />
            </button>
          )}
        </label>

        <div className="flex h-11 shrink-0 rounded-2xl bg-slate-100 p-1 md:hidden" role="tablist" aria-label="Vista">
          {(
            [
              { value: "map", label: "Mapa", Icon: MapIcon },
              { value: "list", label: "Lista", Icon: List },
            ] as const
          ).map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={view === value}
              onClick={() => onViewChange(value)}
              className={`flex items-center gap-1 rounded-xl px-2.5 text-xs font-semibold transition ${
                view === value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
              }`}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="-mx-3 mt-2.5 flex gap-2 overflow-x-auto px-3 pb-0.5 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0 [&::-webkit-scrollbar]:hidden">
        <Pill active={filters.near !== null} onClick={onToggleNear} busy={locating}>
          {locating ? <LoaderCircle className="size-4 animate-spin" /> : <LocateFixed className="size-4" />}
          Cerca de mí
        </Pill>
        <Pill active={filters.onlyWithRoom} onClick={onToggleRoom}>
          🟢 Con sitio (&lt;70%)
        </Pill>
        {INSTITUTION_PILLS.map((p) => (
          <Pill
            key={p.value}
            active={filters.institutions.includes(p.value)}
            onClick={() => onToggleInstitution(p.value)}
          >
            {p.label}
          </Pill>
        ))}
      </div>

      {geoMessage && (
        <div className="mt-2 flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900" role="alert">
          <p className="min-w-0 flex-1">{geoMessage}</p>
          {onGeoRetry && (
            <button
              type="button"
              onClick={onGeoRetry}
              disabled={locating}
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-900 px-2.5 py-1 font-semibold text-white hover:bg-amber-800 disabled:opacity-60"
            >
              <RotateCw className="size-3" /> Reintentar
            </button>
          )}
        </div>
      )}
    </header>
  );
}
