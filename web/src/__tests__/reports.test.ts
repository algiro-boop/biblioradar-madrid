import { describe, expect, it } from "vitest";
import { labelFromPct } from "@/lib/occupancy";
import {
  isReportValue,
  mapReportError,
  rateLimitError,
  REPORT_OPTIONS,
  REPORT_VALUES,
  reportSummary,
  tooFarError,
} from "@/lib/reports";

describe("mapReportError (errores de submit_report)", () => {
  it("P0001 → límite de 1 reporte cada 30 minutos", () => {
    const e = mapReportError({
      code: "P0001",
      message: "Solo un reporte por biblioteca cada 30 minutos",
      details: null,
      hint: null,
    });
    expect(e.kind).toBe("rate_limit");
    expect(e.message).toMatch(/30 minutos/);
  });

  it("22023 con mensaje de distancia → too_far", () => {
    const e = mapReportError({ code: "22023", message: "Debes estar a menos de 250 metros" });
    expect(e.kind).toBe("too_far");
    expect(e.message).toMatch(/250 m/);
  });

  it("22023 con datos inválidos → invalid", () => {
    expect(mapReportError({ code: "22023", message: "Reporte inválido" }).kind).toBe("invalid");
    expect(mapReportError({ code: "22023", message: "Biblioteca inexistente" }).kind).toBe("invalid");
  });

  it("errores de transporte → network", () => {
    expect(mapReportError({ code: "", message: "TypeError: Failed to fetch" }).kind).toBe("network");
    expect(mapReportError({ message: "Load failed" }).kind).toBe("network");
  });

  it("cualquier otro → unknown, con mensaje genérico (sin filtrar detalles internos)", () => {
    const e = mapReportError({ code: "42501", message: "permission denied for function submit_report" });
    expect(e.kind).toBe("unknown");
    expect(e.message).not.toMatch(/permission/);
    expect(mapReportError(null).kind).toBe("unknown");
  });
});

describe("mensajes de cliente", () => {
  it("tooFarError indica a cuántos metros está el usuario", () => {
    expect(tooFarError(1234).message).toContain("1,2 km");
    expect(tooFarError(310).message).toContain("310 m");
    expect(tooFarError(310, 400).message).toContain("±400 m");
    expect(tooFarError(310).kind).toBe("too_far");
  });

  it("rateLimitError informa de los minutos restantes", () => {
    expect(rateLimitError(12).message).toContain("12 min");
    expect(rateLimitError(12).kind).toBe("rate_limit");
  });
});

describe("valores de reporte", () => {
  it("cinco niveles: 20, 40, 75, 90 y 100", () => {
    expect(REPORT_VALUES).toEqual([20, 40, 75, 90, 100]);
    expect(REPORT_OPTIONS.map((o) => [o.value, o.label])).toEqual([
      [20, "Casi vacía"],
      [40, "Bastante sitio"],
      [75, "Pocos sitios"],
      [90, "Casi llena"],
      [100, "Completa"],
    ]);
    for (const value of [20, 40, 75, 90, 100]) expect(isReportValue(value)).toBe(true);
    // 30 sigue siendo válido en la base de datos (reportes antiguos), pero ya no se ofrece.
    for (const value of [30, 50, 70, 0, "20", null]) expect(isReportValue(value)).toBe(false);
  });

  it("cada nivel tiene descripción y frase de confirmación", () => {
    expect(REPORT_OPTIONS.find((o) => o.value === 75)?.description).toBe("Hay que buscar hueco o compartir mesa");
    expect(reportSummary(90)).toBe("está casi llena");
    expect(REPORT_OPTIONS.every((o) => o.description && o.summary)).toBe(true);
  });

  it("el nivel reportado cae en la etiqueta de ocupación esperada", () => {
    expect(REPORT_VALUES.map(labelFromPct)).toEqual(["free", "free", "moderate", "high", "full"]);
  });
});
