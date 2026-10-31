/**
 * Personajes pixel art (estudiantes, bibliotecaria y gato) dibujados por código a doble
 * resolución, con contorno de 1 píxel, rostro legible y animación continua (t en segundos).
 */

import { rect, shade, type Ctx2D } from "./pixel";

/** Carrera del estudiante: decide ropa, materiales sobre la mesa y gestos (ambientación ficticia). */
export type Discipline = "medicina" | "derecho" | "ingenieria" | "matematicas" | "arquitectura" | "historia";
export const DISCIPLINES: Discipline[] = ["medicina", "derecho", "ingenieria", "matematicas", "arquitectura", "historia"];

/** Qué hace la persona en cada momento (de pie, caminando o sentada estudiando). */
export type Act =
  | "stand" | "walk" | "browse" | "chat" | "yawn"
  | "write" | "read" | "turn" | "highlight" | "type" | "lookup" | "compare" | "think" | "drink" | "adjust" | "rest" | "lounge" | "sit";

/** Compatibilidad con el nombre anterior. */
export type Pose = Act;

export interface Look {
  skin: string;
  hair: string;
  /** 0 corto, 1 largo, 2 moño, 3 rizado, 4 coleta, 5 gorro, 6 rapado */
  hairStyle: number;
  top: string;
  /** 0 camiseta, 1 sudadera, 2 jersey a rayas, 3 chaqueta abierta, 4 camisa, 5 bata, 6 cuello alto, 7 rebeca */
  topStyle: number;
  accent: string;
  pants: string;
  shoes: string;
  glasses?: boolean;
  backpack?: string;
  /** Bibliotecaria: rebeca, cordón con acreditación, moño gris y libros en brazos. */
  librarian?: boolean;
  book: string;
  /** Altura relativa (−1, 0, +1 píxel) y complexión para variar siluetas. */
  tall: number;
  wide: number;
}

const SKINS = ["#f6d5b8", "#f2c9a0", "#e0ac7e", "#c68a5c", "#a96f47", "#8d5a3b", "#6b4430"];
const HAIRS = ["#2a1d17", "#3b2a20", "#6b4226", "#1f1b1a", "#c98b3f", "#8a3b2a", "#e3c9a0", "#5a3a5f"];
const PANTS = ["#2c3f6e", "#3d4450", "#6e4a2e", "#4a3426", "#55606e", "#2f4a3a", "#7a6a58"];
const SHOES = ["#2a1f1a", "#f1ece2", "#7a4f31", "#3d4450", "#b84a44"];
const BOOKS = ["#b84a44", "#4c78b5", "#e0b04a", "#5f8f5a", "#7b5aa6", "#3f8f8a"];

/** Ropa típica (no exclusiva) de cada carrera para que la sala tenga personalidad. */
const STYLE_BY_DISCIPLINE: Record<Discipline, { tops: number[]; colors: string[] }> = {
  medicina: { tops: [5, 5, 0, 1, 7], colors: ["#7fb7c9", "#5f9ea0", "#e8d9b8", "#d77f8e"] },
  derecho: { tops: [3, 4, 4, 7], colors: ["#2c3f6e", "#4a3426", "#7a2f3a", "#55606e"] },
  ingenieria: { tops: [1, 1, 0, 2], colors: ["#3d4450", "#4c78b5", "#b84a44", "#5f8f5a"] },
  matematicas: { tops: [2, 7, 0, 4], colors: ["#7b5aa6", "#d6a33a", "#3f8f8a", "#e8d9b8"] },
  arquitectura: { tops: [6, 6, 3, 0], colors: ["#1f1b1a", "#3d4450", "#e7e3ec", "#c07a45"] },
  historia: { tops: [7, 2, 4, 3], colors: ["#6f7d3a", "#a24d3c", "#c98b3f", "#5d4a3a"] },
};

export function randomLook(rand: () => number, discipline?: Discipline): Look {
  const p = <T,>(list: T[]) => list[Math.floor(rand() * list.length)]!;
  const style = discipline ? STYLE_BY_DISCIPLINE[discipline] : { tops: [0, 1, 2, 3, 4, 6, 7], colors: ["#4c78b5", "#b84a44", "#5f8f5a", "#d6a33a", "#7b5aa6", "#3f8f8a", "#e8d9b8", "#d77f8e"] };
  const topStyle = p(style.tops);
  return {
    skin: p(SKINS), hair: p(HAIRS), hairStyle: Math.floor(rand() * 7),
    top: topStyle === 5 ? "#f4f6f8" : p(style.colors), topStyle,
    accent: topStyle === 5 ? p(["#7fb7c9", "#5f9ea0", "#3d4450"]) : p(["#f1ece2", "#e0b04a", "#d77f8e", "#7cc4e8", "#2a1f1a"]),
    pants: p(PANTS), shoes: p(SHOES), glasses: rand() < 0.3, backpack: rand() < 0.55 ? p(["#b84a44", "#2c3f6e", "#5f8f5a", "#d6a33a", "#3d4450"]) : undefined,
    book: p(BOOKS), tall: Math.floor(rand() * 3) - 1, wide: rand() < 0.3 ? 1 : 0,
  };
}

export const LIBRARIAN_LOOK: Look = {
  skin: "#e0ac7e", hair: "#cfc6bb", hairStyle: 2, top: "#f4efe6", topStyle: 7, accent: "#3f6b4f",
  pants: "#3d4450", shoes: "#4a3426", glasses: true, librarian: true, book: "#a24d3c", tall: 1, wide: 0,
};

type R = [x: number, y: number, w: number, h: number, c: string];
const INK = "#2a1f1a";

/** Rectángulos con contorno oscuro de 1 píxel (primero todos los contornos, luego los rellenos). */
function outlined(ctx: Ctx2D, sx: number, sy: number, parts: R[], flip: boolean, outline = INK) {
  const X = (x: number, w: number) => (flip ? -x - w : x);
  for (const [x, y, w, h] of parts) rect(ctx, sx + X(x, w) - 1, sy + y - 1, w + 2, h + 2, outline);
  for (const [x, y, w, h, c] of parts) rect(ctx, sx + X(x, w), sy + y, w, h, c);
}

function fill(ctx: Ctx2D, sx: number, sy: number, parts: R[], flip: boolean) {
  for (const [x, y, w, h, c] of parts) rect(ctx, sx + (flip ? -x - w : x), sy + y, w, h, c);
}

const SEATED: Act[] = ["write", "read", "turn", "highlight", "type", "lookup", "compare", "think", "drink", "adjust", "rest", "lounge", "sit"];
export const isSeatedAct = (a: Act) => SEATED.includes(a);

/** Cabeza y pelo; devuelve las partes (con contorno) y los detalles finos (sin contorno). */
function headParts(look: Look, hx: number, hy: number, back: boolean): { parts: R[]; detail: R[] } {
  const parts: R[] = [];
  const detail: R[] = [];
  const hair = look.hair;
  const hl = shade(hair, 0.22);
  parts.push([hx - 6, hy, 12, 12, look.skin]);
  // Orejas
  if (!back) parts.push([hx - 7, hy + 5, 1, 3, shade(look.skin, -0.08)], [hx + 6, hy + 5, 1, 3, shade(look.skin, -0.08)]);
  const style = look.hairStyle;
  if (back) {
    parts.push([hx - 6, hy - 1, 12, style === 6 ? 7 : 11, hair]);
    if (style === 1) parts.push([hx - 6, hy + 8, 12, 7, hair]);
    if (style === 3) parts.push([hx - 8, hy - 3, 16, 12, hair]);
    if (style === 4) parts.push([hx - 2, hy + 9, 4, 6, hair]);
  } else {
    if (style === 3) parts.push([hx - 8, hy - 3, 16, 7, hair], [hx - 8, hy + 2, 2, 7, hair], [hx + 6, hy + 2, 2, 7, hair]);
    else if (style === 6) parts.push([hx - 6, hy - 1, 12, 3, hair]);
    else {
      parts.push([hx - 6, hy - 2, 12, 5, hair], [hx - 7, hy, 1, style === 1 ? 13 : 6, hair], [hx + 6, hy, 1, style === 1 ? 13 : 6, hair]);
      if (style === 1) parts.push([hx - 7, hy + 6, 2, 8, hair], [hx + 5, hy + 6, 2, 8, hair]);
      detail.push([hx - 4, hy + 3, 4, 1, hair]);
    }
  }
  if (style === 2) parts.push([hx - 3, hy - 6, 6, 5, hair]);
  if (style === 4 && !back) parts.push([hx + 6, hy + 1, 3, 9, hair]);
  if (style === 5) parts.push([hx - 7, hy - 3, 14, 5, look.accent], [hx - 2, hy - 5, 4, 2, shade(look.accent, -0.15)]);
  if (style !== 5 && style !== 6) detail.push([hx - 3, hy - 1, 4, 1, hl]);
  return { parts, detail };
}

/** Rostro: ojos con brillo, cejas, mejillas, boca y gafas; `look` desplaza la mirada (−1, 0, 1). */
function face(ctx: Ctx2D, sx: number, hy: number, look: Look, gaze: number, eyes: "open" | "closed" | "down", mouth: "smile" | "open" | "flat", flip: boolean) {
  const X = (x: number, w = 1) => sx + (flip ? -x - w : x);
  const ey = hy + 6;
  const g = flip ? -gaze : gaze;
  if (eyes === "closed") {
    rect(ctx, X(-4 + g, 2), ey + 1, 2, 1, INK);
    rect(ctx, X(2 + g, 2), ey + 1, 2, 1, INK);
  } else {
    const dy = eyes === "down" ? 1 : 0;
    rect(ctx, X(-4 + g), ey + dy, 1, 2 - dy, INK);
    rect(ctx, X(-3 + g), ey + dy, 1, 2 - dy, INK);
    rect(ctx, X(2 + g), ey + dy, 1, 2 - dy, INK);
    rect(ctx, X(3 + g), ey + dy, 1, 2 - dy, INK);
    if (!dy) {
      rect(ctx, X(-4 + g), ey, 1, 1, "#ffffff");
      rect(ctx, X(2 + g), ey, 1, 1, "#ffffff");
    }
  }
  // Cejas
  rect(ctx, X(-4, 2), ey - 2, 2, 1, shade(look.hair, -0.1));
  rect(ctx, X(2, 2), ey - 2, 2, 1, shade(look.hair, -0.1));
  // Mejillas y boca
  rect(ctx, X(-5), ey + 3, 1, 1, shade(look.skin, -0.12));
  rect(ctx, X(4), ey + 3, 1, 1, shade(look.skin, -0.12));
  if (mouth === "open") rect(ctx, X(-1, 2), ey + 4, 2, 2, "#6b2a2a");
  else if (mouth === "smile") {
    rect(ctx, X(-1, 2), ey + 5, 2, 1, shade(look.skin, -0.35));
    rect(ctx, X(-2), ey + 4, 1, 1, shade(look.skin, -0.3));
    rect(ctx, X(1), ey + 4, 1, 1, shade(look.skin, -0.3));
  } else rect(ctx, X(-1, 2), ey + 5, 2, 1, shade(look.skin, -0.3));
  if (look.glasses) {
    const fr = look.librarian ? "#8a5a2b" : INK;
    for (const gx of [-5, 1]) {
      rect(ctx, X(gx, 4), ey - 1, 4, 1, fr);
      rect(ctx, X(gx, 4), ey + 2, 4, 1, fr);
      rect(ctx, X(gx), ey - 1, 1, 4, fr);
      rect(ctx, X(gx + 3), ey - 1, 1, 4, fr);
    }
    rect(ctx, X(-1, 2), ey, 2, 1, fr);
  }
}

/** Torso según la prenda: devuelve partes con contorno y detalles. */
function torso(look: Look, x: number, y: number, w: number, h: number, back: boolean): { parts: R[]; detail: R[] } {
  const t = look.top;
  const parts: R[] = [[x, y, w, h, t]];
  const detail: R[] = [];
  const dark = shade(t, -0.18);
  detail.push([x + w - 2, y + 1, 2, h - 1, dark]);
  if (back) {
    if (look.topStyle === 1) detail.push([x + 2, y, w - 4, 3, shade(t, -0.1)]);
    if (look.backpack && !look.librarian) parts.push([x + 1, y + 2, w - 2, h - 3, look.backpack]);
    return { parts, detail };
  }
  switch (look.topStyle) {
    case 1: // sudadera: capucha, cordones y bolsillo
      detail.push([x + 2, y, w - 4, 2, shade(t, -0.12)], [x + w / 2 - 2, y + 2, 1, 4, look.accent], [x + w / 2 + 1, y + 2, 1, 4, look.accent], [x + 2, y + h - 4, w - 4, 3, shade(t, -0.1)]);
      break;
    case 2: // jersey a rayas
      for (let i = 2; i < h; i += 3) detail.push([x, y + i, w - 2, 1, look.accent]);
      break;
    case 3: // chaqueta abierta sobre camiseta
      detail.push([x + w / 2 - 2, y, 4, h, look.accent], [x + w / 2 - 3, y, 1, 4, shade(t, 0.15)], [x + w / 2 + 2, y, 1, 4, shade(t, 0.15)]);
      break;
    case 4: // camisa con cuello y botones
      detail.push([x + w / 2 - 3, y, 2, 2, "#ffffff"], [x + w / 2 + 1, y, 2, 2, "#ffffff"]);
      for (let i = 3; i < h - 1; i += 3) detail.push([x + w / 2, y + i, 1, 1, shade(t, -0.3)]);
      break;
    case 5: // bata blanca sobre pijama sanitario (medicina)
      detail.push([x + w / 2 - 2, y, 4, h, look.accent], [x + 1, y + h - 5, 3, 2, shade(t, -0.1)], [x + w - 4, y + 3, 2, 3, "#4c78b5"]);
      break;
    case 6: // cuello alto
      detail.push([x + 2, y - 1, w - 4, 2, shade(t, 0.1)]);
      break;
    case 7: // rebeca abierta
      detail.push([x + w / 2 - 2, y, 4, h, look.librarian ? "#f4efe6" : look.accent], [x + 1, y + 1, 2, h - 1, look.librarian ? look.accent : shade(t, -0.05)], [x + w - 3, y + 1, 2, h - 1, look.librarian ? look.accent : shade(t, -0.05)]);
      for (let i = 2; i < h - 1; i += 3) detail.push([x + w / 2 + 2, y + i, 1, 1, "#e0b04a"]);
      break;
    default: // camiseta con estampado
      detail.push([x + w / 2 - 1, y + 4, 3, 2, look.accent]);
  }
  if (look.librarian) {
    // Cordón y acreditación
    detail.push([x + 3, y, 1, 4, "#3b6fb6"], [x + w - 4, y, 1, 4, "#3b6fb6"], [x + w / 2 - 3, y + 4, 6, 1, "#3b6fb6"], [x + w / 2 - 2, y + 5, 4, 5, "#ffffff"], [x + w / 2 - 2, y + 5, 4, 1, "#3b6fb6"]);
  } else if (look.backpack && look.topStyle !== 5) detail.push([x + 1, y, 1, h - 2, shade(look.backpack, -0.1)], [x + w - 2, y, 1, h - 2, shade(look.backpack, -0.1)]);
  return { parts, detail };
}

export interface PersonState {
  act: Act;
  /** Tiempo propio del personaje (segundos) para animaciones desincronizadas. */
  t: number;
  back: boolean;
  flip: boolean;
  /** Sentado: (sx, sy) es el punto del asiento; de pie: los pies. */
  seated: boolean;
  /** Mirada (−1 izquierda, 0, 1 derecha). */
  gaze?: number;
  /** Lleva algo en brazos (bibliotecaria con libros, estudiante con libro). */
  carry?: boolean;
}

/** Persona completa. Sentada a una mesa de frente, los antebrazos se pintan aparte (`drawDeskArms`). */
export function drawPerson(ctx: Ctx2D, sx: number, sy: number, look: Look, s: PersonState) {
  const { act, t, back, flip } = s;
  const parts: R[] = [];
  const detail: R[] = [];
  const tall = look.tall;
  const W = 12 + look.wide * 2;
  const half = W / 2;
  let headY: number;
  let shoulderY: number;
  if (!s.seated) {
    const walking = act === "walk";
    const cycle = walking ? Math.floor(t * 8) % 4 : 0;
    const bob = walking && cycle % 2 === 1 ? -1 : 0;
    const lLift = walking ? [0, 2, 0, 0][cycle]! : 0;
    const rLift = walking ? [0, 0, 0, 2][cycle]! : 0;
    const legH = 10 + tall;
    // Piernas y zapatos con zancada: el pie que avanza se levanta
    parts.push([-5, -legH - 2 + bob, 4, legH - lLift - bob, look.pants]);
    parts.push([1, -legH - 2 + bob, 4, legH - rLift - bob, look.pants]);
    parts.push([-5 - (lLift ? 1 : 0), -2 - lLift, 4, 2, look.shoes]);
    parts.push([1 + (rLift ? 1 : 0), -2 - rLift, 4, 2, look.shoes]);
    const top = -legH - 14 + bob;
    const tr = torso(look, -half, top, W, 13, back);
    parts.push(...tr.parts);
    detail.push(...tr.detail);
    shoulderY = top;
    // Brazos con balanceo
    const swing = walking ? [1, 0, -1, 0][cycle]! : 0;
    const armC = look.topStyle === 5 ? look.top : shade(look.top, -0.08);
    if (s.carry) {
      parts.push([-half - 1, top + 1, 2, 7, armC], [half - 1, top + 1, 2, 7, armC]);
    } else if (act === "browse") {
      parts.push([-half - 2, top + 1, 2, 10, armC], [half, top - 3, 2, 8, armC], [half, top - 5, 2, 2, look.skin]);
    } else {
      parts.push([-half - 2, top + 1 + swing, 2, 10, armC], [half, top + 1 - swing, 2, 10, armC]);
      parts.push([-half - 2, top + 11 + swing, 2, 2, look.skin], [half, top + 11 - swing, 2, 2, look.skin]);
    }
    headY = top - 12;
  } else {
    // Sentado: caderas en el asiento, piernas hacia delante (ocultas por la mesa si la hay)
    const adjust = act === "adjust" ? (Math.floor(t * 4) % 2) : 0;
    const restLean = act === "rest" ? 1 : 0;
    if (!back) {
      parts.push([-half + 1, -2, W - 2, 4, look.pants]);
      parts.push([-5, 2, 4, 9, look.pants], [1, 2, 4, 9, look.pants]);
      parts.push([-5, 10, 4, 2, look.shoes], [1, 10, 4, 2, look.shoes]);
    }
    const top = -14 - tall + adjust + restLean;
    const tr = torso(look, -half, top, W, 14, back);
    parts.push(...tr.parts);
    detail.push(...tr.detail);
    shoulderY = top;
    const armC = look.topStyle === 5 ? look.top : shade(look.top, -0.08);
    if (act === "rest" && Math.floor(t / 2.2) % 2 === 0) {
      // Estiramiento: brazos arriba
      parts.push([-half - 2, top - 9, 2, 11, armC], [half, top - 9, 2, 11, armC], [-half - 2, top - 11, 2, 2, look.skin], [half, top - 11, 2, 2, look.skin]);
    } else if (act === "think") {
      // Mano en la barbilla
      parts.push([half - 1, top + 2, 2, 7, armC], [half - 4, top - 2, 4, 3, look.skin]);
      if (back) parts.push([-half - 2, top + 1, 2, 9, armC]);
    } else if (act === "drink") {
      const phase = (t % 3) / 3;
      const up = phase < 0.45 ? Math.round(phase / 0.45 * 6) : phase < 0.7 ? 6 : Math.round((1 - phase) / 0.3 * 6);
      parts.push([half - 1, top + 6 - up, 2, 7, armC], [half - 3, top + 1 - up, 3, 8, "#7cc4e8"], [half - 3, top - up, 3, 2, "#3d4450"]);
    } else if (act === "lounge") {
      // Libro abierto en el regazo
      parts.push([-half - 1, top + 3, 2, 9, armC], [half - 1, top + 3, 2, 9, armC]);
      parts.push([-6, top + 8, 12, 6, look.book], [-5, top + 8, 10, 5, "#f8f4ec"]);
      detail.push([0, top + 8, 1, 5, shade(look.book, -0.2)]);
      for (let i = 0; i < 3; i++) detail.push([-4, top + 9 + i, 3, 1, "#b8b2a6"], [2, top + 9 + i, 3, 1, "#b8b2a6"]);
    } else if (back) {
      // De espaldas: codos que se mueven al escribir o teclear
      const work = act === "write" || act === "type" || act === "highlight";
      const k = work ? Math.floor(t * (act === "type" ? 9 : 5)) % 2 : 0;
      parts.push([-half - 2, top + 2 + k, 2, 9, armC], [half, top + 2 + (1 - k), 2, 9, armC]);
    } else {
      // De frente: hombros (los antebrazos van sobre la mesa en otra capa)
      parts.push([-half - 2, top + 1, 2, 6, armC], [half, top + 1, 2, 6, armC]);
    }
    headY = top - 12;
  }
  // Cabeza (inclinada hacia los apuntes al trabajar)
  const working = act === "write" || act === "read" || act === "highlight" || act === "turn";
  const nod = s.seated && working ? 1 : 0;
  const hy = headY + nod;
  const head = headParts(look, 0, hy, back);
  parts.push(...head.parts);
  detail.push(...head.detail);
  if (look.librarian && s.carry) {
    // Pila de libros en brazos
    const ly = shoulderY + 4;
    parts.push([-6, ly, 12, 3, "#b84a44"], [-5, ly - 3, 11, 3, "#4c78b5"], [-6, ly - 6, 10, 3, "#e0b04a"]);
    parts.push([-half - 1, ly + 1, 3, 2, look.skin], [half - 2, ly + 1, 3, 2, look.skin]);
  }
  outlined(ctx, sx, sy, parts, flip);
  fill(ctx, sx, sy, detail, flip);
  if (!back) {
    const blink = Math.floor(t * 10) % 37 === 0;
    const gaze = s.gaze ?? 0;
    const eyes = act === "yawn" || act === "rest" && Math.floor(t / 2.2) % 2 === 1 || blink ? "closed" : working || act === "type" ? "down" : "open";
    const mouth = act === "yawn" ? "open" : act === "chat" && Math.floor(t * 4) % 2 === 0 ? "open" : act === "walk" || act === "chat" || act === "stand" ? "smile" : "flat";
    face(ctx, sx, sy + hy, look, gaze, eyes, mouth, flip);
  }
  if (act === "chat" && Math.floor(t * 1.2) % 3 !== 2) {
    // Bocadillo de conversación en voz baja
    const bx = sx + (flip ? -16 : 6);
    const by = sy + hy - 14;
    rect(ctx, bx - 1, by - 1, 14, 9, INK);
    rect(ctx, bx, by, 12, 7, "#ffffff");
    for (let i = 0; i < 3; i++) rect(ctx, bx + 2 + i * 3, by + 3, 2, 1, i <= Math.floor(t * 3) % 3 ? "#8c9aa8" : "#d8dde3");
    rect(ctx, bx + (flip ? 9 : 1), by + 7, 2, 2, "#ffffff");
  }
  if (act === "think" && !back) {
    const k = Math.floor(t * 1.5) % 4;
    for (let i = 0; i < Math.min(3, k); i++) rect(ctx, sx + (flip ? -8 - i * 3 : 7 + i * 3), sy + hy - 3 - i * 3, 2, 2, "#ffffff");
  }
}

/**
 * Antebrazos y manos sobre la mesa (capa por delante del tablero). (sx, sy) es el punto del
 * asiento; `reach` es cuánto se adelantan las manos en píxeles de pantalla.
 */
export function drawDeskArms(ctx: Ctx2D, sx: number, sy: number, look: Look, act: Act, t: number, flip: boolean) {
  const X = (x: number, w = 1) => sx + (flip ? -x - w : x);
  const armC = look.topStyle === 5 ? look.top : shade(look.top, -0.08);
  const top = -14 - look.tall;
  const half = (12 + look.wide * 2) / 2;
  const hand = (x: number, y: number) => {
    rect(ctx, X(x - 1, 4), sy + y - 1, 4, 4, INK);
    rect(ctx, X(x, 2), sy + y, 2, 2, look.skin);
  };
  const arm = (x0: number, x1: number, y1: number) => {
    const y0 = top + 6;
    const steps = Math.max(1, Math.abs(y1 - y0));
    for (let i = 0; i <= steps; i++) {
      const x = Math.round(x0 + ((x1 - x0) * i) / steps);
      const y = Math.round(y0 + ((y1 - y0) * i) / steps);
      rect(ctx, X(x - 1, 4), sy + y - 1, 4, 3, INK);
    }
    for (let i = 0; i <= steps; i++) {
      const x = Math.round(x0 + ((x1 - x0) * i) / steps);
      const y = Math.round(y0 + ((y1 - y0) * i) / steps);
      rect(ctx, X(x, 2), sy + y, 2, 1, armC);
    }
  };
  if (act === "think" || act === "drink" || act === "rest" || act === "lounge") {
    // Un brazo apoyado; el otro ya está dibujado con el cuerpo
    arm(-half - 1, -4, 2);
    hand(-4, 2);
    return;
  }
  let lx = -5;
  let rx = 4;
  let ly = 2;
  let ry = 2;
  if (act === "type") {
    const k = Math.floor(t * 9) % 2;
    ly = 2 + k;
    ry = 3 - k;
    lx = -4;
    rx = 3;
  } else if (act === "write" || act === "highlight") {
    const k = Math.floor(t * 5) % 3;
    rx = 3 + k;
    ry = 3 + (k === 1 ? 1 : 0);
    ly = 3;
  } else if (act === "turn") {
    const k = (t % 1.2) / 1.2;
    rx = Math.round(4 - k * 9);
    ry = 2 - Math.round(Math.sin(k * Math.PI) * 3);
  } else if (act === "lookup" || act === "compare") {
    const left = Math.floor(t / 1.6) % 2 === 0;
    lx = left ? -8 : -5;
    rx = left ? 2 : 6;
  } else if (act === "adjust") {
    ly = 4;
    ry = 4;
  }
  arm(-half - 1, lx, ly);
  arm(half, rx, ry);
  hand(lx, ly);
  hand(rx, ry);
  if (act === "write") {
    rect(ctx, X(rx + 1), sy + ry - 3, 1, 4, "#2c3f6e");
  } else if (act === "highlight") {
    rect(ctx, X(rx + 1, 2), sy + ry - 4, 2, 5, "#f2e24a");
    rect(ctx, X(rx + 1, 2), sy + ry - 5, 2, 1, "#3d4450");
  }
}

// ---------------------------------------------------------------- gato

export type CatPose = "walk" | "sit" | "sleep" | "jump" | "groom" | "stretch";

/** Gato atigrado naranja (de perfil, mirando a la derecha salvo `flip`) con los pies en (sx, sy). */
export function drawCat(ctx: Ctx2D, sx: number, sy: number, pose: CatPose, t: number, flip: boolean, fur = "#e39a46") {
  const dark = shade(fur, -0.3);
  const light = "#fbf1e2";
  const pink = "#e58a96";
  const OUT = "#3a2414";
  const parts: R[] = [];
  const detail: R[] = [];
  const ears = (hx: number, hy: number) => {
    parts.push([hx, hy - 2, 3, 2, fur], [hx + 1, hy - 3, 1, 1, fur], [hx + 6, hy - 2, 3, 2, fur], [hx + 7, hy - 3, 1, 1, fur]);
    detail.push([hx + 1, hy - 1, 1, 1, pink], [hx + 7, hy - 1, 1, 1, pink]);
  };
  const faceAt = (hx: number, hy: number, closed: boolean) => {
    if (closed) detail.push([hx + 2, hy + 4, 2, 1, OUT], [hx + 6, hy + 4, 2, 1, OUT]);
    else detail.push([hx + 2, hy + 3, 2, 2, "#5fa84a"], [hx + 3, hy + 3, 1, 2, OUT], [hx + 6, hy + 3, 2, 2, "#5fa84a"], [hx + 7, hy + 3, 1, 2, OUT]);
    detail.push([hx + 4, hy + 6, 2, 2, light], [hx + 5, hy + 6, 1, 1, pink], [hx + 2, hy + 1, 1, 2, dark], [hx + 4, hy, 1, 2, dark], [hx + 6, hy + 1, 1, 2, dark]);
  };
  const whiskers = (hx: number, hy: number) => {
    detail.push([hx + 9, hy + 6, 4, 1, "#ffffff"], [hx + 9, hy + 8, 3, 1, "#ffffff"]);
  };
  if (pose === "sleep") {
    // Bola enroscada que respira; cola rodeando el cuerpo
    const breathe = Math.sin(t * 2.2) > 0.3 ? 1 : 0;
    parts.push([-10, -8 - breathe, 18, 8 + breathe, fur], [-11, -5, 2, 4, fur]);
    parts.push([3, -11 - breathe, 9, 7, fur]);
    ears(3, -11 - breathe);
    parts.push([-10, -2, 16, 2, fur], [5, -3, 3, 3, fur]);
    detail.push([-6, -7 - breathe, 1, 4, dark], [-3, -8 - breathe, 1, 5, dark], [0, -8 - breathe, 1, 5, dark], [-8, -2, 3, 1, dark], [-2, -2, 3, 1, dark]);
    detail.push([5, -2, 3, 1, light]);
    outlined(ctx, sx, sy, parts, flip, OUT);
    fill(ctx, sx, sy, detail, flip);
    const X = (x: number, w = 1) => sx + (flip ? -x - w : x);
    rect(ctx, X(5, 2), sy - 7 - breathe, 2, 1, OUT);
    rect(ctx, X(9, 2), sy - 7 - breathe, 2, 1, OUT);
    rect(ctx, X(8), sy - 5 - breathe, 1, 1, pink);
    return;
  }
  if (pose === "sit" || pose === "groom") {
    // Sentado de perfil: cuarto trasero, pecho blanco, cabeza erguida y cola enroscada que se mece
    const sway = Math.round(Math.sin(t * 1.6) * 2);
    parts.push([-7, -11, 11, 11, fur], [-1, -15, 7, 9, fur]);
    parts.push([0, -3, 3, 3, fur], [4, -3, 3, 3, fur]);
    parts.push([-12 + sway, -2, 9, 2, fur], [-13 + sway, -5, 2, 4, fur]);
    detail.push([1, -12, 4, 7, light], [0, -1, 3, 1, light], [4, -1, 3, 1, light], [-5, -10, 1, 4, dark], [-2, -11, 1, 4, dark], [-12 + sway, -2, 2, 1, dark], [-13 + sway, -5, 2, 1, dark]);
    const groom = pose === "groom" && Math.floor(t * 2) % 4 !== 3;
    const hx = 0;
    const hy = groom ? -19 : -23;
    parts.push([hx, hy, 10, 9, fur]);
    ears(hx, hy);
    if (groom) parts.push([7, -16 + (Math.floor(t * 6) % 2), 2, 5, fur]);
    faceAt(hx, hy, groom);
    if (!groom) whiskers(hx, hy);
    else detail.push([7, -12 + (Math.floor(t * 6) % 2), 2, 1, light], [8, hy + 8, 1, 1, pink]);
    outlined(ctx, sx, sy, parts, flip, OUT);
    fill(ctx, sx, sy, detail, flip);
    return;
  }
  if (pose === "stretch") {
    // Estiramiento: patas delanteras estiradas, lomo arqueado hacia abajo, cola arriba
    parts.push([-9, -12, 8, 6, fur], [-1, -9, 7, 4, fur], [6, -5, 7, 2, fur]);
    parts.push([-9, -6, 2, 6, fur], [-4, -6, 2, 6, fur], [8, -3, 5, 3, fur], [11, -3, 3, 3, fur]);
    parts.push([-12, -18, 2, 7, fur], [-11, -20, 2, 2, fur]);
    detail.push([-6, -12, 1, 4, dark], [-3, -11, 1, 3, dark], [-9, -1, 2, 1, light], [-4, -1, 2, 1, light], [11, -1, 3, 1, light], [-12, -18, 2, 1, dark]);
    const hx = 10;
    const hy = -11;
    parts.push([hx, hy, 10, 8, fur]);
    ears(hx, hy);
    faceAt(hx, hy, true);
    detail.push([hx + 4, hy + 6, 2, 2, "#6b2a2a"]);
    outlined(ctx, sx, sy, parts, flip, OUT);
    fill(ctx, sx, sy, detail, flip);
    return;
  }
  // Caminando o saltando: cuatro patas con ciclo de cuatro fases y cola que se mece
  const jump = pose === "jump";
  const cycle = Math.floor(t * 9) % 4;
  const lift = jump ? -3 : 0;
  const bob = !jump && cycle % 2 === 1 ? -1 : 0;
  const by = -12 + lift + bob;
  parts.push([-9, by, 17, 7, fur]);
  const legs = jump ? [[-9, 2], [-6, 2], [5, -2], [8, -2]] : [[-9, [0, 1, 2, 1][cycle]!], [-6, [2, 1, 0, 1][cycle]!], [4, [2, 1, 0, 1][cycle]!], [7, [0, 1, 2, 1][cycle]!]];
  for (const [lx, k] of legs as [number, number][]) {
    parts.push([lx + (jump ? k : 0), by + 7, 2, 5 - (jump ? 0 : k === 2 ? 1 : 0) + lift * -1 - (jump ? 3 : 0), fur]);
    detail.push([lx + (jump ? k : 0), by + 11 - (jump ? 3 : 0) + lift * -1 - (!jump && k === 2 ? 1 : 0), 2, 1, light]);
  }
  const sway = Math.round(Math.sin(t * 3) * 1.5);
  parts.push([-12, by - 1, 3, 3, fur], [-14 + sway, by - 6, 3, 6, fur], [-13 + sway * 2, by - 9, 2, 3, fur]);
  detail.push([-14 + sway, by - 5, 3, 1, dark], [-13 + sway * 2, by - 9, 2, 1, dark]);
  detail.push([-6, by, 1, 4, dark], [-3, by, 1, 5, dark], [0, by, 1, 4, dark], [3, by, 1, 3, dark], [-7, by + 5, 13, 2, shade(fur, 0.12)]);
  const hx = 5;
  const hy = by - 6;
  parts.push([hx, hy, 10, 9, fur]);
  ears(hx, hy);
  faceAt(hx, hy, false);
  whiskers(hx, hy);
  outlined(ctx, sx, sy, parts, flip, OUT);
  fill(ctx, sx, sy, detail, flip);
}
