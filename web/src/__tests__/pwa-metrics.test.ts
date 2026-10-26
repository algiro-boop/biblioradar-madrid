import { describe, expect, it, vi } from "vitest";
import { isPwaMetric, launchContext, metricsOS, type PwaMetric } from "@/lib/pwa-metrics";
import { createPwaTracker, FIRST_OPEN_KEY, QUEUE_KEY, startPwaTracking } from "@/lib/pwa-tracker";
import { POST } from "@/app/api/metrics/install/route";
import manifest from "@/app/manifest";

const ID = "12345678-1234-4234-8234-123456789abc";
const NOW = "2026-10-26T10:00:00.000Z";
function fakeWindow(mode = false, ios = false, search = "") {
  return { matchMedia: () => ({ matches: mode }), navigator: { standalone: ios }, location: { search } };
}
function setup(context = launchContext(fakeWindow()), shared = new Map<string, string>()) {
  let counter = 0;
  const send = vi.fn(async (_event: PwaMetric) => true);
  const analytics = vi.fn();
  const storage = { getItem: (key: string) => shared.get(key) ?? null,
    setItem: (key: string, value: string) => { shared.set(key, value); } };
  const deps = { storage, uuid: () => `12345678-1234-4234-8234-${String(++counter).padStart(12, "0")}`,
    now: () => new Date(NOW), context: () => context, os: "Android" as const, send, analytics };
  return { tracker: createPwaTracker(deps), deps, shared, send, analytics };
}

const metric: PwaMetric = { event_id: ID, client_id: ID, type: "standalone_open", os: "iOS",
  evidence: "ios_standalone", confirmed_standalone: true, first_open: true, occurred_at: NOW };

describe("detección PWA sin SSR", () => {
  it("mantiene identidad del manifest y etiqueta el arranque", () => {
    expect(manifest()).toMatchObject({ id: "/", start_url: "/app", display: "standalone" });
    expect(() => startPwaTracking()).not.toThrow(); // window no existe en este entorno Node.
  });
  it("distingue el modo confirmado de la atribución de URL", () => {
    expect(launchContext({ ...fakeWindow(), location: { search: "", pathname: "/app" } })).toEqual({ evidence: "start_url", standalone: true, confirmed: false });
    expect(launchContext({ ...fakeWindow(), location: { search: "", pathname: "/app/" } })).toHaveProperty("standalone", true);
    expect(launchContext(fakeWindow())).toEqual({ evidence: "browser", standalone: false, confirmed: false });
    expect(launchContext(fakeWindow(true))).toEqual({ evidence: "display_mode", standalone: true, confirmed: true });
    expect(launchContext(fakeWindow(false, true))).toEqual({ evidence: "ios_standalone", standalone: true, confirmed: true });
    expect(launchContext(fakeWindow(false, false, "?source=pwa&utm_source=homescreen"))).toEqual({ evidence: "start_url", standalone: true, confirmed: false });
    expect(launchContext(fakeWindow(false, false, "?source=other"))).toHaveProperty("standalone", false);
  });
  it("identifica iOS incluyendo iPadOS con UA de escritorio", () => {
    expect(metricsOS("Mozilla iPhone Safari")).toBe("iOS");
    expect(metricsOS("Mozilla iPad")).toBe("iOS");
    expect(metricsOS("Mozilla Macintosh", 5)).toBe("iOS");
    expect(metricsOS("Mozilla Macintosh", 0)).toBe("Desktop");
    expect(metricsOS("Mozilla Android Chrome")).toBe("Android");
    expect(metricsOS("Mozilla Windows Chrome")).toBe("Desktop");
  });
});

describe("registro y cola persistente", () => {
  it("registra navegador una sola vez por documento", async () => {
    const { tracker, send, analytics } = setup();
    tracker.open(); tracker.open();
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(send.mock.calls[0]?.[0]).toMatchObject({ type: "browser_open", first_open: false });
    expect(analytics).toHaveBeenCalledWith("app_open", expect.anything());
  });
  it("instalar no consume la primera apertura y no se cuenta aceptar un prompt", async () => {
    const s = setup();
    s.tracker.installed(); s.tracker.installed();
    await vi.waitFor(() => expect(s.send).toHaveBeenCalledOnce());
    expect(s.shared.has(FIRST_OPEN_KEY)).toBe(false);
    expect(s.analytics).toHaveBeenCalledWith("pwa_installed", expect.objectContaining({ type: "install" }));
  });
  it("primera apertura se conserva entre recargas, pero cada acceso se registra", async () => {
    const shared = new Map<string, string>();
    const first = setup(launchContext(fakeWindow(false, true)), shared);
    first.tracker.open();
    await vi.waitFor(() => expect(first.send).toHaveBeenCalledOnce());
    expect(shared.get(FIRST_OPEN_KEY)).toBe("1");
    expect(first.analytics.mock.calls.map((c) => c[0])).toEqual(["pwa_first_open", "app_open"]);
    const next = setup(launchContext(fakeWindow(false, true)), shared);
    next.tracker.open();
    await vi.waitFor(() => expect(next.send).toHaveBeenCalledOnce());
    expect(next.send.mock.calls[0]?.[0]).toMatchObject({ type: "standalone_open", first_open: false });
    expect(next.analytics.mock.calls.map((c) => c[0])).toEqual(["app_open"]);
  });
  it("marca como inferido el fallback por query string", async () => {
    const s = setup(launchContext(fakeWindow(false, false, "?source=pwa")));
    s.tracker.open();
    await vi.waitFor(() => expect(s.send).toHaveBeenCalledOnce());
    expect(s.send.mock.calls[0]?.[0]).toMatchObject({ type: "standalone_open", evidence: "start_url", confirmed_standalone: false });
  });
  it("reintenta un fallo con el mismo identificador y sin duplicar analítica", async () => {
    const s = setup(launchContext(fakeWindow(true)));
    s.send.mockResolvedValueOnce(false).mockResolvedValue(true);
    s.tracker.open();
    await vi.waitFor(() => expect(s.send).toHaveBeenCalledOnce());
    const eventId = s.send.mock.calls[0]?.[0].event_id;
    expect(JSON.parse(s.shared.get(QUEUE_KEY)!)).toHaveLength(1);
    await s.tracker.flush();
    expect(s.send.mock.calls[1]?.[0].event_id).toBe(eventId);
    expect(JSON.parse(s.shared.get(QUEUE_KEY)!)).toEqual([]);
    expect(s.analytics).toHaveBeenCalledTimes(2);
  });
  it("recupera pendientes de una instancia anterior aunque la bandera ya esté marcada", async () => {
    const s = setup(launchContext(fakeWindow(true)));
    s.send.mockResolvedValue(false);
    s.tracker.open();
    await vi.waitFor(() => expect(s.send).toHaveBeenCalledOnce());
    const pending = s.send.mock.calls[0]?.[0];
    const next = setup(launchContext(fakeWindow(true)), s.shared);
    await next.tracker.flush();
    expect(next.send.mock.calls[0]?.[0]).toEqual(pending);
  });
  it("funciona con almacenamiento bloqueado y analítica que lanza un error", async () => {
    const s = setup(launchContext(fakeWindow(true)));
    s.deps.storage.getItem = () => { throw new Error("blocked"); };
    s.deps.storage.setItem = () => { throw new Error("blocked"); };
    s.deps.analytics.mockImplementation(() => { throw new Error("analytics blocked"); });
    const tracker = createPwaTracker(s.deps);
    tracker.open(); tracker.modeChanged();
    await vi.waitFor(() => expect(s.send).toHaveBeenCalledOnce());
  });
  it("serializa primeras aperturas entre dos pestañas con Web Locks", async () => {
    const shared = new Map<string, string>();
    const a = setup(launchContext(fakeWindow(true)), shared);
    const b = setup(launchContext(fakeWindow(true)), shared);
    let chain = Promise.resolve();
    const lock = (action: () => void) => { chain = chain.then(action); return chain; };
    const first = createPwaTracker({ ...a.deps, lock });
    const second = createPwaTracker({ ...b.deps, lock });
    first.open(); second.open();
    await vi.waitFor(() => {
      const events = [...a.analytics.mock.calls, ...b.analytics.mock.calls];
      expect(events.filter((event) => event[0] === "pwa_first_open")).toHaveLength(1);
      expect(events.filter((event) => event[0] === "app_open")).toHaveLength(2);
    });
  });
  it("detecta pasar de pestaña a standalone sin recargar", async () => {
    const s = setup();
    s.tracker.open();
    await vi.waitFor(() => expect(s.send).toHaveBeenCalledOnce());
    s.deps.context = () => launchContext(fakeWindow(true));
    s.tracker.modeChanged(); s.tracker.modeChanged();
    await vi.waitFor(() => expect(s.send).toHaveBeenCalledTimes(2));
    expect(s.send.mock.calls[1]?.[0]).toHaveProperty("first_open", true);
  });
});

describe("endpoint /api/metrics/install", () => {
  function request(body: unknown, extra: Record<string, string> = {}) {
    return new Request("https://biblioradar.test/api/metrics/install", { method: "POST",
      headers: { "Content-Type": "application/json", "Origin": "https://biblioradar.test", "User-Agent": "test-agent", ...extra },
      body: typeof body === "string" ? body : JSON.stringify(body) });
  }
  it("registra los campos autorizados, timestamp de servidor y UA acotado", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const response = await POST(request({ ...metric, injected: "ignored" }));
      expect(response.status).toBe(202);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const record = JSON.parse(log.mock.calls[0]?.[0] as string);
      expect(record).toMatchObject({ metric: "biblioradar_pwa", os: "iOS", user_agent: "test-agent", type: "standalone_open" });
      expect(record).not.toHaveProperty("injected");
      expect(Number.isFinite(Date.parse(record.timestamp))).toBe(true);
    } finally { log.mockRestore(); }
  });
  it.each([{}, { ...metric, type: "arbitrary" }, { ...metric, first_open: "true" },
    { ...metric, type: "browser_open" }, { ...metric, event_id: "bad" }, { ...metric, occurred_at: "bad" },
    { ...metric, evidence: "start_url", confirmed_standalone: true }])("rechaza evento inválido %j", async (value) => {
    expect(isPwaMetric(value)).toBe(false);
    expect((await POST(request(value))).status).toBe(400);
  });
  it("rechaza origen externo, JSON roto, tipo MIME y cuerpo demasiado grande", async () => {
    expect((await POST(request(metric, { Origin: "https://other.test" }))).status).toBe(403);
    expect((await POST(request(metric, { "Sec-Fetch-Site": "cross-site" }))).status).toBe(403);
    expect((await POST(request("{"))).status).toBe(400);
    expect((await POST(request(metric, { "Content-Type": "text/plain" }))).status).toBe(415);
    expect((await POST(request(" ".repeat(2049)))).status).toBe(413);
  });
});
