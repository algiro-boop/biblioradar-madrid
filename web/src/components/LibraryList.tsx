"use client";

import { ChevronRight, RotateCw, SearchX } from "lucide-react";
import type { LibraryListItem } from "@/lib/filters";
import { formatDistance } from "@/lib/geo";
import { formatRelativeTime, hasRoom } from "@/lib/occupancy";
import { InstitutionBadge, LevelText, OccupancyPill } from "./Badges";
import { CapacityText } from "./CapacityText";

function SkeletonCard() {
  return (
    <li className="flex animate-pulse items-center gap-3 rounded-2xl bg-white p-3.5 ring-1 ring-slate-200">
      <span className="h-10 w-14 rounded-full bg-slate-200" />
      <span className="flex-1 space-y-2">
        <span className="block h-3.5 w-3/4 rounded bg-slate-200" />
        <span className="block h-3 w-1/2 rounded bg-slate-100" />
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
  onClearFilters: () => void;
  onRetry: () => void;
}) {
  const withRoom = items.filter((i) => hasRoom(i.library.occupancy)).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-4 pt-1 pb-2 text-xs text-slate-500">
        {loading && total === 0 ? (
          <span>Cargando bibliotecas…</span>
        ) : (
          <span>
            {items.length === total ? `${total} bibliotecas` : `${items.length} de ${total} bibliotecas`}
            {items.length > 0 && ` · ${withRoom} con sitio`}
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

        {items.map(({ library, distanceM }) => {
          const selected = library.id === selectedId;
          return (
            <li key={library.id}>
              <button
                type="button"
                onClick={() => onSelect(library.id)}
                aria-current={selected ? "true" : undefined}
                className={`flex w-full items-center gap-3 rounded-2xl bg-white p-3.5 text-left ring-1 transition hover:ring-slate-300 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:outline-none ${
                  selected ? "ring-2 ring-slate-900" : "ring-slate-200"
                }`}
              >
                <OccupancyPill status={library.occupancy} />
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
                </span>
                <ChevronRight className="size-4 shrink-0 text-slate-300" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
