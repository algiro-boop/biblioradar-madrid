import { describe, expect, it } from "vitest";
import { applyFilters, EMPTY_FILTERS } from "@/lib/filters";
import {
  formatOccupancy,
  formatPinText,
  getOccupancyLevel,
  hasRoom,
  labelFromPct,
  mergeOccupancy,
  parseLibraryRow,
  parseOccupancyStatus,
  toPct,
} from "@/lib/occupancy";
import { toOccupancyChange } from "@/lib/supabase";
import type { LibraryWithOccupancy, OccupancyStatus } from "@/lib/types";

function status(overrides: Partial<OccupancyStatus> = {}): OccupancyStatus {
  return {
    library_id: "lib-1",
    google_live_pct: null,
    google_hist_pct: null,
    predicted_base_pct: null,
    crowd_pct: null,
    final_occupancy_pct: null,
    status_label: null,
    base_source: "Sin datos de ocupación",
    base_observed_at: null,
    base_valid_until: null,
    primary_source: "Sin datos de ocupación",
    active_reports_count: 0,
    updated_at: "2026-10-23T09:55:00Z",
    ...overrides,
  };
}

function library(id: string, name: string, occ: OccupancyStatus | null, extra: Partial<LibraryWithOccupancy> = {}) {
  return {
    id,
    source: "madrid:201747",
    source_id: id,
    source_url: null,
    name,
    institution: "ayuntamiento",
    address: "CALLE X 1",
    district: "Centro",
    lat: 40.4168,
    lng: -3.7038,
    google_place_id: null,
    opening_hours: { timezone: "Europe/Madrid", raw_text: "", normalized_text: "", weekly: null, requires_review: true },
    total_seats: null,
    created_at: "2026-10-23T00:00:00Z",
    updated_at: "2026-10-23T00:00:00Z",
    occupancy: occ ? { ...occ, library_id: id } : null,
    ...extra,
  } satisfies LibraryWithOccupancy;
}

describe("final_occupancy_pct: null nunca es 0 %", () => {
  it("toPct no convierte null/undefined/'' en 0", () => {
    expect(toPct(null)).toBeNull();
    expect(toPct(undefined)).toBeNull();
    expect(toPct("")).toBeNull();
    expect(toPct(Number.NaN)).toBeNull();
    expect(toPct({})).toBeNull();
    expect(toPct(0)).toBe(0);
    expect(toPct("45")).toBe(45);
    expect(toPct(101)).toBeNull();
    expect(toPct(-1)).toBeNull();
  });

  it("se muestra como '?' en el pin y 'Sin datos recientes' en el detalle", () => {
    expect(formatPinText(null)).toBe("?");
    expect(formatPinText(undefined)).toBe("?");
    expect(formatOccupancy(null)).toBe("Sin datos recientes");
    expect(formatPinText(0)).toBe("0%");
    expect(formatOccupancy(0)).toBe("0%");
  });

  it("nivel 'unknown' (gris), no 'free'", () => {
    expect(getOccupancyLevel(status())).toBe("unknown");
    expect(getOccupancyLevel(null)).toBe("unknown");
    // Aunque llegue una etiqueta incoherente, sin porcentaje no hay nivel.
    expect(getOccupancyLevel(status({ status_label: "free" }))).toBe("unknown");
    expect(getOccupancyLevel(status({ final_occupancy_pct: 0, status_label: "free" }))).toBe("free");
  });

  it("no cuenta como 'con sitio' ni pasa el filtro <70 %", () => {
    expect(hasRoom(status())).toBe(false);
    expect(hasRoom(null)).toBe(false);
    expect(hasRoom(status({ final_occupancy_pct: 0 }))).toBe(true);
    const libs = [
      library("a", "Sin datos", status()),
      library("b", "Vacía", status({ final_occupancy_pct: 0, status_label: "free" })),
      library("c", "Sin fila", null),
    ];
    const ids = applyFilters(libs, { ...EMPTY_FILTERS, onlyWithRoom: true }).map((i) => i.library.id);
    expect(ids).toEqual(["b"]);
  });

  it("parseOccupancyStatus conserva null en todos los porcentajes y fuerza etiqueta null", () => {
    const parsed = parseOccupancyStatus({
      library_id: "lib-1",
      final_occupancy_pct: null,
      status_label: "free",
      predicted_base_pct: null,
      crowd_pct: null,
      google_live_pct: null,
      google_hist_pct: null,
      active_reports_count: 0,
      primary_source: "Sin datos de ocupación",
      updated_at: "2026-10-23T09:00:00Z",
    });
    expect(parsed?.final_occupancy_pct).toBeNull();
    expect(parsed?.status_label).toBeNull();
    expect(parsed?.predicted_base_pct).toBeNull();
    expect(parsed?.crowd_pct).toBeNull();
  });

  it("un payload Realtime con null sigue siendo null", () => {
    const change = toOccupancyChange({
      eventType: "UPDATE",
      new: status({ final_occupancy_pct: null }),
      old: {},
    });
    expect(change?.type).toBe("UPDATE");
    expect(change && change.type !== "DELETE" ? change.status.final_occupancy_pct : "x").toBeNull();
  });
});

describe("labelFromPct replica la columna generada", () => {
  it.each([
    [0, "free"],
    [69, "free"],
    [70, "moderate"],
    [89, "moderate"],
    [90, "high"],
    [99, "high"],
    [100, "full"],
  ] as const)("%i%% → %s", (pct, label) => {
    expect(labelFromPct(pct)).toBe(label);
  });

  it("deriva la etiqueta si Realtime no la incluye", () => {
    const parsed = parseOccupancyStatus({ ...status(), final_occupancy_pct: 92, status_label: undefined });
    expect(parsed?.status_label).toBe("high");
  });
});

describe("parseLibraryRow", () => {
  const row = { ...library("lib-1", "Biblioteca", null), occupancy: undefined };

  it("acepta el embed como objeto (1:1) o como array", () => {
    const occ = status({ final_occupancy_pct: 40, status_label: "free" });
    expect(parseLibraryRow({ ...row, occupancy_status: occ })?.occupancy?.final_occupancy_pct).toBe(40);
    expect(parseLibraryRow({ ...row, occupancy_status: [occ] })?.occupancy?.final_occupancy_pct).toBe(40);
    expect(parseLibraryRow({ ...row, occupancy_status: null })?.occupancy).toBeNull();
    expect(parseLibraryRow({ ...row, occupancy_status: [] })?.occupancy).toBeNull();
  });

  it("descarta filas sin coordenadas", () => {
    expect(parseLibraryRow({ ...row, lat: null })).toBeNull();
  });
});

describe("mergeOccupancy (Realtime)", () => {
  const base = [library("lib-1", "A", status({ final_occupancy_pct: 50, updated_at: "2026-10-23T09:50:00Z" }))];

  it("aplica actualizaciones más recientes", () => {
    const next = mergeOccupancy(base, status({ final_occupancy_pct: 95, updated_at: "2026-10-23T09:59:00Z" }));
    expect(next[0]?.occupancy?.final_occupancy_pct).toBe(95);
    expect(next).not.toBe(base);
  });

  it("ignora eventos fuera de orden", () => {
    const next = mergeOccupancy(base, status({ final_occupancy_pct: 10, updated_at: "2026-10-23T09:00:00Z" }));
    expect(next).toBe(base);
  });

  it("aplica un paso a null (biblioteca que cierra) sin convertirlo en 0", () => {
    const next = mergeOccupancy(base, status({ final_occupancy_pct: null, updated_at: "2026-10-23T09:59:00Z" }));
    expect(next[0]?.occupancy?.final_occupancy_pct).toBeNull();
  });
});

describe("applyFilters", () => {
  const libs = [
    library("1", "Biblioteca Pública Municipal Chamberí", null, { district: "Chamberí" }),
    library("2", "Biblioteca María Zambrano", null, { institution: "ucm", district: "Moncloa-Aravaca" }),
    library("3", "Biblioteca Regional Retiro", null, { institution: "comunidad", district: "Retiro", lat: 40.41, lng: -3.68 }),
  ];

  it("busca sin tildes por nombre o distrito", () => {
    expect(applyFilters(libs, { ...EMPTY_FILTERS, query: "chamberi" }).map((i) => i.library.id)).toEqual(["1"]);
    expect(applyFilters(libs, { ...EMPTY_FILTERS, query: "Zambrano" }).map((i) => i.library.id)).toEqual(["2"]);
    expect(applyFilters(libs, { ...EMPTY_FILTERS, query: "retiro" }).map((i) => i.library.id)).toEqual(["3"]);
  });

  it("combina instituciones con OR", () => {
    const ids = applyFilters(libs, { ...EMPTY_FILTERS, institutions: ["ucm", "comunidad"] }).map((i) => i.library.id);
    expect(ids.sort()).toEqual(["2", "3"]);
  });

  it("ordena por cercanía cuando hay posición", () => {
    const items = applyFilters(libs, { ...EMPTY_FILTERS, near: { lat: 40.41, lng: -3.68 } });
    expect(items[0]?.library.id).toBe("3");
    expect(items[0]?.distanceM).toBe(0);
  });
});

it("una biblioteca cerrada nunca se ofrece como disponible aunque su porcentaje sea cero", () => {
  const closed = status({ final_occupancy_pct: 0, status_label: "free", is_open_now: false });
  expect(getOccupancyLevel(closed)).toBe("closed");
  expect(hasRoom(closed)).toBe(false);
});

it("conserva el posterior y los campos del CSV al recibir Realtime", () => {
  const parsed = parseOccupancyStatus({ ...status(), prior_occupancy: 35,
    bayesian_occupancy: 62, final_occupancy_pct: 62, confidence_score: .7, is_open_now: true });
  expect(parsed).toMatchObject({ prior_occupancy: 35, bayesian_occupancy: 62,
    confidence_score: .7, is_open_now: true });
});
