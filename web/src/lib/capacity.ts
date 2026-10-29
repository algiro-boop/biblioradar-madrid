import type { OccupancyStatus } from "./types";

/** El total es oficial; las plazas libres son una estimación del porcentaje actual. */
export function capacityText(total: number | null, status: OccupancyStatus | null): string | null {
  if (total === null || !Number.isSafeInteger(total) || total <= 0) return null;
  const pct = status?.final_occupancy_pct;
  if (status?.is_open_now === true && typeof pct === "number" && Number.isFinite(pct) && pct >= 0 && pct <= 100) {
    const free = Math.max(0, Math.round(total * (1 - pct / 100)));
    return `~${free} libres de ${total} plazas`;
  }
  // Cierre, apertura desconocida o porcentaje ausente: no inventar plazas libres.
  return `Capacidad: ${total} puestos`;
}
