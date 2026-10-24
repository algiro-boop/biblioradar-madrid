export interface TileConfig {
  url: string;
  attribution: string;
  /** Aplica un filtro CSS para aclarar teselas estándar y que destaquen los pines. */
  softened: boolean;
}

const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

/**
 * Teselas XYZ. CARTO Positron ya exige API key, así que por defecto se usa OpenStreetMap con un filtro
 * suave. Para Positron (u otro proveedor) define NEXT_PUBLIC_MAP_TILE_URL con tu clave.
 */
export function getTileConfig(): TileConfig {
  const url = process.env.NEXT_PUBLIC_MAP_TILE_URL;
  if (url) {
    return {
      url,
      attribution: process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION || OSM_ATTRIBUTION,
      softened: false,
    };
  }
  return {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: OSM_ATTRIBUTION,
    softened: true,
  };
}
