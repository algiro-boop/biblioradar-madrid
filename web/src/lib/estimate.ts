// Estimación horaria en el navegador, idéntica a `biblioradar.engine.heuristic_base` y a los
// horarios de `biblioradar.update_job`. Se usa cuando la base del cron ha caducado (p. ej. a las
// 09:00, al abrir) para no esperar a la siguiente ejecución. Paridad: src/__tests__/estimate.test.ts.

import { labelFromPct } from "./occupancy";
import type { Library, LibraryWithOccupancy, OccupancyStatus, OpeningHours } from "./types";

export const MADRID = "Europe/Madrid";
export const HEURISTIC_SOURCE = "Estimación horaria + contexto Madrid";
/** Los reportes cuentan 90 minutos: mientras haya alguno vigente manda la fusión del servidor. */
const REPORT_WINDOW_MS = 90 * 60 * 1000;

const HOURLY_CURVE: ReadonlyArray<readonly [number, number]> = [
  [0, 5],
  [7, 5],
  [8, 10],
  [9, 30],
  [10, 48],
  [11, 58],
  [12, 62],
  [13, 60],
  [14, 45],
  [15, 40],
  [16, 50],
  [17, 58],
  [18, 62],
  [19, 57],
  [20, 48],
  [20.5, 38],
  [21, 25],
  [22, 12],
  [23, 6],
  [24, 5],
];
const DEFAULT_OPEN_FROM = 8.5;
const DEFAULT_OPEN_UNTIL = 21;
const HEURISTIC_CAP = 90;
const CURVE_PEAK = Math.max(...HOURLY_CURVE.map(([, v]) => v));
const SPREAD = 7;

export type LocalTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** ISO: 1 = lunes … 7 = domingo. */
  isoWeekday: number;
};

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const formatters = new Map<string, Intl.DateTimeFormat>();

/** Fecha y hora de pared en `timeZone` (por defecto Madrid, con su cambio CET/CEST). */
export function localTime(t: number, timeZone: string = MADRID): LocalTime {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
      hourCycle: "h23",
    });
    formatters.set(timeZone, formatter);
  }
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(t)) parts[part.type] = part.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    isoWeekday: WEEKDAYS[parts.weekday ?? ""] ?? 1,
  };
}

export function isExamPeriod(month: number, day: number): boolean {
  const md = month * 100 + day;
  return md >= 1115 || md <= 131 || (md >= 425 && md <= 630);
}

/** Igual que `ingest.fold`: minúsculas, sin tildes, solo palabras [a-z0-9]. */
export function fold(text: string): string {
  return (asciiLower(text).match(/[a-z0-9]+/g) ?? []).join(" ");
}

/** NFKD y descarte de lo no ASCII, como `.encode("ascii", "ignore")` en Python. */
function asciiLower(text: string): string {
  return text.normalize("NFKD").replace(/[^\x00-\x7f]/g, "").toLowerCase();
}

const STUDENT_DISTRICTS = new Set(
  ["Moncloa-Aravaca", "Chamberí", "Centro", "Ciudad Lineal", "Salamanca", "Retiro"].map(fold),
);
const STUDY_ROOM = /\b(?:sala|salas|aula|espacio) de (?:estudios?|lectura)\b/;

// SHA-256 síncrono (FIPS 180-4) para la variación estable por centro, igual que en Python.
const K = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256(message: string): Uint8Array {
  const data = new TextEncoder().encode(message);
  const blocks = Math.ceil((data.length + 9) / 64);
  const padded = new Uint8Array(blocks * 64);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bits = data.length * 8;
  view.setUint32(padded.length - 8, Math.floor(bits / 2 ** 32));
  view.setUint32(padded.length - 4, bits >>> 0);
  const h = Uint32Array.from([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15]!;
      const b = w[i - 2]!;
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let a = h[0]!;
    let b = h[1]!;
    let c = h[2]!;
    let d = h[3]!;
    let e = h[4]!;
    let f = h[5]!;
    let g = h[6]!;
    let hh = h[7]!;
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const t1 = (hh + s1 + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const t2 = (s0 + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    [a, b, c, d, e, f, g, hh].forEach((value, i) => {
      h[i] = (h[i]! + value) >>> 0;
    });
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  h.forEach((value, i) => outView.setUint32(i * 4, value));
  return out;
}

type LibraryContext = Pick<Library, "id" | "name" | "institution" | "district">;

/** Puntos del centro en hora punta, como `engine.library_points`. */
export function libraryPoints(library: Partial<LibraryContext>, weekend: boolean): number {
  let points = 0;
  if (library.institution === "ucm" || library.institution === "comunidad") points += weekend ? 12 : 8;
  if (STUDY_ROOM.test(fold(library.name ?? ""))) points += 6;
  if (STUDENT_DISTRICTS.has(fold(library.district ?? ""))) points += 5;
  const digest = sha256(String(library.id || library.name || ""));
  let first8 = 0n;
  for (let i = 0; i < 8; i++) first8 = (first8 << 8n) | BigInt(digest[i]!);
  return points + Number(first8 % BigInt(2 * SPREAD + 1)) - SPREAD;
}

/** Redondeo con mitades hacia arriba (Decimal ROUND_HALF_UP), tolerante al error de coma flotante. */
function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5 + 1e-9);
}

/**
 * Estimación sin fuentes de afluencia. `null` si está cerrada o no se puede saber.
 * `openNow = null` (horario desconocido) solo estima de lunes a viernes de 8:30 a 21:00 (Madrid).
 */
export function heuristicBase(
  t: number,
  isRaining: boolean,
  openNow: boolean | null,
  library?: Partial<LibraryContext>,
): number | null {
  if (openNow === false) return null;
  const local = localTime(t);
  const hour = local.hour + local.minute / 60;
  const weekday = local.isoWeekday;
  if (openNow === null && (weekday >= 6 || hour < DEFAULT_OPEN_FROM || hour >= DEFAULT_OPEN_UNTIL)) {
    return null;
  }
  let base = 0;
  for (let i = 0; i < HOURLY_CURVE.length - 1; i++) {
    const [h0, v0] = HOURLY_CURVE[i]!;
    const [h1, v1] = HOURLY_CURVE[i + 1]!;
    if (h0 <= hour && hour < h1) {
      base = v0 + (v1 - v0) * ((hour - h0) / (h1 - h0));
      break;
    }
  }
  if (library) base += (base * libraryPoints(library, weekday >= 6)) / CURVE_PEAK;
  const exams = isExamPeriod(local.month, local.day);
  if (weekday === 6) base *= exams ? 0.95 : 0.75;
  else if (weekday === 7) base *= exams ? 0.9 : 0.65;
  if (exams) base *= 1.25;
  if (isRaining) base *= 1.1;
  return Math.max(1, Math.min(HEURISTIC_CAP, roundHalfUp(base)));
}

function hhmm(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parts = value.split(":");
  if (parts.length !== 2 || !parts.every((p) => /^\s*\+?\d+\s*$/.test(p))) return null;
  const [hour, minutes] = parts.map(Number) as [number, number];
  if (!(hour >= 0 && hour <= 24 && minutes >= 0 && minutes < 60 && (hour < 24 || minutes === 0))) return null;
  return hour * 60 + minutes;
}

/** Horario revisado (`weekly` ISO 1..7, `date_overrides`), como `update_job.opening_status`. */
export function openingStatus(hours: OpeningHours | null | undefined, t: number): boolean | null {
  if (!hours || hours.requires_review !== false) return null;
  const weekly = hours.weekly;
  if (!weekly) return null;
  let local: LocalTime;
  try {
    local = localTime(t, hours.timezone || MADRID);
  } catch {
    return null;
  }
  const raw = (hours as OpeningHours & { date_overrides?: unknown }).date_overrides;
  if (raw !== undefined && (typeof raw !== "object" || raw === null || Array.isArray(raw))) return null;
  const overrides = (raw ?? {}) as Record<string, unknown>;
  for (const delta of [0, 1]) {
    const date = new Date(Date.UTC(local.year, local.month - 1, local.day - delta));
    const iso = date.toISOString().slice(0, 10);
    const isoWeekday = ((date.getUTCDay() + 6) % 7) + 1;
    const intervals = iso in overrides ? overrides[iso] : weekly[String(isoWeekday)];
    if (intervals === null || intervals === undefined) return null;
    if (!Array.isArray(intervals)) return null;
    for (const interval of intervals) {
      if (!Array.isArray(interval) || interval.length !== 2) return null;
      const start = hhmm(interval[0]);
      let end = hhmm(interval[1]);
      if (start === null || end === null) return null;
      if (end <= start) end += 1440;
      const current = delta * 1440 + local.hour * 60 + local.minute;
      if (start <= current && current < end) return true;
    }
  }
  return false;
}

const MONTHS = "enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre";
const DECLARED_DAYS = /apertura de lunes a (viernes|sabado|domingo)\b/;
const SEASONAL = new RegExp(
  `^(?:horario\\s+(?:especial\\s+)?(?:de\\s+)?)?(?:${MONTHS.split(" ").join("|")}|verano|invierno|navidad|semana santa|examenes|campana)\\b`,
);
const DATED = new RegExp(`\\d+\\s+de\\s+(?:${MONTHS.split(" ").join("|")})\\b`);
const CLOSED_WORDS = /cerrad|cierr|no abre/;
const TIME_RANGE = /(\d{1,2})(?::(\d{2}))?\s*h?\s*(?:a|-|–)\s*(\d{1,2})(?::(\d{2}))?\b/g;
const WEEKEND_MENTION: Record<6 | 7, RegExp> = {
  6: /sabado|fines? de semana|todos los dias|lunes a (?:a )?domingo/,
  7: /domingo|fines? de semana|todos los dias/,
};
const WEEKEND_EXPLICIT: Record<6 | 7, RegExp> = {
  6: /sabado|fines? de semana/,
  7: /domingo|fines? de semana/,
};

function stripChars(text: string, chars: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && chars.includes(text[start]!)) start++;
  while (end > start && chars.includes(text[end - 1]!)) end--;
  return text.slice(start, end);
}

/** Sábado o domingo según el texto del catálogo, como `update_job.published_weekend_status`. */
export function publishedWeekendStatus(hours: OpeningHours | null | undefined, t: number): boolean | null {
  if (!hours) return null;
  const local = localTime(t);
  const weekday = local.isoWeekday;
  if (weekday !== 6 && weekday !== 7) return null;
  const text = asciiLower(hours.normalized_text || hours.raw_text || "");
  const declared = DECLARED_DAYS.exec(text);
  if (declared && (declared[1] === "viernes" || (weekday === 7 && declared[1] !== "domingo"))) return false;
  let dayOpen = declared !== null;
  const intervals: Array<[number, number]> = [];
  for (const piece of text.split(/[.;\n]+/)) {
    const clause = stripChars(piece, " ,:()");
    const closed = CLOSED_WORDS.test(clause);
    if (closed && WEEKEND_EXPLICIT[weekday].test(clause) && !DATED.test(clause)) return false;
    const mention = WEEKEND_MENTION[weekday].exec(clause);
    if (closed || !mention || SEASONAL.test(clause)) continue;
    let ranges = [...clause.slice(mention.index).matchAll(TIME_RANGE)];
    if (ranges.length === 0) ranges = [...clause.matchAll(TIME_RANGE)];
    if (ranges.length === 0 && mention[0] === "todos los dias") continue;
    dayOpen = true;
    for (const [, h0, m0, h1, m1] of ranges) {
      const start = Number(h0) * 60 + Number(m0 ?? 0);
      const end = Number(h1) * 60 + Number(m1 ?? 0);
      if (Number(h0) > 24 || Number(h1) > 24 || !(start < end && end <= 1440)) return null;
      intervals.push([start, end]);
    }
  }
  const current = local.hour * 60 + local.minute;
  if (intervals.length > 0) return intervals.some(([start, end]) => start <= current && current < end);
  if (dayOpen) return current >= DEFAULT_OPEN_FROM * 60 && current < DEFAULT_OPEN_UNTIL * 60 ? true : null;
  return null;
}

/** El navegador no conoce el horario de Google: horario revisado y, en fin de semana, el texto. */
export function libraryOpenNow(library: Pick<Library, "opening_hours">, t: number): boolean | null {
  return openingStatus(library.opening_hours, t) ?? publishedWeekendStatus(library.opening_hours, t);
}

/** La base del cron sigue vigente (o hay reportes recientes que el servidor ya ha fusionado). */
export function serverStatusIsCurrent(status: OccupancyStatus | null, now: number): boolean {
  if (!status) return false;
  const updated = Date.parse(status.updated_at);
  if (status.active_reports_count > 0 && Number.isFinite(updated) && now - updated < REPORT_WINDOW_MS) {
    return true;
  }
  const validUntil = status.base_valid_until ? Date.parse(status.base_valid_until) : Number.NaN;
  return Number.isFinite(validUntil) && now < validUntil;
}

/**
 * Estado que se muestra ahora. Si la base del cron caducó (cambio de apertura o cron retrasado),
 * se sustituye por la estimación horaria vigente calculada aquí, sin avisos de desactualización.
 */
export function currentOccupancy(library: LibraryWithOccupancy, now: number): OccupancyStatus {
  const status = library.occupancy;
  const csvModel = library.historical_popularity?.model === "csv-v1";
  const validUntil = Date.parse(status?.base_valid_until ?? "");
  const current = csvModel
    ? Number.isFinite(validUntil) && now < validUntil
    : serverStatusIsCurrent(status, now);
  if (status && current) return status;
  if (csvModel) {
    // El posterior pertenece al servidor: nunca sustituirlo por la curva genérica antigua.
    return {
      library_id: library.id,
      google_live_pct: null,
      google_hist_pct: null,
      predicted_base_pct: null,
      crowd_pct: null,
      final_occupancy_pct: null,
      prior_occupancy: null,
      bayesian_occupancy: null,
      confidence_score: 0,
      is_open_now: null,
      status_label: null,
      base_source: "CSV pendiente de actualización",
      primary_source: "CSV pendiente de actualización",
      active_reports_count: 0,
      base_observed_at: null,
      base_valid_until: null,
      updated_at: status?.updated_at ?? new Date(0).toISOString(),
    };
  }
  const openNow = libraryOpenNow(library, now);
  const pct = heuristicBase(now, false, openNow, library);
  const source =
    pct !== null
      ? HEURISTIC_SOURCE
      : openNow === false
        ? openingStatus(library.opening_hours, now) === false
          ? "Cerrada según horario revisado"
          : "Cerrada según horario publicado"
        : "Sin datos de concurrencia";
  return {
    library_id: library.id,
    google_live_pct: null,
    google_hist_pct: null,
    predicted_base_pct: pct,
    crowd_pct: null,
    final_occupancy_pct: pct,
    status_label: labelFromPct(pct),
    base_source: source,
    base_observed_at: new Date(now).toISOString(),
    base_valid_until: null,
    primary_source: source,
    active_reports_count: 0,
    updated_at: status?.updated_at ?? new Date(0).toISOString(),
  };
}

/** Aplica `currentOccupancy` a todo el catálogo conservando la referencia de lo que no cambia. */
export function withCurrentOccupancy(libraries: LibraryWithOccupancy[], now: number): LibraryWithOccupancy[] {
  return libraries.map((library) => {
    const occupancy = currentOccupancy(library, now);
    return occupancy === library.occupancy
      ? library
      : { ...library, occupancy, estimatedLocally: library.historical_popularity?.model !== "csv-v1" };
  });
}
