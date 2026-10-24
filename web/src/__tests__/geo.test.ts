import { describe, expect, it } from "vitest";
import {
  canReportFrom,
  EARTH_RADIUS_M,
  formatDistance,
  haversineMeters,
  isInProximity,
  MADRID_CENTER,
  PROXIMITY_RADIUS_M,
  REPORT_RADIUS_M,
} from "@/lib/geo";

const sol = { lat: MADRID_CENTER[0], lng: MADRID_CENTER[1] };

/** Réplica literal de la fórmula del trigger SQL `validate_report`. */
function sqlHaversine(userLat: number, userLng: number, libLat: number, libLng: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const a =
    Math.pow(Math.sin(rad(userLat - libLat) / 2), 2) +
    Math.cos(rad(libLat)) * Math.cos(rad(userLat)) * Math.pow(Math.sin(rad(userLng - libLng) / 2), 2);
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1.0, Math.max(0.0, a))));
}

describe("haversineMeters", () => {
  it("usa el mismo radio terrestre que el SQL", () => {
    expect(EARTH_RADIUS_M).toBe(6371000);
  });

  it("es 0 para el mismo punto", () => {
    expect(haversineMeters(sol, sol)).toBe(0);
  });

  it("0.001° de latitud ≈ 111.19 m", () => {
    const d = haversineMeters(sol, { lat: sol.lat + 0.001, lng: sol.lng });
    expect(d).toBeCloseTo((6371000 * Math.PI * 0.001) / 180, 6);
    expect(d).toBeCloseTo(111.195, 2);
  });

  it("Madrid (Sol) – Barcelona (Pl. Catalunya) ≈ 505 km", () => {
    const d = haversineMeters(sol, { lat: 41.387, lng: 2.17 });
    expect(d / 1000).toBeGreaterThan(500);
    expect(d / 1000).toBeLessThan(510);
  });

  it("es simétrica", () => {
    const b = { lat: 40.4153, lng: -3.6844 }; // Retiro
    expect(haversineMeters(sol, b)).toBeCloseTo(haversineMeters(b, sol), 9);
  });

  it("coincide con la fórmula SQL en puntos de Madrid", () => {
    const points = [
      { lat: 40.39597, lng: -3.75627 },
      { lat: 40.43, lng: -3.70 },
      { lat: 40.4169, lng: -3.7037 },
      { lat: 40.45, lng: -3.69 },
    ];
    for (const p of points) {
      expect(haversineMeters(p, sol)).toBeCloseTo(sqlHaversine(p.lat, p.lng, sol.lat, sol.lng), 9);
    }
  });
});

describe("radios de reporte y proximidad", () => {
  it("permite reportar estrictamente por debajo de 250 m (el SQL rechaza >= 250)", () => {
    expect(REPORT_RADIUS_M).toBe(250);
    expect(canReportFrom(0)).toBe(true);
    expect(canReportFrom(249.99)).toBe(true);
    expect(canReportFrom(250)).toBe(false);
    expect(canReportFrom(Number.NaN)).toBe(false);
    expect(canReportFrom(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("banner proactivo por debajo de 150 m", () => {
    expect(PROXIMITY_RADIUS_M).toBe(150);
    expect(isInProximity(149.9)).toBe(true);
    expect(isInProximity(150)).toBe(false);
  });

  it("un punto a ~240 m al norte puede reportar y a ~260 m no", () => {
    const metersPerDegLat = (6371000 * Math.PI) / 180;
    const near = { lat: sol.lat + 240 / metersPerDegLat, lng: sol.lng };
    const far = { lat: sol.lat + 260 / metersPerDegLat, lng: sol.lng };
    expect(canReportFrom(haversineMeters(near, sol))).toBe(true);
    expect(canReportFrom(haversineMeters(far, sol))).toBe(false);
  });
});

describe("formatDistance", () => {
  it("formatea metros y kilómetros en español", () => {
    expect(formatDistance(42.4)).toBe("42 m");
    expect(formatDistance(999.4)).toBe("999 m");
    expect(formatDistance(1234)).toBe("1,2 km");
    expect(formatDistance(15300)).toBe("15 km");
  });
});
