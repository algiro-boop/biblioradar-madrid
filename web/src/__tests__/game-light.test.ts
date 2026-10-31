import { afterEach, describe, expect, it, vi } from "vitest";
import { REPORT_COINS } from "@/game/engine";
import { daylight, phaseInstant, sunTimes } from "@/game/sun";
import { TUTORIAL_STEPS } from "@/components/game/Tutorial";

const MIN = 60_000;
const madridClock = (ms: number) =>
  new Date(ms).toLocaleTimeString("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" });
const minutes = (hhmm: string) => {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

describe("sol de Madrid", () => {
  // Horas oficiales (Observatorio Astronómico Nacional, redondeadas al minuto).
  it.each([
    ["2026-06-21", "06:44", "21:48"],
    ["2026-12-21", "08:33", "17:51"],
    ["2026-03-20", "07:18", "19:26"],
    ["2026-10-31", "07:43", "18:12"],
  ])("%s: sale a las %s y se pone a las %s (±2 min)", (key, rise, set) => {
    const t = sunTimes(key);
    expect(Math.abs(minutes(madridClock(t.sunrise)) - minutes(rise))).toBeLessThanOrEqual(2);
    expect(Math.abs(minutes(madridClock(t.sunset)) - minutes(set))).toBeLessThanOrEqual(2);
  });

  it("los cambios de hora no descuadran el amanecer (antes y después del 25 de octubre)", () => {
    const before = minutes(madridClock(sunTimes("2026-10-24").sunrise));
    const after = minutes(madridClock(sunTimes("2026-10-26").sunrise));
    // Al retrasar la hora, el sol sale casi una hora antes en el reloj.
    expect(before - after).toBeGreaterThan(55);
    expect(before - after).toBeLessThan(62);
  });
});

describe("luz del juego", () => {
  const key = "2026-10-31";
  const { sunrise, sunset } = sunTimes(key);

  it("sigue el ciclo noche → amanecer → día → atardecer → noche", () => {
    expect(daylight(sunrise - 90 * MIN).phase).toBe("night");
    expect(daylight(sunrise + 5 * MIN).phase).toBe("dawn");
    expect(daylight((sunrise + sunset) / 2).phase).toBe("day");
    expect(daylight(sunset - 10 * MIN).phase).toBe("dusk");
    expect(daylight(sunset + 120 * MIN).phase).toBe("night");
  });

  it("de noche hay estrellas, penumbra y halos; de día, nubes y ningún velo", () => {
    const night = daylight(sunset + 150 * MIN);
    expect(night.stars).toBe(1);
    expect(night.sun).toBeNull();
    expect(night.night).toBeGreaterThan(0.3);
    const day = daylight((sunrise + sunset) / 2);
    expect(day.clouds).toBe(1);
    expect(day.veils).toEqual([]);
    expect(day.night).toBe(0);
  });

  it("con el sol bajo se ve el disco en la ventana y un haz largo y cálido en el suelo", () => {
    for (const t of [sunrise + 6 * MIN, sunset - 12 * MIN]) {
      const light = daylight(t);
      expect(light.sun).not.toBeNull();
      expect(light.beam!.length).toBeGreaterThan(5);
      expect(light.veils.length).toBe(2);
    }
  });

  it("el alba es más rosada y el atardecer más anaranjado", () => {
    const dawn = daylight(sunrise + 6 * MIN).veils.at(-1)!.color;
    const dusk = daylight(sunset - 6 * MIN).veils.at(-1)!.color;
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    // Más azul al amanecer (rosa) que al atardecer (naranja).
    expect(rgb(dawn)[2]).toBeGreaterThan(rgb(dusk)[2]! + 40);
  });

  it("la vista previa de Dev cae en el momento pedido", () => {
    for (const phase of ["dawn", "day", "dusk", "night"] as const) expect(daylight(phaseInstant(key, phase)).phase).toBe(phase);
  });
});

describe("tutorial", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("explica las pestañas y la economía con las cifras reales del juego", () => {
    const tabs = new Set(TUTORIAL_STEPS.flatMap((s) => s.tabs ?? []));
    for (const t of ["missions", "shop", "inventory", "achievements", "progress", "visit", "settings"]) expect(tabs.has(t as never)).toBe(true);
    const coins = TUTORIAL_STEPS.find((s) => s.title === "Monedas")!.body;
    expect(coins).toContain(`${REPORT_COINS[0]} el primero del día`);
    for (const s of TUTORIAL_STEPS) {
      expect(s.title.length).toBeGreaterThan(0);
      // Breve: cada paso cabe en la tarjeta sin desplazarse.
      expect(s.body.length).toBeLessThan(260);
    }
  });

  it("solo sale una vez por navegador", async () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
    const first = await import("@/components/game/Tutorial");
    expect(first.tutorialSeen()).toBe(false);
    first.markTutorialSeen();
    vi.resetModules();
    const again = await import("@/components/game/Tutorial");
    expect(again.tutorialSeen()).toBe(true);
  });

  it("sin almacenamiento disponible no se repite en la misma visita", async () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("bloqueado"); }, setItem: () => { throw new Error("bloqueado"); } });
    const mod = await import("@/components/game/Tutorial");
    expect(mod.tutorialSeen()).toBe(false);
    mod.markTutorialSeen();
    expect(mod.tutorialSeen()).toBe(true);
  });
});
