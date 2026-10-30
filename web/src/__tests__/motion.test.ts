import { describe, expect, it } from "vitest";
import { countUpValue, easeOutCubic, PIN_DELAY_BUCKETS, pinDelayBucket, staggerDelay } from "@/lib/motion";
import { pinClassName, pinHtml, type PinState } from "@/lib/pins";

const BASE: PinState = { level: "free", pct: 42, name: "Biblioteca Aluche", selected: false, live: false, changed: false };

describe("animaciones", () => {
  it("escalona listas con tope", () => {
    expect(staggerDelay(0)).toBe(0);
    expect(staggerDelay(2)).toBe(70);
    expect(staggerDelay(100)).toBe(280);
    expect(staggerDelay(-3)).toBe(0);
  });

  it("el retardo del pin es estable por biblioteca y está acotado", () => {
    const ids = Array.from({ length: 200 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`);
    const buckets = ids.map(pinDelayBucket);
    expect(buckets.every((b) => b >= 0 && b < PIN_DELAY_BUCKETS)).toBe(true);
    expect(new Set(buckets).size).toBe(PIN_DELAY_BUCKETS); // se reparten, no aparecen todos a la vez
    expect(pinDelayBucket(ids[7]!)).toBe(pinDelayBucket(ids[7]!));
    expect(pinClassName(ids[7]!)).toBe(`biblio-pin pin-enter pin-d${pinDelayBucket(ids[7]!)}`);
  });

  it("contador animado: empieza, desacelera y termina exacto", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(2)).toBe(1);
    expect(countUpValue(0, 80, 0, 700)).toBe(0);
    expect(countUpValue(0, 80, 350, 700)).toBeGreaterThan(40); // ease-out: más de la mitad a mitad de tiempo
    expect(countUpValue(0, 80, 700, 700)).toBe(80);
    expect(countUpValue(60, 30, 9999, 700)).toBe(30);
    expect(countUpValue(0, 80, 10, 0)).toBe(80);
  });
});

describe("pines del mapa", () => {
  it("porcentaje, accesibilidad y sin animaciones extra por defecto", () => {
    const html = pinHtml(BASE);
    expect(html).toContain(">42%<");
    expect(html).toContain('aria-label="Biblioteca Aluche: 42%, Hay sitio"');
    expect(html).not.toContain("pin-live");
    expect(html).not.toContain("pin-pop");
    expect(html).not.toContain("pin-selected");
  });

  it("halo en vivo, rebote al cambiar y al seleccionar", () => {
    const html = pinHtml({ ...BASE, live: true, changed: true, selected: true });
    expect(html).toContain("pin-live");
    expect(html).toContain("confirmada hace poco");
    expect(html).toContain("pin-pop");
    expect(html).toContain("pin-selected");
    expect(html).toContain("ring-slate-900");
  });

  it("cerradas y sin datos quedan en segundo plano y sin halo", () => {
    const closed = pinHtml({ ...BASE, level: "closed", pct: 0, live: true });
    expect(closed).toContain(">Cerrada<");
    expect(closed).toContain("scale-90");
    expect(closed).not.toContain("pin-live");
    expect(pinHtml({ ...BASE, level: "unknown", pct: null })).toContain(">?<");
  });

  it("escapa el nombre", () => {
    expect(pinHtml({ ...BASE, name: 'Sala "A" <B>' })).toContain("Sala &#34;A&#34; &#60;B&#62;");
  });
});
