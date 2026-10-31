/** Rotación diaria global de especiales (§5) y reglas de precio, reventa y reserva (§4.4). */

import { SPECIAL_ITEMS, type CatalogItem } from "../data/catalog";
import { seeded } from "../rng";
import { addDays, daysBetween } from "../time";

export const SPECIAL_SLOTS = 3;
export const RARITY_WEIGHTS: [CatalogItem["rarity"], number][] = [["R", 0.6], ["E", 0.3], ["L", 0.1]];
export const ROTATION_SEED_VERSION = 1;
/** Lanzamiento de la gamificación; el primer mes solo rotan especiales hasta L10. Configurable. */
export const SHOP_LAUNCH_DATE = "2026-11-02";
export const SHOP_FULL_POOL_AFTER_DAYS = 30;
export const RESERVATION_HOURS = 72;
const RECENT_DAYS = 3;

export function maxRotationLevel(date: string): number {
  return daysBetween(SHOP_LAUNCH_DATE, date) < SHOP_FULL_POOL_AFTER_DAYS ? 10 : 15;
}

function pool(date: string): CatalogItem[] {
  const cap = maxRotationLevel(date);
  return SPECIAL_ITEMS.filter((i) => i.minLevel <= cap);
}

/**
 * Sorteo determinista de un día: rareza por hueco 60/30/10, sin duplicados, evitando las
 * piezas de los 3 días anteriores si hay alternativas, y con al menos una pieza comprable en L1.
 * Si ningún hueco salió raro (6,4 % de los días) el primero pasa a raro de L1: es el único
 * caso en que la rareza no sigue el peso, y se documenta en el README.
 */
export function drawRotation(date: string, recent: Set<string>, seedVersion = ROTATION_SEED_VERSION): string[] {
  const rand = seeded(`shop:${seedVersion}:${date}`);
  const items = pool(date);
  const rarities = Array.from({ length: SPECIAL_SLOTS }, () => {
    const r = rand();
    let acc = 0;
    for (const [rarity, w] of RARITY_WEIGHTS) {
      acc += w;
      if (r < acc) return rarity;
    }
    return "R" as const;
  });
  if (!rarities.includes("R")) rarities[0] = "R";
  const chosen: string[] = [];
  // El primer hueco raro se reserva para una pieza de nivel 1.
  const l1Slot = rarities.indexOf("R");
  rarities.forEach((rarity, slot) => {
    const base = items.filter((i) => i.rarity === rarity && !chosen.includes(i.id) && (slot !== l1Slot || i.minLevel === 1));
    const fresh = base.filter((i) => !recent.has(i.id));
    const candidates = fresh.length ? fresh : base;
    chosen.push(candidates[Math.floor(rand() * candidates.length)]!.id);
  });
  return chosen;
}

/** Rotación de una fecha usando las instantáneas guardadas de los días previos. */
export function rotationFor(date: string, snapshots: Record<string, { ids: string[] }>): string[] {
  const saved = snapshots[date];
  if (saved) return saved.ids;
  const recent = new Set<string>();
  for (let i = 1; i <= RECENT_DAYS; i++) {
    const prev = addDays(date, -i);
    const ids = snapshots[prev]?.ids ?? drawRotation(prev, new Set());
    ids.forEach((id) => recent.add(id));
  }
  return drawRotation(date, recent);
}

export const resaleValue = (paid: number) => Math.floor(paid / 2);
export const reservationDeposit = (price: number) => Math.ceil(price * 0.1);
