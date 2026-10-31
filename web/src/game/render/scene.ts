/**
 * Escena isométrica en canvas: se pinta a resolución nativa (pixel art) y se escala con vecino
 * más próximo. Solo corre con la pestaña visible; se pausa en segundo plano y respeta
 * `prefers-reduced-motion` (sin desplazamientos ni partículas).
 */

import { findItem, type CatalogItem } from "../data/catalog";
import { STYLES, type RoomDef } from "../data/levels";
import { cellsOf, footprint, reservedCells, wallSlotsOf } from "../engine/layout";
import type { RoomStyle } from "../engine/types";
import { drawCat, drawPerson } from "./characters";
import { paintItem, paintWallItem } from "./furniture";
import { alpha, ellipse, line, mix, Painter, poly, project, rect, shade, TH, TW, unproject, WALL_H, WallPainter, type Ctx2D, type Iso, type Pt } from "./pixel";
import { Sim, type ScenePlacement } from "./sim";

export interface SceneInput {
  room: RoomDef;
  placements: ScenePlacement[];
  style: RoomStyle;
  level: number;
  trophies: number;
  students: number;
  librarian: boolean;
  cat: boolean;
  now: number;
}

export interface Ghost {
  itemId: string;
  x: number;
  y: number;
  rot: number;
  valid: boolean;
}

export interface Overlay {
  editing: boolean;
  selected: string | null;
  ghost: Ghost | null;
}

export type Cinematic = "build" | "cozy" | "cat" | "opening" | "expansion" | "floor" | "final";

export type TileHit = { kind: "floor"; x: number; y: number } | { kind: "wall"; wall: "R" | "L"; u: number } | null;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  kind: "confetti" | "z" | "spark" | "heart" | "drop" | "leaf" | "firefly";
}

interface Hit {
  id: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  depth: number;
}

const SURFACE_Z: Partial<Record<CatalogItem["kind"], number>> = {
  table: 14, roundtable: 14, desk: 15, counter: 21, lowshelf: 16, coffeetable: 8, cabinet: 18,
};
const MARGIN_X = 10;
const TOP = WALL_H + 30;

interface Sprite {
  canvas: HTMLCanvasElement;
  ox: number;
  oy: number;
  bbox: [number, number, number, number];
}

const spriteCache = new Map<string, Sprite>();

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

function tightBox(canvas: HTMLCanvasElement): [number, number, number, number] {
  const ctx = canvas.getContext("2d")!;
  const { width: w, height: h } = canvas;
  const data = ctx.getImageData(0, 0, w, h).data;
  let x0 = w;
  let y0 = h;
  let x1 = 0;
  let y1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3]! > 10) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return x1 >= x0 ? [x0, y0, x1 + 1, y1 + 1] : [0, 0, w, h];
}

/** Sprite cacheado de un mueble de suelo (o pequeño) para una orientación. */
export function furnitureSprite(itemId: string, rot: number, trophies = 0): Sprite {
  const item = findItem(itemId)!;
  const key = `${itemId}|${rot}|${item.tags.includes("showcase") ? trophies : 0}`;
  const hit = spriteCache.get(key);
  if (hit) return hit;
  const { w: fw, h: fh } = item.layer === "small" ? { w: 1, h: 1 } : footprint(item, rot);
  const ox = fh * (TW / 2) + 2;
  const oy = 70;
  const canvas = makeCanvas((fw + fh) * (TW / 2) + 4, oy + (fw + fh) * (TH / 2) + 4);
  const ctx = canvas.getContext("2d")!;
  paintItem(new Painter(ctx, { ox, oy }), item, { fw, fh, facing: rot % 4, trophies });
  const sprite = { canvas, ox, oy, bbox: tightBox(canvas) };
  spriteCache.set(key, sprite);
  return sprite;
}

/** Miniatura para tarjetas de tienda e inventario (data URL cacheada). */
const thumbCache = new Map<string, string>();
export function itemThumbnail(itemId: string): string {
  const hit = thumbCache.get(itemId);
  if (hit) return hit;
  const item = findItem(itemId);
  if (!item || typeof document === "undefined") return "";
  let canvas: HTMLCanvasElement;
  if (item.layer === "wall") {
    const len = item.w;
    canvas = makeCanvas(len * (TW / 2) + 20, 70);
    const ctx = canvas.getContext("2d")!;
    const o: Iso = { ox: 4, oy: 62 };
    const W = new WallPainter(ctx, o, "R", 0);
    W.rect(-0.1, 8, len + 0.1, 58, "#eadcc0");
    paintWallItem(W, item, 0, len);
  } else {
    const s = furnitureSprite(itemId, 0);
    const [x0, y0, x1, y1] = s.bbox;
    canvas = makeCanvas(x1 - x0 + 2, y1 - y0 + 2);
    canvas.getContext("2d")!.drawImage(s.canvas, x0, y0, x1 - x0, y1 - y0, 1, 1, x1 - x0, y1 - y0);
  }
  const url = canvas.toDataURL();
  thumbCache.set(itemId, url);
  return url;
}

function styleColors(id: string): string[] {
  return STYLES.find((s) => s.id === id)?.colors ?? ["#c99a63", "#b98a55"];
}

const hourFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "numeric", minute: "numeric", hourCycle: "h23" });

/** Luz del día en Madrid: cielo de las ventanas y penumbra de la sala. */
function daylight(now: number): { sky: string; night: number; sun: boolean } {
  const [h = 12, m = 0] = hourFormatter.format(now).split(":").map(Number);
  const t = h + m / 60;
  if (t >= 9 && t < 18) return { sky: "#9fd3f0", night: 0, sun: true };
  if (t >= 7 && t < 9) return { sky: mix("#f6c98b", "#9fd3f0", (t - 7) / 2), night: 0.15 * (1 - (t - 7) / 2), sun: true };
  if (t >= 18 && t < 20.5) return { sky: mix("#9fd3f0", "#f0905f", Math.min(1, (t - 18) / 1.5)), night: 0.12 * ((t - 18) / 2.5), sun: t < 19.5 };
  return { sky: "#1f2747", night: 0.32, sun: false };
}

const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const easeBack = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  const c = 1.7;
  return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);
};

export interface SceneCallbacks {
  onCatNap?: () => void;
}

export class Scene {
  private ctx: CanvasRenderingContext2D;
  private buffer: HTMLCanvasElement;
  private bctx: CanvasRenderingContext2D;
  private staticLayer: HTMLCanvasElement | null = null;
  private staticKey = "";
  private input: SceneInput | null = null;
  private overlay: Overlay = { editing: false, selected: null, ghost: null };
  private sim: Sim | null = null;
  private particles: Particle[] = [];
  private cinematic: { kind: Cinematic; start: number } | null = null;
  private hits: Hit[] = [];
  private raf = 0;
  private last = 0;
  private time = 0;
  private running = false;
  private iso: Iso = { ox: 0, oy: TOP };
  private scale = 2;
  private offX = 0;
  private offY = 0;
  private zzzTimer = 0;
  zoom = 1;
  panX = 0;
  panY = 0;
  reducedMotion: boolean;

  constructor(private canvas: HTMLCanvasElement, private callbacks: SceneCallbacks = {}) {
    this.ctx = canvas.getContext("2d")!;
    this.buffer = makeCanvas(10, 10);
    this.bctx = this.buffer.getContext("2d")!;
    this.reducedMotion = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  private onVisibility = () => {
    if (document.hidden) this.pause();
    else this.start();
  };

  setInput(input: SceneInput) {
    const prevRoom = this.input?.room.id;
    this.input = input;
    const bw = (input.room.w + input.room.h) * (TW / 2) + MARGIN_X * 2;
    const bh = (input.room.w + input.room.h) * (TH / 2) + TOP + 14;
    if (this.buffer.width !== bw || this.buffer.height !== bh) {
      this.buffer.width = bw;
      this.buffer.height = bh;
    }
    this.iso = { ox: input.room.h * (TW / 2) + MARGIN_X, oy: TOP };
    const simOpts = {
      students: input.students, librarian: input.librarian, cat: input.cat, reducedMotion: this.reducedMotion,
      onCatNap: () => this.callbacks.onCatNap?.(),
    };
    if (!this.sim) this.sim = new Sim(input.room, simOpts);
    this.sim.setLayout(input.room, input.placements, simOpts);
    if (prevRoom && prevRoom !== input.room.id) this.particles = [];
    this.draw();
  }

  setOverlay(overlay: Overlay) {
    this.overlay = overlay;
    if (!this.running) this.draw();
  }

  play(kind: Cinematic) {
    if (this.reducedMotion) return;
    this.cinematic = { kind, start: this.time };
    const bw = this.buffer.width;
    if (kind === "opening" || kind === "final") this.confetti(bw / 2, 20, 110, kind === "final");
    if (kind === "cozy") for (let i = 0; i < 40; i++) this.spark(Math.random() * bw, TOP + Math.random() * 80, "#ffd88a");
    if (kind === "cat" && this.input) {
      const [x, y] = project(this.iso, 0.5, (this.input.room.door ?? 2) + 0.5, 12);
      for (let i = 0; i < 6; i++) this.particles.push({ x: x + i * 3, y, vx: (Math.random() - 0.5) * 8, vy: -14 - Math.random() * 10, life: 2, max: 2, color: "#e05a7a", kind: "heart" });
    }
  }

  private confetti(x: number, y: number, n: number, gold = false) {
    const colors = gold ? ["#e0b04a", "#f3e2bf", "#ffd88a", "#ffffff"] : ["#10b981", "#fbbf24", "#38bdf8", "#f472b6", "#a78bfa", "#ffffff"];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI;
      const s = 30 + Math.random() * 70;
      this.particles.push({ x, y, vx: Math.cos(a) * s * (Math.random() < 0.5 ? -1 : 1), vy: -Math.sin(a) * s * 0.6, life: 3, max: 3, color: colors[i % colors.length]!, kind: "confetti" });
    }
  }

  private spark(x: number, y: number, color: string) {
    this.particles.push({ x, y, vx: 0, vy: -4 - Math.random() * 6, life: 1.2 + Math.random(), max: 2.2, color, kind: "spark" });
  }

  start() {
    if (this.running || document.hidden) return;
    this.running = true;
    this.last = performance.now();
    const loop = (t: number) => {
      if (!this.running) return;
      const dt = Math.min(0.1, (t - this.last) / 1000);
      // Pixel art a ~30 fps: suficiente y ahorra batería.
      if (dt >= 1 / 32) {
        this.last = t;
        this.update(dt);
        this.draw();
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  pause() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  destroy() {
    this.pause();
    document.removeEventListener("visibilitychange", this.onVisibility);
  }

  private update(dt: number) {
    this.time += dt;
    this.sim?.update(dt);
    if (this.reducedMotion) {
      this.particles = [];
      return;
    }
    // Zzz del gato dormido.
    this.zzzTimer -= dt;
    if (this.zzzTimer <= 0) {
      this.zzzTimer = 1.4;
      const cat = this.sim?.agents.find((a) => a.kind === "cat" && a.state === "sleep");
      if (cat) {
        const [x, y] = project(this.iso, cat.x, cat.y, cat.z + 10);
        this.particles.push({ x: x + 3, y, vx: 4, vy: -7, life: 2.2, max: 2.2, color: "#ffffff", kind: "z" });
      }
    }
    // Ambiente: luciérnagas, lluvia y hojas de los objetos animados.
    if (this.input) for (const p of this.input.placements) {
      const item = findItem(p.itemId);
      if (!item?.fx || Math.random() > dt * 2.2) continue;
      const { w: fw, h: fh } = item.layer === "small" ? { w: 1, h: 1 } : footprint(item, p.rot);
      const [x, y] = project(this.iso, p.x + fw / 2, p.y + fh / 2, 20);
      if (item.fx === "flicker") this.particles.push({ x: x + (Math.random() - 0.5) * 16, y: y + (Math.random() - 0.5) * 10, vx: (Math.random() - 0.5) * 6, vy: -3, life: 1.6, max: 1.6, color: "#d8ff8a", kind: "firefly" });
      if (item.fx === "leaves") this.particles.push({ x: x + (Math.random() - 0.5) * 10, y: y - 6, vx: (Math.random() - 0.5) * 4, vy: 7, life: 1.8, max: 1.8, color: item.colors[0]!, kind: "leaf" });
      if (item.fx === "glow" || item.fx === "stars") this.spark(x + (Math.random() - 0.5) * 18, y + (Math.random() - 0.5) * 8, item.fx === "stars" ? "#fff6d8" : item.colors[1] ?? "#ffffff");
      if (item.fx === "water") this.particles.push({ x: x + (Math.random() - 0.5) * 4, y: y - 4, vx: (Math.random() - 0.5) * 16, vy: -14, life: 0.9, max: 0.9, color: "#bfe3f2", kind: "drop" });
    }
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === "confetti" || p.kind === "drop") p.vy += (p.kind === "drop" ? 40 : 45) * dt;
      if (p.kind === "confetti") p.vx *= 0.98;
    }
    this.particles = this.particles.filter((p) => p.life > 0).slice(-260);
    if (this.cinematic && this.time - this.cinematic.start > 4) this.cinematic = null;
  }

  // ------------------------------------------------------------------ dibujo

  private renderStatic(ctx: Ctx2D, anim: { tile?: (x: number, y: number) => number; wall?: number } = {}) {
    const input = this.input!;
    const { room, style, level } = input;
    const o = this.iso;
    const floor = styleColors(style.floor);
    const wallC = styleColors(style.wall);
    const winC = styleColors(style.window);
    const light = daylight(input.now);
    if (level === 0 && !anim.tile) return this.renderLot(ctx);
    const [fa = "#c99a63", fb = "#b98a55"] = floor;
    // Losa del suelo con canto frontal (aspecto de diorama).
    const slab = 7;
    const L0 = project(o, 0, room.h);
    const R0 = project(o, room.w, room.h);
    const R1 = project(o, room.w, 0);
    if (!anim.tile) {
      poly(ctx, [L0, R0, [R0[0], R0[1] + slab], [L0[0], L0[1] + slab]], shade(fb, -0.35));
      poly(ctx, [R0, R1, [R1[0], R1[1] + slab], [R0[0], R0[1] + slab]], shade(fb, -0.5));
    }
    for (let x = 0; x < room.w; x++) for (let y = 0; y < room.h; y++) {
      const k = anim.tile ? anim.tile(x, y) : 1;
      if (k <= 0) continue;
      const dy = (1 - k) * -16;
      const pts = [project(o, x, y), project(o, x + 1, y), project(o, x + 1, y + 1), project(o, x, y + 1)].map(([a, b]) => [a, b + dy] as Pt);
      const odd = (x + y) % 2 === 1;
      let base = style.floor === "floor-ajedrez" ? (odd ? fb : fa) : odd ? fa : mix(fa, fb, 0.35);
      if (style.floor === "floor-moqueta") base = fa;
      poly(ctx, pts, base);
      const P = new Painter(ctx, { ox: o.ox, oy: o.oy + dy });
      if (style.floor === "floor-roble" || style.floor === "floor-terracota") {
        const grout = shade(fb, -0.18);
        if (style.floor === "floor-roble") {
          P.line([x, y + 0.5, 0], [x + 1, y + 0.5, 0], grout);
          if ((x * 3 + y) % 4 === 0) P.line([x + 0.5, y, 0], [x + 0.5, y + 0.5, 0], grout);
        } else {
          P.line([x, y, 0], [x + 1, y, 0], grout);
          P.line([x, y, 0], [x, y + 1, 0], grout);
        }
      } else if (style.floor === "floor-espiga") {
        const c = shade(fb, -0.25);
        P.line([x, y + 0.25, 0], [x + 0.5, y, 0], c);
        P.line([x + 0.5, y + 1, 0], [x + 1, y + 0.5, 0], c);
        P.line([x, y + 0.75, 0], [x + 0.75, y, 0], shade(fa, 0.08));
      } else if (style.floor === "floor-moqueta") {
        for (let i = 0; i < 3; i++) P.dot(x + ((i * 0.37 + x * 0.13) % 0.9) + 0.05, y + ((i * 0.53 + y * 0.29) % 0.9) + 0.05, 0, fb);
      }
    }
    // Paredes
    const H = WALL_H * (anim.wall ?? 1);
    if (H > 1) {
      const [wa = "#efe2c8", wb = "#d9c7a5"] = wallC;
      const leftWall = shade(wa, -0.1);
      poly(ctx, [project(o, 0, 0, 0), project(o, room.w, 0, 0), project(o, room.w, 0, H), project(o, 0, 0, H)], wa);
      poly(ctx, [project(o, 0, 0, 0), project(o, 0, room.h, 0), project(o, 0, room.h, H), project(o, 0, 0, H)], leftWall);
      const R = new WallPainter(ctx, o, "R", 0);
      const Lw = new WallPainter(ctx, o, "L", 0);
      if (style.wall === "wall-ladrillo") {
        for (let v = 4; v < H; v += 6) {
          R.line(0, v, room.w, v, shade(wa, -0.18));
          Lw.line(0, v, room.h, v, shade(leftWall, -0.18));
          for (let u = ((v / 6) % 2) * 0.25; u < Math.max(room.w, room.h); u += 0.5) {
            if (u < room.w) R.line(u, v, u, Math.min(H, v + 6), shade(wa, -0.18));
            if (u < room.h) Lw.line(u, v, u, Math.min(H, v + 6), shade(leftWall, -0.18));
          }
        }
      } else {
        for (let u = 0.5; u < room.w; u += 0.5) R.line(u, 6, u, H - 4, alpha(wb, 0.35));
        for (let u = 0.5; u < room.h; u += 0.5) Lw.line(u, 6, u, H - 4, alpha(shade(wb, -0.1), 0.35));
      }
      // Zócalo y remate superior
      R.rect(0, 0, room.w, 4, shade(wb, -0.25));
      Lw.rect(0, 0, room.h, 4, shade(wb, -0.32));
      poly(ctx, [project(o, 0, 0, H), project(o, room.w, 0, H), project(o, room.w, -0.15, H), project(o, -0.15, -0.15, H), project(o, -0.15, room.h, H), project(o, 0, room.h, H)], shade(wb, -0.15));
      line(ctx, ...project(o, 0, 0, 0), ...project(o, 0, 0, H), shade(wa, -0.3));
      if (anim.wall === undefined || anim.wall >= 1) {
        // Ventanas con el cielo de la hora de Madrid
        for (const win of room.windows) {
          const a = win.at + 0.12;
          const b = win.at + win.w - 0.12;
          const [frame = "#8d5e33", tint = "#bfe3f2"] = winC;
          R.rect(a - 0.06, 16, b + 0.06, 50, frame);
          R.rect(a + 0.04, 19, b - 0.04, 47, mix(light.sky, tint, 0.25));
          if (!light.sun) for (let i = 0; i < 5; i++) R.dot(a + 0.15 + ((i * 0.37) % (b - a - 0.3)), 25 + ((i * 7) % 18), "#f3e2bf");
          else R.rect(a + 0.15, 40, a + 0.45, 42, alpha("#ffffff", 0.7));
          if (style.window === "window-arco") R.rect(a + 0.04, 44, b - 0.04, 47, frame);
          if (style.window === "window-vidriera") for (let i = 0; i < win.w * 4; i++) R.rect(a + 0.05 + i * 0.22, 21, a + 0.2 + i * 0.22, 26, ["#e7b85c", "#b84a44", "#4c78b5", "#5f8f5a"][i % 4]!);
          R.line((a + b) / 2, 19, (a + b) / 2, 47, frame);
          R.line(a, 33, b, 33, frame);
          R.rect(a - 0.1, 14, b + 0.1, 16, shade(frame, 0.2));
        }
        // Puerta
        if (room.door !== null) {
          Lw.rect(room.door + 0.08, 0, room.door + 0.92, 40, shade(wb, -0.45));
          Lw.rect(room.door + 0.16, 0, room.door + 0.84, 37, "#4a3426");
          Lw.rect(room.door + 0.2, 0, room.door + 0.8, 34, "#2a1f1a");
          Lw.dot(room.door + 0.7, 18, "#e0b04a");
        }
      }
    }
    // Escalera de la planta alta (hueco con peldaños)
    if (room.stairs) {
      const s = room.stairs;
      const P = new Painter(ctx, o);
      P.quad([[s.x, s.y, 0], [s.x + s.w, s.y, 0], [s.x + s.w, s.y + s.h, 0], [s.x, s.y + s.h, 0]], "#2a1f1a");
      for (let i = 0; i < 6; i++) P.box(s.x + 0.1, s.y + 0.1 + i * 0.3, -i * 4 - 4, s.w - 0.2, 0.3, 4, "#9b7046", false);
      P.box(s.x, s.y - 0.08, 0, s.w, 0.08, 14, "#7a4f31");
      P.box(s.x + s.w, s.y, 0, 0.08, s.h, 14, "#7a4f31");
    }
    if (anim.tile) return;
    // Luz de las ventanas en el suelo (nivel 2+: ambiente cálido)
    if (level >= 2 && light.sun) {
      for (const win of room.windows) {
        const P = new Painter(ctx, o);
        P.quad([[win.at + 0.1, 0.05, 0], [win.at + win.w - 0.1, 0.05, 0], [win.at + win.w - 0.6, 3.2, 0], [win.at - 0.4, 3.2, 0]], "rgba(255,236,180,0.16)");
      }
    }
    // Objetos de pared y alfombras
    for (const p of input.placements) {
      const item = findItem(p.itemId);
      if (!item) continue;
      if (item.layer === "wall") paintWallItem(new WallPainter(ctx, o, p.rot % 2 === 1 ? "L" : "R"), item, p.x, item.w);
      if (item.layer === "rug") {
        const { w: fw, h: fh } = footprint(item, p.rot);
        paintItem(new Painter(ctx, { ox: project(o, p.x, p.y)[0], oy: project(o, p.x, p.y)[1] }), item, { fw, fh, facing: p.rot });
      }
    }
  }

  /** Nivel 0: solar vacío con césped, valla y cartel de «próximamente». */
  private renderLot(ctx: Ctx2D) {
    const { room } = this.input!;
    const o = this.iso;
    const P = new Painter(ctx, o);
    const L0 = project(o, 0, room.h);
    const R0 = project(o, room.w, room.h);
    const R1 = project(o, room.w, 0);
    poly(ctx, [L0, R0, [R0[0], R0[1] + 7], [L0[0], L0[1] + 7]], "#6b4a2e");
    poly(ctx, [R0, R1, [R1[0], R1[1] + 7], [R0[0], R0[1] + 7]], "#56391f");
    for (let x = 0; x < room.w; x++) for (let y = 0; y < room.h; y++) {
      P.quad([[x, y, 0], [x + 1, y, 0], [x + 1, y + 1, 0], [x, y + 1, 0]], (x * 7 + y * 3) % 5 === 0 ? "#7fae5a" : (x + y) % 2 ? "#86b862" : "#8cbf67");
      if ((x * 13 + y * 7) % 6 === 0) P.vline(x + 0.4, y + 0.5, 0, 2, "#5f8f45");
      if ((x * 5 + y * 11) % 17 === 0) P.dot(x + 0.6, y + 0.3, 1, "#f3e2bf");
    }
    // Valla al fondo y estacas de obra.
    for (let u = 0; u <= room.w; u += 0.5) P.box(u - 0.04, -0.04, 0, 0.08, 0.08, 14, "#c9a26b", false);
    for (let u = 0; u <= room.h; u += 0.5) P.box(-0.04, u - 0.04, 0, 0.08, 0.08, 14, "#b8915c", false);
    P.box(0, -0.03, 9, room.w, 0.06, 2, "#d9b47c", false);
    P.box(-0.03, 0, 9, 0.06, room.h, 2, "#c9a26b", false);
    P.box(3.4, 3.5, 0, 0.12, 0.12, 22, "#7a4f31");
    P.box(3.1, 3.45, 16, 0.75, 0.08, 10, "#f3e2bf");
    P.box(3.2, 3.42, 19, 0.55, 0.08, 2, "#b84a44", false);
    P.box(5, 5, 0, 1, 0.6, 5, "#c4703f");
    P.box(5.1, 5.1, 5, 0.8, 0.4, 4, "#c4703f");
  }

  private staticCacheKey(): string {
    const i = this.input!;
    const minute = Math.floor(i.now / 600_000);
    return JSON.stringify([i.room.id, i.style, i.level, minute, i.placements.filter((p) => {
      const item = findItem(p.itemId);
      return item?.layer === "wall" || item?.layer === "rug";
    })]);
  }

  draw() {
    const input = this.input;
    if (!input) return;
    const ctx = this.bctx;
    ctx.clearRect(0, 0, this.buffer.width, this.buffer.height);
    const cine = this.cinematic;
    const ct = cine ? this.time - cine.start : 99;
    const building = !!cine && ["build", "expansion", "floor", "final"].includes(cine.kind) && ct < 3.2;
    if (building) {
      const span = input.room.w + input.room.h;
      this.renderStatic(ctx, { tile: (x, y) => ease((ct - ((x + y) / span) * 0.9) / 0.35), wall: ease((ct - 0.7) / 0.6) });
      if (ct > 1.3) {
        const anim = this.staticLayer;
        if (anim) {
          ctx.globalAlpha = ease((ct - 1.3) / 0.5);
          ctx.drawImage(anim, 0, 0);
          ctx.globalAlpha = 1;
        }
      }
    } else {
      const key = this.staticCacheKey();
      if (!this.staticLayer || key !== this.staticKey || this.staticLayer.width !== this.buffer.width || this.staticLayer.height !== this.buffer.height) {
        this.staticLayer = makeCanvas(this.buffer.width, this.buffer.height);
        this.renderStatic(this.staticLayer.getContext("2d")!);
        this.staticKey = key;
      }
      ctx.drawImage(this.staticLayer, 0, 0);
    }
    if (this.overlay.editing) this.drawGrid(ctx);

    // Muebles, objetos pequeños y personajes ordenados por profundidad.
    type Drawable = { depth: number; draw: () => void };
    const list: Drawable[] = [];
    const hits: Hit[] = [];
    const surfaces = new Map<string, { depth: number; z: number }>();
    const floorItems = input.placements.filter((p) => findItem(p.itemId)?.layer === "floor");
    floorItems.forEach((p) => {
      const item = findItem(p.itemId)!;
      const { w: fw, h: fh } = footprint(item, p.rot);
      const depth = p.x + fw / 2 + p.y + fh / 2;
      if (SURFACE_Z[item.kind]) for (const [x, y] of cellsOf(item, p)) surfaces.set(`${x},${y}`, { depth, z: SURFACE_Z[item.kind]! });
    });
    let index = 0;
    for (const p of input.placements) {
      const item = findItem(p.itemId);
      if (!item || item.layer === "wall" || item.layer === "rug") continue;
      const small = item.layer === "small";
      const { w: fw, h: fh } = small ? { w: 1, h: 1 } : footprint(item, p.rot);
      const surface = small ? surfaces.get(`${p.x},${p.y}`) : undefined;
      const depth = surface ? surface.depth + 0.02 + (p.x + p.y) * 0.001 : p.x + fw / 2 + p.y + fh / 2;
      const order = index++;
      list.push({
        depth,
        draw: () => {
          let lift = surface?.z ?? 0;
          if (item.fx === "float" && !this.reducedMotion) lift += Math.round(Math.sin(this.time * 2 + order) * 1.5);
          let drop = 0;
          if (building && ct < 3.2) {
            const local = (ct - 1.4 - order * 0.08) / 0.5;
            if (local <= 0) return;
            drop = (1 - easeBack(local)) * 40;
          }
          const spr = furnitureSprite(item.id, p.rot, input.trophies);
          const [sx, sy] = project(this.iso, p.x, p.y, lift + drop);
          const dx = Math.round(sx - spr.ox);
          const dy = Math.round(sy - spr.oy);
          ctx.drawImage(spr.canvas, dx, dy);
          this.fx(ctx, item, p.x, p.y, fw, fh, lift);
          const [x0, y0, x1, y1] = spr.bbox;
          hits.push({ id: p.uid, x0: dx + x0, y0: dy + y0, x1: dx + x1, y1: dy + y1, depth });
          if (this.overlay.selected === p.uid) this.drawSelection(ctx, item, p.x, p.y, fw, fh, lift);
        },
      });
    }
    for (const a of this.sim?.agents ?? []) {
      const depth = a.x + a.y + (a.z > 0 ? 0.08 : 0.05);
      list.push({
        depth,
        draw: () => {
          if (building && ct < 2.4) return;
          const arc = a.jump > 0 ? Math.sin((1 - a.jump) * Math.PI) * 10 : 0;
          const [sx, sy] = project(this.iso, a.x, a.y, a.z + arc);
          const x = Math.round(sx);
          const y = Math.round(sy) + (a.z > 0 ? 3 : 0);
          // Sombra
          if (a.z === 0) ellipse(ctx, x, Math.round(sy), a.kind === "cat" ? 4 : 4, 1, "rgba(40,25,15,0.22)");
          const frame = this.reducedMotion ? 0 : a.frame;
          if (a.kind === "cat") drawCat(ctx, x, y, a.state === "sleep" ? "sleep" : a.jump > 0 ? "jump" : a.path.length ? "walk" : "sit", frame, a.flip);
          else drawPerson(ctx, x, y, a.look, a.pose, frame, a.back, a.flip, a.z > 0);
          if (a.kind === "cat") hits.push({ id: "cat", x0: x - 8, y0: y - 14, x1: x + 8, y1: y + 2, depth });
        },
      });
    }
    // Fantasma de colocación
    const ghost = this.overlay.ghost;
    if (ghost) {
      const item = findItem(ghost.itemId);
      if (item && item.layer !== "wall" && item.layer !== "rug") {
        const { w: fw, h: fh } = item.layer === "small" ? { w: 1, h: 1 } : footprint(item, ghost.rot);
        const surface = item.layer === "small" ? surfaces.get(`${ghost.x},${ghost.y}`) : undefined;
        list.push({
          depth: ghost.x + fw / 2 + ghost.y + fh / 2 + (surface ? 0.5 : 0),
          draw: () => {
            this.footprintFill(ctx, ghost.x, ghost.y, fw, fh, ghost.valid ? "rgba(34,197,94,0.45)" : "rgba(239,68,68,0.5)");
            ctx.globalAlpha = 0.72;
            const spr = furnitureSprite(item.id, ghost.rot, input.trophies);
            const [sx, sy] = project(this.iso, ghost.x, ghost.y, surface?.z ?? 0);
            ctx.drawImage(spr.canvas, Math.round(sx - spr.ox), Math.round(sy - spr.oy));
            ctx.globalAlpha = 1;
          },
        });
      }
    }
    list.sort((a, b) => a.depth - b.depth);
    for (const d of list) d.draw();

    // Paredes y alfombras: selección y zona de toque.
    for (const p of input.placements) {
      const item = findItem(p.itemId);
      if (!item) continue;
      if (item.layer === "wall") {
        const W = new WallPainter(ctx, this.iso, p.rot % 2 === 1 ? "L" : "R");
        const pts = [W.p(p.x, 12), W.p(p.x + item.w, 12), W.p(p.x + item.w, 56), W.p(p.x, 56)];
        const xs = pts.map((q) => q[0]);
        const ys = pts.map((q) => q[1]);
        hits.push({ id: p.uid, x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys), depth: -1 });
        if (this.overlay.selected === p.uid) poly(ctx, pts, "rgba(56,189,248,0.25)");
      } else if (item.layer === "rug") {
        const { w: fw, h: fh } = footprint(item, p.rot);
        const pts = [project(this.iso, p.x, p.y), project(this.iso, p.x + fw, p.y), project(this.iso, p.x + fw, p.y + fh), project(this.iso, p.x, p.y + fh)];
        hits.push({ id: p.uid, x0: pts[3]![0], y0: pts[0]![1], x1: pts[1]![0], y1: pts[2]![1], depth: -2 });
        if (this.overlay.selected === p.uid) this.drawSelection(ctx, item, p.x, p.y, fw, fh, 0);
      }
    }
    if (ghost) {
      const item = findItem(ghost.itemId);
      if (item?.layer === "wall") {
        const W = new WallPainter(ctx, this.iso, ghost.rot % 2 === 1 ? "L" : "R");
        W.rect(ghost.x, 10, ghost.x + item.w, 58, ghost.valid ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.4)");
        ctx.globalAlpha = 0.8;
        paintWallItem(W, item, ghost.x, item.w);
        ctx.globalAlpha = 1;
      } else if (item?.layer === "rug") {
        const { w: fw, h: fh } = footprint(item, ghost.rot);
        ctx.globalAlpha = 0.75;
        paintItem(new Painter(ctx, { ox: project(this.iso, ghost.x, ghost.y)[0], oy: project(this.iso, ghost.x, ghost.y)[1] }), item, { fw, fh, facing: ghost.rot });
        ctx.globalAlpha = 1;
        this.footprintFill(ctx, ghost.x, ghost.y, fw, fh, ghost.valid ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.45)");
      }
    }
    this.hits = hits;

    // Penumbra nocturna y halos de las lámparas por encima.
    const light = daylight(input.now);
    if (light.night > 0) {
      ctx.fillStyle = `rgba(18,22,58,${light.night})`;
      ctx.fillRect(0, 0, this.buffer.width, this.buffer.height);
    }
    if (input.level >= 2 || light.night > 0) this.drawHalos(ctx, light.night);
    if (cine?.kind === "cozy" && ct < 2) {
      ctx.fillStyle = `rgba(255,200,120,${0.25 * (1 - ct / 2)})`;
      ctx.fillRect(0, 0, this.buffer.width, this.buffer.height);
    }
    this.drawParticles(ctx);
    this.blit();
  }

  private drawHalos(ctx: Ctx2D, night: number) {
    const input = this.input!;
    for (const p of input.placements) {
      const item = findItem(p.itemId);
      if (!item?.tags.includes("light")) continue;
      const wall = item.layer === "wall";
      const { w: fw, h: fh } = wall || item.layer === "small" ? { w: 1, h: 1 } : footprint(item, p.rot);
      const [x, y] = wall
        ? new WallPainter(ctx, this.iso, p.rot % 2 === 1 ? "L" : "R").p(p.x + item.w / 2, 40)
        : project(this.iso, p.x + fw / 2, p.y + fh / 2, item.kind === "floorlamp" ? 30 : 14);
      const pulse = this.reducedMotion ? 0 : Math.sin(this.time * 1.5 + p.x) * 0.02;
      const strength = 0.1 + night * 0.25 + pulse;
      const color = item.fx === "flicker" ? "#d8ff8a" : "#ffd88a";
      for (const [r, a] of [[22, strength * 0.5], [14, strength * 0.8], [7, strength]] as const) {
        ctx.fillStyle = alpha(color, Math.max(0, a));
        ctx.beginPath();
        ctx.ellipse(x, y, r, r * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private fx(ctx: Ctx2D, item: CatalogItem, x: number, y: number, fw: number, fh: number, lift: number) {
    if (!item.fx || this.reducedMotion) return;
    const t = this.time;
    const center = (z: number) => project(this.iso, x + fw / 2, y + fh / 2, lift + z);
    switch (item.fx) {
      case "spin": {
        const [cx, cy] = fw >= fh ? project(this.iso, x + fw * 0.38, y + fh / 2, lift + 15) : project(this.iso, x + fw / 2, y + fh * 0.38, lift + 15);
        const a = t * 5;
        rect(ctx, Math.round(cx + Math.cos(a) * 7), Math.round(cy + Math.sin(a) * 3), 2, 1, "#d8dde3");
        break;
      }
      case "screen": {
        const [cx, cy] = center(item.kind === "desk" ? 24 : 12);
        const phase = Math.floor(t * 3) % 4;
        rect(ctx, Math.round(cx - 3), Math.round(cy - 1 + phase), 6, 1, alpha("#ffffff", 0.6));
        break;
      }
      case "keys": {
        const n = Math.floor(t * 6) % 8;
        const [kx, ky] = project(this.iso, x + 0.2 + (fw >= fh ? n * 0.2 : 0.5), y + 0.5 + (fw >= fh ? 0 : n * 0.2), lift + 15);
        rect(ctx, Math.round(kx), Math.round(ky), 2, 1, item.colors[1] ?? "#7fd6b0");
        break;
      }
      case "gears": {
        const [cx, cy] = center(item.layer === "small" ? 10 : 16);
        for (let i = 0; i < 4; i++) {
          const a = t * 2 + (i * Math.PI) / 2;
          rect(ctx, Math.round(cx + Math.cos(a) * 4), Math.round(cy + Math.sin(a) * 2), 1, 1, "#e0b04a");
        }
        break;
      }
      case "glow": case "stars": {
        const [cx, cy] = center(12);
        const a = 0.12 + Math.sin(t * 2 + x) * 0.06;
        ctx.fillStyle = alpha(item.fx === "stars" ? "#b48ae0" : item.colors[1] ?? "#ffffff", a);
        ctx.beginPath();
        ctx.ellipse(cx, cy, 10 + fw * 5, 6 + fh * 3, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "float": {
        if (item.kind === "table") for (let i = 0; i < 3; i++) {
          const [bx, by] = project(this.iso, x + 0.6 + i * 0.7, y + fh / 2, lift + 22 + Math.sin(t * 2 + i) * 3);
          rect(ctx, Math.round(bx), Math.round(by), 4, 3, ["#b84a44", "#4c78b5", "#e0b04a"][i]!);
          rect(ctx, Math.round(bx) + 1, Math.round(by) + 1, 2, 1, "#f8f4ec");
        }
        break;
      }
      default:
        break;
    }
  }

  private drawParticles(ctx: Ctx2D) {
    for (const p of this.particles) {
      const a = Math.min(1, p.life / Math.min(0.6, p.max));
      ctx.globalAlpha = a;
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      switch (p.kind) {
        case "z":
          rect(ctx, x, y, 3, 1, p.color);
          rect(ctx, x + 1, y + 1, 1, 1, p.color);
          rect(ctx, x, y + 2, 3, 1, p.color);
          break;
        case "heart":
          rect(ctx, x, y, 2, 2, p.color);
          rect(ctx, x + 3, y, 2, 2, p.color);
          rect(ctx, x, y + 1, 5, 2, p.color);
          rect(ctx, x + 1, y + 3, 3, 1, p.color);
          rect(ctx, x + 2, y + 4, 1, 1, p.color);
          break;
        case "confetti":
          rect(ctx, x, y, (Math.floor(p.life * 8) % 2) + 1, 2, p.color);
          break;
        case "firefly":
          rect(ctx, x, y, 1, 1, p.color);
          ctx.globalAlpha = a * 0.3;
          rect(ctx, x - 1, y - 1, 3, 3, p.color);
          break;
        default:
          rect(ctx, x, y, 1, 1, p.color);
      }
    }
    ctx.globalAlpha = 1;
  }

  private footprintFill(ctx: Ctx2D, x: number, y: number, w: number, h: number, color: string) {
    poly(ctx, [project(this.iso, x, y), project(this.iso, x + w, y), project(this.iso, x + w, y + h), project(this.iso, x, y + h)], color);
  }

  private drawSelection(ctx: Ctx2D, item: CatalogItem, x: number, y: number, w: number, h: number, lift: number) {
    const pts = [project(this.iso, x, y, lift), project(this.iso, x + w, y, lift), project(this.iso, x + w, y + h, lift), project(this.iso, x, y + h, lift)];
    for (let i = 0; i < 4; i++) line(ctx, ...pts[i]!, ...pts[(i + 1) % 4]!, "#38bdf8");
    const [ax, ay] = project(this.iso, x + w / 2, y + h / 2, lift + (item.layer === "rug" ? 10 : 46));
    const bob = this.reducedMotion ? 0 : Math.round(Math.sin(this.time * 4) * 2);
    for (let i = 0; i < 4; i++) rect(ctx, Math.round(ax) - i, Math.round(ay) + bob - i, i * 2 + 1, 1, "#38bdf8");
  }

  private drawGrid(ctx: Ctx2D) {
    const room = this.input!.room;
    const reserved = reservedCells(room);
    for (let x = 0; x < room.w; x++) for (let y = 0; y < room.h; y++) {
      if (reserved.has(`${x},${y}`)) this.footprintFill(ctx, x, y, 1, 1, "rgba(239,68,68,0.18)");
    }
    const c = "rgba(255,255,255,0.28)";
    for (let x = 0; x <= room.w; x++) line(ctx, ...project(this.iso, x, 0), ...project(this.iso, x, room.h), c);
    for (let y = 0; y <= room.h; y++) line(ctx, ...project(this.iso, 0, y), ...project(this.iso, room.w, y), c);
  }

  // ------------------------------------------------------------------ pantalla y cámara

  resize() {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.round(this.canvas.clientWidth * dpr);
    const h = Math.round(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.draw();
  }

  private blit() {
    const { canvas, ctx, buffer } = this;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const fit = Math.min(canvas.width / buffer.width, canvas.height / buffer.height) * 0.96;
    const raw = fit * this.zoom;
    // Escala entera cuando cabe: píxeles idénticos y nítidos.
    this.scale = raw >= 1 ? Math.max(1, Math.floor(raw * 2) / 2) : raw;
    const w = buffer.width * this.scale;
    const h = buffer.height * this.scale;
    const maxPanX = Math.max(0, (w - canvas.width) / 2 + canvas.width * 0.3) / dpr;
    const maxPanY = Math.max(0, (h - canvas.height) / 2 + canvas.height * 0.3) / dpr;
    this.panX = Math.max(-maxPanX, Math.min(maxPanX, this.panX));
    this.panY = Math.max(-maxPanY, Math.min(maxPanY, this.panY));
    this.offX = Math.round((canvas.width - w) / 2 + this.panX * dpr);
    this.offY = Math.round((canvas.height - h) / 2 + this.panY * dpr);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(buffer, this.offX, this.offY, w, h);
  }

  /** Coordenadas del lienzo nativo para un punto de pantalla (clientX/Y). */
  private toBuffer(clientX: number, clientY: number): Pt {
    const r = this.canvas.getBoundingClientRect();
    const dpr = this.canvas.width / Math.max(1, r.width);
    return [((clientX - r.left) * dpr - this.offX) / this.scale, ((clientY - r.top) * dpr - this.offY) / this.scale];
  }

  /** Casilla de suelo o hueco de pared bajo el puntero. */
  pick(clientX: number, clientY: number, wallItem = false): TileHit {
    if (!this.input) return null;
    const [bx, by] = this.toBuffer(clientX, clientY);
    const room = this.input.room;
    if (wallItem) {
      const uR = (bx - this.iso.ox) / (TW / 2);
      const vR = this.iso.oy + uR * (TH / 2) - by;
      if (uR >= 0 && uR <= room.w && vR >= -6 && vR <= WALL_H + 10) return { kind: "wall", wall: "R", u: uR };
      const uL = (this.iso.ox - bx) / (TW / 2);
      const vL = this.iso.oy + uL * (TH / 2) - by;
      if (uL >= 0 && uL <= room.h && vL >= -6 && vL <= WALL_H + 10) return { kind: "wall", wall: "L", u: uL };
      return null;
    }
    const [gx, gy] = unproject(this.iso, bx, by);
    const x = Math.floor(gx);
    const y = Math.floor(gy);
    if (x < 0 || y < 0 || x >= room.w || y >= room.h) return null;
    return { kind: "floor", x, y };
  }

  /** Objeto (uid) o «cat» bajo el puntero, el de delante primero. */
  hitTest(clientX: number, clientY: number): string | null {
    const [bx, by] = this.toBuffer(clientX, clientY);
    const found = this.hits.filter((h) => bx >= h.x0 && bx <= h.x1 && by >= h.y0 && by <= h.y1).sort((a, b) => b.depth - a.depth);
    return found[0]?.id ?? null;
  }

  zoomBy(factor: number) {
    this.zoom = Math.max(0.6, Math.min(3.5, this.zoom * factor));
    if (!this.running) this.draw();
  }

  panBy(dx: number, dy: number) {
    this.panX += dx;
    this.panY += dy;
    if (!this.running) this.draw();
  }

  resetCamera() {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    if (!this.running) this.draw();
  }

  /** Gato dormido presente (para la alternativa accesible al logro de la siesta). */
  catSleeping(): boolean {
    return !!this.sim?.agents.some((a) => a.kind === "cat" && a.state === "sleep");
  }
}

export { wallSlotsOf };
