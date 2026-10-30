import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActiveTags, LiveStatusBadge, ReportTagSelector } from "@/components/CommunityStatus";
import { LiveActivityTicker } from "@/components/LiveActivityTicker";
import { activeTags, liveLabel, parseCommunityReports, recentAt, toggleTag, validTags, type CommunityReport, type ReportTag } from "@/lib/community";
import { parseOccupancyStatus } from "@/lib/occupancy";
const now = Date.parse("2026-10-30T12:00:00Z");
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
function status(minutes = 8, open = true) {
  return parseOccupancyStatus({ library_id: "one", is_open_now: open, confidence_score: 0,
    active_reports_count: 1, latest_report_at: ago(minutes), active_tags: ["silent"], active_tag_times: { silent: ago(minutes) } })!;
}
const report: CommunityReport = { library_id: "one", library_name: "BPM Prueba", district: "Centro",
  reported_value: 75, tags: ["silent", "sockets_free"], created_at: ago(8) };
describe("live community status", () => {
  it("shows actual report time, independent of cron/confidence/memory", () => {
    expect(liveLabel(status(), now)).toBe("En vivo · hace 8 min");
    expect(liveLabel(status(1), now)).toBe("En vivo · confirmado ahora");
    expect(liveLabel(status(2), now)).toBe("En vivo · hace 2 min");
    const html = renderToStaticMarkup(h(LiveStatusBadge, { status: status(), now, onReport() {} }));
    expect(html).toContain("motion-safe:animate-pulse");
    expect(html).not.toContain("<button");
    expect(liveLabel({ ...status(91), confidence_score: 1, report_memory_pct: 95, updated_at: ago(0) }, now)).toContain("Estimado");
  });
  it.each([90, 91, -1, Infinity])("expired, future or invalid timestamp (%s) is estimated and actionable", (minutes) => {
    const s = Number.isFinite(minutes) ? status(minutes) : { ...status(), latest_report_at: "invalid" };
    expect(liveLabel(s, now)).toBe("📊 Estimado · ¿Estás aquí?");
    expect(renderToStaticMarkup(h(LiveStatusBadge, { status: s, now, onReport() {} }))).toContain("<button");
  });
  it("hides badges and tags on closed or unknown opening state", () => {
    for (const s of [status(1, false), { ...status(), is_open_now: null }, null]) {
      expect(liveLabel(s, now)).toBeNull();
      expect(renderToStaticMarkup(h(ActiveTags, { status: s, now }))).toBe("");
    }
  });
  it("expires individual tags even when a new untagged report extends live status", () => {
    expect(activeTags({ ...status(1), active_tag_times: { silent: ago(91) } }, now)).toEqual([]);
    expect(activeTags(status(), now)).toEqual(["silent"]);
    expect(renderToStaticMarkup(h(ActiveTags, { status: status(), now }))).toContain("Silencio total");
  });
});
describe("optional tags", () => {
  it("toggles, replaces same category and retains independent categories", () => {
    let selected: ReportTag[] = [];
    for (const tag of ["sockets_free", "silent", "temp_ok"] as const) selected = toggleTag(selected, tag);
    expect(selected).toEqual(["sockets_free", "silent", "temp_ok"]);
    selected = toggleTag(selected, "temp_hot");
    expect(selected).toEqual(["sockets_free", "silent", "temp_hot"]);
    expect(toggleTag(selected, "silent")).toEqual(["sockets_free", "temp_hot"]);
    const html = renderToStaticMarkup(h(ReportTagSelector, { selected, onToggle() {} }));
    expect((html.match(/aria-pressed="true"/g) ?? []).length).toBe(3);
    expect((html.match(/<button/g) ?? []).length).toBe(7);
    expect(html).toContain("Opcional");
  });
  it.each([null, ["bad"], [null], ["silent", "silent"], ["noisy", "silent"], ["sockets_free", "sockets_full"], ["temp_ok", "temp_cold"], ["silent", "temp_ok", "sockets_free", "temp_hot"]])("rejects invalid input %j", (tags) => expect(validTags(tags)).toBe(false));
  it("allows opting out", () => expect(validTags([])).toBe(true));
});
describe("activity ticker", () => {
  it("renders public activity with library and tags", () => {
    const html = renderToStaticMarkup(h(LiveActivityTicker, { reports: [report], now, onSelect() {} }));
    expect(html).toContain("Hace 8 min"); expect(html).toContain("BPM Prueba");
    expect(html).toContain("75% ocupada"); expect(html).toContain("Enchufes libres");
    expect(html).toContain("<button");
  });
  it.each([[], [{ ...report, created_at: ago(180) }], [{ ...report, created_at: ago(-1) }]].map((reports) => [reports]))("renders motivating empty state without fresh reports", (reports) => {
    const html = renderToStaticMarkup(h(LiveActivityTicker, { reports, now, onSelect() {} }));
    expect(html).toContain("Sé el primero"); expect(html).not.toContain("75%");
  });
  it("only retains the explicit public allowlist, rejects malformed records", () => {
    const parsed = parseCommunityReports([{ ...report, device_hash: "private", user_lat: 40 }]);
    expect(parsed).toEqual([report]); expect(JSON.stringify(parsed)).not.toContain("private");
    expect(parseCommunityReports([null, {}, { ...report, reported_value: 101 }, { ...report, tags: ["bad"] }])).toEqual([]);
    expect(recentAt("invalid", now, 180)).toBe(false);
  });
});
