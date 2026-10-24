import { haversineMeters, type LatLng } from "./geo";
import { hasRoom } from "./occupancy";
import type { InstitutionType, LibraryWithOccupancy } from "./types";

export type FilterInstitution = Exclude<InstitutionType, "otra">;

export interface LibraryFilters {
  query: string;
  onlyWithRoom: boolean;
  /** Vacío = todas. Varias seleccionadas se combinan con OR. */
  institutions: FilterInstitution[];
  /** Si hay posición, se ordena por cercanía. */
  near: LatLng | null;
}

export interface LibraryListItem {
  library: LibraryWithOccupancy;
  distanceM: number | null;
}

export const EMPTY_FILTERS: LibraryFilters = {
  query: "",
  onlyWithRoom: false,
  institutions: [],
  near: null,
};

/** Minúsculas y sin tildes: "Chamberí" encuentra "chamberi" y viceversa. */
export function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });

export function matchesQuery(library: LibraryWithOccupancy, query: string): boolean {
  const terms = normalizeText(query).split(" ").filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = normalizeText(`${library.name} ${library.district} ${library.address}`);
  return terms.every((t) => haystack.includes(t));
}

export function applyFilters(
  libraries: LibraryWithOccupancy[],
  filters: LibraryFilters,
): LibraryListItem[] {
  const items: LibraryListItem[] = [];
  for (const library of libraries) {
    if (filters.onlyWithRoom && !hasRoom(library.occupancy)) continue;
    if (
      filters.institutions.length > 0 &&
      !(filters.institutions as InstitutionType[]).includes(library.institution)
    ) {
      continue;
    }
    if (!matchesQuery(library, filters.query)) continue;
    items.push({
      library,
      distanceM: filters.near ? haversineMeters(filters.near, library) : null,
    });
  }
  items.sort((a, b) => {
    if (a.distanceM !== null && b.distanceM !== null && a.distanceM !== b.distanceM) {
      return a.distanceM - b.distanceM;
    }
    return collator.compare(a.library.name, b.library.name);
  });
  return items;
}

export function hasActiveFilters(filters: LibraryFilters): boolean {
  return (
    filters.query.trim() !== "" ||
    filters.onlyWithRoom ||
    filters.institutions.length > 0 ||
    filters.near !== null
  );
}
