/**
 * Vida de la biblioteca: estudiantes que entran, buscan asiento, estudian y se van; bibliotecario
 * que atiende y ordena; gato que pasea y duerme. Es decorativo: no toca la ocupación real.
 */

import { findItem, type CatalogItem } from "../data/catalog";
import type { RoomDef } from "../data/levels";
import { cellsOf, entranceOf, findPath, walkableGrid, type Cell } from "../engine/layout";
import { mulberry32 } from "../rng";
import { LIBRARIAN_LOOK, randomLook, type Look, type Pose } from "./characters";

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
  approach: Cell;
  pose: Pose;
  z: number;
  /** Dirección a la que mira sentado (0: +x … 3: −y). */
  facing: number;
  kind: "seat" | "browse" | "counter" | "rest" | "music";
  onFurniture: boolean;
}

export interface Agent {
  id: number;
  kind: "student" | "librarian" | "cat";
  look: Look;
  x: number;
  y: number;
  z: number;
  path: Cell[];
  state: "enter" | "walk" | "settle" | "stay" | "leave" | "gone" | "wander" | "sleep";
  timer: number;
  spot: Spot | null;
  pose: Pose;
  back: boolean;
  flip: boolean;
  frame: number;
  frameTimer: number;
  gesture: number;
  jump: number;
}

const SEAT_Z: Partial<Record<CatalogItem["kind"], number>> = {
  chair: 8, stool: 10, officechair: 8, armchair: 7, throne: 8, bench: 8, sofa: 7, pouf: 9,
};
const DIRS: Cell[] = [[1, 0], [0, 1], [-1, 0], [0, -1]];

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
  const near = (c: Cell, test: (i: CatalogItem) => boolean) =>
    DIRS.some(([dx, dy]) => itemAt.get(`${c[0] + dx},${c[1] + dy}`)?.some((e) => test(e.item)));
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
    if (item.tags.includes("seat")) {
      // Sofás: una plaza por casilla de la fila delantera; resto: una plaza.
      const seats = item.kind === "sofa" ? cells.filter((_, i) => i % 2 === 0) : [cells[Math.floor(cells.length / 2)]!];
      for (const seat of seats) {
        const approach = approachFor([seat], p.rot);
        if (!approach) continue;
        const pc = near(seat, (i) => i.tags.includes("pc"));
        const table = near(seat, (i) => i.tags.includes("table"));
        const lounge = item.kind === "sofa" || item.kind === "armchair" || item.kind === "throne" || item.kind === "pouf";
        spots.push({
          key: `${p.uid}:${seat.join(",")}`, seat, approach, z: SEAT_Z[item.kind] ?? 8, facing: p.rot % 4,
          pose: pc ? "type" : lounge ? "read" : table ? (seat[0] + seat[1]) % 2 ? "write" : "read" : "sit",
          kind: "seat", onFurniture: true,
        });
      }
    } else if (item.tags.includes("shelf") || item.kind === "newstand" || item.kind === "vitrine") {
      const front: Cell[] = cells.map(([x, y]) => (p.rot % 2 === 0 ? [x, y + 1] : [x + 1, y]) as Cell).filter(walk);
      for (const c of front.slice(0, 2)) spots.push({ key: `${p.uid}:b${c.join(",")}`, seat: c, approach: c, z: 0, facing: p.rot % 2 === 0 ? 3 : 2, pose: "browse", kind: "browse", onFurniture: false });
    } else if (item.kind === "counter") {
      const behind: Cell[] = cells.map(([x, y]) => (p.rot % 2 === 0 ? [x, y - 1] : [x - 1, y]) as Cell);
      const front: Cell[] = cells.map(([x, y]) => (p.rot % 2 === 0 ? [x, y + 1] : [x + 1, y]) as Cell);
      const c = [...behind, ...front].find(walk);
      if (c) spots.push({ key: `${p.uid}:counter`, seat: c, approach: c, z: 0, facing: behind.some((b) => b[0] === c[0] && b[1] === c[1]) ? (p.rot % 2 === 0 ? 1 : 0) : 3, pose: "write", kind: "counter", onFurniture: false });
    } else if (item.tags.includes("record") || item.tags.includes("piano")) {
      const a = approachFor(cells);
      if (a) spots.push({ key: `${p.uid}:music`, seat: a, approach: a, z: 0, facing: 3, pose: "chat", kind: "music", onFurniture: false });
    }
    if (item.tags.includes("rest")) {
      const tile = cells[0]!;
      const onRug = item.layer === "rug";
      const approach = onRug ? (walk(tile) ? tile : null) : approachFor([tile]);
      if (approach) spots.push({ key: `${p.uid}:rest`, seat: tile, approach, z: onRug ? 0 : SEAT_Z[item.kind] ?? 8, facing: 0, pose: "sit", kind: "rest", onFurniture: !onRug });
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

const SPEED = { student: 1.7, librarian: 1.3, cat: 2.3 };

export class Sim {
  agents: Agent[] = [];
  spots: Spot[] = [];
  grid: boolean[][] = [];
  private nextId = 1;
  private rand = mulberry32(Date.now() & 0xffff);
  private spawnTimer = 0.6;
  private taken = new Set<string>();

  constructor(public room: RoomDef, public opts: SimOptions) {}

  setLayout(room: RoomDef, placements: ScenePlacement[], opts: SimOptions) {
    const changedRoom = room.id !== this.room.id;
    this.room = room;
    this.opts = opts;
    const lookup = new Map(placements.map((p) => [p.uid, findItem(p.itemId)]));
    this.grid = walkableGrid(room, placements, (uid) => lookup.get(uid));
    this.spots = buildSpots(room, placements, this.grid);
    const keys = new Set(this.spots.map((s) => s.key));
    if (changedRoom) {
      this.agents = [];
      this.taken.clear();
    } else {
      // Quien estaba en un mueble que ya no existe se levanta y se va.
      for (const a of this.agents) if (a.spot && !keys.has(a.spot.key)) this.release(a, true);
    }
    this.syncFixed();
    if (opts.reducedMotion) this.populateStatic();
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
    const agent: Agent = {
      id: this.nextId++, kind, look: kind === "librarian" ? LIBRARIAN_LOOK : randomLook(this.rand),
      x: ex + 0.5, y: ey + 0.5, z: 0, path: [], state: "enter", timer: 0, spot: null, pose: "walk",
      back: false, flip: false, frame: 0, frameTimer: 0, gesture: 0, jump: 0,
    };
    if (this.room.door !== null) agent.x = -0.2;
    this.agents.push(agent);
    this.choose(agent);
    return agent;
  }

  /** Sin movimiento: estudiantes ya sentados, gato dormido. */
  private populateStatic() {
    const free = this.spots.filter((s) => s.kind === "seat");
    let n = this.agents.filter((a) => a.kind === "student").length;
    for (const spot of free) {
      if (n >= this.opts.students || this.taken.has(spot.key)) continue;
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
    a.x = spot.seat[0] + 0.5;
    a.y = spot.seat[1] + 0.5;
    a.z = spot.z;
    a.path = [];
    a.state = state;
    a.pose = state === "sleep" ? "sit" : spot.pose;
    a.timer = 1e9;
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
      const seats = options.filter((s) => s.kind === "seat");
      const pool = this.rand() < 0.75 && seats.length ? seats : options;
      spot = pool[Math.floor(this.rand() * pool.length)];
    } else if (a.kind === "librarian") {
      const counter = free(["counter"])[0];
      const shelves = free(["browse"]);
      spot = this.rand() < 0.65 && counter ? counter : shelves[Math.floor(this.rand() * shelves.length)] ?? counter;
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
    // Paseo sin destino: una casilla libre al azar.
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

  update(dt: number) {
    if (this.opts.reducedMotion) return;
    const students = this.agents.filter((a) => a.kind === "student" && a.state !== "gone");
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && students.length < this.opts.students) {
      this.spawn("student");
      this.spawnTimer = 3 + this.rand() * 5;
    }
    for (const a of this.agents) this.step(a, dt);
    this.agents = this.agents.filter((a) => a.state !== "gone");
  }

  private step(a: Agent, dt: number) {
    a.frameTimer += dt;
    const frameLen = a.state === "stay" || a.state === "sleep" ? 0.6 : 0.18;
    if (a.frameTimer > frameLen) {
      a.frameTimer = 0;
      a.frame = (a.frame + 1) % 4;
    }
    if (a.jump > 0) a.jump = Math.max(0, a.jump - dt * 3);
    if (a.path.length) {
      const [tx, ty] = a.path[0]!;
      const gx = tx + 0.5;
      const gy = ty + 0.5;
      const dx = gx - a.x;
      const dy = gy - a.y;
      const dist = Math.hypot(dx, dy);
      const step = SPEED[a.kind] * dt;
      a.pose = "walk";
      a.z = 0;
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
          a.jump = a.kind === "cat" ? 1 : 0;
          this.place(a, spot, a.kind === "cat" ? "sleep" : "stay");
        } else {
          a.state = a.kind === "cat" ? "sleep" : "stay";
          a.pose = spot.pose;
          this.face(a, DIRS[spot.facing]!);
        }
        a.timer = a.kind === "student" ? 18 + this.rand() * 30 : a.kind === "librarian" ? (spot.kind === "counter" ? 20 : 6) : 9 + this.rand() * 12;
        if (a.kind === "cat") this.opts.onCatNap?.();
        return;
      }
      case "stay": case "sleep": {
        a.timer -= dt;
        a.gesture -= dt;
        if (a.kind === "cat") a.pose = "sit";
        else if (a.gesture <= 0 && a.spot) {
          // Gestos ocasionales: bostezar o charlar en voz baja con alguien cerca.
          const r = this.rand();
          const neighbour = this.agents.some((o) => o !== a && o.kind === "student" && o.state === "stay" && Math.hypot(o.x - a.x, o.y - a.y) < 2.2);
          a.pose = r < 0.15 ? "yawn" : r < 0.35 && neighbour ? "chat" : a.spot.pose;
          a.gesture = a.pose === a.spot.pose ? 4 + this.rand() * 6 : 2.4;
        }
        if (a.timer <= 0) {
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
        a.pose = "stand";
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
