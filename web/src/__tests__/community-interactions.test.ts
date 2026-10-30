// @vitest-environment happy-dom
// DOM simulation only: no browser process, navigation, screenshots or network requests.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveStatusBadge } from "@/components/CommunityStatus";
import { LiveActivityTicker } from "@/components/LiveActivityTicker";
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
  it("selects the correct library and navigates the carousel", async () => {
    const onSelect = vi.fn(); const now = Date.now();
    const first = { library_id: "one", library_name: "First", district: "Test", reported_value: 75, tags: [] as [], created_at: new Date(now).toISOString() };
    await act(async () => root.render(h(LiveActivityTicker, { reports: [first, { ...first, library_id: "two", library_name: "Second" }], now, onSelect })));
    await click("First"); expect(onSelect).toHaveBeenLastCalledWith("one");
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Actividad siguiente"]')!.click());
    await click("Second"); expect(onSelect).toHaveBeenLastCalledWith("two");
    await click("Pausar"); expect(button("Reanudar")).toBeDefined();
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
