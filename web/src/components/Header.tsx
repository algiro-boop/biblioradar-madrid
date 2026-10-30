"use client";

import { LoaderCircle, LocateFixed, RotateCw, Search, SlidersHorizontal, X } from "lucide-react";
import { useState } from "react";
import { BRAND_ICON_SRC } from "@/lib/brand";
import type { FilterInstitution, LibraryFilters } from "@/lib/filters";
import type { RealtimeConnection } from "@/lib/types";
import type { Library } from "@/lib/types";
import { FeedbackButton } from "./FeedbackButton";
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
      className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium whitespace-nowrap ring-1 transition-[background-color,color,box-shadow,scale] duration-150 active:scale-[0.97] lg:h-9 lg:px-3.5 lg:text-sm focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:outline-none ${
        active
          ? "bg-slate-900 text-white shadow-md shadow-slate-900/20 ring-slate-900"
          : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50 hover:ring-slate-300"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Pliega una fila de la cabecera animando su altura (0fr ↔ 1fr). Al terminar de abrirse deja de
 * recortar para que los menús desplegables (Compartir) puedan sobresalir.
 */
function Reveal({ open, className = "", children }: { open: boolean; className?: string; children: React.ReactNode }) {
  const [settled, setSettled] = useState(open);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    setSettled(false);
  }
  return (
    <div
      inert={!open}
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget && open) setSettled(true);
      }}
      className={`grid transition-[grid-template-rows,opacity] ease-[var(--ease-out-quint)] lg:grid-rows-[1fr] lg:opacity-100 ${
        open ? "grid-rows-[1fr] opacity-100 duration-300" : "grid-rows-[0fr] opacity-0 duration-200"
      } ${className}`}
    >
      <div className={`min-h-0 ${open && settled ? "" : "overflow-hidden"}`}>{children}</div>
    </div>
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
  libraries,
  activityAction,
  collapsed = false,
  onExpand,
}: {
  libraries: Pick<Library, "id" | "name">[];
  /** Botón de actividad; `compact` es la variante de solo icono de la fila superior en móvil. */
  activityAction?: (compact: boolean) => React.ReactNode;
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
  /** Móvil: al arrastrar el mapa se pliegan marca y filtros y queda solo la búsqueda. */
  collapsed?: boolean;
  onExpand?: () => void;
}) {
  const conn = CONNECTION_TEXT[connection];
  const activeFilters = (filters.near ? 1 : 0) + (filters.onlyWithRoom ? 1 : 0) + filters.institutions.length;
  return (
    <header className="pointer-events-auto relative z-10 rounded-3xl bg-white/95 p-2.5 shadow-lg ring-1 ring-slate-900/5 backdrop-blur lg:rounded-none lg:bg-transparent lg:px-4 lg:pt-4 lg:pb-2 lg:shadow-none lg:ring-0">
      <Reveal open={!collapsed}>
        <div className="flex items-center justify-between gap-2 px-1 pb-2 lg:pb-2.5">
          <h1 className="flex min-w-0 items-center gap-2 text-base font-extrabold tracking-tight text-slate-900">
            <span className="relative size-7 shrink-0 overflow-hidden rounded-lg">
              <img src={BRAND_ICON_SRC} alt="" width={28} height={28} className="size-7" />
              {/* Barrido de radar sobre el logo mientras llegan datos en vivo. */}
              {connection === "live" && (
                <span
                  className="absolute inset-[3px] rounded-full bg-[conic-gradient(from_0deg,transparent_0deg,rgb(52_211_153/0.55)_40deg,transparent_70deg)] mix-blend-screen motion-safe:animate-[radar-spin_3.2s_linear_infinite] motion-reduce:hidden"
                  aria-hidden
                />
              )}
            </span>
            <span className="truncate">
              BiblioRadar <span className="font-semibold text-slate-400 max-[379px]:hidden">Madrid</span>
            </span>
          </h1>
          <div className="flex shrink-0 items-center gap-1.5 lg:gap-2">
            <span
              className="flex items-center gap-1.5 text-xs font-medium text-slate-500"
              role="status"
              title={conn.label}
            >
              <span className="relative flex size-2">
                {connection === "live" && (
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                )}
                <span className={`relative inline-flex size-2 rounded-full ${conn.dot}`} />
              </span>
              {/* En la columna fija de 400 px (md+) o en móviles estrechos basta el punto. */}
              <span className="max-[429px]:sr-only lg:sr-only">{conn.label}</span>
            </span>
            {view === "map" && <span className="contents lg:hidden">{activityAction?.(true)}</span>}
            <ShareAppButton />
            <InstallAppButton />
          </div>
        </div>
      </Reveal>

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
            onFocus={onExpand}
            placeholder="Busca biblioteca o distrito…"
            className="h-10 w-full rounded-2xl lg:h-11 bg-slate-100 pr-10 pl-10 text-[16px] text-slate-900 placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-900 focus:outline-none lg:text-sm [&::-webkit-search-cancel-button]:hidden"
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

        {collapsed && (
          <button
            type="button"
            onClick={onExpand}
            aria-label={activeFilters ? `Mostrar filtros (${activeFilters} activos)` : "Mostrar filtros"}
            className="anim-pop relative grid size-10 shrink-0 place-items-center rounded-2xl bg-slate-100 text-slate-700 transition active:scale-[0.97] hover:bg-slate-200 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:outline-none lg:hidden"
          >
            <SlidersHorizontal className="size-4" />
            {activeFilters > 0 && (
              <span className="absolute -top-1 -right-1 grid h-4 min-w-4 place-items-center rounded-full bg-slate-900 px-1 text-[10px] font-semibold text-white ring-2 ring-white">
                {activeFilters}
              </span>
            )}
          </button>
        )}
      </div>

      <Reveal open={!collapsed} className="-mx-2.5 lg:mx-0">
        <div className="flex gap-1.5 overflow-x-auto px-2.5 pt-2 pb-0.5 [scrollbar-width:none] lg:flex-wrap lg:gap-2 lg:px-0 lg:pt-2.5 [&::-webkit-scrollbar]:hidden">
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
      </Reveal>

      {/* En el mapa móvil «Actividad» va como icono arriba y «Sugerencias» queda en la vista de lista. */}
      <div
        className={`mt-1.5 items-center justify-between gap-1 lg:mt-2 ${view === "map" ? "hidden lg:flex" : "flex"}`}
      >
        <FeedbackButton libraries={libraries} compact />
        {activityAction?.(false)}
      </div>

      {geoMessage && (
        <div
          className="mt-2 flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900"
          role="alert"
        >
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
