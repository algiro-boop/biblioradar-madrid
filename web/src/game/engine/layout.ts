/** Geometría de salas, validación de distribuciones (colisiones, accesos) y rutas libres. */

import { findItem, type CatalogItem, type Tag } from "../data/catalog";
import { ROOMS, roomAt, type RoomDef } from "../data/levels";
import type { GameState, OwnedItem, Placement, RoomStyle, SaveFacts } from "./types";

export type Cell = [number, number];

/** Lo colgado va en una de las dos paredes; lo de suelo gira en las cuatro direcciones. */
export function rotationsFor(item: CatalogItem): number[] {
  if (item.layer === "wall") return [0, 1];
  return [0, 1, 2, 3];
}

/** Hacia dónde mira el frente de un mueble según su giro (0: +y, 1: +x, 2: −y, 3: −x). */
export const FRONT: readonly Cell[] = [[0, 1], [1, 0], [0, -1], [-1, 0]];

/**
 * Hacia dónde mira quien se sienta (0: +x, 1: +y, 2: −x, 3: −y). Las sillas de una casilla miran
 * según su giro; los asientos alargados (sofás) miran por su lado largo, con el respaldo a lo ancho.
 */
export function seatFacing(item: CatalogItem, rot: number): number {
  const r = ((rot % 4) + 4) % 4;
  return item.w === item.h ? r : [1, 0, 3, 2][r]!;
}

/** Huella en casillas tras el giro (las orientaciones impares intercambian ancho y fondo). */
export function footprint(item: CatalogItem, rot: number): { w: number; h: number } {
  if (item.layer === "wall") return { w: item.w, h: 1 };
  return rot % 2 === 1 ? { w: item.h, h: item.w } : { w: item.w, h: item.h };
}

export function cellsOf(item: CatalogItem, p: Pick<Placement, "x" | "y" | "rot">): Cell[] {
  const { w, h } = footprint(item, p.rot);
  const cells: Cell[] = [];
  for (let dx = 0; dx < w; dx++) for (let dy = 0; dy < h; dy++) cells.push([p.x + dx, p.y + dy]);
  return cells;
}

/** Huecos de pared: pared derecha (y = 0) «R:x», izquierda (x = 0) «L:y». */
export function wallSlotsOf(item: CatalogItem, p: Pick<Placement, "x" | "rot">): string[] {
  const wall = p.rot % 2 === 1 ? "L" : "R";
  return Array.from({ length: item.w }, (_, i) => `${wall}:${p.x + i}`);
}

export function entranceOf(room: RoomDef): Cell {
  if (room.stairs) return [room.stairs.x + room.stairs.w, room.stairs.y];
  return [0, room.door ?? 0];
}

/** Casillas que siempre deben quedar libres: puerta y su acceso, escalera y su desembarco. */
export function reservedCells(room: RoomDef): Set<string> {
  const out = new Set<string>();
  if (room.door !== null) {
    out.add(`0,${room.door}`);
    out.add(`1,${room.door}`);
  }
  if (room.stairs) {
    const s = room.stairs;
    for (let x = s.x; x < s.x + s.w; x++) for (let y = s.y; y < s.y + s.h; y++) out.add(`${x},${y}`);
    const [ex, ey] = entranceOf(room);
    out.add(`${ex},${ey}`);
  }
  return out;
}

export function blockedWallSlots(room: RoomDef): Set<string> {
  const out = new Set<string>();
  // También los huecos de ventanas que aparecerán al ampliar: así nunca tapan nada colgado.
  for (const win of [...room.windows, ...room.futureWindows]) for (let i = 0; i < win.w; i++) out.add(`R:${win.at + i}`);
  if (room.door !== null) out.add(`L:${room.door}`);
  return out;
}

export interface LayoutIssue {
  uid: string;
  reason: string;
}

interface Resolved {
  p: Placement;
  item: CatalogItem;
}

function resolve(placements: Placement[], owned: Map<string, OwnedItem>): { list: Resolved[]; issues: LayoutIssue[] } {
  const issues: LayoutIssue[] = [];
  const list: Resolved[] = [];
  const seen = new Set<string>();
  for (const p of placements) {
    const own = owned.get(p.uid);
    if (!own || own.soldAt) {
      issues.push({ uid: p.uid, reason: "No posees este objeto." });
      continue;
    }
    if (seen.has(p.uid)) {
      issues.push({ uid: p.uid, reason: "El objeto ya está colocado." });
      continue;
    }
    seen.add(p.uid);
    const item = findItem(own.itemId);
    if (!item) {
      issues.push({ uid: p.uid, reason: "Artículo desconocido." });
      continue;
    }
    list.push({ p, item });
  }
  return { list, issues };
}

/** Ocupación de una sala: suelo bloqueado, alfombras, objetos pequeños y pared. */
export function occupancy(list: Resolved[], room: RoomDef) {
  const floor = new Map<string, Resolved>();
  const rugs = new Map<string, Resolved>();
  const smalls = new Map<string, Resolved>();
  const wall = new Map<string, Resolved>();
  for (const r of list) {
    if (r.p.room !== room.id) continue;
    if (r.item.layer === "wall") for (const s of wallSlotsOf(r.item, r.p)) wall.set(s, r);
    else if (r.item.layer === "rug") for (const [x, y] of cellsOf(r.item, r.p)) rugs.set(`${x},${y}`, r);
    else if (r.item.layer === "small") smalls.set(`${r.p.x},${r.p.y}`, r);
    else for (const [x, y] of cellsOf(r.item, r.p)) floor.set(`${x},${y}`, r);
  }
  return { floor, rugs, smalls, wall };
}

/**
 * Valida una distribución completa. Mismas reglas en cliente (vista previa) y en el motor
 * (autoridad): propiedad, sala desbloqueada, límites, colisiones, puertas y escaleras.
 */
export function validateLayout(
  placements: Placement[], ownedItems: OwnedItem[], level: number, expansions: Record<string, number> = {},
): LayoutIssue[] {
  const owned = new Map(ownedItems.map((o) => [o.uid, o]));
  const { list, issues } = resolve(placements, owned);
  if (list.some((r) => !ROOMS.some((room) => room.id === r.p.room))) {
    for (const r of list) if (!ROOMS.some((room) => room.id === r.p.room)) issues.push({ uid: r.p.uid, reason: "Sala desconocida." });
  }
  for (const spec of ROOMS) {
    const room = roomAt(spec.id, level, expansions[spec.id]);
    const inRoom = list.filter((r) => r.p.room === room.id);
    if (!inRoom.length) continue;
    if (room.level > level) {
      for (const r of inRoom) issues.push({ uid: r.p.uid, reason: "Esa sala aún no está desbloqueada." });
      continue;
    }
    const reserved = reservedCells(room);
    const blockedWall = blockedWallSlots(room);
    const floor = new Map<string, string>();
    const rugs = new Map<string, string>();
    const smalls = new Map<string, string>();
    const wall = new Map<string, string>();
    // Primero los muebles de suelo: los pequeños dependen de si hay superficie debajo.
    const ordered = [...inRoom].sort((a, b) => order(a.item) - order(b.item));
    for (const { p, item } of ordered) {
      if (!rotationsFor(item).includes(p.rot)) {
        issues.push({ uid: p.uid, reason: "Orientación no disponible para este objeto." });
        continue;
      }
      if (item.layer === "wall") {
        const len = p.rot % 2 === 1 ? room.h : room.w;
        const slots = wallSlotsOf(item, p);
        if (p.x < 0 || p.x + item.w > len) issues.push({ uid: p.uid, reason: "Fuera de la pared." });
        else if (slots.some((s) => blockedWall.has(s))) issues.push({ uid: p.uid, reason: "Tapa una ventana o la puerta." });
        else if (slots.some((s) => wall.has(s))) issues.push({ uid: p.uid, reason: "Ya hay algo colgado ahí." });
        else for (const s of slots) wall.set(s, p.uid);
        continue;
      }
      const cells = item.layer === "small" ? [[p.x, p.y] as Cell] : cellsOf(item, p);
      if (cells.some(([x, y]) => x < 0 || y < 0 || x >= room.w || y >= room.h)) {
        issues.push({ uid: p.uid, reason: "Se sale de la sala." });
        continue;
      }
      const keys = cells.map(([x, y]) => `${x},${y}`);
      if (item.layer === "rug") {
        if (keys.some((k) => rugs.has(k))) issues.push({ uid: p.uid, reason: "Ya hay una alfombra ahí." });
        else if (room.stairs && cells.some(([x, y]) => inRect(x, y, room.stairs!)))
          issues.push({ uid: p.uid, reason: "No se puede cubrir la escalera." });
        else for (const k of keys) rugs.set(k, p.uid);
        continue;
      }
      if (keys.some((k) => reserved.has(k))) {
        issues.push({ uid: p.uid, reason: room.stairs ? "Bloquea la escalera." : "Bloquea la puerta." });
        continue;
      }
      if (item.layer === "small") {
        const k = keys[0]!;
        const under = floor.get(k);
        const underItem = under ? findItem(owned.get(under)!.itemId) : undefined;
        if (smalls.has(k)) issues.push({ uid: p.uid, reason: "Ya hay un objeto en esa casilla." });
        else if (under && !underItem?.tags.includes("surface")) issues.push({ uid: p.uid, reason: "No cabe encima de ese mueble." });
        else smalls.set(k, p.uid);
        continue;
      }
      if (keys.some((k) => floor.has(k) || smalls.has(k))) {
        issues.push({ uid: p.uid, reason: "Choca con otro mueble." });
        continue;
      }
      for (const k of keys) floor.set(k, p.uid);
    }
  }
  return issues;
}

function inRect(x: number, y: number, r: { x: number; y: number; w: number; h: number }): boolean {
  return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
}

function order(item: CatalogItem): number {
  return item.layer === "floor" ? 0 : item.layer === "rug" ? 1 : item.layer === "wall" ? 2 : 3;
}

/** Casillas transitables: sin muebles de suelo ni objetos pequeños en el suelo (las alfombras se pisan). */
export function walkableGrid(room: RoomDef, placements: Placement[], itemOf: (uid: string) => CatalogItem | undefined): boolean[][] {
  const grid = Array.from({ length: room.w }, () => Array<boolean>(room.h).fill(true));
  const floorCells = new Set<string>();
  for (const p of placements) {
    if (p.room !== room.id) continue;
    const item = itemOf(p.uid);
    if (!item || item.layer === "wall" || item.layer === "rug") continue;
    if (item.layer === "floor") for (const [x, y] of cellsOf(item, p)) floorCells.add(`${x},${y}`);
  }
  for (const p of placements) {
    if (p.room !== room.id) continue;
    const item = itemOf(p.uid);
    if (item?.layer === "small" && !floorCells.has(`${p.x},${p.y}`)) floorCells.add(`${p.x},${p.y}`);
  }
  for (const k of floorCells) {
    const [x = -1, y = -1] = k.split(",").map(Number);
    if (x >= 0 && y >= 0 && x < room.w && y < room.h) grid[x]![y] = false;
  }
  if (room.stairs) {
    const s = room.stairs;
    for (let x = s.x; x < s.x + s.w; x++) for (let y = s.y; y < s.y + s.h; y++) {
      const col = grid[x];
      if (col) col[y] = false;
    }
  }
  return grid;
}

export const NEIGHBORS: Cell[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function reachableFrom(grid: boolean[][], start: Cell): Set<string> {
  const seen = new Set<string>();
  const [sx, sy] = start;
  if (!grid[sx]?.[sy]) return seen;
  const queue: Cell[] = [start];
  seen.add(`${sx},${sy}`);
  while (queue.length) {
    const [x, y] = queue.shift()!;
    for (const [dx, dy] of NEIGHBORS) {
      const nx = x + dx;
      const ny = y + dy;
      const k = `${nx},${ny}`;
      if (grid[nx]?.[ny] && !seen.has(k)) {
        seen.add(k);
        queue.push([nx, ny]);
      }
    }
  }
  return seen;
}

/** Ruta más corta (BFS) entre dos casillas transitables; null si no hay camino. */
export function findPath(grid: boolean[][], from: Cell, to: Cell): Cell[] | null {
  const key = (c: Cell) => `${c[0]},${c[1]}`;
  const prev = new Map<string, Cell | null>([[key(from), null]]);
  const queue: Cell[] = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur[0] === to[0] && cur[1] === to[1]) {
      const path: Cell[] = [];
      let c: Cell | null = cur;
      while (c) {
        path.unshift(c);
        c = prev.get(key(c)) ?? null;
      }
      return path;
    }
    for (const [dx, dy] of NEIGHBORS) {
      const n: Cell = [cur[0] + dx, cur[1] + dy];
      if (grid[n[0]]?.[n[1]] && !prev.has(key(n))) {
        prev.set(key(n), cur);
        queue.push(n);
      }
    }
  }
  return null;
}

/** Ayudas de consulta sobre el estado. */
export function itemLookup(state: Pick<GameState, "inventory">): (uid: string) => CatalogItem | undefined {
  const map = new Map(state.inventory.map((o) => [o.uid, o.itemId]));
  return (uid) => {
    const id = map.get(uid);
    return id ? findItem(id) : undefined;
  };
}

export function placedInRoom(placements: Placement[], room: string): Placement[] {
  return placements.filter((p) => p.room === room);
}

function tagged(placements: Placement[], itemOf: (uid: string) => CatalogItem | undefined, tag: Tag): Placement[] {
  return placements.filter((p) => itemOf(p.uid)?.tags.includes(tag));
}

function touches(a: Cell[], b: Cell[]): boolean {
  return a.some(([ax, ay]) => b.some(([bx, by]) => Math.abs(ax - bx) + Math.abs(ay - by) === 1));
}

function cellsFor(p: Placement, item: CatalogItem): Cell[] {
  return item.layer === "small" ? [[p.x, p.y]] : cellsOf(item, p);
}

/** Pares adyacentes (lado con lado) entre piezas de dos etiquetas en la misma sala. */
export function adjacentPairs(
  placements: Placement[], itemOf: (uid: string) => CatalogItem | undefined, a: Tag, b: Tag,
): [Placement, Placement][] {
  const pairs: [Placement, Placement][] = [];
  const as = tagged(placements, itemOf, a);
  const bs = tagged(placements, itemOf, b);
  for (const pa of as) {
    for (const pb of bs) {
      if (pa.uid === pb.uid || pa.room !== pb.room) continue;
      const ia = itemOf(pa.uid)!;
      const ib = itemOf(pb.uid)!;
      // Un PC encima de una mesa cuenta desde la casilla de la mesa.
      if (touches(cellsFor(pa, ia), cellsFor(pb, ib))) pairs.push([pa, pb]);
    }
  }
  return pairs;
}

/** Todas las casillas libres de la sala son alcanzables desde la entrada (accesos sin bloquear). */
export function roomAccessible(room: RoomDef, placements: Placement[], itemOf: (uid: string) => CatalogItem | undefined): boolean {
  const grid = walkableGrid(room, placements, itemOf);
  const reach = reachableFrom(grid, entranceOf(room));
  for (let x = 0; x < room.w; x++) for (let y = 0; y < room.h; y++) if (grid[x]?.[y] && !reach.has(`${x},${y}`)) return false;
  return true;
}

/** ¿Hay un sitio de descanso que el gato pueda alcanzar desde la entrada? */
export function catRestAccessible(room: RoomDef, placements: Placement[], itemOf: (uid: string) => CatalogItem | undefined): boolean {
  const grid = walkableGrid(room, placements, itemOf);
  const reach = reachableFrom(grid, entranceOf(room));
  return placedInRoom(placements, room.id).some((p) => {
    const item = itemOf(p.uid);
    if (!item?.tags.includes("rest")) return false;
    const cells = cellsFor(p, item);
    if (item.layer === "rug") return cells.some(([x, y]) => reach.has(`${x},${y}`));
    return cells.some(([x, y]) => NEIGHBORS.some(([dx, dy]) => reach.has(`${x + dx},${y + dy}`)));
  });
}

/** Compara la distribución anterior con la nueva para las misiones de decoración. */
export function saveFacts(
  before: Placement[], after: Placement[], stylesBefore: Record<string, RoomStyle>, stylesAfter: Record<string, RoomStyle>,
  itemOf: (uid: string) => CatalogItem | undefined,
): SaveFacts {
  const prev = new Map(before.map((p) => [p.uid, p]));
  const next = new Map(after.map((p) => [p.uid, p]));
  const newlyPlaced: string[] = [];
  const movedOrPlaced: string[] = [];
  let removed = false;
  for (const p of after) {
    const old = prev.get(p.uid);
    if (!old) {
      newlyPlaced.push(p.uid);
      movedOrPlaced.push(p.uid);
    } else if (old.room !== p.room || old.x !== p.x || old.y !== p.y || old.rot !== p.rot) movedOrPlaced.push(p.uid);
  }
  const removedUids = before.filter((p) => !next.has(p.uid)).map((p) => p.uid);
  if (removedUids.length) removed = true;
  const floorChanged = Object.keys(stylesAfter).some((r) => stylesAfter[r]?.floor !== (stylesBefore[r]?.floor ?? stylesAfter[r]?.floor));
  const styleChanged = Object.keys(stylesAfter).some((r) => JSON.stringify(stylesAfter[r]) !== JSON.stringify(stylesBefore[r]));
  const changedSet = new Set([...movedOrPlaced, ...removedUids]);
  const decorTags: Tag[] = ["decor", "wallart", "plant", "lamp", "rug", "light"];
  const decorChanged = [...changedSet].some((uid) => decorTags.some((t) => itemOf(uid)?.tags.includes(t)));
  const moved = new Set(movedOrPlaced);
  const seatTableChanged = adjacentPairs(after, itemOf, "seat", "table").some(([a, b]) => moved.has(a.uid) || moved.has(b.uid));
  const pcSeatChanged = adjacentPairs(after, itemOf, "pc", "seat").some(([a, b]) => moved.has(a.uid) || moved.has(b.uid));
  return {
    changed: movedOrPlaced.length > 0 || removed || styleChanged,
    newlyPlaced,
    movedOrPlaced,
    decorChanged,
    floorChanged,
    seatTableChanged,
    pcSeatChanged,
  };
}
