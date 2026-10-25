import {
  formatPinText,
  getOccupancyLevel,
  INSTITUTION_STYLES,
  INSTITUTION_TEXT,
  LEVEL_STYLES,
  LEVEL_TEXT,
} from "@/lib/occupancy";
import type { InstitutionType, OccupancyStatus } from "@/lib/types";

export function InstitutionBadge({ institution }: { institution: InstitutionType }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${INSTITUTION_STYLES[institution]}`}
    >
      {INSTITUTION_TEXT[institution]}
    </span>
  );
}

/** Píldora compacta con el porcentaje y color semántico. NULL se muestra como "?", nunca "0%". */
export function OccupancyPill({
  status,
  size = "md",
}: {
  status: OccupancyStatus | null;
  size?: "sm" | "md";
}) {
  const level = getOccupancyLevel(status);
  const styles = LEVEL_STYLES[level];
  const pct = status?.final_occupancy_pct ?? null;
  const dims = size === "sm" ? "h-7 min-w-11 text-xs" : "h-10 min-w-14 text-sm";
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full px-2.5 font-bold tabular-nums ${dims} ${styles.bg} ${styles.text}`}
      aria-label={pct === null ? "Sin datos de ocupación" : `Ocupación ${pct} por ciento, ${LEVEL_TEXT[level]}`}
      title={LEVEL_TEXT[level]}
    >
      {formatPinText(pct)}
    </span>
  );
}

export function LevelText({ status }: { status: OccupancyStatus | null }) {
  const level = getOccupancyLevel(status);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${LEVEL_STYLES[level].soft}`}
    >
      <span className={`size-1.5 rounded-full ${LEVEL_STYLES[level].dot}`} aria-hidden />
      {LEVEL_TEXT[level]}
    </span>
  );
}
