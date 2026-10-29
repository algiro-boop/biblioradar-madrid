import type { OccupancyStatus } from "./types";

/** A new server snapshot can arrive between the UI's 30-second clock ticks. */
function evaluationTime(status: OccupancyStatus, now: number): number {
  const observed = Date.parse(status.base_observed_at ?? "");
  return observed > now && observed - now <= 30_000 ? observed : now;
}

export function currentReportPct(status: OccupancyStatus, now: number): number | null {
  if (status.is_open_now !== true || !status.full_reported_at || status.bayesian_occupancy == null) return null;
  return reportDisplayPct(status.bayesian_occupancy, status.full_reported_at, evaluationTime(status, now));
}

/** Identical to SQL report_display_pct: hold 10 min and fade for 5 min. */
export function reportDisplayPct(bayesian: number, fullAt: string | null | undefined, now: number): number {
  const age = now - Date.parse(fullAt ?? "");
  if (!Number.isFinite(age) || age < 0 || age >= 900_000) return bayesian;
  if (age <= 600_000) return 100;
  return Math.floor(bayesian + (100 - bayesian) * (900_000 - age) / 300_000 + 0.5);
}

export function fullReportNotice(status: OccupancyStatus | null, now: number): string | null {
  if (status?.is_open_now !== true) return null;
  const age = evaluationTime(status, now) - Date.parse(status.full_reported_at ?? "");
  if (!Number.isFinite(age) || age < 0 || age >= 900_000) return null;
  const minutes = Math.floor(age / 60_000);
  const when = minutes === 0 ? "ahora mismo" : `hace ${minutes} min`;
  return age <= 600_000 ? `Reportada completa ${when}` : `Reporte de sala completa ${when} · volviendo a la estimación`;
}
