// @vitest-environment happy-dom
// DOM simulation only: no browser process, navigation, screenshots or network requests.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveStatusBadge } from "@/components/CommunityStatus";
import { LiveActivityButton } from "@/components/LiveActivityButton";
import { LibraryList } from "@/components/LibraryList";
import { parseLibraryRow } from "@/lib/occupancy";
import { ReportButtons } from "@/components/ReportButtons";
import { useCommunityActivity } from "@/hooks/useCommunityActivity";
import { parseOccupancyStatus } from "@/lib/occupancy";

const api = vi.hoisted(() => ({ send: vi.fn(), activity: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  submitReport: api.send,
  getSupabase: () => ({ rpc: () => ({ abortSignal: api.activity }) }),
}));
vi.mock("@/lib/device", async (original) => ({
  ...await original<typeof import("@/lib/device")>(), getDeviceHash: async () => "a".repeat(64),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks();
  api.send.mockResolvedValue({ ok: true, reportId: "report" });
  api.activity.mockResolvedValue({ data: [], error: null });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });
function button(text: string) {
  const found = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes(text));
  if (!found) throw new Error(`Button not found: ${text}`);
  return found;
}
async function click(text: string) { await act(async () => button(text).click()); }
const library = { id: "one", name: "Test", lat: 40.4, lng: -3.7 };
const locate = vi.fn(async () => ({ lat: 40.4, lng: -3.7, accuracy: 10, timestamp: Date.now() }));

describe("report form interactions", () => {
  it("selects percentage and optional tags before sending, with one per category", async () => {
    const onReported = vi.fn();
    await act(async () => root.render(h(ReportButtons, { library, locate, onReported })));
    expect(button("Enviar reporte").disabled).toBe(true);
    await click("75%");
    for (const tag of ["Enchufes libres", "Silencio total", "Clima ideal", "Pocos enchufes", "Hace calor"]) await click(tag);
    expect(api.send).not.toHaveBeenCalled();
    expect(button("Enchufes libres").getAttribute("aria-pressed")).toBe("false");
    expect(button("Hace calor").getAttribute("aria-pressed")).toBe("true");
    await click("Enviar reporte");
    expect(api.send).toHaveBeenCalledWith(expect.objectContaining({ value: 75,
      tags: ["silent", "sockets_full", "temp_hot"], deviceHash: "a".repeat(64) }));
    expect(onReported).toHaveBeenCalledWith("one", 75);
    expect(container.textContent).toContain("¡Gracias!");
    expect(button("Enviar reporte").disabled).toBe(true);
  });
  it("allows deselection and sending without tags", async () => {
    await act(async () => root.render(h(ReportButtons, { library, locate })));
    await click("90%"); await click("Silencio total"); await click("Silencio total"); await click("Enviar reporte");
    expect(api.send).toHaveBeenCalledWith(expect.objectContaining({ value: 90, tags: [] }));
  });
  it("keeps legacy reporting functional while the community migration is unavailable", async () => {
    await act(async () => root.render(h(ReportButtons, { library, locate, tagsEnabled: false })));
    expect(container.textContent).not.toContain("¿Cómo está el ambiente?");
    await click("40%"); await click("Enviar reporte");
    expect(api.send).toHaveBeenCalledWith(expect.objectContaining({ tags: [] }));
  });
  it("opens reporting from the estimated badge", async () => {
    const onReport = vi.fn();
    await act(async () => root.render(h(LiveStatusBadge, { status: parseOccupancyStatus({ library_id: "one", is_open_now: true }), now: Date.now(), onReport })));
    await click("Estimado"); expect(onReport).toHaveBeenCalledOnce();
  });
});
describe("library card integration", () => {
  it("opens reporting directly without nesting buttons or selecting the outer card", async () => {
    const onSelect = vi.fn(), onRequestReport = vi.fn();
    const library = parseLibraryRow({ id: "one", name: "Test", lat: 40.4, lng: -3.7,
      occupancy_status: { library_id: "one", is_open_now: true, active_reports_count: 0 } })!;
    await act(async () => root.render(h(LibraryList, { items: [{ library, distanceM: null }], total: 1,
      loading: false, error: null, now: Date.now(), selectedId: null, filtersActive: false,
      onSelect, onRequestReport, onClearFilters() {}, onRetry() {} })));
    expect(container.querySelector("button button")).toBeNull();
    await click("Estimado"); expect(onRequestReport).toHaveBeenCalledWith("one");
    expect(onSelect).not.toHaveBeenCalled();
  });
});
describe("activity interactions and recovery", () => {
  it("keeps the feed hidden until requested and closes it when selecting a library", async () => {
    const onSelect = vi.fn(); const now = Date.now();
    const first = { library_id: "one", library_name: "First", district: "Test", reported_value: 75, tags: [] as [], created_at: new Date(now).toISOString() };
    await act(async () => root.render(h(LiveActivityButton, { reports: [first, { ...first, library_id: "two", library_name: "Second" }], now, onSelect })));
    expect(container.textContent).not.toContain("First");
    expect(container.querySelector("dialog")?.open).toBe(false);
    await click("Actividad");
    expect(container.querySelector("dialog")?.open).toBe(true);
    expect(container.textContent).toContain("First");
    await click("Second"); expect(onSelect).toHaveBeenLastCalledWith("two");
    expect(container.querySelector("dialog")?.open).toBe(false);
    expect(container.textContent).not.toContain("Second");
  });
  it("opens the empty state on demand, closes with Escape and restores focus", async () => {
    await act(async () => root.render(h(LiveActivityButton, { reports: [], now: Date.now(), onSelect() {} })));
    const opener = button("Actividad");
    expect(opener.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain("Radar en directo listo");
    await click("Actividad");
    expect(opener.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("Sé el primero");
    await act(async () => container.querySelector("dialog")!.dispatchEvent(new Event("cancel", { cancelable: true })));
    expect(container.querySelector("dialog")?.open).toBe(false);
    expect(document.activeElement).toBe(opener);
    await click("Actividad");
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Cerrar actividad"]')!.click());
    expect(container.querySelector("dialog")?.open).toBe(false);
    expect(document.activeElement).toBe(opener);
  });
  it("does not disguise a missing backend RPC as an empty feed, and recovers on retry", async () => {
    api.activity.mockResolvedValue({ data: null, error: { code: "PGRST202" } });
    const report = { library_id: "one", library_name: "Recovered library", district: "Test", reported_value: 40,
      tags: [], created_at: new Date().toISOString() };
    function Activity() {
      const { reports, available, loading, error, refresh } = useCommunityActivity("initial");
      return h("div", null, h("output", null, String(available)),
        h(LiveActivityButton, { reports, now: Date.now(), loading, error, onRefresh: refresh, onSelect() {} }));
    }
    await act(async () => root.render(h(Activity)));
    await click("Actividad");
    expect(container.querySelector("[role=alert]")?.textContent).toContain("No se ha podido cargar");
    expect(container.textContent).not.toContain("Sé el primero");
    expect(container.querySelector("output")?.textContent).toBe("false");
    api.activity.mockResolvedValue({ data: [report], error: null });
    await click("Reintentar");
    expect(container.textContent).toContain("Recovered library");
    expect(container.querySelector("output")?.textContent).toBe("true");
    expect(container.querySelector("[role=alert]")).toBeNull();
  });
  it("shows loading instead of an empty result, then handles a genuinely empty response", async () => {
    let finish!: (value: { data: []; error: null }) => void;
    api.activity.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    function Activity() {
      const { reports, loading, error } = useCommunityActivity("initial");
      return h(LiveActivityButton, { reports, now: Date.now(), loading, error, onSelect() {} });
    }
    await act(async () => root.render(h(Activity)));
    await click("Actividad");
    expect(container.textContent).toContain("Actualizando actividad");
    expect(container.textContent).not.toContain("Sé el primero");
    await act(async () => finish({ data: [], error: null }));
    expect(container.textContent).not.toContain("Actualizando actividad");
    expect(container.textContent).toContain("Sé el primero");
  });
  it("rejects malformed responses rather than claiming there are no reports", async () => {
    api.activity.mockResolvedValue({ data: [{ bad: true }], error: null });
    function Probe() {
      const { reports, available, loading, error } = useCommunityActivity("initial");
      return h("p", null, `${available}/${loading}/${reports.length}/${error}`);
    }
    await act(async () => root.render(h(Probe)));
    expect(container.textContent).toContain("false/false/0/No se ha podido cargar");
  });
  it("refreshes immediately after a successful report, without waiting for Realtime or polling", async () => {
    const report = { library_id: "one", library_name: "Reported library", district: "Test", reported_value: 75,
      tags: [], created_at: new Date().toISOString() };
    function ActivityAndReport() {
      const { reports, refresh } = useCommunityActivity("initial");
      return h("div", null, h("output", null, reports.map((r) => r.library_name).join()),
        h(ReportButtons, { library, locate, onReported: refresh }));
    }
    await act(async () => root.render(h(ActivityAndReport)));
    expect(api.activity).toHaveBeenCalledOnce();
    api.activity.mockResolvedValue({ data: [report], error: null });
    await click("75%"); await click("Enviar reporte");
    expect(api.activity).toHaveBeenCalledTimes(2);
    expect(container.querySelector("output")?.textContent).toBe("Reported library");
  });
  it("refreshes after Realtime invalidation and preserves data on temporary errors", async () => {
    const report = { library_id: "one", library_name: "Fresh", district: "Test", reported_value: 75, tags: [], created_at: new Date().toISOString() };
    api.activity.mockResolvedValue({ data: [report], error: null });
    function Probe({ refreshKey }: { refreshKey: string }) {
      const { reports, available } = useCommunityActivity(refreshKey);
      return h("p", null, `${available}: ${reports.map((r) => r.library_name).join()}`);
    }
    await act(async () => root.render(h(Probe, { refreshKey: "initial" })));
    expect(container.textContent).toBe("true: Fresh");
    api.activity.mockRejectedValueOnce(new Error("offline"));
    await act(async () => root.render(h(Probe, { refreshKey: "new-report" })));
    expect(api.activity).toHaveBeenCalledTimes(2);
    expect(container.textContent).toBe("true: Fresh");
  });
});
