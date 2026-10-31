import { describe, expect, it } from "vitest";
import audit from "../../../data/csv/north_import_audit.json";
import { matchesQuery } from "@/lib/filters";
import { parseLibraryRow } from "@/lib/occupancy";
import { liveLabel } from "@/lib/community";
import { openingStatus } from "@/lib/estimate";

describe("northern catalog and estimated zone profiles", () => {
  const libraries = audit.map((row) => parseLibraryRow({
    id: row.name, name: row.name, address: row.address, district: row.district,
    lat: row.lat, lng: row.lng, institution: "ayuntamiento",
    occupancy_status: { library_id: row.name, is_open_now: true, confidence_score: 0, active_reports_count: 0 },
  })!);
  it.each([["Alcobendas", 3], ["San Sebastian de los Reyes", 3], ["Carabanchel", 1], ["Barajas", 1]] as const)("finds %s without requiring accents", (query, count) => {
    expect(libraries.filter((library) => matchesQuery(library, query))).toHaveLength(count);
  });
  it("keeps inferred historical curves estimated until a real report exists", () => {
    const now = Date.parse("2026-10-31T12:00:00+01:00");
    for (const library of libraries) {
      expect(liveLabel(library.occupancy, now)).toContain("Estimado");
      expect(liveLabel({ ...library.occupancy!, confidence_score: 0.8, active_reports_count: 1,
        latest_report_at: new Date(now - 60_000).toISOString() }, now)).toContain("En vivo");
    }
  });
  it("never reopens a temporarily closed library through client-side estimation", () => {
    expect(openingStatus({ temporarily_closed: true, requires_review: false, timezone: "Europe/Madrid",
      raw_text: "", normalized_text: "", weekly: { "6": [["00:00", "24:00"]] } }, Date.parse("2026-10-31T12:00:00+01:00"))).toBe(false);
  });
});
