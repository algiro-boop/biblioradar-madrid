import { describe, expect, it } from "vitest";
import {
  currentOccupancy,
  heuristicBase,
  HEURISTIC_SOURCE,
  libraryPoints,
  localTime,
  openingStatus,
  publishedWeekendStatus,
  serverStatusIsCurrent,
  sha256,
  withCurrentOccupancy,
} from "@/lib/estimate";
import type { LibraryWithOccupancy, OccupancyStatus, OpeningHours } from "@/lib/types";
import vectors from "./fixtures/estimate-vectors.json";

type Ctx = { id: string; name: string; institution: LibraryWithOccupancy["institution"]; district: string };
const libraries = vectors.libraries as Ctx[];

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function hoursFromText(text: string): OpeningHours {
  return { timezone: "Europe/Madrid", raw_text: text, normalized_text: text, weekly: null, requires_review: true };
}

describe("paridad con el motor Python (tests/estimate_vectors.py)", () => {
  it("SHA-256 síncrono coincide con los vectores FIPS", () => {
    expect(hex(sha256(""))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(hex(sha256("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(hex(sha256("a".repeat(1000)))).toBe(
      "41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3",
    );
  });

  it("puntos por centro", () => {
    for (const [points, weekend, index] of vectors.points as Array<[number, boolean, number]>) {
      expect(libraryPoints(libraries[index]!, weekend)).toBe(points);
    }
  });

  it("estimación horaria en todas las horas, días, aperturas y lluvia", () => {
    const mismatches = (vectors.heuristic as Array<[number, boolean | null, boolean, number, number | null]>)
      .filter(([t, open, rain, index, expected]) => heuristicBase(t, rain, open, libraries[index]) !== expected)
      .slice(0, 5);
    expect(mismatches).toEqual([]);
  });

  it("fin de semana según el texto publicado (catálogo real)", () => {
    const texts = vectors.texts as string[];
    const mismatches = (vectors.published as Array<[number, number, boolean | null]>)
      .filter(([i, t, expected]) => publishedWeekendStatus(hoursFromText(texts[i]!), t) !== expected)
      .map(([i, t, expected]) => ({ text: texts[i]!.slice(0, 80), t: new Date(t).toISOString(), expected }))
      .slice(0, 5);
    expect(mismatches).toEqual([]);
  });

  it("horario revisado con medianoche, festivos y formatos inválidos", () => {
    const hours = vectors.reviewed_hours as unknown as OpeningHours[];
    for (const [i, t, expected] of vectors.reviewed as Array<[number, number, boolean | null]>) {
      expect([i, t, openingStatus(hours[i]!, t)]).toEqual([i, t, expected]);
    }
  });
});

describe("hora de Madrid explícita", () => {
  it("respeta el cambio CEST → CET del 25-10-2026", () => {
    // 09:00 en Madrid: 07:00 UTC en verano (sábado 24) y 08:00 UTC en invierno (domingo 25).
    expect(localTime(Date.UTC(2026, 9, 24, 7))).toMatchObject({ hour: 9, minute: 0, isoWeekday: 6 });
    expect(localTime(Date.UTC(2026, 9, 25, 8))).toMatchObject({ hour: 9, minute: 0, isoWeekday: 7 });
    expect(localTime(Date.UTC(2026, 9, 25, 23, 30))).toMatchObject({ day: 26, hour: 0, isoWeekday: 1 });
  });
});

const BASE_LIBRARY: LibraryWithOccupancy = {
  id: "00000000-0000-0000-0000-000000000001",
  source: "madrid:201747",
  source_id: "1",
  source_url: null,
  name: "Biblioteca Aluche",
  institution: "ayuntamiento",
  address: "Calle Camarena 10",
  district: "Latina",
  lat: 40.4,
  lng: -3.7,
  google_place_id: null,
  opening_hours: hoursFromText("De lunes a viernes de 9 a 21 horas."),
  total_seats: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  occupancy: null,
};

function status(overrides: Partial<OccupancyStatus>): OccupancyStatus {
  return {
    library_id: BASE_LIBRARY.id,
    google_live_pct: null,
    google_hist_pct: null,
    predicted_base_pct: null,
    crowd_pct: null,
    final_occupancy_pct: null,
    status_label: null,
    base_source: "Cerrada según horario de Google",
    base_observed_at: "2026-10-26T07:44:00Z",
    base_valid_until: "2026-10-26T08:00:00Z", // 09:00 en Madrid (CET): el cron previó la apertura
    primary_source: "Cerrada según horario de Google",
    active_reports_count: 0,
    updated_at: "2026-10-26T07:44:00Z",
    ...overrides,
  };
}

describe("estimación inmediata al abrir", () => {
  const before = Date.UTC(2026, 9, 26, 7, 59); // lunes 08:59 Madrid
  const opening = Date.UTC(2026, 9, 26, 8, 0); // lunes 09:00 Madrid

  it("a las 09:00 muestra la estimación de apertura aunque el último snapshot sea de las 08:44", () => {
    const library = { ...BASE_LIBRARY, occupancy: status({}) };
    expect(currentOccupancy(library, before)).toBe(library.occupancy); // aún vigente: cerrada
    const now = currentOccupancy(library, opening);
    expect(now.final_occupancy_pct).toBe(heuristicBase(opening, false, null, library));
    expect(now.final_occupancy_pct).toBeGreaterThan(0);
    expect(now.status_label).toBe("free");
    expect(now.primary_source).toBe(HEURISTIC_SOURCE);
  });

  it("sin fila de estado o sin validez también estima en horario hábil", () => {
    expect(currentOccupancy(BASE_LIBRARY, opening).final_occupancy_pct).not.toBeNull();
    const library = { ...BASE_LIBRARY, occupancy: status({ base_valid_until: null }) };
    expect(currentOccupancy(library, opening).final_occupancy_pct).not.toBeNull();
  });

  it("un snapshot caducado de noche no inventa ocupación", () => {
    const night = Date.UTC(2026, 9, 26, 21, 30); // 22:30
    const library = { ...BASE_LIBRARY, occupancy: status({ final_occupancy_pct: 40 }) };
    const now = currentOccupancy(library, night);
    expect(now.final_occupancy_pct).toBeNull();
    expect(now.status_label).toBeNull();
  });

  it("respeta el cierre del horario revisado y del texto de fin de semana", () => {
    const reviewed: OpeningHours = {
      ...hoursFromText(""),
      requires_review: false,
      weekly: Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [String(d), [["10:00", "14:00"]]])),
    };
    const library = { ...BASE_LIBRARY, opening_hours: reviewed };
    expect(currentOccupancy(library, opening).primary_source).toBe("Cerrada según horario revisado");
    const saturday = Date.UTC(2026, 9, 31, 11); // sábado 12:00
    const weekend = { ...BASE_LIBRARY, opening_hours: hoursFromText("Sábados, domingos y festivos cerrado.") };
    expect(currentOccupancy(weekend, saturday).primary_source).toBe("Cerrada según horario publicado");
    const open = { ...BASE_LIBRARY, opening_hours: hoursFromText("Sábados de 9 a 14 horas.") };
    expect(currentOccupancy(open, saturday).final_occupancy_pct).not.toBeNull();
  });

  it("mientras la base es vigente o hay reportes recientes manda el servidor", () => {
    const fresh = status({ final_occupancy_pct: 63, base_valid_until: "2026-10-26T09:30:00Z" });
    expect(serverStatusIsCurrent(fresh, opening)).toBe(true);
    const reports = status({ final_occupancy_pct: 75, active_reports_count: 2, updated_at: "2026-10-26T07:50:00Z" });
    expect(serverStatusIsCurrent(reports, opening)).toBe(true);
    expect(serverStatusIsCurrent({ ...reports, updated_at: "2026-10-26T06:00:00Z" }, opening)).toBe(false);
  });

  it("conserva la referencia de las bibliotecas con dato vigente", () => {
    const fresh = { ...BASE_LIBRARY, occupancy: status({ base_valid_until: "2026-10-26T09:30:00Z" }) };
    const expired = { ...BASE_LIBRARY, id: "x", occupancy: status({ library_id: "x" }) };
    const [a, b] = withCurrentOccupancy([fresh, expired], opening);
    expect(a).toBe(fresh);
    expect(b?.estimatedLocally).toBe(true);
    expect(b?.occupancy?.library_id).toBe("x");
  });
});

it("el CSV conserva el posterior vigente y nunca recurre a la curva genérica cuando caduca", () => {
  const now = Date.parse("2026-10-26T08:10:00Z");
  const occupancy = status({ final_occupancy_pct: 61, bayesian_occupancy: 61,
    base_valid_until: "2026-10-26T08:30:00Z", active_reports_count: 2 });
  const library = { ...BASE_LIBRARY, historical_popularity: { model: "csv-v1" }, occupancy };
  expect(currentOccupancy(library, now)).toBe(occupancy);
  const stale = currentOccupancy(library, now + 31 * 60_000);
  expect(stale.final_occupancy_pct).toBeNull();
  expect(stale.primary_source).toBe("CSV pendiente de actualización");
});
