// @vitest-environment happy-dom
// Script insertion is intercepted: these tests never download or execute Google code.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
type SDKWindow = Window & {
  google?: { maps: { importLibrary: (name: string) => Promise<unknown> } };
  __biblioradarPlacesReady?: () => void;
};
let scripts: HTMLScriptElement[];
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); scripts = [];
  delete (window as SDKWindow).google;
  delete (window as SDKWindow).__biblioradarPlacesReady;
  vi.spyOn(document.head, "append").mockImplementation((...nodes) => {
    for (const node of nodes) if (node instanceof HTMLScriptElement) scripts.push(node);
  });
  if (!customElements.get("gmp-place-details")) customElements.define("gmp-place-details", class extends HTMLElement {});
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("Google SDK loader", () => {
  it("shares a single lazy script across concurrent requests and configures the standard Places library", async () => {
    const { loadGooglePlaces } = await import("@/lib/google-places-loader");
    const first = loadGooglePlaces("test-only-key");
    const second = loadGooglePlaces("test-only-key");
    expect(first).toBe(second); expect(scripts).toHaveLength(1);
    const src = new URL(scripts[0]!.src);
    expect(src.origin).toBe("https://maps.googleapis.com");
    expect(src.searchParams.get("libraries")).toBe("places");
    expect(src.searchParams.get("language")).toBe("es");
    expect(src.searchParams.get("region")).toBe("ES");
    const importLibrary = vi.fn().mockResolvedValue({});
    (window as SDKWindow).google = { maps: { importLibrary } };
    (window as SDKWindow).__biblioradarPlacesReady!();
    await first;
    expect(importLibrary).toHaveBeenCalledExactlyOnceWith("places");
    await loadGooglePlaces("test-only-key"); expect(scripts).toHaveLength(1);
  });
  it("rejects a failed download and permits a later explicit retry", async () => {
    const { loadGooglePlaces } = await import("@/lib/google-places-loader");
    const failed = expect(loadGooglePlaces("test")).rejects.toThrow("could not load");
    scripts[0]!.dispatchEvent(new Event("error")); await failed;
    const retry = loadGooglePlaces("test"); expect(scripts).toHaveLength(2);
    (window as SDKWindow).google = { maps: { importLibrary: vi.fn().mockResolvedValue({}) } };
    (window as SDKWindow).__biblioradarPlacesReady!(); await retry;
  });
  it("times out a hanging library import instead of leaving loading UI indefinitely", async () => {
    (window as SDKWindow).google = { maps: { importLibrary: () => new Promise(() => {}) } };
    const { loadGooglePlaces } = await import("@/lib/google-places-loader");
    const failed = expect(loadGooglePlaces("test")).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(15_001); await failed;
    expect(scripts).toHaveLength(0);
  });
  it("rejects missing configuration and SSR without adding a script", async () => {
    const { loadGooglePlaces } = await import("@/lib/google-places-loader");
    await expect(loadGooglePlaces("")).rejects.toThrow("not configured");
    vi.stubGlobal("window", undefined);
    await expect(loadGooglePlaces("test")).rejects.toThrow("not configured");
    expect(scripts).toHaveLength(0);
  });
});
