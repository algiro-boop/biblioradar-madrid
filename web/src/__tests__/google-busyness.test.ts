// @vitest-environment happy-dom
// Simulated DOM and SDK events only; no browser, real key or external HTTP requests.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoogleBusyness } from "@/components/GoogleBusyness";
import { googleMapsPlaceUrl, mountGoogleBusyness, type GoogleBusynessPhase } from "@/lib/google-busyness";

const sdk = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/lib/google-places-loader", () => ({ loadGooglePlaces: sdk.load }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const library = { id: "one", name: "Biblioteca de prueba", address: "Calle de prueba, Madrid", google_place_id: "ChIJ-test" };
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY", "test-key");
  sdk.load.mockReset().mockResolvedValue(undefined);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.unstubAllEnvs(); vi.useRealTimers();
});
async function render(value = library) { await act(async () => root.render(h(GoogleBusyness, { library: value }))); }
async function click() { await act(async () => container.querySelector<HTMLButtonElement>("button")!.click()); }

describe("Google busyness on demand", () => {
  it("does not load Google until clicked, mounts the standard component and never reloads for occupancy ticks", async () => {
    await render();
    expect(sdk.load).not.toHaveBeenCalled(); expect(container.querySelector("gmp-place-details")).toBeNull();
    await click();
    expect(sdk.load).toHaveBeenCalledOnce();
    const details = container.querySelector("gmp-place-details")!;
    expect(details.querySelector("gmp-place-details-place-request")?.getAttribute("place")).toBe("ChIJ-test");
    expect(details.querySelector("gmp-place-name")).not.toBeNull();
    expect(container.querySelector("gmp-advanced-place-details")).toBeNull();
    const times = details.querySelector("gmp-place-popular-times")!;
    Object.assign(times, { rendered: true });
    await act(async () => details.dispatchEvent(new Event("gmp-load")));
    expect(container.textContent).not.toContain("Consultando Google");
    await render({ ...library });
    await click(); await click();
    expect(sdk.load).toHaveBeenCalledOnce();
    expect(container.querySelector("gmp-place-details")).toBe(details);
  });
  it("shows no-data and failure states without inventing live values", async () => {
    await render(); await click();
    const details = container.querySelector("gmp-place-details")!;
    await act(async () => details.dispatchEvent(new Event("gmp-load")));
    expect(container.textContent).toContain("Google no muestra horas punta");
    await act(async () => details.dispatchEvent(new Event("gmp-error")));
    expect(container.textContent).toContain("No se ha podido cargar");
    expect(container.querySelector('a[target="_blank"]')).not.toBeNull();
    expect(container.textContent).not.toContain("0%");
  });
  it("falls back to a direct Maps link when no key exists, with no SDK call", async () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY", "");
    await render();
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("a")?.href).toBe(googleMapsPlaceUrl(library));
    expect(container.textContent).toContain("Se abre Google Maps");
    expect(sdk.load).not.toHaveBeenCalled();
  });
  it("falls back after a loader rejection", async () => {
    sdk.load.mockRejectedValueOnce(new Error("blocked"));
    await render(); await click();
    expect(container.textContent).toContain("No se ha podido cargar");
  });
  it("does not mount a billable widget if the user closes while the SDK is loading", async () => {
    let finish!: () => void;
    sdk.load.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
    await render(); await click();
    await act(async () => root.render(h("p", null, "closed")));
    await act(async () => finish());
    expect(container.querySelector("gmp-place-details")).toBeNull();
  });
});

describe("Google widget adapter", () => {
  it("requires the user's selection when the Place ID is missing and keeps attribution", () => {
    const phases: GoogleBusynessPhase[] = [];
    const host = document.createElement("div");
    const dispose = mountGoogleBusyness(host, { ...library, google_place_id: null }, (phase) => phases.push(phase));
    const search = host.querySelector("gmp-place-search")!;
    expect(search.hasAttribute("selectable")).toBe(true);
    expect(search.querySelector("gmp-place-text-search-request")?.getAttribute("text-query")).toBe(`${library.name}, ${library.address}`);
    expect(search.querySelector("gmp-place-attribution")).not.toBeNull();
    expect(host.querySelector("gmp-place-details")).toBeNull();
    Object.assign(search, { places: [{ id: "correct" }] });
    search.dispatchEvent(new Event("gmp-load")); expect(phases.at(-1)).toBe("choose");
    const event = new Event("gmp-select"); Object.assign(event, { place: { id: "correct" } });
    search.dispatchEvent(event);
    expect(host.querySelector("gmp-place-details-place-request")?.getAttribute("place")).toBe("correct");
    const count = phases.length; dispose();
    search.dispatchEvent(event); expect(phases).toHaveLength(count); expect(host.children.length).toBe(0);
  });
  it("handles zero search results and times out without automatically retrying", () => {
    vi.useFakeTimers();
    const phase = vi.fn(); const host = document.createElement("div");
    const dispose = mountGoogleBusyness(host, { ...library, google_place_id: null }, phase);
    const search = host.querySelector("gmp-place-search")!;
    Object.assign(search, { places: [] }); search.dispatchEvent(new Event("gmp-load"));
    expect(phase).toHaveBeenLastCalledWith("empty"); dispose();
    const cleanup = mountGoogleBusyness(host, library, phase);
    vi.advanceTimersByTime(18_001); expect(phase).toHaveBeenLastCalledWith("error"); cleanup();
  });
  it("builds an encoded Maps URL with the exact ID, or name and address when missing", () => {
    const url = new URL(googleMapsPlaceUrl(library));
    expect(url.origin).toBe("https://www.google.com");
    expect(url.searchParams.get("query_place_id")).toBe(library.google_place_id);
    const noId = new URL(googleMapsPlaceUrl({ ...library, name: 'A&B <test>', google_place_id: null }));
    expect(noId.searchParams.get("query")).toBe('A&B <test>, Calle de prueba, Madrid');
    expect(noId.searchParams.has("query_place_id")).toBe(false);
  });
});
