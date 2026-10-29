import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LibraryDrawer } from "@/components/LibraryDrawer";
import { LibraryList } from "@/components/LibraryList";
import { capacityText } from "@/lib/capacity";
import { parseLibraryRow } from "@/lib/occupancy";
import type { LibraryWithOccupancy } from "@/lib/types";

// Synthetic render fixtures, unrelated to the official capacity audit.
function library(capacity: unknown = 100, open: boolean | null = true, pct: number | null = 40): LibraryWithOccupancy {
  return parseLibraryRow({
    id: "test", name: "Biblioteca de prueba", lat: 40.4, lng: -3.7,
    total_seats: 999, total_capacity: capacity,
    occupancy_status: { library_id: "test", is_open_now: open, final_occupancy_pct: pct },
  })!;
}

describe("capacidad oficial y plazas libres estimadas", () => {
  it("calcula y redondea las plazas libres sin presentarlas como un recuento", () => {
    expect(capacityText(100, library().occupancy)).toBe("~60 libres de 100 plazas");
    expect(capacityText(101, library(101, true, 75).occupancy)).toBe("~25 libres de 101 plazas");
    expect(capacityText(100, library(100, true, 100).occupancy)).toBe("~0 libres de 100 plazas");
    expect(capacityText(100, library(100, true, 0).occupancy)).toBe("~100 libres de 100 plazas");
  });

  it("cerrada o sin porcentaje/apertura confirmada: solo muestra el total", () => {
    for (const lib of [library(100, false, 0), library(100, true, null), library(100, null, 40)]) {
      expect(capacityText(lib.total_capacity, lib.occupancy)).toBe("Capacidad: 100 puestos");
    }
    expect(capacityText(100, null)).toBe("Capacidad: 100 puestos");
  });

  it.each([null, undefined, 0, -1, 1.5, "100", true])("no usa capacidades inválidas ni el total_seats antiguo: %s", (raw) => {
    const lib = parseLibraryRow({ ...library(), total_capacity: raw })!;
    expect(lib.total_capacity).toBeNull();
    expect(lib.total_seats).toBe(999);
    expect(capacityText(lib.total_capacity, lib.occupancy)).toBeNull();
  });

  for (const component of ["list", "map-detail"] as const) {
    function render(lib: LibraryWithOccupancy) {
      return renderToStaticMarkup(component === "list"
        ? createElement(LibraryList, {
          items: [{ library: lib, distanceM: null }], total: 1, loading: false, error: null,
          now: 0, selectedId: null, filtersActive: false, onSelect() {}, onClearFilters() {}, onRetry() {},
        })
        : createElement(LibraryDrawer, {
          library: lib, distanceM: null, now: 0, locationGranted: false,
          locate: async () => ({ lat: 40.4, lng: -3.7, accuracy: 10, timestamp: 0 }),
          onReported() {}, onClose() {},
        }));
    }
    it(`${component}: abierta con total numérico`, () => {
      expect(render(library())).toContain("~60 libres de 100 plazas");
    });
    it(`${component}: cerrada con total numérico`, () => {
      const html = render(library(100, false, 0));
      expect(html).toContain("Capacidad: 100 puestos");
      expect(html).not.toContain("libres de");
    });
    it(`${component}: null no añade texto de plazas`, () => {
      const html = render(library(null));
      expect(html).not.toContain("libres de");
      expect(html).not.toContain("Capacidad:");
      expect(html).not.toContain("999 puestos");
      expect(html).toContain("40%");
    });
  }
});
