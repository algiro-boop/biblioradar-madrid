/**
 * Anuncio vertical (1080×1920, 30 fps) de BiblioRadar Madrid y Mi Biblioteca, dibujado con el
 * propio motor del juego. Solo lo usa la ruta de desarrollo /mi-biblioteca/anuncio: cada fotograma
 * se pinta a demanda (`renderFrame`) y un script de Playwright los graba y los une en un MP4.
 *
 * Música: 120 ppm, compases de 2 s que arrancan en t = 3 (tras el gancho); los cortes caen en
 * los compases. `CUES` lista los efectos de sonido sincronizados con la imagen.
 */

import { ACHIEVEMENTS } from "@/game/data/achievements";
import { ALL_ITEMS, findItem, RARITY_LABEL } from "@/game/data/catalog";
import { DEFAULT_STYLE, roomAt, roomsForLevel, studentsForLevel } from "@/game/data/levels";
import { getMission } from "@/game/data/missions";
import { SHOWCASES } from "@/game/data/showcases";
import { dispatch, initialState, type GameState } from "@/game/engine";
import { itemLookup } from "@/game/engine/layout";
import { itemThumbnail, Scene, type Cinematic, type SceneInput } from "@/game/render/scene";
import { mulberry32 } from "@/game/rng";
import { phaseInstant, sunTimes } from "@/game/sun";
import { madridDateKey } from "@/game/time";
import { REPORT_OPTIONS } from "@/lib/reports";

export const W = 1080;
export const H = 1920;
export const FPS = 30;
export const DURATION = 41;
export const FRAMES = DURATION * FPS;
/** Arranque del compás 1 de la música (el gancho va antes, con un redoble). */
export const MUSIC_START = 3;
export const BPM = 120;

export type CueKind = "pop" | "coin" | "whoosh" | "levelup" | "tap" | "boom" | "tick" | "sparkle" | "stamp" | "check";
export interface Cue {
  t: number;
  kind: CueKind;
}

type Ctx = CanvasRenderingContext2D;

// ------------------------------------------------------------------ utilidades

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOutCubic = (t: number) => 1 - (1 - clamp01(t)) ** 3;
const easeInOut = (t: number) => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
};
const easeOutBack = (t: number) => {
  const x = clamp01(t);
  const c1 = 2.2;
  return 1 + (c1 + 1) * (x - 1) ** 3 + c1 * (x - 1) ** 2;
};
/** Escala de «pop» (0 → rebote → 1) a partir de `start`. */
const pop = (t: number, start: number, dur = 0.28) => (t < start ? 0 : easeOutBack((t - start) / dur));
const fadeIn = (t: number, start: number, dur = 0.2) => clamp01((t - start) / dur);
const beatPulse = (t: number) => {
  if (t < MUSIC_START) return 0;
  const beat = ((t - MUSIC_START) * BPM) / 60;
  return Math.max(0, 1 - (beat - Math.floor(beat)) * 4);
};

const FONT = `"SF Pro Display", -apple-system, system-ui, "Helvetica Neue", Arial, sans-serif`;
const font = (size: number, weight = 900) => `${weight} ${Math.round(size)}px ${FONT}`;

const INK = "#2a1f1a";
const CREAM = "#fff6e3";
const GOLD = "#ffd84a";
const GREEN = "#10b981";
const AMBER = "#fbbf24";
const ORANGE = "#f97316";
const RED = "#dc2626";

function pinColor(pct: number) {
  if (pct < 70) return { bg: GREEN, fg: "#ffffff" };
  if (pct < 90) return { bg: AMBER, fg: "#451a03" };
  if (pct < 100) return { bg: ORANGE, fg: "#ffffff" };
  return { bg: RED, fg: "#ffffff" };
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/**
 * Rótulo grande estilo TikTok: blanco con contorno grueso y sombra. Lo que va entre asteriscos
 * se resalta en amarillo. Centrado en `cx`.
 */
function caption(ctx: Ctx, text: string, cx: number, cy: number, size: number, scale = 1, opts: { hl?: string; fill?: string; rot?: number } = {}) {
  if (scale <= 0.001) return;
  const parts = text.split("*").map((s, i) => ({ s, hl: i % 2 === 1 }));
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(opts.rot ?? 0);
  ctx.scale(scale, scale);
  ctx.font = font(size);
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.lineJoin = "round";
  const total = parts.reduce((n, p) => n + ctx.measureText(p.s).width, 0);
  let x = -total / 2;
  // Sombra dura desplazada (look de pegatina) y contorno.
  for (const pass of ["shadow", "stroke", "fill"] as const) {
    x = -total / 2;
    for (const p of parts) {
      if (pass === "shadow") {
        ctx.fillStyle = "rgba(20,10,5,0.55)";
        ctx.strokeStyle = "rgba(20,10,5,0.55)";
        ctx.lineWidth = size * 0.26;
        ctx.strokeText(p.s, x + size * 0.06, size * 0.09);
      } else if (pass === "stroke") {
        ctx.strokeStyle = INK;
        ctx.lineWidth = size * 0.24;
        ctx.strokeText(p.s, x, 0);
      } else {
        ctx.fillStyle = p.hl ? opts.hl ?? GOLD : opts.fill ?? "#ffffff";
        ctx.fillText(p.s, x, 0);
      }
      x += ctx.measureText(p.s).width;
    }
  }
  ctx.restore();
}

/** Texto sencillo (sin contorno) alineado. */
function text(ctx: Ctx, s: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = "left", weight = 800) {
  ctx.font = font(size, weight);
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
}

/** Sprite pixel art a partir de filas de texto y una paleta. */
function sprite(ctx: Ctx, rows: string[], pal: Record<string, string>, x: number, y: number, px: number, flip = false) {
  const w = rows[0]!.length;
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const c = pal[row[i]!];
      if (!c) continue;
      ctx.fillStyle = c;
      const ii = flip ? w - 1 - i : i;
      ctx.fillRect(Math.round(x + ii * px), Math.round(y + j * px), Math.ceil(px), Math.ceil(px));
    }
  });
}

const COIN = [
  "...oooo...",
  ".oohhyyoo.",
  ".ohhyyyyo.",
  "ohyyddyyyo",
  "ohyyddyydo",
  "oyyyddyydo",
  "oyyyddyydo",
  ".oyyyyddo.",
  ".oodddddo.",
  "...oooo...",
];
const COIN_PAL = { o: "#6b3d0c", y: "#f5b82e", h: "#fff3a0", d: "#c97d14" };
function coin(ctx: Ctx, cx: number, cy: number, size: number) {
  const px = size / 10;
  sprite(ctx, COIN, COIN_PAL, cx - size / 2, cy - size / 2, px);
}

const FLAME = [
  "....o.....",
  "...oro....",
  "...orro...",
  "..ornro.o.",
  "..ornnroro",
  ".ornnnnrro",
  ".ornnynnro",
  "ornnyyynro",
  "ornyywyyno",
  "ornyywwyno",
  ".ornyyyno.",
  "..oooooo..",
];
const FLAME_PAL = { o: "#7a1d0a", r: "#e8452c", n: "#ff8a1f", y: "#ffd84a", w: "#fff6c8" };
function flame(ctx: Ctx, cx: number, cy: number, size: number, t: number) {
  const px = size / 10;
  const flip = Math.floor(t * 7) % 2 === 1;
  const sy = 1 + Math.sin(t * 18) * 0.04;
  ctx.save();
  ctx.translate(cx, cy + size * 0.6);
  ctx.scale(1, sy);
  sprite(ctx, FLAME, FLAME_PAL, -size / 2, -size * 1.2, px, flip);
  ctx.restore();
}

const SHIELD = [
  "oooooooo",
  "ollbbbbo",
  "olbbbbbo",
  "obbbbbbo",
  "obbbbbdo",
  ".obbbdo.",
  ".obbddo.",
  "..oddo..",
  "...oo...",
];
const SHIELD_PAL = { o: "#1e3a5f", b: "#4a90d9", l: "#cfe8ff", d: "#2f6db0" };

const STAR = [
  "....o....",
  "...oyo...",
  "...oyo...",
  "oooohoooo",
  "oyyyhyyyo",
  ".oyyyyyo.",
  "..oyyyo..",
  ".oyyoyyo.",
  "oyoo.ooyo",
  "oo.....oo",
];
const STAR_PAL = { o: "#6b3d0c", y: "#ffd84a", h: "#fff6c8" };

/** Destellos de cuatro puntas alrededor de un punto (bucle). */
function sparkles(ctx: Ctx, cx: number, cy: number, r: number, t: number, n = 6, color = "#fff6c8") {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + t * 0.8;
    const ph = (t * 2 + i * 0.37) % 1;
    const s = Math.sin(ph * Math.PI) * 14;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r * 0.8;
    ctx.fillStyle = color;
    ctx.fillRect(x - 2, y - s, 4, s * 2);
    ctx.fillRect(x - s, y - 2, s * 2, 4);
  }
}

// ------------------------------------------------------------------ partículas propias (monedas, confeti)

interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  life: number;
  kind: "coin" | "confetti";
  color: string;
  tx?: number;
  ty?: number;
}

const CONFETTI = ["#10b981", "#fbbf24", "#38bdf8", "#f472b6", "#a78bfa", "#ffffff", "#ff8a1f"];

// ------------------------------------------------------------------ escenas del motor

interface Shot {
  scene: Scene;
  canvas: HTMLCanvasElement;
}

function makeShot(w: number, h: number): Shot {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const scene = new Scene(canvas);
  scene.reducedMotion = false;
  return { scene, canvas };
}

const showcase = (id: string) => SHOWCASES.find((s) => s.id === id)!;

function showcaseInput(id: string, room: string, now: number, share = 1, home = true): SceneInput {
  const n = showcase(id);
  const r = roomAt(room, n.level);
  return {
    room: r, style: { ...DEFAULT_STYLE, ...n.styles[r.id] }, level: n.level, trophies: 5,
    placements: n.placements.map((p, i) => ({ ...p, uid: `${n.id}-${i}` })).filter((p) => p.room === r.id),
    students: Math.ceil(studentsForLevel(n.level) / share), librarian: n.level >= 4 && home, cat: n.level >= 3 && home, now,
  };
}

/** Sala principal de una partida que ha llegado a `level` solo con los regalos de cada nivel. */
function progressInput(state: GameState, now: number): SceneInput {
  const itemOf = itemLookup(state);
  const r = state.level === 0 ? roomAt("r1", 0) : roomsForLevel(state.level).find((x) => x.id === "r1")!;
  const placements = state.placements.filter((p) => p.room === "r1").flatMap((p) => {
    const item = itemOf(p.uid);
    return item ? [{ uid: p.uid, itemId: item.id, room: p.room, x: p.x, y: p.y, rot: p.rot }] : [];
  });
  const rooms = state.level === 0 ? 1 : roomsForLevel(state.level).length;
  return {
    room: r, placements, style: { ...DEFAULT_STYLE, ...state.roomStyles.r1 }, level: state.level, trophies: Math.min(5, state.level),
    students: state.level === 0 ? 0 : Math.ceil(studentsForLevel(state.level) / rooms), librarian: state.level >= 4, cat: state.level >= 3, now,
  };
}

function stateAt(level: number, now: number): GameState {
  const s = initialState("anuncio", now);
  return dispatch(s, { type: "dev_set_level", level }, { now }).state;
}

// ------------------------------------------------------------------ mapa estilizado de Madrid

interface Pin {
  x: number;
  y: number;
  pct: number;
  at: number;
}

function drawMadridMap(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  const rand = mulberry32(28013);
  ctx.fillStyle = "#eef0e6";
  ctx.fillRect(0, 0, w, h);
  // Manzanas: rejilla ligeramente girada con calles finas.
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-0.12);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 6;
  for (let x = -w; x < w; x += 46 + rand() * 30) {
    ctx.beginPath();
    ctx.moveTo(x, -h);
    ctx.lineTo(x + rand() * 40 - 20, h);
    ctx.stroke();
  }
  for (let y = -h; y < h; y += 42 + rand() * 30) {
    ctx.beginPath();
    ctx.moveTo(-w, y);
    ctx.lineTo(w, y + rand() * 40 - 20);
    ctx.stroke();
  }
  ctx.restore();
  // Casa de Campo y Retiro.
  ctx.fillStyle = "#c9e2ad";
  ctx.beginPath();
  ctx.ellipse(w * 0.02, h * 0.42, w * 0.2, h * 0.17, 0.2, 0, Math.PI * 2);
  ctx.fill();
  roundRect(ctx, w * 0.62, h * 0.47, w * 0.17, h * 0.12, 22);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(w * 0.3, h * 0.82, w * 0.12, h * 0.05, -0.3, 0, Math.PI * 2);
  ctx.fill();
  // Manzanares.
  ctx.strokeStyle = "#a9d3f0";
  ctx.lineWidth = 18;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(w * 0.12, -10);
  ctx.bezierCurveTo(w * 0.28, h * 0.3, w * 0.12, h * 0.55, w * 0.32, h * 0.7);
  ctx.bezierCurveTo(w * 0.45, h * 0.8, w * 0.5, h * 0.9, w * 0.62, h + 10);
  ctx.stroke();
  // Grandes vías: M-30, Castellana y Gran Vía.
  const road = (draw: () => void) => {
    ctx.strokeStyle = "#e0d3b4";
    ctx.lineWidth = 20;
    draw();
    ctx.stroke();
    ctx.strokeStyle = "#fff7d6";
    ctx.lineWidth = 13;
    draw();
    ctx.stroke();
  };
  road(() => {
    ctx.beginPath();
    ctx.ellipse(w * 0.52, h * 0.52, w * 0.4, h * 0.36, 0.1, 0, Math.PI * 2);
  });
  road(() => {
    ctx.beginPath();
    ctx.moveTo(w * 0.58, -10);
    ctx.lineTo(w * 0.6, h * 0.5);
    ctx.lineTo(w * 0.56, h + 10);
  });
  road(() => {
    ctx.beginPath();
    ctx.moveTo(w * 0.25, h * 0.44);
    ctx.lineTo(w * 0.6, h * 0.4);
    ctx.lineTo(w + 10, h * 0.33);
  });
  return c;
}

function drawPin(ctx: Ctx, x: number, y: number, pct: number, scale: number, big = 1) {
  if (scale <= 0.001) return;
  const { bg, fg } = pinColor(pct);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale * big, scale * big);
  const label = `${pct}%`;
  ctx.font = font(26, 800);
  const w = ctx.measureText(label).width + 28;
  const h = 42;
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  roundRect(ctx, -w / 2 + 2, -h - 12 + 4, w, h, 21);
  ctx.fill();
  ctx.fillStyle = bg;
  roundRect(ctx, -w / 2, -h - 12, w, h, 21);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-9, -14);
  ctx.lineTo(9, -14);
  ctx.lineTo(0, 0);
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 4;
  roundRect(ctx, -w / 2, -h - 12, w, h, 21);
  ctx.stroke();
  ctx.fillStyle = fg;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 0, -h / 2 - 11);
  ctx.restore();
}

// ------------------------------------------------------------------ teléfono

const PHONE = { x: 150, y: 560, w: 780, h: 1240, r: 90 };

function phoneFrame(ctx: Ctx, draw: (x: number, y: number, w: number, h: number) => void) {
  const { x, y, w, h, r } = PHONE;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  roundRect(ctx, x + 14, y + 22, w, h, r);
  ctx.fill();
  ctx.fillStyle = "#16181d";
  roundRect(ctx, x - 16, y - 16, w + 32, h + 32, r + 14);
  ctx.fill();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  draw(x, y, w, h);
  ctx.restore();
  // Isla dinámica.
  ctx.fillStyle = "#16181d";
  roundRect(ctx, x + w / 2 - 90, y + 18, 180, 46, 23);
  ctx.fill();
}

// ------------------------------------------------------------------ anuncio

export interface Promo {
  frames: number;
  fps: number;
  musicStart: number;
  bpm: number;
  cues: Cue[];
  renderFrame(i: number): void;
}

const LIBRARY_NAME = "Biblioteca Pública María Moliner";

const BUILD_STEPS: { at: number; level: number; play: Cinematic; sub: string }[] = [
  { at: 14, level: 1, play: "build", sub: "¡Tu primera sala!" },
  { at: 17, level: 3, play: "cat", sub: "¡Llega el gato!" },
  { at: 18.5, level: 5, play: "opening", sub: "Más estudiantes" },
  { at: 20, level: 10, play: "opening", sub: "Salas más grandes" },
];

export async function createPromo(canvas: HTMLCanvasElement): Promise<Promo> {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const day = madridDateKey(Date.now());
  const noon = phaseInstant(day, "day");
  const { sunrise, sunset } = sunTimes(day);

  const loadImage = (src: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  const logo = await loadImage("/icon-512.png");
  const mark = await loadImage("/icon-mark.png");
  const SHOP_IDS = ["L005", "L007", "E017", "L010", "E008", "L009", "E013", "L002", "E012"];
  const thumbs = new Map<string, HTMLImageElement>();
  for (const id of SHOP_IDS) thumbs.set(id, await loadImage(itemThumbnail(id)));
  await document.fonts.ready;

  // Mapa y pines (datos ilustrativos).
  const mapW = PHONE.w;
  const mapH = PHONE.h - 230;
  const map = drawMadridMap(mapW, mapH);
  const rand = mulberry32(105);
  const pins: Pin[] = [];
  for (let i = 0; i < 22; i++) {
    const r = rand();
    const pct = r < 0.55 ? Math.round(18 + rand() * 50) : r < 0.75 ? Math.round(70 + rand() * 18) : r < 0.9 ? Math.round(90 + rand() * 9) : 100;
    pins.push({ x: 60 + rand() * (mapW - 120), y: 90 + rand() * (mapH - 160), pct, at: 3.15 + i * 0.075 });
  }
  const hero: Pin = { x: mapW * 0.5, y: mapH * 0.5, pct: 23, at: 3.0 };

  // Escenas del motor.
  const roomShot = makeShot(W, 1240);
  const fullShot = makeShot(W, H);
  const crowded = showcaseInput("muestra-infinita", "r1", noon, 1);
  crowded.students = 18;
  const levelStates = new Map<number, GameState>();
  for (const l of [0, 1, 3, 5, 10]) levelStates.set(l, stateAt(l, noon));
  const infinita = SHOWCASES.find((s) => s.id === "muestra-infinita")!;
  const infinitaOverview = infinita.rooms.map((id, i) => ({ ...showcaseInput(infinita.id, id, noon, infinita.rooms.length, i === 0), locked: false }));

  // ---------------------------------------------------------------- guion
  // Cada plano: inicio, fin, preparación (al entrar) y dibujo.
  interface Plan {
    start: number;
    end: number;
    enter?: () => void;
    draw: (t: number) => void;
  }

  const cues: Cue[] = [];
  // Los efectos se anotan una sola vez, en una pasada previa por todos los planos.
  let recording = true;
  const cue = (t: number, kind: CueKind) => {
    if (recording) cues.push({ t, kind });
  };
  let bits: Bit[] = [];
  const coinBurst = (t: number, x: number, y: number, n: number, tx: number, ty: number) => {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const s = 600 + Math.random() * 700;
      bits.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, born: t + i * 0.012, life: 1.3, kind: "coin", color: "", tx, ty });
    }
  };
  const confetti = (t: number, x: number, y: number, n: number) => {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.6;
      const s = 500 + Math.random() * 900;
      bits.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, born: t, life: 2.2, kind: "confetti", color: CONFETTI[i % CONFETTI.length]! });
    }
  };

  /** Fondo cálido como la pantalla del juego, con rayos que giran. */
  const warmBg = (t: number, top = "#3b2a20", bottom = "#1d1410", rays = true) => {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, top);
    g.addColorStop(1, bottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    if (!rays) return;
    ctx.save();
    ctx.translate(W / 2, H * 0.55);
    ctx.rotate(t * 0.25);
    ctx.fillStyle = "rgba(255,216,74,0.05)";
    for (let i = 0; i < 12; i++) {
      ctx.rotate((Math.PI * 2) / 12);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-120, -1600);
      ctx.lineTo(120, -1600);
      ctx.fill();
    }
    ctx.restore();
  };

  const drawShot = (shot: Shot, y: number, zoom = 1, alpha = 1) => {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(W / 2, y + shot.canvas.height / 2);
    ctx.scale(zoom, zoom);
    ctx.drawImage(shot.canvas, -shot.canvas.width / 2, -shot.canvas.height / 2);
    ctx.restore();
  };

  const levelBadge = (t: number, start: number, level: number, sub?: string) => {
    const s = pop(t, start, 0.35);
    if (!s) return;
    ctx.save();
    ctx.translate(W / 2, 1600);
    ctx.scale(s, s);
    ctx.rotate(-0.04);
    const label = `NIVEL ${level}`;
    ctx.font = font(78);
    const w = ctx.measureText(label).width + 90;
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    roundRect(ctx, -w / 2 + 8, -58 + 10, w, 116, 30);
    ctx.fill();
    ctx.fillStyle = GOLD;
    roundRect(ctx, -w / 2, -58, w, 116, 30);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 8;
    ctx.stroke();
    text(ctx, label, 0, 4, 78, INK, "center", 900);
    if (sub) caption(ctx, sub, 0, 120, 52);
    ctx.restore();
  };

  const coinCounter = (t: number, value: number, start: number) => {
    const s = pop(t, start, 0.3);
    if (!s) return;
    ctx.save();
    ctx.translate(W / 2, 470);
    ctx.scale(s * (1 + beatPulse(t) * 0.04), s * (1 + beatPulse(t) * 0.04));
    ctx.fillStyle = "rgba(20,14,10,0.85)";
    roundRect(ctx, -170, -55, 340, 110, 55);
    ctx.fill();
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 5;
    ctx.stroke();
    coin(ctx, -95, 0, 70);
    text(ctx, `${value}`, 0, 4, 70, GOLD, "left", 900);
    ctx.restore();
  };

  const plans: Plan[] = [
    // 0–3 s · GANCHO: sala abarrotada, «100 %» en rojo.
    {
      start: 0, end: 3,
      enter: () => {
        roomShot.scene.setInput(crowded);
        roomShot.scene.zoom = 1.75;
        cue(0, "boom");
        cue(1.25, "whoosh");
        cue(1.55, "stamp");
      },
      draw: (t) => {
        warmBg(t, "#3a1414", "#140808", false);
        const shake = t > 1.55 && t < 1.9 ? Math.sin(t * 90) * 14 * (1.9 - t) * 3 : 0;
        ctx.save();
        ctx.translate(shake, 0);
        drawShot(roomShot, 540, 1 + t * 0.02);
        // Velo rojo que late.
        ctx.fillStyle = `rgba(220,38,38,${0.12 + 0.08 * Math.sin(t * 9)})`;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
        caption(ctx, "¿Llegas a la biblio…", W / 2, 300, 92, pop(t, 0.1));
        caption(ctx, "…y está *LLENA*? 😩", W / 2, 430, 104, pop(t, 1.25), { hl: "#ff5a4a" });
        // Sello «100 %».
        const s = t < 1.55 ? 0 : 1 + 1.4 * (1 - easeOutCubic((t - 1.55) / 0.18));
        if (s) {
          ctx.save();
          ctx.translate(W / 2, 1180);
          ctx.rotate(-0.16);
          ctx.scale(s, s);
          ctx.globalAlpha = clamp01((t - 1.55) / 0.08);
          ctx.strokeStyle = RED;
          ctx.lineWidth = 18;
          roundRect(ctx, -260, -120, 520, 240, 30);
          ctx.stroke();
          ctx.fillStyle = "rgba(220,38,38,0.88)";
          ctx.fill();
          text(ctx, "100%", 0, -14, 150, "#ffffff", "center", 900);
          text(ctx, "COMPLETA", 0, 82, 48, "#ffe0dc", "center", 900);
          ctx.restore();
        }
      },
    },
    // 3–9 s · AFORO REAL: mapa con pines y tarjeta de una biblioteca.
    {
      start: 3, end: 9,
      enter: () => {
        cue(3, "whoosh");
        pins.forEach((p, i) => i % 2 === 0 && cue(p.at, "pop"));
        cue(4.9, "tap");
        cue(5.15, "sparkle");
        cue(7, "whoosh");
        for (let k = 0; k < 10; k++) cue(7.2 + k * 0.08, "tick");
      },
      draw: (t) => {
        warmBg(t, "#123a2c", "#071a13");
        // Zoom al pin protagonista y vuelta.
        const zin = easeInOut((t - 4.7) / 0.5) * (1 - easeInOut((t - 6.9) / 0.4));
        phoneFrame(ctx, (x, y, w, h) => {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(x, y, w, h);
          // Cabecera de la app.
          ctx.drawImage(mark, x + 44, y + 92, 64, 64);
          text(ctx, "BiblioRadar", x + 124, y + 124, 40, "#0f172a", "left", 900);
          text(ctx, "Madrid", x + 352, y + 124, 40, "#94a3b8", "left", 700);
          const live = 0.6 + 0.4 * Math.sin(t * 8);
          ctx.fillStyle = `rgba(16,185,129,${live})`;
          ctx.beginPath();
          ctx.arc(x + w - 190, y + 124, 10, 0, Math.PI * 2);
          ctx.fill();
          text(ctx, "En vivo", x + w - 170, y + 126, 30, "#475569", "left", 700);
          ctx.fillStyle = "#f1f5f9";
          roundRect(ctx, x + 36, y + 170, w - 72, 70, 26);
          ctx.fill();
          text(ctx, "Busca biblioteca o distrito…", x + 80, y + 206, 30, "#94a3b8", "left", 500);
          // Mapa.
          const my = y + 230;
          ctx.save();
          ctx.beginPath();
          ctx.rect(x, my, w, h - 230);
          ctx.clip();
          const z = 1 + zin * 0.7;
          const fx = lerp(w / 2, hero.x, zin);
          const fy = lerp((h - 230) / 2, hero.y, zin);
          ctx.translate(x + w / 2, my + (h - 230) / 2);
          ctx.scale(z, z);
          ctx.translate(-fx, -fy);
          ctx.drawImage(map, 0, 0);
          for (const p of pins) drawPin(ctx, p.x, p.y, p.pct, (1.25 * pop(t, p.at, 0.3)) / z ** 0.5);
          const heroPulse = 1 + 0.08 * Math.sin(t * 10) * fadeIn(t, 4.6);
          drawPin(ctx, hero.x, hero.y, hero.pct, pop(t, 3.0, 0.3) / z ** 0.5, 1.7 * heroPulse);
          if (t > 4.9 && t < 5.5) {
            ctx.strokeStyle = `rgba(255,255,255,${1 - (t - 4.9) / 0.6})`;
            ctx.lineWidth = 8 / z;
            ctx.beginPath();
            ctx.arc(hero.x, hero.y - 30, 30 + ((t - 4.9) / 0.6) * 90, 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.restore();
          text(ctx, "Datos ilustrativos", x + 40, y + h - 34, 24, "rgba(51,65,85,0.75)", "left", 600);
          // Hoja inferior con la biblioteca.
          const sheet = easeOutCubic((t - 5.05) / 0.35) * (1 - easeInOut((t - 6.9) / 0.3));
          if (sheet > 0) {
            const sy = y + h - sheet * 470;
            ctx.fillStyle = "rgba(0,0,0,0.18)";
            roundRect(ctx, x, sy - 8, w, 500, 46);
            ctx.fill();
            ctx.fillStyle = "#ffffff";
            roundRect(ctx, x, sy, w, 500, 46);
            ctx.fill();
            ctx.fillStyle = "#e2e8f0";
            roundRect(ctx, x + w / 2 - 50, sy + 18, 100, 10, 5);
            ctx.fill();
            text(ctx, LIBRARY_NAME, x + 48, sy + 82, 36, "#0f172a", "left", 800);
            const shown = Math.round(lerp(0, hero.pct, easeOutCubic((t - 5.2) / 0.6)));
            text(ctx, `${shown}%`, x + 48, sy + 200, 130, GREEN, "left", 900);
            ctx.fillStyle = "#d1fae5";
            roundRect(ctx, x + 330, sy + 150, 250, 64, 32);
            ctx.fill();
            text(ctx, "Hay sitio", x + 455, sy + 184, 34, "#065f46", "center", 800);
            ctx.fillStyle = "#e2e8f0";
            roundRect(ctx, x + 48, sy + 290, w - 96, 26, 13);
            ctx.fill();
            ctx.fillStyle = GREEN;
            roundRect(ctx, x + 48, sy + 290, (w - 96) * (shown / 100), 26, 13);
            ctx.fill();
            ctx.fillStyle = `rgba(16,185,129,${live})`;
            ctx.beginPath();
            ctx.arc(x + 60, sy + 370, 10, 0, Math.PI * 2);
            ctx.fill();
            text(ctx, "En vivo · actualizado hace 2 min", x + 84, sy + 372, 30, "#475569", "left", 600);
          }
        });
        caption(ctx, "Mira el *AFORO REAL*", W / 2, 230, 96, pop(t, 3.05));
        if (t < 7) caption(ctx, "antes de salir de casa", W / 2, 360, 70, pop(t, 3.45), { rot: -0.02 });
        else {
          const n = Math.round(lerp(0, 105, easeOutCubic((t - 7.1) / 0.8)));
          caption(ctx, `de *${n}* bibliotecas de Madrid`, W / 2, 360, 66, pop(t, 7.05));
        }
      },
    },
    // 9–13 s · REPORTE: dos toques y monedas.
    {
      start: 9, end: 13,
      enter: () => {
        cue(9, "whoosh");
        cue(10.3, "tap");
        cue(10.55, "coin");
        for (let k = 0; k < 6; k++) cue(10.7 + k * 0.1, "coin");
        cue(11.6, "sparkle");
      },
      draw: (t) => {
        warmBg(t, "#3b2a20", "#120c08");
        const thanks = t >= 10.55;
        phoneFrame(ctx, (x, y, w, h) => {
          ctx.fillStyle = "#f8fafc";
          ctx.fillRect(x, y, w, h);
          text(ctx, LIBRARY_NAME, x + 48, y + 150, 36, "#0f172a", "left", 800);
          text(ctx, "¿Cómo está ahora?", x + 48, y + 236, 56, "#0f172a", "left", 900);
          if (!thanks) {
            REPORT_OPTIONS.forEach((o, i) => {
              const s = pop(t, 9.25 + i * 0.09, 0.25);
              if (!s) return;
              const by = y + 320 + i * 150;
              const pressed = i === 1 && t > 10.3;
              ctx.save();
              ctx.translate(x + w / 2, by + 60);
              ctx.scale(s * (pressed ? 0.95 : 1), s * (pressed ? 0.95 : 1));
              ctx.fillStyle = pressed ? "#0f172a" : "#ffffff";
              roundRect(ctx, -w / 2 + 40, -60, w - 80, 120, 30);
              ctx.fill();
              ctx.strokeStyle = "#e2e8f0";
              ctx.lineWidth = 3;
              ctx.stroke();
              ctx.fillStyle = pinColor(o.value).bg;
              ctx.beginPath();
              ctx.arc(-w / 2 + 100, 0, 18, 0, Math.PI * 2);
              ctx.fill();
              text(ctx, o.label, -w / 2 + 140, -14, 40, pressed ? "#ffffff" : "#0f172a", "left", 800);
              text(ctx, o.description, -w / 2 + 140, 28, 26, pressed ? "#cbd5e1" : "#64748b", "left", 500);
              ctx.restore();
            });
            if (t > 10.3 && t < 10.8) {
              const k = (t - 10.3) / 0.5;
              ctx.strokeStyle = `rgba(16,185,129,${1 - k})`;
              ctx.lineWidth = 10;
              ctx.beginPath();
              ctx.arc(x + w / 2 + 120, y + 320 + 150 + 60, 20 + k * 120, 0, Math.PI * 2);
              ctx.stroke();
            }
          } else {
            const s = pop(t, 10.55, 0.35);
            ctx.save();
            ctx.translate(x + w / 2, y + 640);
            ctx.scale(s, s);
            ctx.fillStyle = "#d1fae5";
            ctx.beginPath();
            ctx.arc(0, -40, 120, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = GREEN;
            ctx.lineWidth = 22;
            ctx.lineCap = "round";
            ctx.beginPath();
            ctx.moveTo(-55, -40);
            ctx.lineTo(-12, 5);
            ctx.lineTo(60, -85);
            ctx.stroke();
            text(ctx, "¡Gracias!", 0, 160, 70, "#0f172a", "center", 900);
            text(ctx, "Has indicado que hay bastante sitio", 0, 240, 30, "#64748b", "center", 600);
            ctx.restore();
          }
        });
        if (t >= 10.55 && t < 10.6 && !bits.some((b) => b.kind === "coin")) coinBurst(t, W / 2, 1150, 14, W / 2 - 95, 470);
        const got = bits.filter((b) => b.kind === "coin" && t - b.born > 0.75).length;
        coinCounter(t, Math.min(10, got), 10.55);
        caption(ctx, "Reporta en *2 toques*", W / 2, 260, 96, pop(t, 9.1));
        if (t >= 10.55) caption(ctx, "+10 monedas", W / 2, 1600, 110, pop(t, 10.6), { fill: GOLD });
      },
    },
    // 13–23 s · CONSTRUYE: del solar al nivel 15.
    {
      start: 13, end: 21.5,
      enter: () => {
        roomShot.scene.setInput(progressInput(levelStates.get(0)!, noon));
        roomShot.scene.zoom = 1.45;
        cue(13, "whoosh");
        for (const s of BUILD_STEPS) {
          cue(s.at, "levelup");
          cue(s.at, "boom");
        }
      },
      draw: (t) => {
        warmBg(t);
        const steps = BUILD_STEPS;
        let current = 0;
        let sub: string | undefined;
        let since = 13;
        for (const s of steps) {
          if (t >= s.at) {
            current = s.level;
            sub = s.sub;
            since = s.at;
          }
          if (Math.abs(t - s.at) < 0.5 / FPS) {
            roomShot.scene.setInput(progressInput(levelStates.get(s.level)!, noon));
            roomShot.scene.zoom = s.level >= 10 ? 1.3 : 1.45;
            roomShot.scene.play(s.play);
            confetti(t, W / 2, 1250, 60);
          }
        }
        const punch = 1 + 0.06 * (1 - easeOutCubic((t - since) / 0.35));
        drawShot(roomShot, 480, punch);
        caption(ctx, "Cada reporte *construye*", W / 2, 250, 88, pop(t, 13.1));
        caption(ctx, "TU biblioteca", W / 2, 375, 110, pop(t, 13.4), { fill: GOLD, rot: -0.03 });
        if (current === 0) {
          caption(ctx, "Un solar vacío… por ahora", W / 2, 1600, 54, pop(t, 13.5));
        } else levelBadge(t, since, current, sub);
      },
    },
    {
      start: 21.5, end: 23,
      enter: () => {
        fullShot.scene.setOverview(infinitaOverview);
        cue(21.5, "levelup");
        cue(21.5, "boom");
        confetti(21.5, W / 2, 900, 120);
        fullShot.scene.burst();
      },
      draw: (t) => {
        warmBg(t, "#1d2a44", "#0b1020");
        drawShot(fullShot, 0, 1.05 + (t - 21.5) * 0.05);
        caption(ctx, "¡Hasta *4 salas*", W / 2, 260, 100, pop(t, 21.55));
        caption(ctx, "en 2 plantas!", W / 2, 385, 100, pop(t, 21.75), { fill: GOLD });
        levelBadge(t, 21.6, 15);
      },
    },
    // 23–25 s · RACHA.
    {
      start: 23, end: 25,
      enter: () => {
        cue(23, "whoosh");
        for (let k = 0; k < 7; k++) cue(23.25 + k * 0.125, "tick");
        cue(24.2, "sparkle");
      },
      draw: (t) => {
        warmBg(t, "#4a1a0c", "#160604");
        const days = Math.min(7, Math.max(1, Math.floor((t - 23.25) / 0.125) + 1));
        const big = 340 * (1 + beatPulse(t) * 0.05) * pop(t, 23.05, 0.35);
        if (big > 0) {
          ctx.save();
          ctx.shadowColor = "rgba(255,138,31,0.8)";
          ctx.shadowBlur = 80;
          flame(ctx, W / 2, 880, big, t);
          ctx.restore();
        }
        caption(ctx, `${days}`, W / 2, 1040, 220, pop(t, 23.25, 0.2) * (1 + 0.12 * (1 - clamp01(((t - 23.25) % 0.125) / 0.1))), { fill: GOLD });
        caption(ctx, "días de racha", W / 2, 1210, 76, pop(t, 23.3));
        const labels = ["L", "M", "X", "J", "V", "S", "D"];
        labels.forEach((l, i) => {
          const s = pop(t, 23.25 + i * 0.125, 0.2);
          if (!s) return;
          const cx = W / 2 + (i - 3) * 120;
          ctx.save();
          ctx.translate(cx, 1360);
          ctx.scale(s, s);
          ctx.fillStyle = "#ff8a1f";
          ctx.beginPath();
          ctx.arc(0, 0, 48, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = GOLD;
          ctx.lineWidth = 6;
          ctx.stroke();
          text(ctx, l, 0, 3, 44, "#ffffff", "center", 900);
          ctx.restore();
        });
        const sh = pop(t, 24.2, 0.3);
        if (sh) {
          ctx.save();
          ctx.translate(W / 2, 1520);
          ctx.scale(sh, sh);
          for (let i = 0; i < 3; i++) sprite(ctx, SHIELD, SHIELD_PAL, -230 + i * 72, -40, 8);
          text(ctx, "Protectores", 30, 0, 50, "#cfe8ff", "left", 900);
          ctx.restore();
        }
        caption(ctx, "Mantén tu *racha*", W / 2, 300, 104, pop(t, 23.05));
      },
    },
    // 25–27 s · TIENDA.
    {
      start: 25, end: 27,
      enter: () => {
        cue(25, "whoosh");
        SHOP_IDS.forEach((_, i) => cue(25.2 + i * 0.1, "pop"));
        cue(26.3, "sparkle");
      },
      draw: (t) => {
        warmBg(t, "#2c1d3f", "#100a1a");
        const RAR: Record<string, string> = { L: "#ffb627", E: "#b57bff", R: "#4aa8ff", P: "#9aa4b2" };
        SHOP_IDS.forEach((id, i) => {
          const item = findItem(id)!;
          const s = pop(t, 25.2 + i * 0.1, 0.3);
          if (!s) return;
          const col = i % 3;
          const row = Math.floor(i / 3);
          const cx = 210 + col * 330;
          const cy = 690 + row * 370;
          ctx.save();
          ctx.translate(cx, cy);
          ctx.scale(s, s);
          ctx.rotate(((i % 2) - 0.5) * 0.04);
          ctx.fillStyle = "#fff6e3";
          roundRect(ctx, -145, -165, 290, 330, 30);
          ctx.fill();
          ctx.strokeStyle = RAR[item.rarity] ?? "#ffffff";
          ctx.lineWidth = 10;
          ctx.stroke();
          if (item.rarity === "L") sparkles(ctx, 0, -40, 150, t + i, 4, "#ffd84a");
          const img = thumbs.get(id)!;
          const k = Math.min(230 / img.width, 170 / img.height);
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(img, -(img.width * k) / 2, -40 - (img.height * k) / 2, img.width * k, img.height * k);
          ctx.imageSmoothingEnabled = true;
          ctx.fillStyle = RAR[item.rarity] ?? "#ffffff";
          roundRect(ctx, -110, 70, 220, 40, 20);
          ctx.fill();
          text(ctx, RARITY_LABEL[item.rarity].toUpperCase(), 0, 91, 22, INK, "center", 900);
          coin(ctx, -48, 135, 34);
          text(ctx, `${item.price}`, -24, 137, 32, INK, "left", 900);
          ctx.restore();
        });
        caption(ctx, `+${Math.floor(ALL_ITEMS.length / 10) * 10} muebles`, W / 2, 250, 108, pop(t, 25.05));
        caption(ctx, "¡y algunos *legendarios*!", W / 2, 375, 74, pop(t, 25.4), { hl: "#ffb627" });
      },
    },
    // 27–29 s · MISIONES Y LOGROS.
    {
      start: 27, end: 29,
      enter: () => {
        cue(27, "whoosh");
        [27.35, 27.6, 27.85].forEach((at) => cue(at, "check"));
        cue(28.25, "levelup");
      },
      draw: (t) => {
        warmBg(t, "#123048", "#06121c");
        const list = [getMission("D01"), getMission("D18"), getMission("W01")];
        list.forEach((m, i) => {
          const s = pop(t, 27.1 + i * 0.12, 0.3);
          if (!s) return;
          const done = t > 27.35 + i * 0.25;
          ctx.save();
          ctx.translate(W / 2, 640 + i * 190);
          ctx.scale(s, s);
          ctx.fillStyle = done ? "#d1fae5" : "#fff6e3";
          roundRect(ctx, -420, -75, 840, 150, 34);
          ctx.fill();
          ctx.strokeStyle = done ? GREEN : "#e0d3b4";
          ctx.lineWidth = 6;
          ctx.stroke();
          ctx.fillStyle = done ? GREEN : "#ffffff";
          ctx.beginPath();
          ctx.arc(-335, 0, 40, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = done ? GREEN : "#cbd5e1";
          ctx.stroke();
          if (done) {
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 10;
            ctx.lineCap = "round";
            ctx.beginPath();
            ctx.moveTo(-355, 0);
            ctx.lineTo(-340, 16);
            ctx.lineTo(-312, -16);
            ctx.stroke();
          }
          text(ctx, m.name, -270, -18, 44, INK, "left", 900);
          text(ctx, m.goal.length > 30 ? `${m.goal.slice(0, 29)}…` : m.goal, -270, 28, 28, "#64748b", "left", 600);
          coin(ctx, 290, 0, 50);
          text(ctx, `+${m.reward}`, 325, 3, 44, "#b45309", "left", 900);
          ctx.restore();
        });
        const a = pop(t, 28.25, 0.35);
        if (a) {
          ctx.save();
          ctx.translate(W / 2, 1290);
          ctx.scale(a, a);
          ctx.fillStyle = "rgba(20,14,10,0.9)";
          roundRect(ctx, -400, -95, 800, 190, 40);
          ctx.fill();
          ctx.strokeStyle = GOLD;
          ctx.lineWidth = 6;
          ctx.stroke();
          sprite(ctx, STAR, STAR_PAL, -360, -50, 11);
          text(ctx, "¡Logro desbloqueado!", -230, -26, 34, GOLD, "left", 800);
          text(ctx, ACHIEVEMENTS[0]!.name, -230, 28, 52, "#ffffff", "left", 900);
          sparkles(ctx, -310, 0, 90, t, 5);
          ctx.restore();
        }
        caption(ctx, "Misiones diarias", W / 2, 250, 100, pop(t, 27.05));
        caption(ctx, `y *${ACHIEVEMENTS.length} logros*`, W / 2, 375, 100, pop(t, 27.3));
      },
    },
    // 29–31 s · VISITAR.
    {
      start: 29, end: 31,
      enter: () => {
        roomShot.scene.setInput(showcaseInput("muestra-vinilo", "r1", noon));
        roomShot.scene.zoom = 1.55;
        cue(29, "whoosh");
        cue(30, "whoosh");
      },
      draw: (t) => {
        warmBg(t, "#2a1f1a", "#0e0a08");
        if (Math.abs(t - 30) < 0.5 / FPS) roomShot.scene.setInput(showcaseInput("muestra-observatorio", "r1", noon));
        const since = t < 30 ? 29 : 30;
        drawShot(roomShot, 480, 1 + 0.05 * (1 - easeOutCubic((t - since) / 0.3)) + (t - since) * 0.03);
        const name = t < 30 ? "Café Vinilo" : "Observatorio de Medianoche";
        const s = pop(t, since + 0.05, 0.3);
        if (s) {
          ctx.save();
          ctx.translate(W / 2, 1560);
          ctx.scale(s, s);
          ctx.font = font(50, 900);
          const w = ctx.measureText(name).width + 80;
          ctx.fillStyle = "rgba(20,14,10,0.85)";
          roundRect(ctx, -w / 2, -45, w, 90, 45);
          ctx.fill();
          text(ctx, name, 0, 3, 50, CREAM, "center", 900);
          ctx.restore();
        }
        caption(ctx, "Visita otras bibliotecas", W / 2, 250, 86, pop(t, 29.05));
        caption(ctx, "e *inspírate*", W / 2, 370, 96, pop(t, 29.3));
      },
    },
    // 31–35 s · LUZ DE MADRID: amanecer → día → atardecer → noche.
    {
      start: 31, end: 35,
      enter: () => {
        roomShot.scene.setInput(showcaseInput("muestra-invernadero", "r1", sunrise - 30 * 60_000, 2));
        roomShot.scene.zoom = 1.5;
        cue(31, "whoosh");
        cue(34, "sparkle");
      },
      draw: (t) => {
        const k = clamp01((t - 31.2) / 3.4);
        const keys = [sunrise - 40 * 60_000, sunrise + 30 * 60_000, noon, sunset - 50 * 60_000, sunset + 10 * 60_000, sunset + 100 * 60_000];
        const seg = Math.min(keys.length - 2, Math.floor(k * (keys.length - 1)));
        const now = lerp(keys[seg]!, keys[seg + 1]!, easeInOut(k * (keys.length - 1) - seg));
        const night = now < sunrise || now > sunset + 20 * 60_000;
        warmBg(t, night ? "#141a3a" : "#3b2a20", night ? "#05070f" : "#120c08", false);
        roomShot.scene.setInput(showcaseInput("muestra-invernadero", "r1", now, 2));
        drawShot(roomShot, 480);
        const clock = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" }).format(now);
        const s = pop(t, 31.15, 0.3);
        if (s) {
          ctx.save();
          ctx.translate(W / 2, 1560);
          ctx.scale(s, s);
          ctx.fillStyle = "rgba(10,10,20,0.8)";
          roundRect(ctx, -170, -55, 340, 110, 55);
          ctx.fill();
          text(ctx, clock, 0, 4, 70, night ? "#cfe8ff" : GOLD, "center", 900);
          ctx.restore();
        }
        caption(ctx, "Amanece y anochece", W / 2, 250, 92, pop(t, 31.05));
        caption(ctx, "con *Madrid*", W / 2, 375, 108, pop(t, 31.3), { hl: night ? "#9cd0ff" : GOLD });
      },
    },
    // 35–41 s · LLAMADA A LA ACCIÓN.
    {
      start: 35, end: DURATION,
      enter: () => {
        fullShot.scene.setOverview(infinitaOverview.map((i) => ({ ...i, now: noon })));
        cue(35, "boom");
        cue(35.15, "levelup");
        cue(36.1, "pop");
        cue(36.6, "pop");
        cue(37.4, "sparkle");
        confetti(35.15, W / 2, 700, 140);
      },
      draw: (t) => {
        warmBg(t, "#3b2a20", "#120c08");
        drawShot(fullShot, 0, 1.15, 0.35);
        ctx.fillStyle = "rgba(18,12,8,0.45)";
        ctx.fillRect(0, 0, W, H);
        const s = pop(t, 35.15, 0.45);
        if (s) {
          const size = 430 * s * (1 + beatPulse(t) * 0.03);
          const bob = Math.sin(t * 3) * 10;
          ctx.save();
          ctx.shadowColor = "rgba(0,0,0,0.5)";
          ctx.shadowBlur = 50;
          ctx.shadowOffsetY = 20;
          ctx.drawImage(logo, W / 2 - size / 2, 560 - size / 2 + bob, size, size);
          ctx.restore();
          sparkles(ctx, W / 2, 560 + bob, 300, t, 8, GOLD);
        }
        caption(ctx, "BiblioRadar *Madrid*", W / 2, 230, 100, pop(t, 35.4));
        caption(ctx, "Aforo real de *105 bibliotecas*", W / 2, 920, 62, pop(t, 36.1));
        caption(ctx, "+ tu biblioteca pixel art", W / 2, 1020, 62, pop(t, 36.6), { fill: CREAM });
        const b = pop(t, 37.4, 0.35);
        if (b) {
          const pulse = 1 + 0.05 * Math.sin((t - 37.4) * 8);
          ctx.save();
          ctx.translate(W / 2, 1200);
          ctx.scale(b * pulse, b * pulse);
          ctx.fillStyle = "rgba(0,0,0,0.4)";
          roundRect(ctx, -330 + 8, -75 + 12, 660, 150, 75);
          ctx.fill();
          ctx.fillStyle = GREEN;
          roundRect(ctx, -330, -75, 660, 150, 75);
          ctx.fill();
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 8;
          ctx.stroke();
          text(ctx, "¡Pruébala gratis!", 0, 4, 66, "#ffffff", "center", 900);
          ctx.restore();
        }
        const u = fadeIn(t, 37.8, 0.3);
        if (u) {
          ctx.globalAlpha = u;
          text(ctx, "biblioradar-madrid.vercel.app", W / 2, 1350, 48, CREAM, "center", 800);
          ctx.globalAlpha = 1;
        }
        // Fundido final a negro.
        const out = clamp01((t - (DURATION - 0.6)) / 0.6);
        if (out) {
          ctx.fillStyle = `rgba(0,0,0,${out})`;
          ctx.fillRect(0, 0, W, H);
        }
      },
    },
  ];

  // Los efectos de sonido no dependen de los fotogramas: se anotan todos al principio.
  for (const p of plans) p.enter?.();
  recording = false;
  const sfxCues = [...cues].sort((a, b) => a.t - b.t);
  // `enter` también prepara escenas y partículas: se vuelve a llamar al entrar en cada plano.
  bits = [];
  const entered = new Set<Plan>();

  const dt = 1 / FPS;
  let last = -1;
  const renderFrame = (i: number) => {
    if (i !== last + 1) throw new Error(`Los fotogramas van en orden: se esperaba ${last + 1} y llegó ${i}`);
    last = i;
    const t = i / FPS;
    const plan = plans.find((p) => t >= p.start && t < p.end) ?? plans[plans.length - 1]!;
    if (!entered.has(plan)) {
      entered.add(plan);
      plan.enter?.();
      // Arranque del plano: la escena corre un poco para que todo esté en marcha.
      if (plan.start === 21.5 || plan.start === 35) for (let k = 0; k < 8; k++) fullShot.scene.step(dt);
    }
    // Escenas del motor: un paso por fotograma.
    const usesFull = plan.start === 21.5 || plan.start === 35;
    (usesFull ? fullShot : roomShot).scene.step(dt);
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    plan.draw(t);
    // Partículas propias por encima de todo.
    bits = bits.filter((b) => t - b.born < b.life);
    for (const b of bits) {
      const age = t - b.born;
      if (age < 0) continue;
      if (b.kind === "coin") {
        // Salen disparadas y luego vuelan al contador.
        const fly = easeInOut((age - 0.35) / 0.45);
        const px = b.x + b.vx * Math.min(age, 0.35) * 0.6;
        const py = b.y + b.vy * Math.min(age, 0.35) * 0.6 + 900 * Math.min(age, 0.35) ** 2;
        const x = lerp(px, b.tx!, fly);
        const y = lerp(py, b.ty!, fly);
        if (age < 0.8) coin(ctx, x, y, 64 * (1 - fly * 0.4));
      } else {
        const x = b.x + b.vx * age * 0.7;
        const y = b.y + b.vy * age * 0.7 + 700 * age * age;
        ctx.globalAlpha = clamp01((b.life - age) / 0.5);
        ctx.fillStyle = b.color;
        const flip = Math.floor(age * 10 + b.x) % 2 === 0;
        ctx.fillRect(x, y, flip ? 18 : 10, 24);
        ctx.globalAlpha = 1;
      }
    }
    // Destello blanco en los cortes.
    const cut = plans.find((p) => p.start > 0 && t >= p.start && t < p.start + 0.12);
    if (cut) {
      ctx.fillStyle = `rgba(255,255,255,${0.55 * (1 - (t - cut.start) / 0.12)})`;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  };

  return { frames: FRAMES, fps: FPS, musicStart: MUSIC_START, bpm: BPM, cues: sfxCues, renderFrame };
}
