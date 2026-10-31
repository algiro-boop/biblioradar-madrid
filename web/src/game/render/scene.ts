/**
 * Escena isométrica en canvas: se pinta a resolución nativa (pixel art a doble resolución) y se
 * escala sin suavizado. Muestra una sala o la vista general de toda la biblioteca (casa de
 * muñecas: cada planta en una fila, todas las salas por dentro). Solo corre con la pestaña
 * visible y respeta `prefers-reduced-motion` (sin desplazamientos ni partículas).
 */

import { findItem, type CatalogItem } from "../data/catalog";
import { STYLES, type RoomDef } from "../data/levels";
import { cellsOf, footprint, reservedCells, wallSlotsOf } from "../engine/layout";
import type { RoomStyle } from "../engine/types";
import { drawCat, drawDeskArms, drawPerson } from "./characters";
import { paintItem, paintWallItem } from "./furniture";
import {
  alpha, ellipse, line, mix, outlineCanvas, Painter, poly, project, rect, shade, TH, TW, unproject, WALL_H, WallPainter, ZS,
  type Ctx2D, type Iso, type Pt,
} from "./pixel";
import { Sim, SURFACE_Z, type Agent, type ScenePlacement } from "./sim";
import { drawDeskProps } from "./study";

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
  /** Objetos seleccionados (uno o un grupo). */
  selected: string[];
  /** Fantasmas de colocación (uno, o varios al mover un grupo). */
  ghosts: Ghost[];
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

const MARGIN_X = 20;
const TOP = WALL_H * ZS + 48;
const SLAB = 7 * ZS;
/** Escala mínima (px CSS por px nativo) en la vista de sala: personas de ~26 px de alto en móvil. */
const MIN_CSS_SCALE = 0.66;
const OUTLINE: [number, number, number, number] = [42, 28, 20, 235];
/**
 * Escala entera de los personajes: con ×2 una persona mide ~80 px (≈1,7 m frente a paredes de
 * 3 m y asientos a 45 cm) y se lee bien en móvil. El gato ya está dibujado a su tamaño.
 */
const PERSON_SCALE = 2;
const CAT_SCALE = 1;

function scaled(ctx: Ctx2D, x: number, y: number, k: number, draw: () => void) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  draw();
  ctx.restore();
}

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

/**
 * Sprite cacheado de un mueble de suelo (o pequeño) para una orientación: dibujo, contorno de
 * 1 píxel y sombra de contacto suave sobre el suelo.
 */
export function furnitureSprite(itemId: string, rot: number, trophies = 0): Sprite {
  const item = findItem(itemId)!;
  const key = `${itemId}|${rot}|${item.tags.includes("showcase") ? trophies : 0}`;
  const hit = spriteCache.get(key);
  if (hit) return hit;
  const { w: fw, h: fh } = item.layer === "small" ? { w: 1, h: 1 } : footprint(item, rot);
  const ox = fh * (TW / 2) + 4;
  const oy = 70 * ZS;
  const W = (fw + fh) * (TW / 2) + 8;
  const H = oy + (fw + fh) * (TH / 2) + 8;
  const art = makeCanvas(W, H);
  paintItem(new Painter(art.getContext("2d")!, { ox, oy }), item, { fw, fh, facing: rot % 4, trophies });
  outlineCanvas(art, OUTLINE);
  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext("2d")!;
  if (item.layer !== "small") {
    // Sombra de contacto: huella algo encogida, desplazada hacia la luz contraria.
    const P = new Painter(ctx, { ox: ox + 3, oy: oy + 2 });
    P.quad([[0.08, 0.08, 0], [fw - 0.04, 0.08, 0], [fw - 0.04, fh - 0.04, 0], [0.08, fh - 0.04, 0]], "rgba(40,24,14,0.2)");
  }
  ctx.drawImage(art, 0, 0);
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
    canvas = makeCanvas(len * (TW / 2) + 20, 70 * ZS);
    const ctx = canvas.getContext("2d")!;
    const o: Iso = { ox: 8, oy: 62 * ZS };
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

/** Tamaño del lienzo nativo de una sala. */
function roomSize(room: RoomDef): { bw: number; bh: number } {
  return { bw: (room.w + room.h) * (TW / 2) + MARGIN_X * 2, bh: (room.w + room.h) * (TH / 2) + TOP + SLAB + 12 };
}

/** Una sala dibujable: capa estática cacheada, simulación de vida y zonas de toque. */
class RoomView {
  input!: SceneInput;
  sim: Sim | null = null;
  bw = 10;
  bh = 10;
  /** Posición de la sala en el lienzo compuesto. */
  ox = 0;
  oy = 0;
  iso: Iso = { ox: 0, oy: TOP };
  hits: Hit[] = [];
  private local: Iso = { ox: 0, oy: TOP };
  private staticLayer: HTMLCanvasElement | null = null;
  private staticKey = "";

  constructor(private host: { reducedMotion: boolean; onCatNap: () => void }) {}

  setInput(input: SceneInput) {
    this.input = input;
    const { bw, bh } = roomSize(input.room);
    this.bw = bw;
    this.bh = bh;
    this.local = { ox: input.room.h * (TW / 2) + MARGIN_X, oy: TOP };
    this.place(this.ox, this.oy);
    const opts = {
      students: input.students, librarian: input.librarian, cat: input.cat, reducedMotion: this.host.reducedMotion,
      onCatNap: () => this.host.onCatNap(),
    };
    if (!this.sim) this.sim = new Sim(input.room, opts);
    this.sim.setLayout(input.room, input.placements, opts);
  }

  place(ox: number, oy: number) {
    this.ox = ox;
    this.oy = oy;
    this.iso = { ox: this.local.ox + ox, oy: this.local.oy + oy };
  }

  private cacheKey(): string {
    const i = this.input;
    const minute = Math.floor(i.now / 600_000);
    return JSON.stringify([i.room.id, i.room.w, i.room.h, i.style, i.level, minute, i.placements.filter((p) => {
      const item = findItem(p.itemId);
      return item?.layer === "wall" || item?.layer === "rug";
    })]);
  }

  drawStatic(ctx: Ctx2D) {
    const key = this.cacheKey();
    if (!this.staticLayer || key !== this.staticKey || this.staticLayer.width !== this.bw || this.staticLayer.height !== this.bh) {
      this.staticLayer = makeCanvas(this.bw, this.bh);
      this.renderStatic(this.staticLayer.getContext("2d")!, this.local);
      this.staticKey = key;
    }
    ctx.drawImage(this.staticLayer, this.ox, this.oy);
  }

  /** Capa estática animada (cinemáticas de construcción), sin caché. */
  drawBuilding(ctx: Ctx2D, ct: number) {
    const span = this.input.room.w + this.input.room.h;
    this.renderStatic(ctx, this.iso, { tile: (x, y) => ease((ct - ((x + y) / span) * 0.9) / 0.35), wall: ease((ct - 0.7) / 0.6) });
    if (ct > 1.3 && this.staticLayer) {
      ctx.globalAlpha = ease((ct - 1.3) / 0.5);
      ctx.drawImage(this.staticLayer, this.ox, this.oy);
      ctx.globalAlpha = 1;
    } else if (!this.staticLayer) this.drawStatic(ctx);
  }

  renderStatic(ctx: Ctx2D, o: Iso, anim: { tile?: (x: number, y: number) => number; wall?: number } = {}) {
    const input = this.input;
    const { room, style, level } = input;
    const floor = styleColors(style.floor);
    const wallC = styleColors(style.wall);
    const winC = styleColors(style.window);
    const light = daylight(input.now);
    if (level === 0 && !anim.tile) return this.renderLot(ctx, o);
    const [fa = "#c99a63", fb = "#b98a55"] = floor;
    const L0 = project(o, 0, room.h);
    const R0 = project(o, room.w, room.h);
    const R1 = project(o, room.w, 0);
    if (!anim.tile) {
      // Losa del suelo con canto frontal (aspecto de diorama) y franja de cimentación.
      poly(ctx, [L0, R0, [R0[0], R0[1] + SLAB], [L0[0], L0[1] + SLAB]], shade(fb, -0.35));
      poly(ctx, [R0, R1, [R1[0], R1[1] + SLAB], [R0[0], R0[1] + SLAB]], shade(fb, -0.5));
      line(ctx, L0[0], L0[1] + 1, R0[0], R0[1] + 1, shade(fb, -0.1));
      line(ctx, R0[0], R0[1] + 1, R1[0], R1[1] + 1, shade(fb, -0.25));
    }
    for (let x = 0; x < room.w; x++) for (let y = 0; y < room.h; y++) {
      const k = anim.tile ? anim.tile(x, y) : 1;
      if (k <= 0) continue;
      const dy = (1 - k) * -16 * ZS;
      const pts = [project(o, x, y), project(o, x + 1, y), project(o, x + 1, y + 1), project(o, x, y + 1)].map(([a, b]) => [a, b + dy] as Pt);
      const odd = (x + y) % 2 === 1;
      let base = style.floor === "floor-ajedrez" ? (odd ? fb : fa) : odd ? fa : mix(fa, fb, 0.35);
      if (style.floor === "floor-moqueta") base = fa;
      poly(ctx, pts, base);
      const P = new Painter(ctx, { ox: o.ox, oy: o.oy + dy });
      if (style.floor === "floor-roble") {
        // Tablas a lo largo de x con juntas escalonadas y algo de veta.
        const grout = shade(fb, -0.2);
        for (let i = 1; i < 3; i++) P.line([x, y + i / 3, 0], [x + 1, y + i / 3, 0], grout);
        P.line([x, y, 0], [x + 1, y, 0], shade(fb, -0.12));
        const j = ((x * 7 + y * 3) % 3) / 3 + 0.2;
        P.line([x + j, y, 0], [x + j, y + 1 / 3, 0], grout);
        P.line([x + ((j + 0.45) % 1), y + 1 / 3, 0], [x + ((j + 0.45) % 1), y + 2 / 3, 0], grout);
        P.px(x + 0.3 + ((x * 13 + y) % 5) * 0.1, y + 0.5, 0, shade(fa, 0.1));
      } else if (style.floor === "floor-terracota") {
        const grout = shade(fb, -0.22);
        P.line([x, y, 0], [x + 1, y, 0], grout);
        P.line([x, y, 0], [x, y + 1, 0], grout);
        P.line([x, y + 0.5, 0], [x + 1, y + 0.5, 0], shade(fb, -0.08));
        P.line([x + 0.5, y, 0], [x + 0.5, y + 1, 0], shade(fb, -0.08));
      } else if (style.floor === "floor-espiga") {
        const c = shade(fb, -0.25);
        for (let i = 0; i < 4; i++) P.line([x, y + i * 0.25, 0], [x + 0.25, y + i * 0.25 - 0.25 < y ? y : y + i * 0.25 - 0.25, 0], c);
        P.line([x, y + 0.25, 0], [x + 0.5, y, 0], c);
        P.line([x + 0.5, y + 1, 0], [x + 1, y + 0.5, 0], c);
        P.line([x, y + 0.75, 0], [x + 0.75, y, 0], shade(fa, 0.08));
        P.line([x + 0.25, y + 1, 0], [x + 1, y + 0.25, 0], shade(fa, 0.04));
      } else if (style.floor === "floor-moqueta") {
        for (let i = 0; i < 6; i++) P.px(x + ((i * 0.37 + x * 0.13) % 0.9) + 0.05, y + ((i * 0.53 + y * 0.29) % 0.9) + 0.05, 0, fb);
      } else if (style.floor === "floor-ajedrez") {
        P.line([x, y, 0], [x + 1, y, 0], alpha("#000000", 0.08));
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
        // Papel pintado con rayas suaves y friso de madera (arrimadero) en la parte baja.
        for (let u = 0.25; u < room.w; u += 0.25) R.line(u, 18, u, H - 4, alpha(wb, (u * 4) % 2 ? 0.18 : 0.35));
        for (let u = 0.25; u < room.h; u += 0.25) Lw.line(u, 18, u, H - 4, alpha(shade(wb, -0.1), (u * 4) % 2 ? 0.18 : 0.35));
        R.rect(0, 4, room.w, 17, shade(wb, -0.12));
        Lw.rect(0, 4, room.h, 17, shade(wb, -0.2));
        for (let u = 0.5; u < room.w; u += 1) R.rect(u - 0.38, 6.5, u + 0.38, 14.5, shade(wb, -0.05));
        for (let u = 0.5; u < room.h; u += 1) Lw.rect(u - 0.38, 6.5, u + 0.38, 14.5, shade(wb, -0.13));
        R.rect(0, 17, room.w, 18.2, shade(wb, -0.32));
        Lw.rect(0, 17, room.h, 18.2, shade(wb, -0.38));
      }
      // Zócalo, moldura superior y arista
      R.rect(0, 0, room.w, 4, shade(wb, -0.35));
      Lw.rect(0, 0, room.h, 4, shade(wb, -0.42));
      R.rect(0, H - 3, room.w, H, shade(wa, -0.06));
      Lw.rect(0, H - 3, room.h, H, shade(leftWall, -0.06));
      poly(ctx, [project(o, 0, 0, H), project(o, room.w, 0, H), project(o, room.w, -0.15, H), project(o, -0.15, -0.15, H), project(o, -0.15, room.h, H), project(o, 0, room.h, H)], shade(wb, -0.15));
      line(ctx, ...project(o, 0, 0, 0), ...project(o, 0, 0, H), shade(wa, -0.3));
      if (anim.wall === undefined || anim.wall >= 1) {
        // Ventanas con el cielo de la hora de Madrid, alféizar y parteluz
        for (const win of room.windows) {
          const a = win.at + 0.12;
          const b = win.at + win.w - 0.12;
          const [frame = "#8d5e33", tint = "#bfe3f2"] = winC;
          R.rect(a - 0.08, 14, b + 0.08, 52, shade(frame, -0.2));
          R.rect(a - 0.04, 16, b + 0.04, 50, frame);
          R.rect(a + 0.05, 19, b - 0.05, 47, mix(light.sky, tint, 0.25));
          if (!light.sun) for (let i = 0; i < 7; i++) R.dot(a + 0.15 + ((i * 0.37) % (b - a - 0.3)), 25 + ((i * 7) % 18), "#f3e2bf");
          else {
            R.rect(a + 0.1, 28, a + 0.6, 31, alpha("#ffffff", 0.75));
            R.rect(a + 0.35, 31, a + 0.9, 33, alpha("#ffffff", 0.55));
            R.line(a + 0.12, 44, a + 0.4, 22, alpha("#ffffff", 0.45));
          }
          if (style.window === "window-arco") R.rect(a + 0.04, 44, b - 0.04, 47, frame);
          if (style.window === "window-vidriera") for (let i = 0; i < win.w * 4; i++) R.rect(a + 0.05 + i * 0.22, 21, a + 0.2 + i * 0.22, 26, ["#e7b85c", "#b84a44", "#4c78b5", "#5f8f5a"][i % 4]!);
          R.rect((a + b) / 2 - 0.03, 19, (a + b) / 2 + 0.03, 47, frame);
          R.rect(a, 32.5, b, 34, frame);
          R.rect(a - 0.14, 12, b + 0.14, 14.5, shade(frame, 0.25));
          R.rect(a - 0.1, 11, b + 0.1, 12, shade(frame, -0.25));
        }
        // Puerta con marco, cuarterones y pomo
        if (room.door !== null) {
          const d = room.door;
          Lw.rect(d + 0.06, 0, d + 0.94, 42, shade(wb, -0.45));
          Lw.rect(d + 0.14, 0, d + 0.86, 39, "#5a3f2c");
          Lw.rect(d + 0.18, 0, d + 0.82, 37, "#2a1f1a");
          Lw.rect(d + 0.22, 21, d + 0.78, 33, "#3b2a20");
          Lw.rect(d + 0.22, 4, d + 0.78, 18, "#3b2a20");
          Lw.dot(d + 0.7, 19, "#e0b04a");
        }
      }
    }
    // Escalera de la planta alta (hueco con peldaños y barandilla)
    if (room.stairs) {
      const s = room.stairs;
      const P = new Painter(ctx, o);
      P.quad([[s.x, s.y, 0], [s.x + s.w, s.y, 0], [s.x + s.w, s.y + s.h, 0], [s.x, s.y + s.h, 0]], "#2a1f1a");
      for (let i = 0; i < 6; i++) P.box(s.x + 0.1, s.y + 0.1 + i * 0.3, -i * 4 - 4, s.w - 0.2, 0.3, 4, "#9b7046", false);
      P.box(s.x, s.y - 0.08, 0, s.w, 0.08, 14, "#7a4f31");
      P.box(s.x + s.w, s.y, 0, 0.08, s.h, 14, "#7a4f31");
      for (let i = 0; i <= s.h * 3; i++) P.box(s.x + s.w + 0.02, s.y + i / 3 - 0.02, 0, 0.04, 0.04, 14, "#5a3f2c", false);
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
  private renderLot(ctx: Ctx2D, o: Iso) {
    const { room } = this.input;
    const P = new Painter(ctx, o);
    const L0 = project(o, 0, room.h);
    const R0 = project(o, room.w, room.h);
    const R1 = project(o, room.w, 0);
    poly(ctx, [L0, R0, [R0[0], R0[1] + SLAB], [L0[0], L0[1] + SLAB]], "#6b4a2e");
    poly(ctx, [R0, R1, [R1[0], R1[1] + SLAB], [R0[0], R0[1] + SLAB]], "#56391f");
    for (let x = 0; x < room.w; x++) for (let y = 0; y < room.h; y++) {
      P.quad([[x, y, 0], [x + 1, y, 0], [x + 1, y + 1, 0], [x, y + 1, 0]], (x * 7 + y * 3) % 5 === 0 ? "#7fae5a" : (x + y) % 2 ? "#86b862" : "#8cbf67");
      for (let i = 0; i < 3; i++) P.vline(x + 0.2 + i * 0.3, y + 0.3 + ((x + i) % 3) * 0.2, 0, 1.5, "#5f8f45", 0.5);
      if ((x * 5 + y * 11) % 17 === 0) P.dot(x + 0.6, y + 0.3, 1, "#f3e2bf");
    }
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

  /** Muebles, objetos, personas, materiales de estudio y fantasmas, por profundidad. */
  drawDynamic(ctx: Ctx2D, time: number, overlay: Overlay | null, build: { on: boolean; ct: number }) {
    const input = this.input;
    const reduced = this.host.reducedMotion;
    type Drawable = { depth: number; draw: () => void };
    const list: Drawable[] = [];
    const hits: Hit[] = [];
    const surfaces = new Map<string, { depth: number; z: number }>();
    for (const p of input.placements) {
      const item = findItem(p.itemId);
      if (item?.layer !== "floor" || !SURFACE_Z[item.kind]) continue;
      const { w: fw, h: fh } = footprint(item, p.rot);
      const depth = p.x + fw / 2 + p.y + fh / 2;
      for (const [x, y] of cellsOf(item, p)) surfaces.set(`${x},${y}`, { depth, z: SURFACE_Z[item.kind]! });
    }
    const selected = new Set(overlay?.selected ?? []);
    let index = 0;
    for (const p of input.placements) {
      const item = findItem(p.itemId);
      if (!item || item.layer === "wall" || item.layer === "rug") continue;
      const small = item.layer === "small";
      const { w: fw, h: fh } = small ? { w: 1, h: 1 } : footprint(item, p.rot);
      const surface = small ? surfaces.get(`${p.x},${p.y}`) : undefined;
      const depth = surface ? surface.depth + 0.01 + (p.x + p.y) * 0.001 : p.x + fw / 2 + p.y + fh / 2;
      const order = index++;
      list.push({
        depth,
        draw: () => {
          let lift = surface?.z ?? 0;
          if (item.fx === "float" && !reduced) lift += Math.round(Math.sin(time * 2 + order) * 1.5 * ZS) / ZS;
          let drop = 0;
          if (build.on) {
            const local = (build.ct - 1.4 - order * 0.08) / 0.5;
            if (local <= 0) return;
            drop = (1 - easeBack(local)) * 40;
          }
          const spr = furnitureSprite(item.id, p.rot, input.trophies);
          const [sx, sy] = project(this.iso, p.x, p.y, lift + drop);
          const dx = Math.round(sx - spr.ox);
          const dy = Math.round(sy - spr.oy);
          ctx.drawImage(spr.canvas, dx, dy);
          this.fx(ctx, time, item, p.x, p.y, fw, fh, lift);
          const [x0, y0, x1, y1] = spr.bbox;
          hits.push({ id: p.uid, x0: dx + x0, y0: dy + y0, x1: dx + x1, y1: dy + y1, depth });
          if (selected.has(p.uid)) this.drawSelection(ctx, time, item, p.x, p.y, fw, fh, lift);
        },
      });
    }
    for (const a of this.sim?.agents ?? []) this.pushAgent(list, hits, ctx, a, time, build);
    // Fantasmas de colocación (suelo y pequeños)
    for (const ghost of overlay?.ghosts ?? []) {
      const item = findItem(ghost.itemId);
      if (!item || item.layer === "wall" || item.layer === "rug") continue;
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
        if (selected.has(p.uid)) poly(ctx, pts, "rgba(56,189,248,0.25)");
      } else if (item.layer === "rug") {
        const { w: fw, h: fh } = footprint(item, p.rot);
        const pts = [project(this.iso, p.x, p.y), project(this.iso, p.x + fw, p.y), project(this.iso, p.x + fw, p.y + fh), project(this.iso, p.x, p.y + fh)];
        hits.push({ id: p.uid, x0: pts[3]![0], y0: pts[0]![1], x1: pts[1]![0], y1: pts[2]![1], depth: -2 });
        if (selected.has(p.uid)) this.drawSelection(ctx, time, item, p.x, p.y, fw, fh, 0);
      }
    }
    for (const ghost of overlay?.ghosts ?? []) {
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
  }

  private pushAgent(list: { depth: number; draw: () => void }[], hits: Hit[], ctx: Ctx2D, a: Agent, time: number, build: { on: boolean; ct: number }) {
    const reduced = this.host.reducedMotion;
    const spot = a.spot;
    const seated = !!spot && spot.onFurniture && (a.state === "stay" || a.state === "sleep") && a.path.length === 0;
    // Sentado: justo delante de su mueble si mira a cámara, justo detrás si está de espaldas.
    const depth = seated ? spot!.depth + (a.back ? -0.04 : 0.04) : a.x + a.y + 0.05;
    const t = reduced ? 0 : a.t;
    list.push({
      depth,
      draw: () => {
        if (build.on && build.ct < 2.4) return;
        const arc = a.jump > 0 ? Math.sin((1 - a.jump) * Math.PI) * 10 : 0;
        const [sx, sy] = project(this.iso, a.x, a.y, a.z + arc);
        const x = Math.round(sx);
        const y = Math.round(sy);
        if (a.kind === "cat") {
          if (a.z === 0) ellipse(ctx, x, y, 9 * CAT_SCALE, 2 * CAT_SCALE, "rgba(40,25,15,0.22)");
          const pose = a.jump > 0 ? "jump" : a.catPose ?? (a.path.length ? "walk" : "sit");
          scaled(ctx, x, y, CAT_SCALE, () => drawCat(ctx, 0, 0, pose, t, a.flip));
          hits.push({ id: "cat", x0: x - 16 * CAT_SCALE, y0: y - 26 * CAT_SCALE, x1: x + 16 * CAT_SCALE, y1: y + 2, depth });
          return;
        }
        if (a.z === 0) ellipse(ctx, x, y, 8 * PERSON_SCALE, 2 * PERSON_SCALE, "rgba(40,25,15,0.22)");
        scaled(ctx, x, y, PERSON_SCALE, () => drawPerson(ctx, 0, 0, a.look, {
          act: a.act, t, back: a.back, flip: a.flip, seated, gaze: a.gaze,
          carry: a.kind === "librarian" && a.path.length > 0,
        }));
      },
    });
    // Materiales sobre la mesa y manos (por delante del tablero)
    if (seated && spot!.desk && a.kind === "student" && a.kit) {
      const desk = spot!.desk;
      const deskDepth = desk.edge[0] + desk.dir[0] * 0.5 + desk.edge[1] + desk.dir[1] * 0.5 + 0.02;
      const tableDepth = Math.max(deskDepth, a.back ? -Infinity : spot!.depth + 0.06);
      list.push({
        depth: a.back ? Math.min(tableDepth, depth - 0.01) : Math.max(tableDepth, this.tableDepthAt(desk) + 0.02),
        draw: () => {
          if (build.on && build.ct < 2.4) return;
          drawDeskProps(new Painter(ctx, this.iso), desk, a.kit!, a.act, a.t);
          if (!a.back) {
            const [sx, sy] = project(this.iso, a.x, a.y, a.z);
            scaled(ctx, Math.round(sx), Math.round(sy), PERSON_SCALE, () => drawDeskArms(ctx, 0, 0, a.look, a.act, reduced ? 0 : a.t, a.flip));
          }
        },
      });
    }
  }

  /** Profundidad de dibujo de la mesa que hay en una casilla de trabajo. */
  private tableDepthAt(desk: { edge: [number, number]; dir: [number, number] }): number {
    const cx = Math.floor(desk.edge[0] + desk.dir[0] * 0.5);
    const cy = Math.floor(desk.edge[1] + desk.dir[1] * 0.5);
    for (const p of this.input.placements) {
      const item = findItem(p.itemId);
      if (item?.layer !== "floor") continue;
      if (cellsOf(item, p).some(([x, y]) => x === cx && y === cy)) {
        const { w, h } = footprint(item, p.rot);
        return p.x + w / 2 + p.y + h / 2;
      }
    }
    return cx + cy + 1;
  }

  drawHalos(ctx: Ctx2D, time: number, night: number) {
    for (const p of this.input.placements) {
      const item = findItem(p.itemId);
      if (!item?.tags.includes("light")) continue;
      const wall = item.layer === "wall";
      const { w: fw, h: fh } = wall || item.layer === "small" ? { w: 1, h: 1 } : footprint(item, p.rot);
      const lift = item.layer === "small" ? 14 : 0;
      const [x, y] = wall
        ? new WallPainter(ctx, this.iso, p.rot % 2 === 1 ? "L" : "R").p(p.x + item.w / 2, 40)
        : project(this.iso, p.x + fw / 2, p.y + fh / 2, lift + (item.kind === "floorlamp" ? 30 : 12));
      const pulse = this.host.reducedMotion ? 0 : Math.sin(time * 1.5 + p.x) * 0.02;
      const strength = 0.1 + night * 0.25 + pulse;
      const color = item.fx === "flicker" ? "#d8ff8a" : "#ffd88a";
      for (const [r, a] of [[22, strength * 0.5], [14, strength * 0.8], [7, strength]] as const) {
        ctx.fillStyle = alpha(color, Math.max(0, a));
        ctx.beginPath();
        ctx.ellipse(x, y, r * ZS, r * ZS * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Brillo de las pantallas de portátiles vistas de frente
    for (const a of this.sim?.agents ?? []) {
      if (a.kind !== "student" || !a.back || !a.spot?.desk || !a.kit?.laptop || a.state !== "stay") continue;
      const d = a.spot.desk;
      const [x, y] = project(this.iso, d.edge[0] + d.dir[0] * 0.38, d.edge[1] + d.dir[1] * 0.38, d.z + 6);
      ctx.fillStyle = alpha("#bfe3ff", 0.06 + night * 0.2);
      ctx.beginPath();
      ctx.ellipse(x, y, 16 * ZS, 10 * ZS, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ambient(particles: Particle[], dt: number, spark: (x: number, y: number, c: string) => void) {
    for (const p of this.input.placements) {
      const item = findItem(p.itemId);
      if (!item?.fx || Math.random() > dt * 2.2) continue;
      const { w: fw, h: fh } = item.layer === "small" ? { w: 1, h: 1 } : footprint(item, p.rot);
      const [x, y] = project(this.iso, p.x + fw / 2, p.y + fh / 2, 20);
      const j = (n: number) => (Math.random() - 0.5) * n * ZS;
      if (item.fx === "flicker") particles.push({ x: x + j(16), y: y + j(10), vx: j(6), vy: -3 * ZS, life: 1.6, max: 1.6, color: "#d8ff8a", kind: "firefly" });
      if (item.fx === "leaves") particles.push({ x: x + j(10), y: y - 6 * ZS, vx: j(4), vy: 7 * ZS, life: 1.8, max: 1.8, color: item.colors[0]!, kind: "leaf" });
      if (item.fx === "glow" || item.fx === "stars") spark(x + j(18), y + j(8), item.fx === "stars" ? "#fff6d8" : item.colors[1] ?? "#ffffff");
      if (item.fx === "water") particles.push({ x: x + j(4), y: y - 4 * ZS, vx: j(16), vy: -14 * ZS, life: 0.9, max: 0.9, color: "#bfe3f2", kind: "drop" });
    }
  }

  private fx(ctx: Ctx2D, time: number, item: CatalogItem, x: number, y: number, fw: number, fh: number, lift: number) {
    if (!item.fx || this.host.reducedMotion) return;
    const t = time;
    const center = (z: number) => project(this.iso, x + fw / 2, y + fh / 2, lift + z);
    switch (item.fx) {
      case "spin": {
        const [cx, cy] = fw >= fh ? project(this.iso, x + fw * 0.38, y + fh / 2, lift + 15) : project(this.iso, x + fw / 2, y + fh * 0.38, lift + 15);
        const a = t * 5;
        rect(ctx, Math.round(cx + Math.cos(a) * 7 * ZS), Math.round(cy + Math.sin(a) * 3 * ZS), 2 * ZS, ZS, "#d8dde3");
        break;
      }
      case "screen": {
        const [cx, cy] = center(item.kind === "desk" ? 24 : 12);
        const phase = Math.floor(t * 3) % 4;
        rect(ctx, Math.round(cx - 3 * ZS), Math.round(cy + (phase - 1) * ZS), 6 * ZS, 1, alpha("#ffffff", 0.6));
        break;
      }
      case "keys": {
        const n = Math.floor(t * 6) % 8;
        const [kx, ky] = project(this.iso, x + 0.2 + (fw >= fh ? n * 0.2 : 0.5), y + 0.5 + (fw >= fh ? 0 : n * 0.2), lift + 15);
        rect(ctx, Math.round(kx), Math.round(ky), 2 * ZS, ZS, item.colors[1] ?? "#7fd6b0");
        break;
      }
      case "gears": {
        const [cx, cy] = center(item.layer === "small" ? 10 : 16);
        for (let i = 0; i < 4; i++) {
          const a = t * 2 + (i * Math.PI) / 2;
          rect(ctx, Math.round(cx + Math.cos(a) * 4 * ZS), Math.round(cy + Math.sin(a) * 2 * ZS), ZS, ZS, "#e0b04a");
        }
        break;
      }
      case "glow": case "stars": {
        const [cx, cy] = center(12);
        const a = 0.12 + Math.sin(t * 2 + x) * 0.06;
        ctx.fillStyle = alpha(item.fx === "stars" ? "#b48ae0" : item.colors[1] ?? "#ffffff", a);
        ctx.beginPath();
        ctx.ellipse(cx, cy, (10 + fw * 5) * ZS, (6 + fh * 3) * ZS, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "float": {
        if (item.kind === "table") for (let i = 0; i < 3; i++) {
          const [bx, by] = project(this.iso, x + 0.6 + i * 0.7, y + fh / 2, lift + 22 + Math.sin(t * 2 + i) * 3);
          rect(ctx, Math.round(bx) - 1, Math.round(by) - 1, 4 * ZS + 2, 3 * ZS + 2, "#2a1f1a");
          rect(ctx, Math.round(bx), Math.round(by), 4 * ZS, 3 * ZS, ["#b84a44", "#4c78b5", "#e0b04a"][i]!);
          rect(ctx, Math.round(bx) + ZS, Math.round(by) + ZS, 2 * ZS, ZS, "#f8f4ec");
        }
        break;
      }
      default:
        break;
    }
  }

  footprintFill(ctx: Ctx2D, x: number, y: number, w: number, h: number, color: string) {
    poly(ctx, [project(this.iso, x, y), project(this.iso, x + w, y), project(this.iso, x + w, y + h), project(this.iso, x, y + h)], color);
  }

  private drawSelection(ctx: Ctx2D, time: number, item: CatalogItem, x: number, y: number, w: number, h: number, lift: number) {
    const pts = [project(this.iso, x, y, lift), project(this.iso, x + w, y, lift), project(this.iso, x + w, y + h, lift), project(this.iso, x, y + h, lift)];
    poly(ctx, pts, "rgba(56,189,248,0.16)");
    for (let i = 0; i < 4; i++) {
      line(ctx, ...pts[i]!, ...pts[(i + 1) % 4]!, "#38bdf8");
      line(ctx, pts[i]![0], pts[i]![1] + 1, pts[(i + 1) % 4]![0], pts[(i + 1) % 4]![1] + 1, "#38bdf8");
    }
    const [ax, ay] = project(this.iso, x + w / 2, y + h / 2, lift + (item.layer === "rug" ? 10 : 46));
    const bob = this.host.reducedMotion ? 0 : Math.round(Math.sin(time * 4) * 2 * ZS);
    for (let i = 0; i < 5; i++) rect(ctx, Math.round(ax) - i * 2, Math.round(ay) + bob - i * 2, i * 4 + 2, 2, "#38bdf8");
  }

  drawGrid(ctx: Ctx2D) {
    const room = this.input.room;
    const reserved = reservedCells(room);
    for (let x = 0; x < room.w; x++) for (let y = 0; y < room.h; y++) {
      if (reserved.has(`${x},${y}`)) this.footprintFill(ctx, x, y, 1, 1, "rgba(239,68,68,0.18)");
    }
    const c = "rgba(255,255,255,0.28)";
    for (let x = 0; x <= room.w; x++) line(ctx, ...project(this.iso, x, 0), ...project(this.iso, x, room.h), c);
    for (let y = 0; y <= room.h; y++) line(ctx, ...project(this.iso, 0, y), ...project(this.iso, room.w, y), c);
  }
}

export class Scene {
  private ctx: CanvasRenderingContext2D;
  private buffer: HTMLCanvasElement;
  private bctx: CanvasRenderingContext2D;
  private views = new Map<string, RoomView>();
  /** Sala activa (vista de sala) o todas (vista general). */
  private order: string[] = [];
  private mode: "room" | "overview" = "room";
  private overlay: Overlay = { editing: false, selected: [], ghosts: [] };
  private particles: Particle[] = [];
  private cinematic: { kind: Cinematic; start: number } | null = null;
  private raf = 0;
  private last = 0;
  private time = 0;
  private running = false;
  private scale = 2;
  private offX = 0;
  private offY = 0;
  private zzzTimer = 0;
  private labels: { id: string; name: string; floor: number; x: number; y: number }[] = [];
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

  private view(id: string): RoomView {
    let v = this.views.get(id);
    if (!v) {
      v = new RoomView({ reducedMotion: this.reducedMotion, onCatNap: () => this.callbacks.onCatNap?.() });
      this.views.set(id, v);
    }
    return v;
  }

  private resizeBuffer(bw: number, bh: number) {
    if (this.buffer.width !== bw || this.buffer.height !== bh) {
      this.buffer.width = bw;
      this.buffer.height = bh;
    }
  }

  /** Vista de una sala. */
  setInput(input: SceneInput) {
    const prev = this.order.length === 1 ? this.order[0] : null;
    const switched = this.mode !== "room" || prev !== input.room.id;
    if (this.mode !== "room") this.resetCamera(false);
    this.mode = "room";
    this.order = [input.room.id];
    const v = this.view(input.room.id);
    v.place(0, 0);
    v.setInput(input);
    this.resizeBuffer(v.bw, v.bh);
    this.labels = [];
    if (switched) this.particles = [];
    this.draw();
  }

  /**
   * Vista general tipo casa de muñecas: cada planta en una fila (la alta arriba), todas las
   * salas por dentro y con vida. Tocar una sala la abre.
   */
  setOverview(inputs: SceneInput[]) {
    if (this.mode !== "overview") {
      this.resetCamera(false);
      this.particles = [];
    }
    this.mode = "overview";
    const GAP = 28 * ZS;
    const LABEL = 30 * ZS;
    const rows = [1, 0].map((f) => inputs.filter((i) => i.room.floor === f)).filter((r) => r.length);
    for (const i of inputs) this.view(i.room.id).setInput(i);
    const rowSize = rows.map((r) => {
      const views = r.map((i) => this.view(i.room.id));
      return { w: views.reduce((n, v) => n + v.bw, 0) + GAP * (views.length - 1), h: Math.max(...views.map((v) => v.bh)) + LABEL };
    });
    const bw = Math.max(...rowSize.map((r) => r.w)) + GAP * 2;
    const bh = rowSize.reduce((n, r) => n + r.h, 0) + GAP * (rows.length + 1);
    this.resizeBuffer(bw, bh);
    this.labels = [];
    this.order = [];
    let y = GAP;
    rows.forEach((r, ri) => {
      const size = rowSize[ri]!;
      let x = Math.round((bw - size.w) / 2);
      for (const i of r) {
        const v = this.view(i.room.id);
        const vy = y + LABEL + (size.h - LABEL - v.bh);
        v.place(x, vy);
        // Etiqueta sobre el centro de la pared del fondo
        const [lx, ly] = project(v.iso, 0, 0, WALL_H + 8);
        this.labels.push({ id: i.room.id, name: i.room.name, floor: i.room.floor, x: lx, y: Math.max(y + 8, ly - LABEL) });
        this.order.push(i.room.id);
        x += v.bw + GAP;
      }
      y += size.h + GAP;
    });
    this.draw();
  }

  get isOverview() {
    return this.mode === "overview";
  }

  setOverlay(overlay: Overlay) {
    this.overlay = overlay;
    if (!this.running) this.draw();
  }

  play(kind: Cinematic) {
    if (this.reducedMotion || this.mode !== "room") return;
    this.cinematic = { kind, start: this.time };
    const bw = this.buffer.width;
    if (kind === "opening" || kind === "final") this.confetti(bw / 2, 20 * ZS, 140, kind === "final");
    if (kind === "cozy") for (let i = 0; i < 50; i++) this.spark(Math.random() * bw, TOP + Math.random() * 80 * ZS, "#ffd88a");
    const v = this.views.get(this.order[0] ?? "");
    if (kind === "cat" && v) {
      const [x, y] = project(v.iso, 0.5, (v.input.room.door ?? 2) + 0.5, 12);
      for (let i = 0; i < 6; i++) this.particles.push({ x: x + i * 3 * ZS, y, vx: (Math.random() - 0.5) * 8 * ZS, vy: (-14 - Math.random() * 10) * ZS, life: 2, max: 2, color: "#e05a7a", kind: "heart" });
    }
  }

  /** Destello y confeti sobre la sala activa (ampliaciones, compras). */
  burst() {
    if (this.reducedMotion) return;
    this.confetti(this.buffer.width / 2, TOP, 70);
  }

  private confetti(x: number, y: number, n: number, gold = false) {
    const colors = gold ? ["#e0b04a", "#f3e2bf", "#ffd88a", "#ffffff"] : ["#10b981", "#fbbf24", "#38bdf8", "#f472b6", "#a78bfa", "#ffffff"];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI;
      const s = (30 + Math.random() * 70) * ZS;
      this.particles.push({ x, y, vx: Math.cos(a) * s * (Math.random() < 0.5 ? -1 : 1), vy: -Math.sin(a) * s * 0.6, life: 3, max: 3, color: colors[i % colors.length]!, kind: "confetti" });
    }
  }

  private spark(x: number, y: number, color: string) {
    this.particles.push({ x, y, vx: 0, vy: (-4 - Math.random() * 6) * ZS, life: 1.2 + Math.random(), max: 2.2, color, kind: "spark" });
  }

  start() {
    if (this.running || document.hidden) return;
    this.running = true;
    this.last = performance.now();
    const loop = (t: number) => {
      if (!this.running) return;
      const dt = Math.min(0.1, (t - this.last) / 1000);
      // ~30 fps en una sala y ~20 en la vista general: suficiente para pixel art y ahorra batería.
      if (dt >= (this.mode === "overview" ? 1 / 21 : 1 / 32)) {
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

  private active(): RoomView[] {
    return this.order.map((id) => this.views.get(id)).filter((v): v is RoomView => !!v);
  }

  private update(dt: number) {
    this.time += dt;
    const views = this.active();
    for (const v of views) v.sim?.update(dt);
    if (this.reducedMotion) {
      this.particles = [];
      return;
    }
    this.zzzTimer -= dt;
    if (this.zzzTimer <= 0) {
      this.zzzTimer = 1.4;
      for (const v of views) {
        const cat = v.sim?.agents.find((a) => a.kind === "cat" && a.catPose === "sleep");
        if (cat) {
          const [x, y] = project(v.iso, cat.x, cat.y, cat.z + 10);
          this.particles.push({ x: x + 3 * ZS, y, vx: 4 * ZS, vy: -7 * ZS, life: 2.2, max: 2.2, color: "#ffffff", kind: "z" });
        }
      }
    }
    for (const v of views) v.ambient(this.particles, dt, (x, y, c) => this.spark(x, y, c));
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === "confetti" || p.kind === "drop") p.vy += (p.kind === "drop" ? 40 : 45) * ZS * dt;
      if (p.kind === "confetti") p.vx *= 0.98;
    }
    this.particles = this.particles.filter((p) => p.life > 0).slice(-320);
    if (this.cinematic && this.time - this.cinematic.start > 4) this.cinematic = null;
  }

  // ------------------------------------------------------------------ dibujo

  draw() {
    const views = this.active();
    if (!views.length) return;
    const ctx = this.bctx;
    ctx.clearRect(0, 0, this.buffer.width, this.buffer.height);
    const cine = this.mode === "room" ? this.cinematic : null;
    const ct = cine ? this.time - cine.start : 99;
    const building = !!cine && ["build", "expansion", "floor", "final"].includes(cine.kind) && ct < 3.2;
    const overlay = this.mode === "room" ? this.overlay : null;
    let night = 0;
    for (const v of views) {
      if (building) v.drawBuilding(ctx, ct);
      else v.drawStatic(ctx);
      if (overlay?.editing) v.drawGrid(ctx);
      v.drawDynamic(ctx, this.time, overlay, { on: building, ct });
      night = Math.max(night, daylight(v.input.now).night);
    }
    // Penumbra nocturna solo sobre lo pintado; halos de lámparas por encima.
    if (night > 0) {
      ctx.globalCompositeOperation = "source-atop";
      ctx.fillStyle = `rgba(18,22,58,${night})`;
      ctx.fillRect(0, 0, this.buffer.width, this.buffer.height);
      ctx.globalCompositeOperation = "source-over";
    }
    for (const v of views) if (v.input.level >= 2 || night > 0) v.drawHalos(ctx, this.time, night);
    if (cine?.kind === "cozy" && ct < 2) {
      ctx.globalCompositeOperation = "source-atop";
      ctx.fillStyle = `rgba(255,200,120,${0.25 * (1 - ct / 2)})`;
      ctx.fillRect(0, 0, this.buffer.width, this.buffer.height);
      ctx.globalCompositeOperation = "source-over";
    }
    if (this.mode === "overview") this.drawLabels(ctx);
    this.drawParticles(ctx);
    this.blit();
  }

  private drawLabels(ctx: Ctx2D) {
    ctx.font = `700 ${13 * ZS}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    for (const l of this.labels) {
      const text = `${l.floor ? "Planta alta" : "Planta baja"} · ${l.name}`;
      const w = ctx.measureText(text).width + 16 * ZS;
      const h = 22 * ZS;
      const x = Math.round(l.x - w / 2);
      const y = Math.round(l.y - h / 2);
      ctx.fillStyle = "rgba(20,14,10,0.78)";
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 8 * ZS);
      ctx.fill();
      ctx.fillStyle = "#fff6e3";
      ctx.fillText(text, l.x, l.y + 1);
    }
  }

  private drawParticles(ctx: Ctx2D) {
    const s = ZS;
    for (const p of this.particles) {
      const a = Math.min(1, p.life / Math.min(0.6, p.max));
      ctx.globalAlpha = a;
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      switch (p.kind) {
        case "z":
          rect(ctx, x, y, 3 * s, s, p.color);
          rect(ctx, x + s, y + s, s, s, p.color);
          rect(ctx, x, y + 2 * s, 3 * s, s, p.color);
          break;
        case "heart":
          rect(ctx, x, y, 2 * s, 2 * s, p.color);
          rect(ctx, x + 3 * s, y, 2 * s, 2 * s, p.color);
          rect(ctx, x, y + s, 5 * s, 2 * s, p.color);
          rect(ctx, x + s, y + 3 * s, 3 * s, s, p.color);
          rect(ctx, x + 2 * s, y + 4 * s, s, s, p.color);
          break;
        case "confetti":
          rect(ctx, x, y, ((Math.floor(p.life * 8) % 2) + 1) * s, 2 * s, p.color);
          break;
        case "firefly":
          rect(ctx, x, y, s, s, p.color);
          ctx.globalAlpha = a * 0.3;
          rect(ctx, x - s, y - s, 3 * s, 3 * s, p.color);
          break;
        case "leaf":
          rect(ctx, x, y, 2 * s, s, p.color);
          break;
        default:
          rect(ctx, x, y, s, s, p.color);
      }
    }
    ctx.globalAlpha = 1;
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
    // En una sala nunca se arranca con sprites ilegibles: escala mínima y se desplaza con el dedo.
    const base = this.mode === "room" ? Math.max(fit, Math.min(MIN_CSS_SCALE * dpr, fit * 2.4)) : fit;
    const min = fit * 0.85;
    const max = base * 4;
    let s = Math.max(min, Math.min(max, base * this.zoom));
    this.zoom = s / base;
    // Escala de medio píxel cuando cabe: píxeles idénticos y nítidos.
    if (s >= 1) s = Math.max(1, Math.round(s * 2) / 2);
    this.scale = s;
    const w = buffer.width * s;
    const h = buffer.height * s;
    const maxPanX = Math.max(0, (w - canvas.width) / 2 + canvas.width * 0.3) / dpr;
    const maxPanY = Math.max(0, (h - canvas.height) / 2 + canvas.height * 0.3) / dpr;
    this.panX = Math.max(-maxPanX, Math.min(maxPanX, this.panX));
    this.panY = Math.max(-maxPanY, Math.min(maxPanY, this.panY));
    this.offX = Math.round((canvas.width - w) / 2 + this.panX * dpr);
    this.offY = Math.round((canvas.height - h) / 2 + this.panY * dpr);
    // Al reducir (vista general en móvil) se suaviza para no perder líneas finas.
    ctx.imageSmoothingEnabled = s < 1;
    ctx.imageSmoothingQuality = "high";
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(buffer, this.offX, this.offY, w, h);
  }

  /** Coordenadas del lienzo nativo para un punto de pantalla (clientX/Y). */
  private toBuffer(clientX: number, clientY: number): Pt {
    const r = this.canvas.getBoundingClientRect();
    const dpr = this.canvas.width / Math.max(1, r.width);
    return [((clientX - r.left) * dpr - this.offX) / this.scale, ((clientY - r.top) * dpr - this.offY) / this.scale];
  }

  private roomView(): RoomView | null {
    return this.mode === "room" ? this.views.get(this.order[0] ?? "") ?? null : null;
  }

  /** Casilla de suelo o hueco de pared bajo el puntero (vista de sala). */
  pick(clientX: number, clientY: number, wallItem = false): TileHit {
    const v = this.roomView();
    if (!v) return null;
    const [bx, by] = this.toBuffer(clientX, clientY);
    const room = v.input.room;
    const iso = v.iso;
    if (wallItem) {
      const uR = (bx - iso.ox) / (TW / 2);
      const vR = iso.oy + uR * (TH / 2) - by;
      if (uR >= 0 && uR <= room.w && vR >= -6 * ZS && vR <= (WALL_H + 10) * ZS) return { kind: "wall", wall: "R", u: uR };
      const uL = (iso.ox - bx) / (TW / 2);
      const vL = iso.oy + uL * (TH / 2) - by;
      if (uL >= 0 && uL <= room.h && vL >= -6 * ZS && vL <= (WALL_H + 10) * ZS) return { kind: "wall", wall: "L", u: uL };
      return null;
    }
    const [gx, gy] = unproject(iso, bx, by);
    const x = Math.floor(gx);
    const y = Math.floor(gy);
    if (x < 0 || y < 0 || x >= room.w || y >= room.h) return null;
    return { kind: "floor", x, y };
  }

  /** Objeto (uid) o «cat» bajo el puntero, el de delante primero (vista de sala). */
  hitTest(clientX: number, clientY: number): string | null {
    const v = this.roomView();
    if (!v) return null;
    const [bx, by] = this.toBuffer(clientX, clientY);
    const found = v.hits.filter((h) => bx >= h.x0 && bx <= h.x1 && by >= h.y0 && by <= h.y1).sort((a, b) => b.depth - a.depth);
    return found[0]?.id ?? null;
  }

  /** Sala bajo el puntero en la vista general. */
  roomAt(clientX: number, clientY: number): string | null {
    if (this.mode !== "overview") return null;
    const [bx, by] = this.toBuffer(clientX, clientY);
    for (const v of this.active()) {
      const { room } = v.input;
      const [gx, gy] = unproject(v.iso, bx, by);
      const onFloor = gx >= 0 && gy >= 0 && gx <= room.w && gy <= room.h;
      const inBox = bx >= v.ox && bx <= v.ox + v.bw && by >= v.oy + TOP - WALL_H * ZS && by <= v.oy + v.bh;
      if (onFloor || (inBox && gx + gy >= -2)) return room.id;
    }
    return null;
  }

  zoomBy(factor: number) {
    this.zoom *= factor;
    if (!this.running) this.draw();
  }

  panBy(dx: number, dy: number) {
    this.panX += dx;
    this.panY += dy;
    if (!this.running) this.draw();
  }

  resetCamera(redraw = true) {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    if (redraw && !this.running) this.draw();
  }

  /** Gato dormido presente (para la alternativa accesible al logro de la siesta). */
  catSleeping(): boolean {
    return this.active().some((v) => v.sim?.agents.some((a) => a.kind === "cat" && a.catPose === "sleep"));
  }
}

export { wallSlotsOf };
