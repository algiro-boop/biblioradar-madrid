import { afterEach, describe, expect, it, vi } from "vitest";
import { getTileConfig } from "@/lib/tiles";

afterEach(() => vi.unstubAllEnvs());

describe("getTileConfig", () => {
  it("sin variables usa OSM con filtro en ambos temas", () => {
    vi.stubEnv("NEXT_PUBLIC_MAP_TILE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_MAP_TILE_URL_DARK", "");
    for (const theme of ["light", "dark"] as const) {
      expect(getTileConfig(theme)).toMatchObject({ url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", softened: true });
    }
  });

  it("en oscuro prefiere NEXT_PUBLIC_MAP_TILE_URL_DARK y en claro la normal", () => {
    vi.stubEnv("NEXT_PUBLIC_MAP_TILE_URL", "https://claro/{z}/{x}/{y}.png");
    vi.stubEnv("NEXT_PUBLIC_MAP_TILE_URL_DARK", "https://oscuro/{z}/{x}/{y}.png");
    expect(getTileConfig("light")).toMatchObject({ url: "https://claro/{z}/{x}/{y}.png", softened: false });
    expect(getTileConfig("dark")).toMatchObject({ url: "https://oscuro/{z}/{x}/{y}.png", softened: false });
  });

  it("sin URL oscura, el modo oscuro reutiliza la URL configurada", () => {
    vi.stubEnv("NEXT_PUBLIC_MAP_TILE_URL", "https://claro/{z}/{x}/{y}.png");
    vi.stubEnv("NEXT_PUBLIC_MAP_TILE_URL_DARK", "");
    expect(getTileConfig("dark").url).toBe("https://claro/{z}/{x}/{y}.png");
  });

  it("con teselas de CARTO añade su atribución junto a la de OpenStreetMap", () => {
    vi.stubEnv("NEXT_PUBLIC_MAP_TILE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_MAP_TILE_ATTRIBUTION", "");
    vi.stubEnv("NEXT_PUBLIC_MAP_TILE_URL_DARK", "https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png?key=x");
    const { attribution } = getTileConfig("dark");
    expect(attribution).toContain("OpenStreetMap");
    expect(attribution).toContain("CARTO");
    expect(getTileConfig("light").attribution).not.toContain("CARTO");
  });
});
