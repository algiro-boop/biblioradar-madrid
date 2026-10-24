import type { ReportValue } from "./types";

export const DEVICE_HASH_PATTERN = /^[0-9a-f]{64}$/;
export const REPORT_COOLDOWN_MS = 30 * 60 * 1000;

const DEVICE_ID_KEY = "biblioradar:device-id:v1";
const RECENT_REPORTS_KEY = "biblioradar:recent-reports:v1";
const HASH_NAMESPACE = "biblioradar-madrid:device:v1:";

/** Subconjunto de `Storage` para poder inyectar un almacén en tests o en modo privado. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface DeviceDeps {
  storage?: KeyValueStorage | null;
  crypto?: Crypto;
}

class MemoryStorage implements KeyValueStorage {
  private readonly data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

// Si localStorage está bloqueado (modo privado estricto), el identificador dura lo que la pestaña.
const memoryFallback = new MemoryStorage();

function defaultStorage(): KeyValueStorage {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const probe = "biblioradar:probe";
      window.localStorage.setItem(probe, "1");
      window.localStorage.removeItem(probe);
      return window.localStorage;
    }
  } catch {
    // Acceso denegado: usar memoria.
  }
  return memoryFallback;
}

function resolveCrypto(deps?: DeviceDeps): Crypto {
  const c = deps?.crypto ?? (typeof globalThis !== "undefined" ? globalThis.crypto : undefined);
  if (!c?.subtle || typeof c.getRandomValues !== "function") {
    throw new InsecureContextError();
  }
  return c;
}

export class InsecureContextError extends Error {
  constructor() {
    super("Este navegador no ofrece criptografía segura. Abre la web con HTTPS.");
    this.name = "InsecureContextError";
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** UUID v4. Usa `randomUUID` si existe y si no lo construye con `getRandomValues`. */
export function randomUuid(c: Crypto): string {
  if (typeof c.randomUUID === "function") return c.randomUUID();
  const bytes = c.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Identificador aleatorio local; se crea una vez y se reutiliza. No contiene datos personales. */
export function getOrCreateDeviceId(deps?: DeviceDeps): string {
  const storage = deps?.storage ?? defaultStorage();
  let existing: string | null = null;
  try {
    existing = storage.getItem(DEVICE_ID_KEY);
  } catch {
    existing = null;
  }
  if (existing && UUID_PATTERN.test(existing)) return existing;
  const id = randomUuid(resolveCrypto(deps));
  try {
    storage.setItem(DEVICE_ID_KEY, id);
  } catch {
    // Cuota llena o almacenamiento bloqueado: el id vale para esta sesión.
  }
  return id;
}

export function isValidDeviceHash(value: unknown): value is string {
  return typeof value === "string" && DEVICE_HASH_PATTERN.test(value);
}

/** SHA-256 (hex minúsculas, 64 caracteres) del identificador local, como exige `submit_report`. */
export async function computeDeviceHash(deviceId: string, deps?: DeviceDeps): Promise<string> {
  const c = resolveCrypto(deps);
  const data = new TextEncoder().encode(HASH_NAMESPACE + deviceId);
  const hash = toHex(await c.subtle.digest("SHA-256", data)).toLowerCase();
  if (!isValidDeviceHash(hash)) {
    throw new Error("No se pudo generar un identificador de dispositivo válido.");
  }
  return hash;
}

let cachedHash: Promise<string> | null = null;

export function getDeviceHash(deps?: DeviceDeps): Promise<string> {
  if (deps) return computeDeviceHash(getOrCreateDeviceId(deps), deps);
  if (!cachedHash) {
    cachedHash = computeDeviceHash(getOrCreateDeviceId()).catch((err: unknown) => {
      cachedHash = null;
      throw err;
    });
  }
  return cachedHash;
}

// ---------------------------------------------------------------------------
// Registro local de reportes recientes (feedback instantáneo, no sustituye al servidor).
// ---------------------------------------------------------------------------

export interface RecentReport {
  /** null si el servidor indicó límite alcanzado sin que conozcamos el valor original. */
  value: ReportValue | null;
  at: number;
}

type RecentReports = Record<string, RecentReport>;

const listeners = new Set<() => void>();

function readRecent(storage: KeyValueStorage, now: number): RecentReports {
  let parsed: unknown = null;
  try {
    const raw = storage.getItem(RECENT_REPORTS_KEY);
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  const result: RecentReports = {};
  if (typeof parsed !== "object" || parsed === null) return result;
  for (const [id, entry] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof entry !== "object" || entry === null) continue;
    const { value, at } = entry as { value?: unknown; at?: unknown };
    if (typeof at !== "number" || !Number.isFinite(at)) continue;
    if (now - at >= REPORT_COOLDOWN_MS || at - now > 60_000) continue;
    const v = value === 30 || value === 75 || value === 100 ? value : null;
    result[id] = { value: v, at };
  }
  return result;
}

export function recordRecentReport(
  libraryId: string,
  value: ReportValue | null,
  now = Date.now(),
  storage: KeyValueStorage = defaultStorage(),
): void {
  const recent = readRecent(storage, now);
  recent[libraryId] = { value, at: now };
  try {
    storage.setItem(RECENT_REPORTS_KEY, JSON.stringify(recent));
  } catch {
    // Sin persistencia: el servidor seguirá aplicando el límite.
  }
  listeners.forEach((fn) => fn());
}

export function getRecentReport(
  libraryId: string,
  now = Date.now(),
  storage: KeyValueStorage = defaultStorage(),
): RecentReport | null {
  return readRecent(storage, now)[libraryId] ?? null;
}

/** Minutos (redondeados hacia arriba) hasta poder volver a reportar; 0 si ya se puede. */
export function minutesUntilNextReport(
  libraryId: string,
  now = Date.now(),
  storage: KeyValueStorage = defaultStorage(),
): number {
  const recent = getRecentReport(libraryId, now, storage);
  if (!recent) return 0;
  return Math.max(1, Math.ceil((recent.at + REPORT_COOLDOWN_MS - now) / 60000));
}

/** Notifica cambios del registro (esta pestaña y otras, vía evento `storage`). */
export function subscribeRecentReports(fn: () => void): () => void {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key === RECENT_REPORTS_KEY) fn();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}
