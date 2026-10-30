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
      aria-label={level === "closed" ? "Biblioteca cerrada" : pct === null ? "Sin datos de ocupación" : `Ocupación ${pct} por ciento, ${LEVEL_TEXT[level]}`}
      title={LEVEL_TEXT[level]}
    >
      {level === "closed" ? "Cerrada" : formatPinText(pct)}
    </span>
  );
}

// Color del trazo del anillo por nivel (literal para que Tailwind lo detecte).
const RING_STROKE: Record<ReturnType<typeof getOccupancyLevel>, string> = {
  free: "stroke-emerald-500",
  moderate: "stroke-amber-400",
  high: "stroke-orange-500",
  full: "stroke-red-600",
  closed: "stroke-slate-300",
  unknown: "stroke-slate-300",
};

/**
 * Anillo de ocupación: se rellena al aparecer y se desliza al cambiar en vivo.
 * NULL se muestra como "?" y cerrada como icono de candado textual, nunca "0%".
 */
export function OccupancyRing({ status, size = 52 }: { status: OccupancyStatus | null; size?: number }) {
  const level = getOccupancyLevel(status);
  const pct = status?.final_occupancy_pct ?? null;
  const shown = level === "closed" || pct === null ? 0 : Math.max(pct, 4);
  const r = 21;
  const circumference = 2 * Math.PI * r;
  return (
    <span
      className="relative grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
      aria-label={level === "closed" ? "Biblioteca cerrada" : pct === null ? "Sin datos de ocupación" : `Ocupación ${pct} por ciento, ${LEVEL_TEXT[level]}`}
      title={LEVEL_TEXT[level]}
      role="img"
    >
      <svg viewBox="0 0 48 48" className="absolute inset-0 size-full -rotate-90" aria-hidden>
        <circle cx="24" cy="24" r={r} fill="none" strokeWidth="5" className="stroke-slate-100" />
        <circle
          cx="24"
          cy="24"
          r={r}
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - shown / 100)}
          className={`${RING_STROKE[level]} anim-ring transition-[stroke-dashoffset] duration-700 ease-[var(--ease-out-soft)]`}
          style={{ ["--ring-from" as string]: circumference }}
        />
      </svg>
      <span
        className={`relative font-bold tabular-nums leading-none ${
          level === "closed" ? "text-[9px] tracking-tight text-slate-500 uppercase" : pct === null ? "text-sm text-slate-400" : "text-[13px] text-slate-900"
        }`}
      >
        {level === "closed" ? "Cerrada" : formatPinText(pct)}
      </span>
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
