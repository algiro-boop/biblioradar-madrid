"use client";

import { ChevronRight, RotateCw, SearchX } from "lucide-react";
import type { LibraryListItem } from "@/lib/filters";
import { formatDistance } from "@/lib/geo";
import { formatRelativeTime, hasRoom } from "@/lib/occupancy";
import { useCountUp } from "@/hooks/useCountUp";
import { staggerDelay } from "@/lib/motion";
import { InstitutionBadge, LevelText, OccupancyRing } from "./Badges";
import { CapacityText } from "./CapacityText";
import { ActiveTags, LiveStatusBadge } from "./CommunityStatus";
import { FullReportNotice } from "./FullReportNotice";

function SkeletonCard() {
  return (
    <li className="flex items-center gap-3 rounded-2xl bg-white p-3.5 ring-1 ring-slate-200" aria-hidden>
      <span className="skeleton size-[52px] rounded-full" />
      <span className="flex-1 space-y-2">
        <span className="skeleton block h-3.5 w-3/4 rounded" />
        <span className="skeleton block h-3 w-1/2 rounded" />
      </span>
    </li>
  );
}

export function LibraryList({
  items,
  total,
  loading,
  error,
  now,
  selectedId,
  filtersActive,
  onSelect,
  onRequestReport,
  onClearFilters,
  onRetry,
}: {
  items: LibraryListItem[];
  total: number;
  loading: boolean;
  error: string | null;
  now: number;
  selectedId: string | null;
  filtersActive: boolean;
  onSelect: (id: string) => void;
  onRequestReport?: (id: string) => void;
  onClearFilters: () => void;
  onRetry: () => void;
}) {
  const withRoom = items.filter((i) => hasRoom(i.library.occupancy)).length;
  const withRoomShown = useCountUp(items.length > 0 ? withRoom : null);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-4 pt-1 pb-2 text-xs text-slate-500">
        {loading && total === 0 ? (
          <span>Cargando bibliotecas…</span>
        ) : (
          <span className="flex items-center gap-2">
            <span>{items.length === total ? `${total} bibliotecas` : `${items.length} de ${total} bibliotecas`}</span>
            {items.length > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-200">
                <span className="relative flex size-1.5" aria-hidden>
                  <span className="absolute inline-flex size-full rounded-full bg-emerald-400 opacity-70 motion-safe:animate-ping" />
                  <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
                </span>
                <span className="tabular-nums">{withRoomShown ?? withRoom}</span> con sitio ahora
              </span>
            )}
          </span>
        )}
      </div>

      {error && (
        <div className="mx-4 mb-2 flex items-center justify-between gap-3 rounded-2xl bg-red-50 px-3.5 py-2.5 text-sm text-red-900 ring-1 ring-red-200">
          <span>{error}</span>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-semibold ring-1 ring-red-200 hover:bg-red-100"
          >
            <RotateCw className="size-3.5" /> Reintentar
          </button>
        </div>
      )}

      <ul className="flex-1 space-y-2 overflow-y-auto overscroll-contain px-4 pb-28 md:pb-6" aria-label="Bibliotecas">
        {loading && total === 0 && Array.from({ length: 6 }, (_, i) => <SkeletonCard key={i} />)}

        {!loading && items.length === 0 && total > 0 && (
          <li className="flex flex-col items-center gap-3 rounded-2xl bg-white px-6 py-10 text-center ring-1 ring-slate-200">
            <SearchX className="size-8 text-slate-300" />
            <p className="text-sm text-slate-600">Ninguna biblioteca coincide con tu búsqueda.</p>
            {filtersActive && (
              <button
                type="button"
                onClick={onClearFilters}
                className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
              >
                Limpiar filtros
              </button>
            )}
          </li>
        )}

        {items.map(({ library, distanceM }, index) => {
          const selected = library.id === selectedId;
          return (
            <li
              key={library.id}
              style={{ animationDelay: `${staggerDelay(index)}ms` }}
              className={`anim-rise rounded-2xl bg-white shadow-sm shadow-black/[0.03] transition-shadow hover:shadow-md hover:shadow-black/5 ${selected ? "ring-2 ring-slate-900" : "ring-1 ring-slate-200 hover:ring-slate-300"}`}
            >
              <button
                type="button"
                onClick={() => onSelect(library.id)}
                aria-current={selected ? "true" : undefined}
                className="group flex w-full items-center gap-3 rounded-2xl bg-white p-3.5 text-left transition active:scale-[0.985] focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:outline-none"
              >
                <OccupancyRing status={library.occupancy} />
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-sm leading-snug font-semibold text-slate-900">{library.name}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                    <InstitutionBadge institution={library.institution} />
                    <span className="truncate">{library.district}</span>
                    {distanceM !== null && <span className="font-medium text-slate-700">· {formatDistance(distanceM)}</span>}
                  </span>
                  <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <LevelText status={library.occupancy} />
                    <CapacityText library={library} className="text-xs font-medium text-slate-600" />
                    {library.occupancy?.final_occupancy_pct != null && (
                      <span className="text-[11px] text-slate-400">
                        {library.estimatedLocally ? "estimación horaria" : formatRelativeTime(library.occupancy.updated_at, now)}
                      </span>
                    )}
                  </span>
                  <FullReportNotice status={library.occupancy} now={now} />
                </span>
                <ChevronRight className="size-4 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5" />
              </button>
              {library.occupancy?.is_open_now === true && <div className="px-3.5 pb-3">
                <LiveStatusBadge status={library.occupancy} now={now} onReport={() => (onRequestReport ?? onSelect)(library.id)} />
                <ActiveTags status={library.occupancy} now={now} />
              </div>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
