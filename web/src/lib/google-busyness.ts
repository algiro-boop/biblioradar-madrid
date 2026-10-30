import type { Library } from "./types";

export type GoogleLibrary = Pick<Library, "id" | "name" | "address" | "google_place_id">;
export type GoogleBusynessPhase = "loading" | "choose" | "ready" | "unavailable" | "empty" | "error";
type PopularTimesElement = HTMLElement & { rendered?: boolean };
type SearchElement = HTMLElement & { places?: { id?: string }[] };

export function googleMapsPlaceUrl(library: GoogleLibrary): string {
  const params = new URLSearchParams({ api: "1", query: `${library.name}, ${library.address}` });
  if (library.google_place_id) params.set("query_place_id", library.google_place_id);
  return `https://www.google.com/maps/search/?${params}`;
}

/** Render Google's own UI. Never inspect shadow DOM, extract percentages or persist Google content. */
export function mountGoogleBusyness(host: HTMLElement, library: GoogleLibrary,
  onPhase: (phase: GoogleBusynessPhase) => void): () => void {
  let disposed = false;
  let deadline = 0;
  const removers: (() => void)[] = [];
  function listen(element: HTMLElement, type: string, handler: (event: Event) => void) {
    element.addEventListener(type, handler);
    removers.push(() => element.removeEventListener(type, handler));
  }
  function phase(value: GoogleBusynessPhase) {
    if (disposed) return;
    window.clearTimeout(deadline);
    onPhase(value);
  }
  function waiting() {
    phase("loading");
    deadline = window.setTimeout(() => phase("error"), 18_000);
  }
  function showDetails(placeId: string) {
    if (disposed) return;
    waiting();
    const details = document.createElement("gmp-place-details");
    details.style.width = "100%";
    const request = document.createElement("gmp-place-details-place-request");
    request.setAttribute("place", placeId);
    const popularTimes = document.createElement("gmp-place-popular-times") as PopularTimesElement;
    // Name and address remain visible so users can verify the selected Google listing.
    details.append(request, document.createElement("gmp-place-name"), document.createElement("gmp-place-address"), popularTimes);
    listen(details, "gmp-load", () => phase(popularTimes.rendered === true ? "ready" : "unavailable"));
    listen(details, "gmp-error", () => phase("error"));
    host.replaceChildren(details);
  }
  if (library.google_place_id) showDetails(library.google_place_id);
  else {
    waiting();
    const search = document.createElement("gmp-place-search") as SearchElement;
    search.setAttribute("selectable", "");
    search.style.width = "100%";
    const request = document.createElement("gmp-place-text-search-request");
    request.setAttribute("text-query", `${library.name}, ${library.address}`);
    request.setAttribute("max-result-count", "3");
    const template = document.createElement("template");
    template.setAttribute("slot", "details-item");
    template.content.append(document.createElement("gmp-place-name"), document.createElement("gmp-place-address"));
    search.append(request, template, document.createElement("gmp-place-attribution"));
    listen(search, "gmp-load", () => phase(search.places?.length === 0 ? "empty" : "choose"));
    listen(search, "gmp-error", () => phase("error"));
    listen(search, "gmp-select", (event) => {
      if (disposed || !host.contains(search)) return;
      const placeId = (event as Event & { place?: { id?: string } }).place?.id;
      if (typeof placeId === "string" && placeId) showDetails(placeId);
    });
    host.replaceChildren(search);
  }
  return () => {
    disposed = true;
    window.clearTimeout(deadline);
    removers.forEach((remove) => remove());
    host.replaceChildren();
  };
}
