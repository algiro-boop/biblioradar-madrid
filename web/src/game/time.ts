/**
 * Fechas de juego en Europe/Madrid. Todo el progreso (días, semanas, rotación de la tienda)
 * se calcula con claves `YYYY-MM-DD` locales de Madrid, nunca con la hora del dispositivo,
 * así los cambios de hora de marzo/octubre no crean ni pierden días.
 */

export const GAME_TZ = "Europe/Madrid";
export const DAY_MS = 86_400_000;

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: GAME_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const partsFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: GAME_TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Día local de Madrid para un instante. */
export function madridDateKey(ms: number): string {
  return dateFormatter.format(new Date(ms));
}

function keyToUtcMs(key: string): number {
  const [y = 0, m = 1, d = 1] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function utcMsToKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Suma días de calendario a una clave (sin horas: inmune al DST). */
export function addDays(key: string, days: number): string {
  return utcMsToKey(keyToUtcMs(key) + days * DAY_MS);
}

/** Días de calendario de `a` a `b` (positivo si b es posterior). */
export function daysBetween(a: string, b: string): number {
  return Math.round((keyToUtcMs(b) - keyToUtcMs(a)) / DAY_MS);
}

/** 1 = lunes … 7 = domingo. */
export function weekday(key: string): number {
  const d = new Date(keyToUtcMs(key)).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Lunes de la semana natural (lunes–domingo) que contiene el día. */
export function weekStart(key: string): string {
  return addDays(key, 1 - weekday(key));
}

export function weekDates(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function yearOf(key: string): number {
  return Number(key.slice(0, 4));
}

/** Diferencia entre la hora de Madrid y UTC en ese instante, en ms. */
function madridOffsetMs(ms: number): number {
  const p = Object.fromEntries(partsFormatter.formatToParts(new Date(ms)).map((x) => [x.type, x.value])) as Record<string, string>;
  const n = (k: string) => Number(p[k] ?? 0);
  const asUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Instante UTC de las 00:00 en Madrid de ese día (correcto también en días de cambio de hora). */
export function madridMidnightMs(key: string): number {
  const guess = keyToUtcMs(key);
  const first = guess - madridOffsetMs(guess);
  // Segunda pasada por si el desfase cambia entre la estimación y la medianoche real.
  return guess - madridOffsetMs(first);
}

/** Milisegundos hasta la próxima medianoche de Madrid. */
export function msUntilMadridMidnight(now: number): number {
  return madridMidnightMs(addDays(madridDateKey(now), 1)) - now;
}

const WEEKDAYS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export function formatDateKey(key: string, withWeekday = false): string {
  const [, m = 1, d = 1] = key.split("-").map(Number);
  const base = `${d} ${MONTHS[m - 1]}`;
  return withWeekday ? `${WEEKDAYS[weekday(key) - 1]} ${base}` : base;
}

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, "0")} min` : `${m}:${String(s).padStart(2, "0")}`;
}
