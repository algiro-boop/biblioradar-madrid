import { describe, expect, it } from "vitest";
import { resolveTheme, THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from "@/lib/theme";

describe("resolveTheme", () => {
  it("la elección guardada manda sobre el sistema", () => {
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
  });

  it("sin elección (o con un valor raro) sigue al sistema", () => {
    expect(resolveTheme(null, true)).toBe("dark");
    expect(resolveTheme(null, false)).toBe("light");
    expect(resolveTheme("azul", true)).toBe("dark");
  });
});

describe("THEME_INIT_SCRIPT", () => {
  function run(stored: string | null, systemDark: boolean) {
    const classes = new Set<string>();
    const root = {
      classList: { toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)) },
      style: { colorScheme: "" },
    };
    const env = {
      localStorage: { getItem: (k: string) => (k === THEME_STORAGE_KEY ? stored : null) },
      matchMedia: () => ({ matches: systemDark }),
      document: { documentElement: root },
    };
    new Function("localStorage", "matchMedia", "document", THEME_INIT_SCRIPT)(
      env.localStorage,
      env.matchMedia,
      env.document,
    );
    return { dark: classes.has("dark"), colorScheme: root.style.colorScheme };
  }

  it.each([
    [null, true],
    [null, false],
    ["dark", false],
    ["light", true],
  ] as const)("coincide con resolveTheme (guardado %s, sistema oscuro %s)", (stored, systemDark) => {
    const expected = resolveTheme(stored, systemDark);
    expect(run(stored, systemDark)).toEqual({ dark: expected === "dark", colorScheme: expected });
  });

  it("si localStorage falla no rompe la carga", () => {
    const boom = () => {
      throw new Error("bloqueado");
    };
    expect(() => new Function("localStorage", THEME_INIT_SCRIPT)({ getItem: boom })).not.toThrow();
  });
});
