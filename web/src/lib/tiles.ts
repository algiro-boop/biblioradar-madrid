export interface TileConfig {
  url: string;
  attribution: string;
  /** Aplica un filtro CSS para aclarar teselas estándar y que destaquen los pines. */
  softened: boolean;
}

const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
// Sus condiciones exigen citar a CARTO junto a OpenStreetMap en cada mapa.
const CARTO_ATTRIBUTION = `${OSM_ATTRIBUTION} &copy; <a href="https://carto.com/attributions">CARTO</a>`;

/** OpenStreetMap con filtro CSS: lo de por defecto y el respaldo si el proveedor configurado falla. */
export const OSM_TILES: TileConfig = {
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: OSM_ATTRIBUTION,
  softened: true,
};

/**
 * Teselas XYZ. CARTO Positron/Dark Matter ya exigen API key, así que por defecto se usa
 * OpenStreetMap con un filtro (suave en claro; gris azulado en oscuro, ver globals.css). Para
 * otro proveedor define NEXT_PUBLIC_MAP_TILE_URL y, para el modo oscuro, NEXT_PUBLIC_MAP_TILE_URL_DARK.
 */
export function getTileConfig(theme: "light" | "dark" = "light"): TileConfig {
  const url = (theme === "dark" && process.env.NEXT_PUBLIC_MAP_TILE_URL_DARK) || process.env.NEXT_PUBLIC_MAP_TILE_URL;
  if (url) {
    return {
      url,
      attribution:
        process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION || (url.includes("cartocdn.com") ? CARTO_ATTRIBUTION : OSM_ATTRIBUTION),
      softened: false,
    };
  }
  return OSM_TILES;
}
