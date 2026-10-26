import { track } from "@vercel/analytics";
import { isPwaMetric, launchContext, metricsOS, type PwaMetric } from "./pwa-metrics";

export const FIRST_OPEN_KEY = "biblioradar_install_tracked";
export const QUEUE_KEY = "biblioradar_metrics_pending_v1";
const CLIENT_KEY = "biblioradar_metrics_client_v1";
const ENDPOINT = "/api/metrics/install";

interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }
interface TrackerDeps {
  storage: StorageLike;
  lock?: (action: () => void) => Promise<void>;
  uuid: () => string;
  now: () => Date;
  context: () => ReturnType<typeof launchContext>;
  os: PwaMetric["os"];
  send: (event: PwaMetric) => Promise<boolean>;
  analytics: (name: string, event: PwaMetric) => void;
}

/** Inyectable para probar persistencia, errores de red y detección sin navegador. */
export function createPwaTracker(deps: TrackerDeps) {
  let opened = false;
  let installRecorded = false;
  let sending = false;
  let lastStandalone = false;
  let lastConfirmed = false;
  const locked = (action: () => void) => {
    if (deps.lock) return deps.lock(action);
    try { action(); return Promise.resolve(); }
    catch (error) { return Promise.reject(error); }
  };
  const memory = new Map<string, string>();
  function get(key: string) {
    try { return deps.storage.getItem(key) ?? memory.get(key) ?? null; }
    catch { return memory.get(key) ?? null; }
  }
  function set(key: string, value: string) {
    memory.set(key, value);
    try { deps.storage.setItem(key, value); } catch { /* Modo privado: deduplicación en memoria. */ }
  }
  function clientId(): string {
    const existing = get(CLIENT_KEY);
    if (existing && isPwaMetric({ event_id: existing, client_id: existing, type: "browser_open", os: deps.os,
      evidence: "browser", confirmed_standalone: false, first_open: false, occurred_at: deps.now().toISOString() })) return existing;
    const id = deps.uuid();
    set(CLIENT_KEY, id);
    return id;
  }
  function pending(): PwaMetric[] {
    try {
      const value: unknown = JSON.parse(get(QUEUE_KEY) ?? "[]");
      return Array.isArray(value) ? value.filter(isPwaMetric).slice(0, 100) : [];
    } catch { return []; }
  }
  function enqueue(event: PwaMetric) {
    const rows = pending().filter((row) => row.event_id !== event.event_id);
    rows.push(event);
    // Conservar instalaciones/primeras aperturas si una desconexión acumula muchas visitas.
    const priority = rows.filter((row) => row.type === "install" || row.first_open);
    const ordinary = rows.filter((row) => row.type !== "install" && !row.first_open);
    set(QUEUE_KEY, JSON.stringify([...priority.slice(-50), ...ordinary.slice(-50)]));
  }
  async function flush() {
    if (sending) return;
    sending = true;
    try {
      for (;;) {
        const event = pending()[0];
        if (!event) break;
        let ok = false;
        try { ok = await deps.send(event); } catch { /* Reintentar con el mismo event_id. */ }
        if (!ok) break;
        await locked(() => set(QUEUE_KEY, JSON.stringify(pending().filter((row) => row.event_id !== event.event_id))));
      }
    } finally { sending = false; }
  }
  function record(type: PwaMetric["type"], first = false) {
    const context = deps.context();
    const occurredAt = deps.now().toISOString();
    void locked(() => {
      first = first && get(FIRST_OPEN_KEY) !== "1";
      const id = clientId();
      const event: PwaMetric = {
        event_id: first ? `${id}:first-open` : deps.uuid(), client_id: id, type, os: deps.os,
        evidence: context.evidence, confirmed_standalone: context.confirmed,
        first_open: first, occurred_at: occurredAt,
      };
      enqueue(event);
      if (first) set(FIRST_OPEN_KEY, "1"); // La cola persistente conserva el evento si no hay red.
      try {
        deps.analytics(type === "install" ? "pwa_installed" : first ? "pwa_first_open" : "app_open", event);
        // La primera apertura también forma parte del denominador de accesos.
        if (first) deps.analytics("app_open", event);
      } catch { /* Analítica bloqueada/no disponible: el endpoint sigue siendo independiente. */ }
    }).then(() => flush()).catch(() => { /* Telemetría: nunca propagar errores a la app. */ });
  }
  return {
    open() {
      if (opened) return;
      opened = true;
      const context = deps.context();
      lastStandalone = context.standalone;
      lastConfirmed = context.confirmed;
      record(context.standalone ? "standalone_open" : "browser_open", context.standalone && get(FIRST_OPEN_KEY) !== "1");
    },
    installed() {
      if (installRecorded) return;
      installRecorded = true;
      record("install"); // No marcar first_open: instalar y abrir son acciones diferentes.
    },
    modeChanged() {
      const context = deps.context();
      if (opened && context.standalone && (!lastStandalone || (context.confirmed && !lastConfirmed))) {
        record("standalone_open", true);
      }
      lastStandalone = context.standalone;
      lastConfirmed = context.confirmed;
    },
    flush,
  };
}

let running = false;
/** Una instancia por documento: no se duplica con StrictMode ni remontajes del layout. */
export function startPwaTracking(): void {
  if (typeof window === "undefined" || running) return;
  running = true;
  const fallback = new Map<string, string>();
  const storage: StorageLike = {
    getItem(key) { try { return window.localStorage.getItem(key); } catch { return fallback.get(key) ?? null; } },
    setItem(key, value) { fallback.set(key, value); try { window.localStorage.setItem(key, value); } catch { /* Memoria. */ } },
  };
  const tracker = createPwaTracker({
    storage,
    lock: navigator.locks ? async (action) => {
      let invoked = false;
      try { await navigator.locks.request("biblioradar-metrics", () => { invoked = true; action(); }); }
      catch (error) { if (!invoked) action(); else throw error; }
    } : undefined,
    uuid: () => {
      if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6]! & 0x0f) | 0x40;
      bytes[8] = (bytes[8]! & 0x3f) | 0x80;
      const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }, now: () => new Date(),
    context: () => launchContext(window as Window & { navigator: { standalone?: boolean } }),
    os: metricsOS(navigator.userAgent, navigator.maxTouchPoints),
    async send(event) {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(ENDPOINT, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(event), keepalive: true, credentials: "same-origin",
          signal: controller.signal,
        });
        return response.ok;
      } finally { window.clearTimeout(timeout); }
    },
    analytics(name, event) {
      // No enviar IDs persistentes ni User-Agent a Vercel Analytics.
      track(name, { os: event.os, mode: event.evidence === "browser" ? "browser" : "pwa",
        evidence: event.evidence, confirmed_standalone: event.confirmed_standalone });
    },
  });
  window.addEventListener("appinstalled", tracker.installed);
  window.addEventListener("online", () => { void tracker.flush(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") { tracker.modeChanged(); void tracker.flush(); }
  });
  const mode = window.matchMedia("(display-mode: standalone)");
  if (mode.addEventListener) mode.addEventListener("change", tracker.modeChanged);
  else mode.addListener(tracker.modeChanged); // Safari anterior a MediaQueryList.addEventListener.
  tracker.open();
  // Un fallo temporal no necesita una recarga ni esperar a perder/recuperar la red.
  window.setInterval(() => { if (document.visibilityState === "visible") void tracker.flush(); }, 60_000);
}
