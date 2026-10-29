import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CapacityText } from "@/components/CapacityText";
import { FullReportNotice } from "@/components/FullReportNotice";
import { currentOccupancy } from "@/lib/estimate";
import { getOccupancyLevel, hasRoom, parseLibraryRow, parseOccupancyStatus } from "@/lib/occupancy";
import { currentReportPct, fullReportNotice, reportDisplayPct } from "@/lib/report-priority";

const START = Date.parse("2027-07-15T10:00:00Z");
function library() {
  return parseLibraryRow({
    id: "test", name: "Fixture", lat: 40.4, lng: -3.7, total_capacity: 100,
    historical_popularity: { model: "csv-v1" },
    opening_hours: { timezone: "Europe/Madrid", requires_review: false,
      weekly: Object.fromEntries([1,2,3,4,5,6,7].map(d => [String(d), [["00:00", "24:00"]]])) },
    occupancy_status: {
      library_id: "test", is_open_now: true, bayesian_occupancy: 80,
      final_occupancy_pct: 100, active_reports_count: 1,
      full_reported_at: new Date(START).toISOString(), base_observed_at: new Date(START).toISOString(),
      base_valid_until: new Date(START + 30*60_000).toISOString(), updated_at: new Date(START).toISOString(),
    },
  })!;
}

describe("prioridad temporal del reporte de sala completa", () => {
  it.each([[0,100],[10,100],[12.5,90],[15,80],[16,80],[-1,80]])("paridad SQL: edad %s min → %s", (minutes, expected) => {
    expect(reportDisplayPct(80,new Date(START).toISOString(),START+minutes*60_000)).toBe(expected);
  });

  it("no convierte fechas inválidas en una sala completa", () => {
    expect(reportDisplayPct(80, "invalid", START)).toBe(80);
    expect(reportDisplayPct(80, null, START)).toBe(80);
    expect(fullReportNotice({ ...library().occupancy!, full_reported_at: "invalid" }, START)).toBeNull();
  });

  it("el aviso conserva la fecha del reporte al llegar un refresco de cron", () => {
    const lib=library();
    lib.occupancy!.updated_at=new Date(START+5*60_000).toISOString();
    const html=renderToStaticMarkup(createElement(FullReportNotice,{status:lib.occupancy,now:START+5*60_000}));
    expect(html).toContain("Reportada completa hace 5 min");
  });

  it("actualiza mapa, filtros y plazas con el mismo estado efectivo", () => {
    const lib=library();
    const effective=currentOccupancy(lib,START);
    expect(effective.final_occupancy_pct).toBe(100);
    expect(effective.bayesian_occupancy).toBe(80);
    expect(getOccupancyLevel(effective)).toBe("full");
    expect(hasRoom(effective)).toBe(false);
    expect(renderToStaticMarkup(createElement(CapacityText,{library:{...lib,occupancy:effective}}))).toContain("~0 libres de 100 plazas");
  });

  it("desvanece y termina aunque no llegue otro evento del servidor", () => {
    const lib=library();
    expect(currentOccupancy(lib,START+12.5*60_000).final_occupancy_pct).toBe(90);
    expect(currentOccupancy(lib,START+15*60_000).final_occupancy_pct).toBe(80);
    expect(fullReportNotice(lib.occupancy,START+15*60_000)).toBeNull();
    expect(fullReportNotice(lib.occupancy,START+12.5*60_000)).toContain("volviendo a la estimación");
  });

  it("un aviso recibido entre ticks se muestra inmediatamente", () => {
    const lib=library();
    expect(currentReportPct(lib.occupancy!,START-20_000)).toBe(100);
    expect(fullReportNotice(lib.occupancy,START-20_000)).toContain("ahora mismo");
  });

  it("un reporte contradictorio recibido por Realtime elimina el estado", () => {
    const lib=library();
    lib.occupancy={...lib.occupancy!,full_reported_at:null,final_occupancy_pct:60,bayesian_occupancy:60};
    expect(currentOccupancy(lib,START).final_occupancy_pct).toBe(60);
    expect(fullReportNotice(lib.occupancy,START)).toBeNull();
  });

  it("nunca ignora un cierre temporal conocido", () => {
    const lib=library();
    lib.opening_hours.date_overrides={"2027-07-15":[]};
    const status=currentOccupancy(lib,START);
    expect(status.is_open_now).toBe(false);
    expect(status.final_occupancy_pct).toBe(0);
    expect(fullReportNotice(status,START)).toBeNull();
  });

  it("un snapshot cerrado no genera aviso aunque conserve metadatos antiguos", () => {
    const status={...library().occupancy!,is_open_now:false};
    expect(currentReportPct(status,START)).toBeNull();
    expect(fullReportNotice(status,START)).toBeNull();
  });

  it("parsea full_reported_at desde fetch y Realtime", () => {
    const status=parseOccupancyStatus({...library().occupancy!});
    expect(status?.full_reported_at).toBe(new Date(START).toISOString());
    expect(parseOccupancyStatus({library_id:"test",full_reported_at:99})?.full_reported_at).toBeNull();
  });
});
