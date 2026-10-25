import type {
  InstitutionType,
  Library,
  LibraryRowWithEmbed,
  LibraryWithOccupancy,
  OccupancyLabel,
  OccupancyLevel,
  OccupancyStatus,
  OpeningHours,
} from "./types";

const LABELS: readonly OccupancyLabel[] = ["free", "moderate", "high", "full"];
const INSTITUTIONS: readonly InstitutionType[] = ["ayuntamiento", "comunidad", "ucm", "otra"];

/**
 * Convierte un valor a porcentaje entero 0..100 o NULL.
 * Ojo: `Number(null) === 0`, por eso null/undefined/"" se tratan explícitamente como desconocido.
 */
export function toPct(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n);
}

/** Misma regla que la columna generada `status_label` en PostgreSQL. */
export function labelFromPct(pct: number | null): OccupancyLabel | null {
  if (pct === null) return null;
  if (pct < 70) return "free";
  if (pct < 90) return "moderate";
  if (pct < 100) return "high";
  return "full";
}

export function getOccupancyLevel(status: OccupancyStatus | null | undefined): OccupancyLevel {
  if (!status || status.final_occupancy_pct === null) return "unknown";
  return status.status_label ?? labelFromPct(status.final_occupancy_pct) ?? "unknown";
}

/** Texto del pin: "45%" o "?" cuando no hay dato. Nunca "0%" por un NULL. */
export function formatPinText(pct: number | null | undefined): string {
  return typeof pct === "number" ? `${pct}%` : "?";
}

export function formatOccupancy(pct: number | null | undefined): string {
  return typeof pct === "number" ? `${pct}%` : "Sin datos recientes";
}

export function hasRoom(status: OccupancyStatus | null | undefined): boolean {
  // NULL no es "< 70": una biblioteca sin datos nunca aparece como "con sitio".
  return typeof status?.final_occupancy_pct === "number" && status.final_occupancy_pct < 70;
}

export const LEVEL_TEXT: Record<OccupancyLevel, string> = {
  free: "Hay sitio",
  moderate: "Bastante ocupada",
  high: "Casi llena",
  full: "Llena",
  unknown: "Sin datos",
};

/** Clases Tailwind por nivel. Literales completos para que Tailwind las detecte. */
export const LEVEL_STYLES: Record<
  OccupancyLevel,
  { bg: string; text: string; soft: string; ring: string; bar: string; dot: string }
> = {
  free: {
    bg: "bg-emerald-500",
    text: "text-white",
    soft: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    ring: "ring-emerald-500",
    bar: "bg-emerald-500",
    dot: "bg-emerald-500",
  },
  moderate: {
    bg: "bg-amber-400",
    text: "text-amber-950",
    soft: "bg-amber-50 text-amber-900 ring-amber-200",
    ring: "ring-amber-400",
    bar: "bg-amber-400",
    dot: "bg-amber-400",
  },
  high: {
    bg: "bg-orange-500",
    text: "text-white",
    soft: "bg-orange-50 text-orange-900 ring-orange-200",
    ring: "ring-orange-500",
    bar: "bg-orange-500",
    dot: "bg-orange-500",
  },
  full: {
    bg: "bg-red-600",
    text: "text-white",
    soft: "bg-red-50 text-red-800 ring-red-200",
    ring: "ring-red-600",
    bar: "bg-red-600",
    dot: "bg-red-600",
  },
  unknown: {
    bg: "bg-slate-400",
    text: "text-white",
    soft: "bg-slate-100 text-slate-600 ring-slate-200",
    ring: "ring-slate-400",
    bar: "bg-slate-300",
    dot: "bg-slate-400",
  },
};

export const INSTITUTION_TEXT: Record<InstitutionType, string> = {
  ayuntamiento: "Ayuntamiento",
  comunidad: "Comunidad",
  ucm: "UCM",
  otra: "Otra",
};

export const INSTITUTION_STYLES: Record<InstitutionType, string> = {
  ayuntamiento: "bg-sky-50 text-sky-800 ring-sky-200",
  comunidad: "bg-violet-50 text-violet-800 ring-violet-200",
  ucm: "bg-rose-50 text-rose-800 ring-rose-200",
  otra: "bg-slate-100 text-slate-700 ring-slate-200",
};

const relativeFormatter = new Intl.RelativeTimeFormat("es", { numeric: "auto" });

export function formatRelativeTime(iso: string | null | undefined, now: number): string {
  if (!iso) return "fecha desconocida";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "fecha desconocida";
  const diffSec = Math.round((t - now) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 45) return "ahora mismo";
  if (abs < 3600) return relativeFormatter.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return relativeFormatter.format(Math.round(diffSec / 3600), "hour");
  return relativeFormatter.format(Math.round(diffSec / 86400), "day");
}

const clockFormatter = new Intl.DateTimeFormat("es-ES", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Madrid",
});

export function formatClock(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? clockFormatter.format(t) : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

/** Valida una fila de `occupancy_status` (fetch o Realtime). Devuelve null si no es utilizable. */
export function parseOccupancyStatus(raw: unknown): OccupancyStatus | null {
  const r = asRecord(raw);
  if (!r || typeof r.library_id !== "string" || r.library_id.length === 0) return null;
  const finalPct = toPct(r.final_occupancy_pct);
  const rawLabel = r.status_label;
  const label =
    typeof rawLabel === "string" && (LABELS as readonly string[]).includes(rawLabel)
      ? (rawLabel as OccupancyLabel)
      : null;
  const reports = asFiniteNumber(r.active_reports_count);
  return {
    library_id: r.library_id,
    google_live_pct: toPct(r.google_live_pct),
    google_hist_pct: toPct(r.google_hist_pct),
    predicted_base_pct: toPct(r.predicted_base_pct),
    crowd_pct: toPct(r.crowd_pct),
    final_occupancy_pct: finalPct,
    // Con porcentaje NULL la etiqueta debe ser NULL aunque llegue otra cosa.
    status_label: finalPct === null ? null : (label ?? labelFromPct(finalPct)),
    base_source: asString(r.base_source, "Sin datos de ocupación"),
    base_observed_at: asNullableString(r.base_observed_at),
    base_valid_until: asNullableString(r.base_valid_until),
    primary_source: asString(r.primary_source, "Sin datos de ocupación"),
    active_reports_count: reports !== null && reports >= 0 ? Math.floor(reports) : 0,
    updated_at: asString(r.updated_at, new Date(0).toISOString()),
  };
}

function parseOpeningHours(raw: unknown): OpeningHours {
  const r = asRecord(raw) ?? {};
  return {
    timezone: asString(r.timezone, "Europe/Madrid"),
    raw_text: asString(r.raw_text),
    normalized_text: asString(r.normalized_text),
    weekly: asRecord(r.weekly),
    requires_review: typeof r.requires_review === "boolean" ? r.requires_review : true,
  };
}

export function parseLibrary(raw: unknown): Library | null {
  const r = asRecord(raw);
  if (!r || typeof r.id !== "string" || typeof r.name !== "string") return null;
  const lat = asFiniteNumber(r.lat);
  const lng = asFiniteNumber(r.lng);
  if (lat === null || lng === null) return null;
  const institution = (INSTITUTIONS as readonly string[]).includes(asString(r.institution))
    ? (r.institution as InstitutionType)
    : "otra";
  const seats = asFiniteNumber(r.total_seats);
  return {
    id: r.id,
    source: asString(r.source),
    source_id: asString(r.source_id),
    source_url: asNullableString(r.source_url),
    name: r.name,
    institution,
    address: asString(r.address),
    district: asString(r.district),
    lat,
    lng,
    google_place_id: asNullableString(r.google_place_id),
    opening_hours: parseOpeningHours(r.opening_hours),
    total_seats: seats !== null && seats > 0 ? Math.floor(seats) : null,
    created_at: asString(r.created_at),
    updated_at: asString(r.updated_at),
  };
}

/** Normaliza la fila embebida: PostgREST devuelve objeto en relaciones 1:1, array en versiones antiguas. */
export function parseLibraryRow(raw: unknown): LibraryWithOccupancy | null {
  const library = parseLibrary(raw);
  if (!library) return null;
  const embed = (raw as Partial<LibraryRowWithEmbed>).occupancy_status;
  const first = Array.isArray(embed) ? embed[0] : embed;
  const occupancy = first ? parseOccupancyStatus(first) : null;
  return { ...library, occupancy: occupancy && occupancy.library_id === library.id ? occupancy : null };
}

function isNewer(next: OccupancyStatus, current: OccupancyStatus | null): boolean {
  if (!current) return true;
  const a = Date.parse(next.updated_at);
  const b = Date.parse(current.updated_at);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return true;
  // Igual también se acepta: el trigger puede emitir dos cambios en la misma marca de tiempo.
  return a >= b;
}

/**
 * Aplica un estado recibido por Realtime. Ignora eventos fuera de orden (más antiguos que el actual).
 * Devuelve la misma referencia si no hay cambios, para evitar renders innecesarios.
 */
export function mergeOccupancy(
  libraries: LibraryWithOccupancy[],
  status: OccupancyStatus,
): LibraryWithOccupancy[] {
  let changed = false;
  const next = libraries.map((lib) => {
    if (lib.id !== status.library_id || !isNewer(status, lib.occupancy)) return lib;
    changed = true;
    return { ...lib, occupancy: status };
  });
  return changed ? next : libraries;
}

export function clearOccupancy(
  libraries: LibraryWithOccupancy[],
  libraryId: string,
): LibraryWithOccupancy[] {
  let changed = false;
  const next = libraries.map((lib) => {
    if (lib.id !== libraryId || lib.occupancy === null) return lib;
    changed = true;
    return { ...lib, occupancy: null };
  });
  return changed ? next : libraries;
}
