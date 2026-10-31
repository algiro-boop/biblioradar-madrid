/**
 * Vida de la biblioteca: estudiantes de distintas carreras que entran, se sientan y estudian de
 * verdad (escriben, subrayan, teclean, pasan páginas, beben agua…), bibliotecaria que atiende y
 * ordena, y gato que pasea, se asea y duerme. Es ambientación ficticia: no toca la ocupación real.
 */

import { findItem, type CatalogItem } from "../data/catalog";
import type { RoomDef } from "../data/levels";
import { cellsOf, entranceOf, findPath, footprint, FRONT, seatFacing, walkableGrid, type Cell } from "../engine/layout";
import { mulberry32 } from "../rng";
import { DISCIPLINES, LIBRARIAN_LOOK, randomLook, type Act, type Discipline, type Look } from "./characters";
import { makeKit, type DeskSpot, type StudyKit } from "./study";

export interface ScenePlacement {
  uid: string;
  itemId: string;
  room: string;
  x: number;
  y: number;
  rot: number;
}

export interface Spot {
  key: string;
  seat: Cell;
  /** Posición exacta (casillas) donde se coloca la persona; en sofás, hacia el borde del cojín. */
  at: [number, number];
  approach: Cell;
  act: Act;
  z: number;
  /** Dirección a la que mira (0: +x … 3: −y). */
  facing: number;
  kind: "seat" | "browse" | "counter" | "rest" | "music";
  onFurniture: boolean;
  /** Profundidad de dibujo del mueble (para pintar a la persona justo delante o detrás). */
  depth: number;
  desk?: DeskSpot;
}

export interface Agent {
  id: number;
  kind: "student" | "librarian" | "cat";
  look: Look;
  discipline?: Discipline;
  kit?: StudyKit;
  x: number;
  y: number;
  z: number;
  path: Cell[];
  state: "enter" | "walk" | "settle" | "stay" | "leave" | "gone" | "wander" | "sleep";
  timer: number;
  spot: Spot | null;
  act: Act;
  actTimer: number;
  /** Reloj propio (velocidad y fase distintas por persona: nada va sincronizado). */
  t: number;
  speed: number;
  gaze: number;
  back: boolean;
  flip: boolean;
  jump: number;
  /** Gato: pose actual. */
  catPose?: "walk" | "sit" | "sleep" | "jump" | "groom" | "stretch";
}

/** Altura (unidades) de la superficie donde se sienta cada asiento. */
export const SEAT_Z: Partial<Record<CatalogItem["kind"], number>> = {
  chair: 10, stool: 10.5, officechair: 11, armchair: 11, throne: 12, bench: 10, sofa: 11, pouf: 9, cushions: 5,
};
export const SURFACE_Z: Partial<Record<CatalogItem["kind"], number>> = {
  table: 14, roundtable: 14, desk: 15, counter: 21, lowshelf: 17.5, coffeetable: 8, cabinet: 18,
};
const DIRS: Cell[] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
/** Índice de DIRS para mirar hacia un mueble cuyo frente da a FRONT[rot]. */
const TOWARD = [3, 2, 1, 0];

function depthOf(item: CatalogItem, p: ScenePlacement): number {
  const { w, h } = item.layer === "small" ? { w: 1, h: 1 } : footprint(item, p.rot);
  return p.x + w / 2 + p.y + h / 2;
}

export function buildSpots(room: RoomDef, placements: ScenePlacement[], grid: boolean[][]): Spot[] {
  const spots: Spot[] = [];
  const itemAt = new Map<string, { p: ScenePlacement; item: CatalogItem }[]>();
  for (const p of placements) {
    const item = findItem(p.itemId);
    if (!item || item.layer === "wall") continue;
    const cells = item.layer === "small" ? [[p.x, p.y] as Cell] : cellsOf(item, p);
    for (const [x, y] of cells) {
      const k = `${x},${y}`;
      itemAt.set(k, [...(itemAt.get(k) ?? []), { p, item }]);
    }
  }
  const at = (c: Cell) => itemAt.get(`${c[0]},${c[1]}`) ?? [];
  const walk = (c: Cell) => !!grid[c[0]]?.[c[1]];
  const approachFor = (cells: Cell[], prefer?: number): Cell | null => {
    const order = prefer === undefined ? DIRS : [DIRS[prefer]!, ...DIRS];
    for (const [cx, cy] of cells) for (const [dx, dy] of order) if (walk([cx + dx, cy + dy])) return [cx + dx, cy + dy];
    return null;
  };
  for (const p of placements) {
    const item = findItem(p.itemId);
    if (!item) continue;
    const cells = cellsOf(item, p);
    const depth = depthOf(item, p);
    if (item.tags.includes("seat")) {
      const facing = seatFacing(item, p.rot);
      const F = DIRS[facing]!;
      const lounge = item.kind === "sofa" || item.kind === "armchair" || item.kind === "throne" || item.kind === "pouf";
      // Sofás: una plaza por casilla de la fila del respaldo; sillones de 2×2: una plaza centrada.
      let seats: Cell[];
      if (item.kind === "sofa") seats = cells.filter(([x, y]) => (F[0] === 1 ? x === p.x : F[0] === -1 ? x === p.x + footprint(item, p.rot).w - 1 : F[1] === 1 ? y === p.y : y === p.y + footprint(item, p.rot).h - 1));
      else seats = [cells[Math.floor(cells.length / 2)]!];
      for (const seat of seats) {
        const approach = approachFor([seat], facing);
        if (!approach) continue;
        // Mesa justo delante del asiento: puesto de estudio con materiales.
        const front: Cell = [seat[0] + F[0], seat[1] + F[1]];
        const onFront = at(front);
        const table = onFront.find((e) => e.item.tags.includes("table") || e.item.kind === "counter" || e.item.kind === "coffeetable");
        let desk: DeskSpot | undefined;
        if (table && !lounge) {
          const pc = onFront.some((e) => e.item.tags.includes("pc"));
          const crowded = onFront.some((e) => e.item.layer === "small" && !e.item.tags.includes("pc"));
          desk = { edge: [seat[0] + 0.5 + F[0] * 0.5, seat[1] + 0.5 + F[1] * 0.5], dir: F, z: SURFACE_Z[table.item.kind] ?? 14, pc, crowded };
        }
        const big = item.kind === "sofa" || item.w > 1;
        const pos: [number, number] = big ? [seat[0] + 0.5 + F[0] * 0.35, seat[1] + 0.5 + F[1] * 0.35] : [seat[0] + 0.5, seat[1] + 0.5];
        if (item.kind === "armchair" && item.w > 1) {
          const { w, h } = footprint(item, p.rot);
          pos[0] = p.x + w / 2 + F[0] * 0.25;
          pos[1] = p.y + h / 2 + F[1] * 0.25;
        }
        spots.push({
          key: `${p.uid}:${seat.join(",")}`, seat, at: pos, approach, z: SEAT_Z[item.kind] ?? 10, facing,
          act: desk ? "write" : lounge ? "lounge" : "sit", kind: "seat", onFurniture: true, depth, desk,
        });
      }
    } else if (item.tags.includes("shelf") || item.kind === "newstand" || item.kind === "vitrine") {
      // Se ojea desde la casilla de delante del frente, mirando hacia el mueble.
      const r = ((p.rot % 4) + 4) % 4;
      const [fx, fy] = FRONT[r]!;
      const front: Cell[] = cells.map(([x, y]) => [x + fx, y + fy] as Cell).filter((c) => walk(c) && !cells.some(([x, y]) => x === c[0] && y === c[1]));
      for (const c of front.slice(0, 2)) spots.push({ key: `${p.uid}:b${c.join(",")}`, seat: c, at: [c[0] + 0.5, c[1] + 0.5], approach: c, z: 0, facing: TOWARD[r]!, act: "browse", kind: "browse", onFurniture: false, depth: c[0] + c[1] + 1 });
    } else if (item.kind === "counter") {
      const r = ((p.rot % 4) + 4) % 4;
      const [fx, fy] = FRONT[r]!;
      const behind: Cell[] = cells.map(([x, y]) => [x - fx, y - fy] as Cell);
      const front: Cell[] = cells.map(([x, y]) => [x + fx, y + fy] as Cell);
      const c = [...behind, ...front].find(walk);
      if (c) spots.push({ key: `${p.uid}:counter`, seat: c, at: [c[0] + 0.5, c[1] + 0.5], approach: c, z: 0, facing: behind.some((b) => b[0] === c[0] && b[1] === c[1]) ? TOWARD[(r + 2) % 4]! : TOWARD[r]!, act: "stand", kind: "counter", onFurniture: false, depth: c[0] + c[1] + 1 });
    } else if (item.tags.includes("record") || item.tags.includes("piano")) {
      const a = approachFor(cells);
      if (a) spots.push({ key: `${p.uid}:music`, seat: a, at: [a[0] + 0.5, a[1] + 0.5], approach: a, z: 0, facing: 3, act: "chat", kind: "music", onFurniture: false, depth: a[0] + a[1] + 1 });
    }
    if (item.tags.includes("rest")) {
      const tile = cells[0]!;
      const onRug = item.layer === "rug";
      const approach = onRug ? (walk(tile) ? tile : null) : approachFor([tile]);
      if (approach) spots.push({ key: `${p.uid}:rest`, seat: tile, at: [tile[0] + 0.5, tile[1] + 0.5], approach, z: onRug ? 0 : SEAT_Z[item.kind] ?? 8, facing: 0, act: "sit", kind: "rest", onFurniture: !onRug, depth: onRug ? tile[0] + tile[1] + 1 : depth });
    }
  }
  return spots;
}

export interface SimOptions {
  students: number;
  librarian: boolean;
  cat: boolean;
  reducedMotion: boolean;
  onCatNap?: () => void;
}

const SPEED = { student: 1.6, librarian: 1.25, cat: 2.2 };

/** Repertorio de actividades con pesos y duraciones (s) según el puesto y el material. */
type Weighted = [Act, number, number, number][];
const AT_LAPTOP: Weighted = [
  ["type", 30, 4, 10], ["lookup", 12, 4, 8], ["read", 9, 4, 9], ["write", 10, 4, 9], ["think", 8, 2, 4],
  ["drink", 5, 3, 3], ["adjust", 3, 1.2, 1.2], ["rest", 4, 2.5, 4.4], ["highlight", 6, 3, 6], ["compare", 5, 4, 7], ["yawn", 2, 1.6, 1.6],
];
const ON_PAPER: Weighted = [
  ["write", 26, 4, 12], ["read", 18, 5, 12], ["highlight", 14, 3, 6], ["turn", 9, 1.2, 1.2], ["compare", 7, 4, 8],
  ["think", 8, 2, 4], ["drink", 6, 3, 3], ["adjust", 3, 1.2, 1.2], ["rest", 4, 2.5, 4.4], ["yawn", 2, 1.6, 1.6],
];
const LOUNGING: Weighted = [["lounge", 40, 6, 14], ["think", 6, 2, 4], ["drink", 5, 3, 3], ["rest", 4, 3, 5], ["yawn", 3, 1.6, 1.6]];

export class Sim {
  agents: Agent[] = [];
  spots: Spot[] = [];
  grid: boolean[][] = [];
  private nextId = 1;
  private rand = mulberry32((Date.now() ^ 0x5bd1) & 0xffff);
  private spawnTimer = 0.6;
  private taken = new Set<string>();
  private disciplineOffset = Math.floor(Math.random() * DISCIPLINES.length);

  constructor(public room: RoomDef, public opts: SimOptions) {}

  setLayout(room: RoomDef, placements: ScenePlacement[], opts: SimOptions) {
    const changedRoom = room.id !== this.room.id;
    const first = this.agents.length === 0;
    this.room = room;
    this.opts = opts;
    const lookup = new Map(placements.map((p) => [p.uid, findItem(p.itemId)]));
    this.grid = walkableGrid(room, placements, (uid) => lookup.get(uid));
    this.spots = buildSpots(room, placements, this.grid);
    const byKey = new Map(this.spots.map((s) => [s.key, s]));
    if (changedRoom) {
      this.agents = [];
      this.taken.clear();
    } else {
      // Quien estaba en un mueble que ya no existe se levanta y se va; si sigue, se actualiza el puesto.
      for (const a of this.agents) {
        if (!a.spot) continue;
        const fresh = byKey.get(a.spot.key);
        if (!fresh) this.release(a, true);
        else a.spot = fresh;
      }
      // Si sobran estudiantes (menos asientos o nivel), los últimos se marchan.
      const students = this.agents.filter((a) => a.kind === "student" && a.state !== "leave" && a.state !== "gone");
      for (const a of students.slice(this.target())) this.release(a, true);
    }
    this.syncFixed();
    if (opts.reducedMotion) this.populateStatic();
    else if (first || changedRoom) this.prefill();
  }

  /** Población proporcional a los asientos: no se satura la sala ni se pierde rendimiento. */
  private target(): number {
    const seats = this.spots.filter((s) => s.kind === "seat").length;
    return Math.min(this.opts.students, Math.ceil(seats * 0.8) + (seats > 0 ? 1 : 0));
  }

  private syncFixed() {
    const want = { librarian: this.opts.librarian, cat: this.opts.cat };
    for (const kind of ["librarian", "cat"] as const) {
      const existing = this.agents.find((a) => a.kind === kind);
      if (want[kind] && !existing) this.spawn(kind);
      if (!want[kind] && existing) this.agents = this.agents.filter((a) => a !== existing);
    }
  }

  private entrance(): Cell {
    return entranceOf(this.room);
  }

  private spawn(kind: Agent["kind"]): Agent {
    const [ex, ey] = this.entrance();
    const discipline = kind === "student" ? DISCIPLINES[(this.disciplineOffset + this.nextId) % DISCIPLINES.length]! : undefined;
    const agent: Agent = {
      id: this.nextId++, kind, look: kind === "librarian" ? LIBRARIAN_LOOK : randomLook(this.rand, discipline),
      discipline, kit: discipline ? makeKit(discipline, this.rand) : undefined,
      x: ex + 0.5, y: ey + 0.5, z: 0, path: [], state: "enter", timer: 0, spot: null, act: "walk", actTimer: 0,
      t: this.rand() * 10, speed: 0.85 + this.rand() * 0.35, gaze: 0, back: false, flip: false, jump: 0,
      catPose: kind === "cat" ? "walk" : undefined,
    };
    if (this.room.door !== null) agent.x = -0.2;
    this.agents.push(agent);
    this.choose(agent);
    return agent;
  }

  /** Al abrir la sala ya hay gente estudiando (no hay que esperar a que entren uno a uno). */
  private prefill() {
    const seats = this.spots.filter((s) => s.kind === "seat" && !this.taken.has(s.key));
    // Primero los puestos con mesa: es una sala de estudio.
    seats.sort((a, b) => (b.desk ? 1 : 0) - (a.desk ? 1 : 0) || this.rand() - 0.5);
    const want = Math.round(this.target() * 0.7);
    let n = this.agents.filter((a) => a.kind === "student").length;
    for (const spot of seats) {
      if (n >= want) break;
      const a = this.spawn("student");
      this.place(a, spot);
      this.nextAct(a);
      n++;
    }
  }

  /** Sin movimiento: estudiantes ya sentados, gato dormido. */
  private populateStatic() {
    const free = this.spots.filter((s) => s.kind === "seat");
    let n = this.agents.filter((a) => a.kind === "student").length;
    for (const spot of free) {
      if (n >= this.target() || this.taken.has(spot.key)) continue;
      const a = this.spawn("student");
      this.place(a, spot);
      n++;
    }
    for (const a of this.agents) {
      if (a.kind === "cat") {
        const rest = this.spots.find((s) => s.kind === "rest" && !this.taken.has(s.key));
        if (rest) this.place(a, rest, "sleep");
      }
      if (a.kind === "librarian") {
        const counter = this.spots.find((s) => s.kind === "counter");
        if (counter) this.place(a, counter);
      }
    }
  }

  private place(a: Agent, spot: Spot, state: Agent["state"] = "stay") {
    if (a.spot) this.taken.delete(a.spot.key);
    a.spot = spot;
    this.taken.add(spot.key);
    a.x = spot.at[0];
    a.y = spot.at[1];
    a.z = spot.z;
    a.path = [];
    a.state = state;
    a.act = spot.act;
    a.timer = 1e9;
    if (a.kind === "cat") a.catPose = state === "sleep" ? "sleep" : "sit";
    this.face(a, DIRS[spot.facing]!);
  }

  private release(a: Agent, leave: boolean) {
    if (a.spot) this.taken.delete(a.spot.key);
    a.spot = null;
    a.z = 0;
    if (leave && a.kind === "student") this.goLeave(a);
    else this.choose(a);
  }

  private pathTo(a: Agent, target: Cell): boolean {
    const from: Cell = [Math.max(0, Math.min(this.room.w - 1, Math.floor(a.x))), Math.max(0, Math.min(this.room.h - 1, Math.floor(a.y)))];
    const path = findPath(this.grid, this.grid[from[0]]?.[from[1]] ? from : this.entrance(), target);
    if (!path) return false;
    a.path = path.slice(1);
    return true;
  }

  private choose(a: Agent) {
    const free = (kinds: Spot["kind"][]) => this.spots.filter((s) => kinds.includes(s.kind) && !this.taken.has(s.key));
    let spot: Spot | undefined;
    if (a.kind === "student") {
      const options = free(["seat", "browse", "music"]);
      const desks = options.filter((s) => s.kind === "seat" && s.desk);
      const seats = options.filter((s) => s.kind === "seat");
      const r = this.rand();
      const pool = r < 0.7 && desks.length ? desks : r < 0.85 && seats.length ? seats : options;
      spot = pool[Math.floor(this.rand() * pool.length)];
    } else if (a.kind === "librarian") {
      const counter = free(["counter"])[0];
      const shelves = free(["browse"]);
      spot = this.rand() < 0.6 && counter ? counter : shelves[Math.floor(this.rand() * shelves.length)] ?? counter;
    } else {
      const rest = free(["rest"]);
      if (rest.length && this.rand() < 0.5) spot = rest[Math.floor(this.rand() * rest.length)];
    }
    if (spot && this.pathTo(a, spot.approach)) {
      a.spot = spot;
      this.taken.add(spot.key);
      a.state = "walk";
      return;
    }
    for (let tries = 0; tries < 12; tries++) {
      const c: Cell = [Math.floor(this.rand() * this.room.w), Math.floor(this.rand() * this.room.h)];
      if (this.grid[c[0]]?.[c[1]] && this.pathTo(a, c)) {
        a.state = "wander";
        return;
      }
    }
    a.state = "wander";
    a.timer = 2;
  }

  private goLeave(a: Agent) {
    if (!this.pathTo(a, this.entrance())) {
      a.state = "gone";
      return;
    }
    a.state = "leave";
  }

  private face(a: Agent, d: Cell) {
    const sdx = d[0] - d[1];
    const sdy = d[0] + d[1];
    a.back = sdy < 0;
    a.flip = sdx < 0;
  }

  /** Siguiente actividad, con pausas y ritmos distintos para cada estudiante. */
  private nextAct(a: Agent) {
    const spot = a.spot;
    if (!spot) return;
    let table: Weighted;
    if (spot.kind !== "seat") {
      a.act = spot.act;
      a.actTimer = 3 + this.rand() * 5;
      if (spot.kind === "browse" && this.rand() < 0.3) a.act = "read";
      return;
    }
    if (!spot.desk) table = LOUNGING;
    else if (spot.desk.pc || a.kit?.laptop || a.kit?.discipline === "ingenieria") table = AT_LAPTOP;
    else table = ON_PAPER;
    const neighbour = this.agents.some((o) => o !== a && o.kind === "student" && o.state === "stay" && Math.hypot(o.x - a.x, o.y - a.y) < 2.2);
    const options: Weighted = neighbour ? [...table, ["chat", 3, 2.4, 3.6]] : table;
    const total = options.reduce((n, o) => n + o[1], 0);
    let r = this.rand() * total;
    let pick = options[0]!;
    for (const o of options) {
      r -= o[1];
      if (r <= 0) {
        pick = o;
        break;
      }
    }
    // Tras pasar página se vuelve a leer; no se repite dos veces seguidas lo breve.
    if (pick[0] === a.act && pick[2] < 2) pick = table[0]!;
    a.act = !spot.desk && pick[0] === "lounge" ? "lounge" : pick[0];
    a.actTimer = pick[2] + this.rand() * (pick[3] - pick[2]);
    a.gaze = a.act === "lookup" || a.act === "compare" ? 0 : this.rand() < 0.2 ? (this.rand() < 0.5 ? -1 : 1) : 0;
  }

  update(dt: number) {
    if (this.opts.reducedMotion) return;
    const students = this.agents.filter((a) => a.kind === "student" && a.state !== "gone" && a.state !== "leave");
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && students.length < this.target()) {
      this.spawn("student");
      this.spawnTimer = 2.5 + this.rand() * 5;
    }
    for (const a of this.agents) this.step(a, dt);
    this.agents = this.agents.filter((a) => a.state !== "gone");
  }

  private step(a: Agent, dt: number) {
    a.t += dt * a.speed;
    if (a.jump > 0) a.jump = Math.max(0, a.jump - dt * 3);
    if (a.path.length) {
      const [tx, ty] = a.path[0]!;
      const gx = tx + 0.5;
      const gy = ty + 0.5;
      const dx = gx - a.x;
      const dy = gy - a.y;
      const dist = Math.hypot(dx, dy);
      const step = SPEED[a.kind] * a.speed * dt;
      a.act = "walk";
      a.z = 0;
      if (a.kind === "cat") a.catPose = "walk";
      if (dist > 0.001) this.face(a, [Math.sign(Math.round(dx * 10)), Math.sign(Math.round(dy * 10))]);
      if (dist <= step) {
        a.x = gx;
        a.y = gy;
        a.path.shift();
      } else {
        a.x += (dx / dist) * step;
        a.y += (dy / dist) * step;
      }
      return;
    }
    switch (a.state) {
      case "walk": {
        const spot = a.spot;
        if (!spot) return this.choose(a);
        if (spot.onFurniture) {
          a.jump = a.kind === "cat" ? 1 : 0.4;
          this.place(a, spot, a.kind === "cat" ? "sleep" : "stay");
        } else {
          a.state = a.kind === "cat" ? "sleep" : "stay";
          a.x = spot.at[0];
          a.y = spot.at[1];
          a.act = spot.act;
          this.face(a, DIRS[spot.facing]!);
          if (a.kind === "cat") a.catPose = "sleep";
        }
        a.timer = a.kind === "student" ? 30 + this.rand() * 50 : a.kind === "librarian" ? (spot.kind === "counter" ? 22 : 7) : 10 + this.rand() * 14;
        // Al sentarse, primero se acomoda la silla.
        if (a.kind === "student" && spot.kind === "seat") {
          a.act = "adjust";
          a.actTimer = 1.2;
        } else this.nextAct(a);
        if (a.kind === "cat") this.opts.onCatNap?.();
        return;
      }
      case "stay": case "sleep": {
        a.timer -= dt;
        if (a.kind === "cat") {
          a.actTimer -= dt;
          if (a.state === "sleep") a.catPose = "sleep";
          else if (a.actTimer <= 0) {
            a.catPose = a.catPose === "groom" ? "sit" : this.rand() < 0.4 ? "groom" : "sit";
            a.actTimer = 2 + this.rand() * 3;
          }
        } else {
          a.actTimer -= dt;
          if (a.actTimer <= 0) this.nextAct(a);
          if (a.act === "lookup" || a.act === "compare") a.gaze = Math.floor(a.t / 1.6) % 2 === 0 ? -1 : 1;
        }
        if (a.timer <= 0) {
          if (a.kind === "cat" && a.state === "sleep") {
            // Al despertar se estira antes de seguir paseando.
            a.state = "stay";
            a.catPose = "stretch";
            a.actTimer = 1.6;
            a.timer = 1.6;
            const s = a.spot;
            if (s) this.taken.delete(s.key);
            a.spot = null;
            return;
          }
          if (a.kind === "student") this.release(a, true);
          else this.release(a, false);
        }
        return;
      }
      case "leave":
        a.state = "gone";
        if (a.spot) this.taken.delete(a.spot.key);
        return;
      case "wander": case "enter":
        a.timer -= dt;
        a.act = "stand";
        if (a.kind === "cat") a.catPose = "sit";
        if (a.timer <= 0) {
          a.timer = 1 + this.rand() * 2;
          if (a.kind === "student" && this.rand() < 0.3) this.goLeave(a);
          else this.choose(a);
        }
        return;
      default:
        return;
    }
  }
}
