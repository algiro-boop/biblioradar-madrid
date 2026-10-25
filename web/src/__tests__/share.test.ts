import { describe, expect, it, vi } from "vitest";
import { shareOrCopy, shareText, SITE_URL, whatsappUrl } from "@/lib/share";
import type { OccupancyStatus } from "@/lib/types";

function status(overrides: Partial<OccupancyStatus> = {}): OccupancyStatus {
  return {
    library_id: "lib-1",
    google_live_pct: null,
    google_hist_pct: null,
    predicted_base_pct: null,
    crowd_pct: null,
    final_occupancy_pct: null,
    status_label: null,
    base_source: "Sin datos de concurrencia",
    base_observed_at: null,
    base_valid_until: null,
    primary_source: "Sin datos de concurrencia",
    active_reports_count: 0,
    updated_at: "2026-10-25T10:00:00Z",
    ...overrides,
  };
}

const NAME = "Biblioteca Pública Elena Fortún (Retiro)";

describe("shareText", () => {
  it("abierta con porcentaje: nombre, % y etiqueta de estado", () => {
    const occupancy = status({ final_occupancy_pct: 42, status_label: "free", primary_source: "Concurrencia Google en vivo" });
    expect(shareText({ name: NAME, occupancy })).toBe(
      `📚 En *${NAME}* hay ahora mismo un *42% de ocupación* (hay sitio). Míralo en directo en BiblioRadar: ${SITE_URL}`,
    );
    const full = status({ final_occupancy_pct: 95, status_label: "high" });
    expect(shareText({ name: NAME, occupancy: full })).toContain("*95% de ocupación* (casi llena)");
  });

  it.each(["Cerrada según horario revisado", "Cerrada según horario de Google", "Cerrada según horario publicado"])(
    "cerrada (%s)",
    (source) => {
      const occupancy = status({ base_source: source, primary_source: source });
      expect(shareText({ name: NAME, occupancy })).toBe(
        `📚 *${NAME}* está cerrada ahora mismo. Mira qué bibliotecas tienen sitio libre en Madrid: ${SITE_URL}`,
      );
    },
  );

  it("sin datos no afirma que esté cerrada", () => {
    for (const occupancy of [null, status()]) {
      const text = shareText({ name: NAME, occupancy });
      expect(text).not.toMatch(/cerrada/);
      expect(text).toContain(`*${NAME}*`);
      expect(text).toContain(SITE_URL);
    }
  });
});

describe("whatsappUrl", () => {
  it("codifica el texto completo en wa.me", () => {
    const text = "📚 En *Aluche* hay un 40% (hay sitio) & más: https://x.y/?a=1";
    const url = whatsappUrl(text);
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(url.slice("https://wa.me/?text=".length))).toBe(text);
    expect(url.slice("https://wa.me/?".length)).not.toMatch(/[ &?#]|📚/u);
  });
});

describe("shareOrCopy", () => {
  const clipboard = () => ({ writeText: vi.fn<(t: string) => Promise<void>>(() => Promise.resolve()) });

  it("en móvil usa la hoja nativa de compartir", async () => {
    const nav = { clipboard: clipboard(), share: vi.fn(() => Promise.resolve()) };
    await expect(shareOrCopy("hola", nav as never, true)).resolves.toBe("shared");
    expect(nav.share).toHaveBeenCalledWith({ text: "hola" });
    expect(nav.clipboard.writeText).not.toHaveBeenCalled();
  });

  it("cerrar la hoja nativa no copia ni da error", async () => {
    const abort = Object.assign(new Error("cancel"), { name: "AbortError" });
    const nav = { clipboard: clipboard(), share: vi.fn(() => Promise.reject(abort)) };
    await expect(shareOrCopy("hola", nav as never, true)).resolves.toBe("cancelled");
    expect(nav.clipboard.writeText).not.toHaveBeenCalled();
  });

  it("sin navigator.share, en ordenador o si falla, copia al portapapeles", async () => {
    const plain = { clipboard: clipboard() };
    await expect(shareOrCopy("hola", plain as never, true)).resolves.toBe("copied");
    const desktop = { clipboard: clipboard(), share: vi.fn() };
    await expect(shareOrCopy("hola", desktop as never, false)).resolves.toBe("copied");
    expect(desktop.share).not.toHaveBeenCalled();
    const broken = { clipboard: clipboard(), share: vi.fn(() => Promise.reject(new TypeError("no"))) };
    await expect(shareOrCopy("hola", broken as never, true)).resolves.toBe("copied");
    expect(broken.clipboard.writeText).toHaveBeenCalledWith("hola");
  });

  it("si el portapapeles no está disponible devuelve failed", async () => {
    const nav = { clipboard: { writeText: () => Promise.reject(new Error("denied")) } };
    await expect(shareOrCopy("hola", nav as never, false)).resolves.toBe("failed");
  });
});
