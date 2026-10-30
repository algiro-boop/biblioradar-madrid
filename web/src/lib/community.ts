import type { OccupancyStatus } from "./types";

export const TAG_GROUPS = [
  { label: "Enchufes", tags: ["sockets_free", "sockets_full"] },
  { label: "Ambiente", tags: ["silent", "noisy"] },
  { label: "Clima", tags: ["temp_ok", "temp_cold", "temp_hot"] },
] as const;
export type ReportTag = (typeof TAG_GROUPS)[number]["tags"][number];
export const TAG_LABELS: Record<ReportTag, string> = {
  sockets_free: "🔌 Enchufes libres", sockets_full: "🪫 Pocos enchufes",
  silent: "🤫 Silencio total", noisy: "🗣️ Algo de ruido",
  temp_ok: "🌡️ Clima ideal", temp_cold: "🥶 Hace frío", temp_hot: "🥵 Hace calor",
};
export type CommunityReport = {
  library_id: string; library_name: string; district: string;
  reported_value: number; tags: ReportTag[]; created_at: string;
};
export function isReportTag(value: unknown): value is ReportTag {
  return typeof value === "string" && Object.hasOwn(TAG_LABELS, value);
}
export function validTags(value: unknown): value is ReportTag[] {
  return Array.isArray(value) && value.length <= 3 && value.every(isReportTag)
    && TAG_GROUPS.every((group) => value.filter((tag) => (group.tags as readonly string[]).includes(tag)).length <= 1);
}
export function toggleTag(tags: ReportTag[], tag: ReportTag): ReportTag[] {
  const group = TAG_GROUPS.find((g) => (g.tags as readonly string[]).includes(tag))!;
  const rest = tags.filter((t) => !(group.tags as readonly string[]).includes(t));
  return tags.includes(tag) ? rest : [...rest, tag];
}
export function recentAt(timestamp: string | null | undefined, now: number, minutes: number): boolean {
  const time = Date.parse(timestamp ?? "");
  return Number.isFinite(time) && time <= now && now - time < minutes * 60_000;
}
export function liveLabel(status: OccupancyStatus | null, now: number): string | null {
  if (status?.is_open_now !== true) return null;
  if (!recentAt(status.latest_report_at, now, 90)) return "📊 Estimado · ¿Estás aquí?";
  const minutes = Math.floor((now - Date.parse(status.latest_report_at!)) / 60_000);
  return minutes < 2 ? "En vivo · confirmado ahora" : `En vivo · hace ${minutes} min`;
}
export function activeTags(status: OccupancyStatus | null, now: number): ReportTag[] {
  if (status?.is_open_now !== true || !recentAt(status.latest_report_at, now, 90)) return [];
  return (status.active_tags ?? []).filter((tag) => isReportTag(tag)
    && recentAt(status.active_tag_times?.[tag], now, 90));
}
export function parseCommunityReports(raw: unknown): CommunityReport[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) => {
    if (!r || typeof r.library_id !== "string" || typeof r.library_name !== "string"
      || typeof r.district !== "string" || typeof r.created_at !== "string"
      || !Number.isFinite(Date.parse(r.created_at)) || !Number.isInteger(r.reported_value)
      || r.reported_value < 0 || r.reported_value > 100 || !validTags(r.tags)) return [];
    // Explicit allowlist: never spread untrusted responses into public activity state.
    return [{ library_id: r.library_id, library_name: r.library_name, district: r.district,
      reported_value: r.reported_value, tags: r.tags, created_at: r.created_at }];
  });
}
