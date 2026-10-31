/**
 * Dibujantes pixel art del mobiliario. Cada pieza se compone de prismas isométricos y
 * detalles a píxel, con la misma luz (arriba-izquierda), contorno y paleta cálida para todas.
 * Los cuatro giros son reales: a 0°/90° el frente mira a la cámara y a 180°/270° se ve la trasera.
 */

import { ART_VARIANT, type CatalogItem } from "../data/catalog";
import { seatFacing } from "../engine/layout";
import { alpha, mix, Painter, shade, tone, type Tone, WallPainter } from "./pixel";

const BOOKS = ["#b84a44", "#4c78b5", "#d6a33a", "#5f8f5a", "#7b5aa6", "#e8d9b8", "#3f8f8a", "#c07a45"];
/** Vidrio translúcido (sin contorno: el color ya es rgba). */
function glass(color: string, a: number): Tone {
  return { top: alpha(shade(color, 0.3), a), left: alpha(color, a), right: alpha(shade(color, -0.2), a), line: alpha(color, a) };
}

const RAINBOW = ["#e05252", "#ee8f3c", "#e8c547", "#5fb85a", "#4c8fd6", "#8a62c9"];

export interface PaintOpts {
  /** Huella tras el giro y orientación (0: +x, 1: +y, 2: −x, 3: −y). */
  fw: number;
  fh: number;
  facing: number;
  /** Trofeos expuestos (vitrina de logros). */
  trophies?: number;
}

function legs(P: Painter, x: number, y: number, w: number, d: number, h: number, color: string, t = 0.1) {
  const c = tone(color);
  P.box(x, y, 0, t, t, h, c, false);
  P.box(x + w - t, y, 0, t, t, h, c, false);
  P.box(x, y + d - t, 0, t, t, h, c, false);
  P.box(x + w - t, y + d - t, 0, t, t, h, c, false);
}

/** Lomos de libros sobre la cara visible de una estantería: anchos, alturas y tejuelos variados. */
function bookRow(P: Painter, x0: number, x1: number, y: number, z: number, h: number, along: "x" | "y", palette: string[], seed: number) {
  const face = (a: number, b: number, z0: number, z1: number, color: string) =>
    along === "x" ? P.quad([[a, y, z0], [b, y, z0], [b, y, z1], [a, y, z1]], color) : P.quad([[y, a, z0], [y, b, z0], [y, b, z1], [y, a, z1]], color);
  let u = x0 + 0.03;
  let i = 0;
  while (u < x1 - 0.06) {
    const r = (seed * 31 + i * 17) % 97;
    const bw = 0.055 + (r % 5) * 0.012;
    if (u + bw > x1 - 0.02) break;
    // Algún hueco y alguna pila tumbada: estanterías vividas, no un código de barras.
    if (r % 23 === 0) {
      u += bw * 1.6;
      i++;
      continue;
    }
    if (r % 19 === 0 && u + 0.24 < x1) {
      for (let k = 0; k < 3; k++) face(u, u + 0.2 - k * 0.02, z + k * 1.2, z + k * 1.2 + 1.1, palette[(seed + k * 3) % palette.length]!);
      u += 0.24;
      i++;
      continue;
    }
    const color = palette[(seed + i * 5 + (r % 7)) % palette.length]!;
    const bh = h - (r % 4) * 0.55;
    face(u, u + bw, z, z + bh, color);
    face(u, u + 0.012, z, z + bh, shade(color, 0.28));
    face(u, u + bw, z + bh * 0.62, z + bh * 0.62 + 0.7, r % 3 ? shade(color, 0.42) : "#e0b04a");
    face(u + bw - 0.01, u + bw, z, z + bh, shade(color, -0.3));
    u += bw + 0.008;
    i++;
  }
}

type Part = { x: number; y: number; z: number; w: number; d: number; h: number; c: string | Tone; outline: boolean };

/**
 * Prismas en orden de pintor: lo apilado de abajo arriba y lo de atrás antes que lo de delante.
 * Las piezas se diseñan contiguas, sin intersecarse en volumen.
 */
function drawParts(P: Painter, parts: Part[]) {
  const eps = 1e-6;
  const overlap = (a: Part, b: Part) => a.x < b.x + b.w - eps && b.x < a.x + a.w - eps && a.y < b.y + b.d - eps && b.y < a.y + a.d - eps;
  const behind = (a: Part, b: Part) => a.x + a.w <= b.x + eps || a.y + a.d <= b.y + eps;
  const before = (a: Part, b: Part) => (overlap(a, b) ? a.z + a.h <= b.z + eps : behind(a, b) && !behind(b, a));
  const n = parts.length;
  const indeg = new Array<number>(n).fill(0);
  const edges = parts.map(() => [] as number[]);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j && before(parts[i]!, parts[j]!)) {
    edges[i]!.push(j);
    indeg[j]! += 1;
  }
  const depth = (p: Part) => p.x + p.w / 2 + p.y + p.d / 2 + p.z * 0.001;
  const done = new Array<boolean>(n).fill(false);
  for (let k = 0; k < n; k++) {
    let pick = -1;
    for (let i = 0; i < n; i++) if (!done[i] && indeg[i] === 0 && (pick < 0 || depth(parts[i]!) < depth(parts[pick]!))) pick = i;
    if (pick < 0) for (let i = 0; i < n; i++) if (!done[i] && (pick < 0 || depth(parts[i]!) < depth(parts[pick]!))) pick = i;
    done[pick] = true;
    for (const j of edges[pick]!) indeg[j]! -= 1;
    const p = parts[pick]!;
    P.box(p.x, p.y, p.z, p.w, p.d, p.h, p.c, p.outline);
  }
}

/**
 * Marco local de un mueble orientado: u a lo largo del mueble, v desde el respaldo (0) hacia
 * donde mira (V). Así un sofá o una silla se diseñan una vez y valen para los cuatro giros.
 */
function oriented(facing: number, fw: number, fh: number) {
  const f = ((facing % 4) + 4) % 4;
  const U = f % 2 === 1 ? fw : fh;
  const V = f % 2 === 1 ? fh : fw;
  const world = (u: number, v: number, du: number, dv: number): [number, number, number, number] => {
    if (f === 0) return [v, u, dv, du];
    if (f === 1) return [u, v, du, dv];
    if (f === 2) return [V - v - dv, u, dv, du];
    return [u, V - v - dv, du, dv];
  };
  return {
    U, V,
    part(u: number, v: number, z: number, du: number, dv: number, h: number, c: string | Tone, outline = true): Part {
      const [x, y, w, d] = world(u, v, du, dv);
      return { x, y, z, w, d, h, c, outline };
    },
    pt(u: number, v: number): [number, number] {
      const [x, y] = world(u, v, 0, 0);
      return [x, y];
    },
  };
}

/** Sofás y sillones: patas, respaldo, brazos, base y un cojín por plaza con costuras visibles. */
function paintSofa(P: Painter, item: CatalogItem, fw: number, fh: number, facing: number) {
  const [c0 = "#4c78b5", c1 = "#7a4f31"] = item.colors;
  const O = oriented(facing, fw, fh);
  const { U, V } = O;
  const armchair = item.kind === "armchair";
  const wing = item.id === "P083";
  const arm = armchair ? 0.4 : 0.32;
  const backT = 0.34;
  const float = item.fx === "float";
  const fabric = float ? "#f4f6fb" : c0;
  const lift = float ? 3 : 0;
  const parts: Part[] = [];
  if (!float) for (const [u, v] of [[0.12, 0.1], [U - 0.22, 0.1], [0.12, V - 0.2], [U - 0.22, V - 0.2]] as const)
    parts.push(O.part(u, v, 0, 0.1, 0.1, 2, c1, false));
  const backH = wing ? 28 : 22;
  parts.push(O.part(0.04, 0.06, 2 + lift, U - 0.08, backT, backH, fabric));
  let v0 = 0.06 + backT;
  if (wing) {
    // Orejas del sillón orejero: salen del respaldo por encima de los brazos.
    parts.push(O.part(0.04, v0, 14 + lift, arm, 0.24, 15, shade(fabric, -0.05)));
    parts.push(O.part(U - 0.04 - arm, v0, 14 + lift, arm, 0.24, 15, shade(fabric, -0.05)));
  }
  parts.push(O.part(0.04, v0, 2 + lift, arm, V - v0 - 0.06, 12, fabric));
  parts.push(O.part(U - 0.04 - arm, v0, 2 + lift, arm, V - v0 - 0.06, 12, fabric));
  const inner0 = 0.04 + arm;
  const inner = U - 0.08 - arm * 2;
  parts.push(O.part(inner0, v0, 2 + lift, inner, V - v0 - 0.06, 5, shade(fabric, -0.22)));
  const seats = armchair ? 1 : item.id === "P081" ? 2 : 3;
  const sw = inner / seats;
  for (let k = 0; k < seats; k++) {
    const u0 = inner0 + k * sw;
    parts.push(O.part(u0 + 0.03, v0, 7 + lift, sw - 0.06, 0.2, 13, shade(fabric, 0.04)));
    parts.push(O.part(u0 + 0.025, v0 + 0.2, 7 + lift, sw - 0.05, V - v0 - 0.32, 4, shade(fabric, 0.1)));
  }
  if (!armchair) parts.push(O.part(inner0 + 0.06, v0 + 0.22, 11 + lift, 0.34, 0.13, 7, float ? "#e7d3f0" : shade(c1, 0.3)));
  drawParts(P, parts);
  const top = backH + 2 + lift;
  if (float) for (let i = 0; i < U * 3; i++) {
    const [x, y] = O.pt(0.2 + i * 0.33, V * 0.55);
    P.ball(x, y, 1 + (i % 2), 3.5, "#ffffff");
  }
  if (item.fx === "stars") for (let i = 0; i < 12; i++) {
    const [x, y] = O.pt(0.2 + ((i * 0.53) % (U - 0.4)), 0.06 + backT);
    P.px(x, y, 6 + ((i * 7) % 14), i % 3 ? "#f3e2bf" : "#e0b04a");
  }
  if (item.fx === "sway") for (let i = 0; i < U * 3; i++) {
    const [x, y] = O.pt(0.15 + i * 0.32, 0.2);
    P.ball(x, y, top + (i % 2), 3, i % 2 ? "#4f9a52" : "#7cbf5a");
    if (i % 3 === 1) P.ball(x, y, top + 3, 1.2, c1);
  }
  if (item.tags.includes("astral")) {
    const [x, y] = O.pt(U / 2, 0.2);
    P.ball(x, y, top + 3, 3.2, "#e0b04a");
    P.ball(x + 0.07, y - 0.07, top + 4, 2.6, shade(c0, -0.1));
  }
}

/** Sillas: patas, asiento, respaldo con travesaños o tapizado; de oficina con base de cinco radios. */
function paintChair(P: Painter, item: CatalogItem, facing: number) {
  const [c0 = "#b9824a", c1 = "#7a4f31"] = item.colors;
  const O = oriented(facing, 1, 1);
  const parts: Part[] = [];
  const k = item.kind;
  if (k === "stool") {
    for (const [u, v] of [[0.26, 0.26], [0.66, 0.26], [0.26, 0.66], [0.66, 0.66]] as const) parts.push(O.part(u, v, 0, 0.08, 0.08, 9, c1, false));
    drawParts(P, parts);
    P.box(0.3, 0.3, 3, 0.4, 0.4, 0.5, shade(c1, -0.1), false);
    P.disc(0.5, 0.5, 9, 0.32, shade(c0, -0.25));
    P.disc(0.5, 0.5, 10.5, 0.32, c0);
    P.disc(0.45, 0.46, 10.5, 0.14, shade(c0, 0.18));
    return;
  }
  if (k === "officechair") {
    const metal = "#3d4450";
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.3;
      const ex = 0.5 + Math.cos(a) * 0.36;
      const ey = 0.52 + Math.sin(a) * 0.36;
      P.line([0.5, 0.52, 1.5], [ex, ey, 1.2], metal);
      P.line([0.5, 0.53, 1], [ex, ey + 0.01, 0.8], shade(metal, 0.25));
      P.ball(ex, ey, 0.6, 1, "#1f2328");
    }
    P.box(0.44, 0.46, 1, 0.12, 0.12, 7, c1, false);
    parts.push(O.part(0.16, 0.24, 8, 0.68, 0.62, 3, c0));
    parts.push(O.part(0.44, 0.12, 8, 0.12, 0.12, 6, metal, false));
    parts.push(O.part(0.16, 0.06, 14, 0.68, 0.14, 13, c0));
    parts.push(O.part(0.24, 0.07, 27, 0.52, 0.12, 2, shade(c0, 0.1)));
    parts.push(O.part(0.06, 0.42, 11, 0.07, 0.07, 6, metal, false));
    parts.push(O.part(0.87, 0.42, 11, 0.07, 0.07, 6, metal, false));
    parts.push(O.part(0.04, 0.3, 17, 0.11, 0.38, 1.5, "#2a2f38"));
    parts.push(O.part(0.85, 0.3, 17, 0.11, 0.38, 1.5, "#2a2f38"));
    drawParts(P, parts);
    return;
  }
  const throne = k === "throne";
  const bench = k === "bench";
  const seatZ = 8;
  const lift = item.fx === "float" ? 4 : 0;
  const upholstered = throne || ["P014", "P015", "P017", "P020"].includes(item.id);
  if (item.fx !== "float") for (const [u, v] of [[0.18, 0.18], [0.74, 0.18], [0.18, 0.74], [0.74, 0.74]] as const)
    parts.push(O.part(u, v, 0, 0.08, 0.08, seatZ, c1, false));
  const seatH = throne ? 4 : 2;
  parts.push(O.part(0.14, 0.14, seatZ + lift, 0.72, 0.72, seatH, upholstered ? c0 : shade(c0, 0.05)));
  const sz = seatZ + lift + seatH;
  const backH = throne ? 24 : bench ? 7 : 14;
  parts.push(O.part(0.16, 0.14, sz, 0.08, 0.08, backH, c1, false));
  parts.push(O.part(0.76, 0.14, sz, 0.08, 0.08, backH, c1, false));
  if (upholstered || bench) parts.push(O.part(0.24, 0.14, sz + 2, 0.52, 0.08, backH - 3, c0));
  else {
    parts.push(O.part(0.37, 0.15, sz, 0.06, 0.06, backH - 3, c1, false));
    parts.push(O.part(0.57, 0.15, sz, 0.06, 0.06, backH - 3, c1, false));
  }
  parts.push(O.part(0.14, 0.13, sz + backH, 0.72, 0.1, throne ? 4 : 2.5, upholstered ? shade(c0, 0.1) : c1));
  if (throne) {
    parts.push(O.part(0.06, 0.3, sz, 0.08, 0.5, 7, c1));
    parts.push(O.part(0.86, 0.3, sz, 0.08, 0.5, 7, c1));
  }
  drawParts(P, parts);
  if (throne) {
    const [x, y] = O.pt(0.5, 0.18);
    P.ball(x, y, sz + backH + 7, 2.4, c1);
  }
  if (item.id === "P012") for (let i = 0; i < 5; i++) {
    const [x, y] = O.pt(0.24 + i * 0.13, 0.5);
    P.line([x, y - 0.22, seatZ + 2.1], [x + 0.04, y + 0.22, seatZ + 2.1], shade(c0, -0.2));
  }
}

function seatFrame(facing: number, fw: number, fh: number) {
  // Respaldo en el lado contrario a la orientación.
  const back = (facing + 2) % 4;
  return { back, backFirst: back === 2 || back === 3, fw, fh };
}

function drawBack(P: Painter, back: number, fw: number, fh: number, z: number, h: number, color: string, inset = 0.1, thick = 0.16) {
  if (back === 2) P.box(inset, inset, z, thick, fh - inset * 2, h, color);
  else if (back === 0) P.box(fw - inset - thick, inset, z, thick, fh - inset * 2, h, color);
  else if (back === 3) P.box(inset, inset, z, fw - inset * 2, thick, h, color);
  else P.box(inset, fh - inset - thick, z, fw - inset * 2, thick, h, color);
}

/** ¿El mueble se extiende a lo largo de x? Los cuadrados lo deciden por el giro (pares: x). */
function alongX(fw: number, fh: number, facing: number): boolean {
  return fw === fh ? facing % 2 === 0 : fw > fh;
}

function shelfFace(fw: number, fh: number, facing: number): { along: "x" | "y"; front: number; len: number } {
  // Cara de los libros: +y si es ancha en x, +x si lo es en y (o −y/−x girada 180°).
  return alongX(fw, fh, facing) ? { along: "x", front: fh, len: fw } : { along: "y", front: fw, len: fh };
}

export function paintItem(P: Painter, item: CatalogItem, o: PaintOpts): void {
  const [c0 = "#b9824a", c1 = "#7a4f31"] = item.colors;
  const v = ART_VARIANT[item.id] ?? "";
  const { fw, fh } = o;
  const facing = ((o.facing % 4) + 4) % 4;
  // Girado 180° el mueble da la espalda a la cámara: frentes ocultos y trasera a la vista.
  const flip = facing >= 2;
  const ax = alongX(fw, fh, facing);
  switch (item.kind) {
    case "table": {
      const legH = 11;
      const modern = item.id === "P010";
      if (modern) {
        // Patas de placa: dos paneles de grafito en los extremos.
        if (fw >= fh) {
          P.box(0.16, 0.18, 0, 0.12, fh - 0.36, legH, c1);
          P.box(fw - 0.28, 0.18, 0, 0.12, fh - 0.36, legH, c1);
        } else {
          P.box(0.18, 0.16, 0, fw - 0.36, 0.12, legH, c1);
          P.box(0.18, fh - 0.28, 0, fw - 0.36, 0.12, legH, c1);
        }
      } else {
        legs(P, 0.14, 0.14, fw - 0.28, fh - 0.28, legH - 3, c1, 0.11);
        // Faldón bajo el tablero
        P.box(0.14, 0.14, legH - 3, fw - 0.28, fh - 0.28, 3, shade(c1, 0.05));
      }
      if (v === "garden") P.box(0.3, 0.3, 4, fw - 0.6, fh - 0.6, 2, "#5f8f5a", false);
      P.box(0.05, 0.05, legH, fw - 0.1, fh - 0.1, 3, c0);
      const top = legH + 3;
      // Veta de la madera (o vetas del mármol) a lo largo del tablero
      if (item.id === "P008") {
        for (let i = 0; i < 4; i++) P.line([0.2 + i * 0.4, 0.15, top], [0.5 + i * 0.35, fh - 0.2, top], shade(c0, -0.12));
      } else if (!modern && !v) {
        const along = fw >= fh;
        for (let i = 1; i < 4; i++) {
          const t = (i / 4) * (along ? fh : fw);
          if (along) P.line([0.15, t, top], [fw - 0.15 - (i % 2) * 0.4, t, top], shade(c0, -0.08));
          else P.line([t, 0.15, top], [t, fh - 0.15 - (i % 2) * 0.4, top], shade(c0, -0.08));
        }
      }
      if (v === "chess") {
        for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) if ((i + j) % 2)
          P.quad([[0.6 + i * 0.2, 0.5 + j * 0.17, top], [0.8 + i * 0.2, 0.5 + j * 0.17, top], [0.8 + i * 0.2, 0.67 + j * 0.17, top], [0.6 + i * 0.2, 0.67 + j * 0.17, top]], c1);
      } else if (v === "map") {
        P.quad([[0.3, 0.3, top], [fw - 0.3, 0.3, top], [fw - 0.3, fh - 0.3, top], [0.3, fh - 0.3, top]], "#efe0b8");
        P.blob(fw * 0.4, fh * 0.45, top, 3, "#6fa36b");
        P.blob(fw * 0.65, fh * 0.6, top, 2, "#6fa36b");
        P.line([0.4, fh * 0.7, top], [fw - 0.5, fh * 0.35, top], "#b84a44");
      } else if (v === "aurora") {
        for (let i = 0; i < 4; i++) P.line([0.3, 0.4 + i * 0.35, top], [fw - 0.3, 0.3 + i * 0.35, top], ["#7fd6b0", "#7cc4e8", "#b48ae0", "#7fd6b0"][i]!);
      } else if (v === "floating-books") {
        P.box(fw / 2 - 0.3, fh / 2 - 0.2, top, 0.5, 0.35, 2, "#b84a44");
      } else if (v === "garden") {
        P.blob(0.5, 0.5, top + 3, 3, "#4f9a52");
        P.blob(fw - 0.5, fh - 0.5, top + 3, 3, "#7cbf5a");
      } else if (item.fx === "stars") {
        for (let i = 0; i < 9; i++) P.dot(0.3 + ((i * 0.37) % (fw - 0.6)), 0.3 + ((i * 0.61) % (fh - 0.6)), top, i % 3 ? "#f3e2bf" : "#e0b04a");
      } else if (item.fx === "gears") {
        P.disc(fw * 0.35, fh * 0.5, top, 0.25, shade(c1, 0.3));
        P.disc(fw * 0.65, fh * 0.45, top, 0.18, shade(c1, 0.45));
      } else if (item.id === "P009") {
        const [lx, ly] = flip ? [0.35, fh - 0.55] : [fw - 0.6, 0.3];
        P.box(lx, ly, top, 0.25, 0.25, 2, "#4a3426");
        P.box(lx - 0.02, ly - 0.02, top + 8, 0.3, 0.3, 4, "#f3e2bf");
      }
      return;
    }
    case "roundtable": {
      P.box(fw / 2 - 0.12, fh / 2 - 0.12, 0, 0.24, 0.24, 12, c1, false);
      P.disc(fw / 2, fh / 2, 0, 0.45, shade(c1, -0.2));
      P.disc(fw / 2, fh / 2, 12, fw * 0.46, shade(c0, -0.25));
      P.disc(fw / 2, fh / 2, 14, fw * 0.46, c0);
      P.disc(fw / 2 - 0.15, fh / 2 - 0.1, 14, fw * 0.2, shade(c0, 0.12));
      return;
    }
    case "desk": {
      const pc = item.tags.includes("pc");
      const along = ax;
      const len = along ? fw : fh;
      const dep = along ? fh : fw;
      // s a lo largo y t de la trasera (0) al frente (dep); girado 180° ambos se invierten.
      const S = (v: number, d = 0) => (flip ? len - v - d : v);
      const T = (v: number, d = 0) => (flip ? dep - v - d : v);
      const pt = (sv: number, tv: number, z: number): [number, number, number] => (along ? [S(sv), T(tv), z] : [T(tv), S(sv), z]);
      const parts: Part[] = [];
      const add = (s0: number, t0: number, z: number, ds: number, dt: number, h: number, c: string, outline = true) => {
        const [x, y, w, d] = along ? [S(s0, ds), T(t0, dt), ds, dt] : [T(t0, dt), S(s0, ds), dt, ds];
        parts.push({ x, y, z, w, d, h, c, outline });
      };
      // Panel en un extremo, cajonera en el otro, faldón trasero y tablero
      add(0.08, 0.1, 0, 0.12, dep - 0.2, 12, shade(c0, -0.12));
      add(0.2, 0.1, 4, len - 0.8, 0.1, 8, shade(c0, -0.2));
      add(len - 0.6, 0.1, 0, 0.52, dep - 0.2, 12, shade(c0, -0.05));
      add(0.03, 0.04, 12, len - 0.06, dep - 0.08, 3, c0);
      const mx = len / 2 - 0.4;
      if (pc) {
        add(mx + 0.22, 0.2, 15, 0.36, 0.2, 0.6, "#3d4450", false);
        add(mx + 0.32, 0.22, 15.6, 0.16, 0.1, 3.4, "#3d4450", false);
        add(mx, 0.16, 19, 0.8, 0.08, 11, "#2a2f38");
        add(mx + 0.05, dep * 0.55, 15, 0.62, 0.18, 0.8, "#d8dde3");
        add(mx + 0.8, dep * 0.58, 15, 0.1, 0.13, 0.8, "#d8dde3");
      } else {
        add(len - 0.5, 0.25, 15, 0.3, 0.4, 0.6, "#f8f4ec", false);
        add(len - 0.45, 0.3, 15.6, 0.22, 0.3, 0.6, "#e8d9b8", false);
        add(0.25, 0.25, 15, 0.12, 0.12, 4, "#4c78b5");
      }
      drawParts(P, parts);
      if (!flip) {
        // Tiradores de la cajonera y pantalla encendida (de espaldas no se ven).
        for (const z of [3.5, 7.5]) {
          P.line(pt(len - 0.58, dep - 0.1, z), pt(len - 0.1, dep - 0.1, z), shade(c0, -0.35));
          const [hx, hy] = pt(len - 0.36, dep - 0.1, 0);
          P.dot(hx, hy, z + 2, "#d8dde3");
        }
        if (pc) {
          const s0 = mx + 0.05;
          const s1 = mx + 0.75;
          const tf = 0.24;
          P.quad([pt(s0, tf, 20), pt(s1, tf, 20), pt(s1, tf, 29), pt(s0, tf, 29)], c1);
          for (let i = 0; i < 4; i++) P.line(pt(s0 + 0.08, tf, 27 - i * 2), pt(s0 + 0.2 + (i % 3) * 0.12, tf, 27 - i * 2), alpha("#ffffff", 0.75));
        }
      }
      return;
    }
    case "chair": case "stool": case "officechair": case "bench": case "throne": {
      paintChair(P, item, facing);
      return;
    }
    case "armchair": case "sofa": {
      paintSofa(P, item, fw, fh, seatFacing(item, facing));
      return;
    }
    case "pouf": {
      P.disc(0.5, 0.5, 0, 0.38, shade(c0, -0.25));
      for (let z = 1; z < 9; z++) P.disc(0.5, 0.5, z, 0.38, z < 8 ? shade(c0, -0.1) : c0);
      P.disc(0.5, 0.5, 9, 0.3, shade(c0, 0.12));
      return;
    }
    case "shelf": case "lowshelf": {
      const { along, front, len } = shelfFace(fw, fh, facing);
      const H = item.kind === "lowshelf" ? 16 : item.id === "P030" ? 46 : len === 1 && fw === fh ? 32 : 38;
      const depth = Math.min(front, 0.7);
      const back = front - depth;
      // Girada 180°, el cuerpo se pega al otro lado de la casilla y a la vista queda la trasera.
      const S = (v: number, d = 0) => (flip ? len - v - d : v);
      const T = (v: number, d = 0) => (flip ? depth - v - d : back + v);
      const at = (s0: number, t0: number, z: number, ds: number, dt: number, h: number, c: string | Tone, outline = true) =>
        along === "x" ? P.box(S(s0, ds), T(t0, dt), z, ds, dt, h, c, outline) : P.box(T(t0, dt), S(s0, ds), z, dt, ds, h, c, outline);
      const plane = (t: number, s0: number, s1: number, z0: number, z1: number, c: string) =>
        along === "x" ? P.quad([[s0, t, z0], [s1, t, z0], [s1, t, z1], [s0, t, z1]], c) : P.quad([[t, s0, z0], [t, s1, z0], [t, s1, z1], [t, s0, z1]], c);
      const face = (s0: number, s1: number, z0: number, z1: number, c: string) => plane(front, s0, s1, z0, z1, c);
      at(0.04, 0, 0, len - 0.08, depth, H, c1);
      if (flip) {
        // Trasera: tablero liso con juntas verticales.
        plane(depth, 0.1, len - 0.1, 1.5, H - 1.5, shade(c1, -0.12));
        for (let u = 0.5; u < len - 0.2; u += 0.5) plane(depth, u - 0.01, u + 0.01, 1.5, H - 1.5, shade(c1, -0.32));
      } else {
        const palette = v === "rainbow" ? RAINBOW : v === "infinite" ? ["#e0b04a", "#f3e2bf", "#7b5aa6", "#26305a"] : BOOKS;
        const rows = Math.max(1, Math.floor((H - 4) / 9));
        const rowH = (H - 4) / rows;
        for (let r = 0; r < rows; r++) {
          const z = 2 + r * rowH;
          face(0.1, len - 0.1, z, z + rowH - 1.2, shade(c1, -0.5));
          face(0.1, len - 0.1, z + rowH - 2, z + rowH - 1.2, shade(c1, -0.65));
          bookRow(P, 0.1, len - 0.1, front, z, Math.min(7.2, rowH - 2), along, palette, r * 7 + item.id.charCodeAt(item.id.length - 1));
          face(0.06, len - 0.06, z + rowH - 1.2, z + rowH, shade(c0, 0.05));
          face(0.06, len - 0.06, z - 0.4, z, shade(c0, -0.15));
        }
        // Laterales con canto
        at(0.04, depth - 0.06, 0, 0.08, 0.08, H, c0);
        at(len - 0.12, depth - 0.06, 0, 0.08, 0.08, H, c0);
      }
      // Remate superior
      at(0.02, 0, H, len - 0.04, depth + 0.03, 1.5, shade(c0, 0.06));
      if (item.kind === "lowshelf") {
        // Encima: maceta pequeña y un libro tumbado
        at(0.25, 0.2, H + 1.5, 0.22, 0.22, 3, "#c4703f");
        const [ps, pt] = [S(0.36), T(0.31)];
        P.ball(along === "x" ? ps : pt, along === "x" ? pt : ps, H + 7, 3, "#5f8f5a");
        at(len - 0.6, 0.15, H + 1.5, 0.35, 0.3, 1.2, "#4c78b5");
      }
      if (v === "stained" && !flip) for (let i = 0; i < 3; i++) P.ball(along === "x" ? 0.4 + i * 0.6 : front, along === "x" ? front : 0.4 + i * 0.6, H - 5, 2, RAINBOW[i * 2]!);
      if (item.id === "P030") {
        at(0, 0, H + 1.5, len, depth + 0.06, 3, c1);
        at(0.1, 0, H + 4.5, len - 0.2, depth, 1, c0);
      }
      return;
    }
    case "cornershelf": {
      // Rinconera en L: el giro lleva la esquina a cada rincón de la huella.
      const rot = (x: number, y: number): [number, number] =>
        facing === 0 ? [x, y] : facing === 1 ? [fw - y, x] : facing === 2 ? [fw - x, fh - y] : [y, fh - x];
      const part = (x0: number, y0: number, x1: number, y1: number): Part => {
        const [ax0, ay0] = rot(x0, y0);
        const [ax1, ay1] = rot(x1, y1);
        return { x: Math.min(ax0, ax1), y: Math.min(ay0, ay1), z: 0, w: Math.abs(ax1 - ax0), d: Math.abs(ay1 - ay0), h: 34, c: c1, outline: true };
      };
      drawParts(P, [part(0.04, 0.04, fw - 0.04, 0.74), part(0.04, 0.74, 0.74, fh - 0.04)]);
      for (let r = 0; r < 3; r++) {
        if (facing === 0 || facing === 1) bookRow(P, facing === 0 ? 0.8 : 0.1, facing === 0 ? fw - 0.1 : fw - 0.8, 0.74, 3 + r * 10, 7, "x", BOOKS, facing === 0 ? r : r + 4);
        if (facing === 0 || facing === 3) bookRow(P, facing === 0 ? 0.8 : 0.1, facing === 0 ? fh - 0.1 : fh - 0.8, 0.74, 3 + r * 10, 7, "y", BOOKS, facing === 0 ? r + 4 : r);
      }
      return;
    }
    case "cart": {
      const along = fw >= fh;
      P.box(0.1, 0.1, 3, fw - 0.2, fh - 0.2, 10, c0);
      for (const [x, y] of [[0.2, 0.2], [fw - 0.2, 0.2], [0.2, fh - 0.2], [fw - 0.2, fh - 0.2]] as const) P.disc(x, y, 1, 0.1, "#3d4450");
      bookRow(P, 0.2, (along ? fw : fh) - 0.2, along ? fh / 2 : fw / 2, 13, 6, along ? "x" : "y", BOOKS, 2);
      return;
    }
    case "books": {
      const lift = item.fx === "float" ? 3 : 0;
      const pal = [c0, c1, shade(c0, 0.3), shade(c1, -0.2)];
      for (let i = 0; i < 4; i++) P.box(0.28 + (i % 2) * 0.04, 0.3, lift + i * 3, 0.42 - (i % 3) * 0.04, 0.38, 3, pal[i]!);
      return;
    }
    case "plant": case "tree": case "palm": case "smallplant": {
      const potColor = c1;
      const small = item.kind === "smallplant";
      const potH = small ? 5 : 8;
      const r = small ? 0.18 : 0.26;
      const cx = fw / 2;
      const cy = fh / 2;
      P.box(cx - r, cy - r, 0, r * 2, r * 2, potH, potColor);
      P.disc(cx, cy, potH, r * 0.8, "#4a3426");
      if (item.id === "P032") {
        P.box(cx - 0.07, cy - 0.07, potH, 0.14, 0.14, 9, c0);
        P.box(cx + 0.07, cy - 0.04, potH + 4, 0.1, 0.08, 4, c0);
        return;
      }
      if (item.kind === "tree") {
        P.box(cx - 0.05, cy - 0.05, potH, 0.1, 0.1, 14, "#7a4f31", false);
        const canopy = [[0, 0, 26, 7], [-0.2, 0.1, 22, 5], [0.2, -0.1, 23, 5], [0.05, 0.15, 30, 4]] as const;
        for (const [dx, dy, z, rr] of canopy) P.ball(cx + dx, cy + dy, z + potH - 6, rr, shade(c0, dx > 0 ? -0.15 : 0.05));
        P.blob(cx - 0.1, cy, potH + 24, 2, shade(c0, 0.3));
        return;
      }
      if (item.kind === "palm") {
        P.box(cx - 0.06, cy - 0.06, potH, 0.12, 0.12, 24, "#9b7046", false);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          P.line([cx, cy, potH + 26], [cx + Math.cos(a) * 0.7, cy + Math.sin(a) * 0.7, potH + 16], shade(c0, i % 2 ? -0.1 : 0.05));
          P.line([cx, cy, potH + 27], [cx + Math.cos(a) * 0.65, cy + Math.sin(a) * 0.65, potH + 18], c0);
        }
        return;
      }
      const leaves = small ? 3 : 5;
      for (let i = 0; i < leaves; i++) {
        const a = (i / leaves) * Math.PI * 2;
        P.ball(cx + Math.cos(a) * r * 0.7, cy + Math.sin(a) * r * 0.7, potH + (small ? 4 : 7) + (i % 2) * 3, small ? 2 : 3, shade(c0, (i % 3) * 0.08 - 0.08));
      }
      P.ball(cx, cy, potH + (small ? 7 : 12), small ? 2 : 3, shade(c0, 0.12));
      return;
    }
    case "planter": {
      const sand = item.id === "E012";
      P.box(0.06, 0.12, 0, fw - 0.12, fh - 0.24, sand ? 5 : 9, sand ? "#b9824a" : c1);
      if (sand) {
        P.quad([[0.16, 0.22, 5], [fw - 0.16, 0.22, 5], [fw - 0.16, fh - 0.22, 5], [0.16, fh - 0.22, 5]], "#ead7b0");
        P.blob(0.4, 0.45, 6, 1, "#8c9aa8");
        P.blob(0.62, 0.6, 6, 1, "#8c9aa8");
        return;
      }
      for (let i = 0; i < fw * 3; i++) P.ball(0.25 + i * 0.32, fh / 2, 12 + (i % 2) * 3, 3, shade(c0, (i % 3) * 0.1 - 0.1));
      return;
    }
    case "lamp": {
      if (item.id === "R016") {
        // Lámpara seta: sombrero con lunares sobre un pie crema
        P.disc(0.5, 0.5, 0, 0.16, shade(c1, -0.15));
        P.box(0.44, 0.44, 0, 0.12, 0.12, 8, c1);
        P.disc(0.5, 0.5, 8, 0.3, shade(c0, -0.3));
        for (let z = 8; z < 13; z++) P.disc(0.5, 0.5, z, 0.3 - (z - 8) * 0.045, z === 12 ? shade(c0, 0.15) : c0);
        for (const [x, y, z] of [[0.38, 0.42, 11], [0.58, 0.4, 12], [0.5, 0.6, 10.5]] as const) P.dot(x, y, z, "#fff6d8");
        return;
      }
      if (item.id === "P042" || item.id === "R017") {
        // Flexo articulado: base, dos brazos, codo y cabezal hacia la mesa
        P.disc(0.4, 0.55, 0, 0.17, shade(c0, -0.2));
        P.disc(0.4, 0.55, 1, 0.17, c0);
        P.line([0.4, 0.55, 1], [0.32, 0.4, 11], c0);
        P.line([0.41, 0.55, 1], [0.33, 0.4, 11], shade(c0, -0.2));
        P.ball(0.32, 0.4, 11, 1, c1);
        P.line([0.32, 0.4, 11], [0.62, 0.42, 15], c0);
        P.line([0.32, 0.41, 10.5], [0.62, 0.43, 14.5], shade(c0, -0.2));
        P.box(0.56, 0.38, 12, 0.18, 0.14, 3, c0);
        P.box(0.6, 0.42, 11.4, 0.1, 0.06, 0.6, "#fff6d8", false);
        return;
      }
      // Lámpara de mesa: peana, pie y pantalla troncocónica con luz interior
      P.disc(0.5, 0.5, 0, 0.18, shade(c1, -0.2));
      P.disc(0.5, 0.5, 1, 0.16, c1);
      P.box(0.47, 0.47, 1, 0.06, 0.06, 8, c1, false);
      P.ball(0.5, 0.5, 5, 1.6, c1);
      P.disc(0.5, 0.5, 9, 0.27, "#fff3c4");
      for (let z = 9; z < 15; z++) P.disc(0.5, 0.5, z, 0.27 - (z - 9) * 0.017, z === 14 ? shade(c0, 0.15) : z < 11 ? shade(c0, -0.08) : c0);
      P.disc(0.5, 0.5, 15, 0.16, shade(c0, -0.2));
      return;
    }
    case "floorlamp": {
      if (item.fx === "stars" || item.fx === "flicker") {
        P.disc(0.5, 0.5, 0, 0.22, c1);
        P.box(0.47, 0.47, 1, 0.06, 0.06, 28, c1, false);
        if (item.fx === "stars") {
          P.ball(0.5, 0.5, 33, 4, c0);
          P.ball(0.5, 0.5, 34, 2, "#fff6d8");
        } else P.box(0.32, 0.32, 26, 0.36, 0.36, 9, glass("#ffffff", 0.35), false);
        return;
      }
      const deco = item.id === "P049";
      // Base pesada, mástil y pantalla de tambor (art déco: escalonada)
      P.disc(0.5, 0.5, 0, 0.24, shade(c1, -0.25));
      P.disc(0.5, 0.5, 1, 0.22, c1);
      P.box(0.47, 0.47, 1.5, 0.06, 0.06, 27, c1, false);
      P.disc(0.5, 0.5, 13, 0.06, shade(c1, 0.2));
      P.disc(0.5, 0.5, 27, 0.3, "#fff3c4");
      if (deco) {
        for (let z = 27; z < 36; z++) P.disc(0.5, 0.5, z, 0.32 - Math.floor((z - 27) / 3) * 0.06, z % 3 === 2 ? shade(c0, 0.2) : c0);
        P.ball(0.5, 0.5, 37, 1.4, c0);
      } else {
        for (let z = 27; z < 36; z++) P.disc(0.5, 0.5, z, 0.31 - (z - 27) * 0.012, z === 35 ? shade(c0, 0.12) : z === 29 ? shade(c0, -0.12) : c0);
        P.disc(0.5, 0.5, 36, 0.2, shade(c0, -0.2));
      }
      return;
    }
    case "rug": {
      const round = v === "round";
      const inset = 0.08;
      if (round) {
        P.disc(fw / 2, fh / 2, 0, Math.min(fw, fh) * 0.48, c1);
        P.disc(fw / 2, fh / 2, 0, Math.min(fw, fh) * 0.42, c0);
        P.disc(fw / 2, fh / 2, 0, Math.min(fw, fh) * 0.2, c1);
        return;
      }
      P.quad([[inset, inset, 0], [fw - inset, inset, 0], [fw - inset, fh - inset, 0], [inset, fh - inset, 0]], c1);
      P.quad([[inset + 0.1, inset + 0.1, 0], [fw - inset - 0.1, inset + 0.1, 0], [fw - inset - 0.1, fh - inset - 0.1, 0], [inset + 0.1, fh - inset - 0.1, 0]], c0);
      if (item.id === "P052" || v === "mosaic") {
        const n = v === "mosaic" ? 4 : 3;
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if ((i + j) % 2 === 0) {
          const s = (fw - 0.4) / n;
          const x = 0.2 + i * s;
          const y = 0.2 + j * s;
          P.quad([[x + s / 2, y, 0], [x + s, y + s / 2, 0], [x + s / 2, y + s, 0], [x, y + s / 2, 0]], c1);
        }
      }
      if (item.fx === "stars") for (let i = 0; i < 6; i++) P.dot(0.25 + ((i * 0.37) % (fw - 0.5)), 0.25 + ((i * 0.59) % (fh - 0.5)), 0, c1);
      return;
    }
    case "cushions": {
      P.box(0.15, 0.2, 0, 0.5, 0.5, 5, c0);
      P.box(0.35, 0.3, 5, 0.45, 0.45, 5, c1);
      return;
    }
    case "globe": {
      P.disc(0.5, 0.5, 0, 0.18, c1);
      P.box(0.47, 0.47, 1, 0.06, 0.06, 6, c1, false);
      P.ball(0.5, 0.5, 13, 5, c0);
      P.blob(0.45, 0.45, 15, 2, "#6fa36b");
      P.blob(0.58, 0.55, 11, 1, "#6fa36b");
      return;
    }
    case "hourglass": {
      P.box(0.32, 0.32, 0, 0.36, 0.36, 2, c1);
      P.box(0.4, 0.4, 2, 0.2, 0.2, 4, c0, false);
      P.box(0.45, 0.45, 6, 0.1, 0.1, 1, c0, false);
      P.box(0.4, 0.4, 7, 0.2, 0.2, 4, glass("#ffffff", 0.6), false);
      P.box(0.32, 0.32, 11, 0.36, 0.36, 2, c1);
      return;
    }
    case "vase": {
      P.disc(0.5, 0.5, 0, 0.16, shade(c0, -0.2));
      for (let z = 1; z < 10; z++) P.disc(0.5, 0.5, z, z < 6 ? 0.16 : 0.11, z === 9 ? shade(c0, 0.2) : c0);
      P.blob(0.5, 0.5, 13, 2, "#d77f8e");
      return;
    }
    case "folding": {
      const along = fw >= fh;
      const len = along ? fw : fh;
      const panels = len * 2;
      for (let i = 0; i < panels; i++) {
        const a = i / panels * len;
        const b = (i + 1) / panels * len;
        const off = i % 2 ? 0.12 : 0;
        if (along) P.quad([[a, 0.45 + off, 0], [b, 0.57 - off, 0], [b, 0.57 - off, 30], [a, 0.45 + off, 30]], i % 2 ? shade(c0, -0.12) : c0);
        else P.quad([[0.45 + off, a, 0], [0.57 - off, b, 0], [0.57 - off, b, 30], [0.45 + off, a, 30]], i % 2 ? shade(c0, -0.12) : c0);
      }
      if (along) P.line([0, 0.45, 30], [len, 0.5, 30], c1);
      else P.line([0.45, 0, 30], [0.5, len, 30], c1);
      return;
    }
    case "counter": {
      P.box(0.04, 0.1, 0, fw - 0.08, fh - 0.2, 18, c0);
      P.box(0, 0.05, 18, fw, fh - 0.1, 3, c1);
      // Paneles del frente (por detrás, mostrador liso).
      if (!flip) {
        if (ax) for (let i = 0; i < fw * 2; i++) P.vline(0.2 + i * 0.5, fh - 0.1, 3, 11, shade(c0, -0.18));
        else for (let i = 0; i < fh * 2; i++) P.vline(fw - 0.04, 0.2 + i * 0.5, 3, 11, shade(c0, -0.18));
      }
      P.box(fw / 2 - 0.15, fh / 2 - 0.15, 21, 0.3, 0.3, 3, "#e8d9b8", false);
      return;
    }
    case "sign": {
      P.box(0.45, 0.45, 0, 0.1, 0.1, 14, "#7a4f31", false);
      const t = flip ? 0.47 : 0.45;
      if (ax) P.box(0.15, t, 12, 0.7, 0.08, 12, c1);
      else P.box(t, 0.15, 12, 0.08, 0.7, 12, c1);
      if (!flip) {
        const f = 0.53;
        if (ax) {
          P.quad([[0.2, f, 15], [0.8, f, 15], [0.8, f, 21], [0.2, f, 21]], c0);
          P.line([0.3, f, 18], [0.7, f, 18], c1);
        } else {
          P.quad([[f, 0.2, 15], [f, 0.8, 15], [f, 0.8, 21], [f, 0.2, 21]], c0);
          P.line([f, 0.3, 18], [f, 0.7, 18], c1);
        }
      }
      return;
    }
    case "coatrack": {
      P.disc(0.5, 0.5, 0, 0.2, c0);
      P.box(0.46, 0.46, 0, 0.08, 0.08, 30, c0, false);
      P.blob(0.4, 0.55, 22, 3, c1);
      P.blob(0.6, 0.45, 26, 2, "#4c78b5");
      return;
    }
    case "locker": {
      P.box(0.05, 0.1, 0, fw - 0.1, fh - 0.2, 28, c0);
      const len = ax ? fw : fh;
      if (!flip) for (let i = 1; i < len * 2; i++) {
        if (ax) P.vline(i * 0.5, fh - 0.1, 1, 26, shade(c0, -0.3));
        else P.vline(fw - 0.05, i * 0.5, 1, 26, shade(c0, -0.3));
      }
      return;
    }
    case "infopanel": case "terminal": {
      const len = ax ? fw : fh;
      const screen = item.kind === "terminal" ? c1 : c0;
      const body = item.kind === "terminal" ? c0 : c1;
      const t = flip ? 0.48 : 0.4;
      P.box(ax ? len / 2 - 0.08 : 0.42, ax ? 0.42 : len / 2 - 0.08, 0, 0.16, 0.16, 12, c1, false);
      if (ax) {
        P.box(0.15, t, 12, len - 0.3, 0.12, 16, body);
        if (!flip) P.quad([[0.22, 0.52, 14], [len - 0.22, 0.52, 14], [len - 0.22, 0.52, 26], [0.22, 0.52, 26]], screen);
      } else {
        P.box(t, 0.15, 12, 0.12, len - 0.3, 16, body);
        if (!flip) P.quad([[0.52, 0.22, 14], [0.52, len - 0.22, 14], [0.52, len - 0.22, 26], [0.52, 0.22, 26]], screen);
      }
      return;
    }
    case "cabinet": {
      P.box(0.15, 0.15, 0, 0.7, 0.7, 18, c0);
      if (!flip) for (const z of [4, 10, 16]) {
        if (ax) P.line([0.25, 0.85, z], [0.75, 0.85, z], shade(c0, -0.35));
        else P.line([0.85, 0.25, z], [0.85, 0.75, z], shade(c0, -0.35));
      }
      return;
    }
    case "newstand": {
      const len = ax ? fw : fh;
      const dep = ax ? fh : fw;
      // Revistas inclinadas hacia el frente; de espaldas se ven sus contraportadas.
      const T = (t: number) => (flip ? dep - t : t);
      P.box(0.05, 0.05, 0, fw - 0.1, fh - 0.1, 6, c0);
      for (let i = 0; i < len * 2; i++) {
        const col = flip ? shade(BOOKS[(i * 3) % BOOKS.length]!, -0.3) : BOOKS[(i * 3) % BOOKS.length]!;
        const a = 0.15 + i * 0.48;
        const b = 0.5 + i * 0.48;
        if (ax) P.quad([[a, T(0.3), 6], [b, T(0.3), 6], [b, T(0.15), 18], [a, T(0.15), 18]], col);
        else P.quad([[T(0.3), a, 6], [T(0.3), b, 6], [T(0.15), b, 18], [T(0.15), a, 18]], col);
      }
      return;
    }
    case "vitrine": {
      P.box(0.05, 0.1, 0, fw - 0.1, fh - 0.2, 10, c0);
      P.box(0.1, 0.15, 10, fw - 0.2, fh - 0.3, 18, glass(c1, 0.45), false);
      const n = item.tags.includes("showcase") ? Math.max(0, o.trophies ?? 0) : 3;
      const len = Math.max(fw, fh);
      for (let i = 0; i < Math.min(n, len * 3); i++) {
        const u = 0.3 + (i % (len * 3)) * 0.32;
        const [x, y] = fw >= fh ? [u, fh / 2] : [fw / 2, u];
        P.box(x - 0.06, y - 0.06, 11, 0.12, 0.12, 4, "#e0b04a", false);
        P.blob(x, y, 18, 2, item.tags.includes("showcase") ? "#e0b04a" : RAINBOW[i % RAINBOW.length]!);
      }
      P.box(0.05, 0.1, 28, fw - 0.1, fh - 0.2, 2, c0);
      return;
    }
    case "pc": case "monitor": {
      const wide = item.kind === "monitor";
      const keyboard = () => {
        if (wide) return;
        const t = flip ? 0.22 : 0.62;
        if (ax) P.box(0.25, t, 0, 0.5, 0.16, 1, "#d8dde3", false);
        else P.box(t, 0.25, 0, 0.16, 0.5, 1, "#d8dde3", false);
      };
      // De espaldas el teclado queda detrás de la pantalla: se pinta antes.
      if (flip) keyboard();
      P.box(0.4, 0.4, 0, 0.2, 0.2, 2, "#3d4450", false);
      P.box(0.47, 0.47, 2, 0.06, 0.06, 4, "#3d4450", false);
      const t = flip ? 0.57 : 0.35;
      const a = wide ? 0.08 : 0.2;
      const span = wide ? 0.84 : 0.6;
      if (ax) P.box(a, t, 6, span, 0.08, 11, c0);
      else P.box(t, a, 6, 0.08, span, 11, c0);
      if (!flip) {
        const s0 = wide ? 0.13 : 0.25;
        const s1 = wide ? 0.87 : 0.75;
        if (ax) P.quad([[s0, 0.43, 7], [s1, 0.43, 7], [s1, 0.43, 16], [s0, 0.43, 16]], c1);
        else P.quad([[0.43, s0, 7], [0.43, s1, 7], [0.43, s1, 16], [0.43, s0, 16]], c1);
        keyboard();
      }
      return;
    }
    case "printer": {
      // Bandeja de salida en el frente (detrás del cuerpo si está de espaldas).
      const tray = () => {
        const t = flip ? 0.28 : 0.62;
        if (ax) P.box(0.2, t, 3, 0.6, 0.1, 1, c1, false);
        else P.box(t, 0.2, 3, 0.1, 0.6, 1, c1, false);
      };
      if (flip) tray();
      P.box(0.18, 0.2, 0, 0.64, 0.6, 7, c0);
      P.box(0.28, 0.25, 7, 0.44, 0.3, 2, "#ffffff", false);
      if (!flip) tray();
      return;
    }
    case "coffeetable": {
      legs(P, 0.12, 0.15, fw - 0.24, fh - 0.3, 6, c1);
      P.box(0.06, 0.1, 6, fw - 0.12, fh - 0.2, 2, c0);
      P.box(fw / 2 - 0.12, fh / 2 - 0.1, 8, 0.2, 0.2, 3, "#f1ece2", false);
      return;
    }
    case "record": {
      P.box(0.06, 0.1, 0, fw - 0.12, fh - 0.2, 12, c0);
      P.box(0.1, 0.14, 12, fw - 0.2, fh - 0.28, 2, shade(c0, -0.2));
      const k = flip ? 0.62 : 0.38;
      const [cx, cy] = ax ? [fw * k, fh / 2] : [fw / 2, fh * k];
      P.disc(cx, cy, 14, 0.36, "#1d1d22");
      P.disc(cx, cy, 14, 0.1, c1);
      P.line(flip ? [fw * 0.2, fh * 0.7, 15] : [fw * 0.8, fh * 0.3, 15], [cx + (flip ? -0.15 : 0.15), cy, 15], "#d8dde3");
      return;
    }
    case "vinylbox": {
      P.box(0.15, 0.2, 0, 0.7, 0.6, 7, c0);
      for (let i = 0; i < 5; i++) P.box(0.2 + i * 0.12, 0.25, 7, 0.06, 0.5, 5 - (i % 2), i % 2 ? c1 : "#1d1d22", false);
      return;
    }
    case "speakers": {
      const len = ax ? fw : fh;
      for (const u of [0.1, len - 0.6]) {
        const [x, y] = ax ? [u, 0.2] : [0.2, u];
        P.box(x, y, 0, ax ? 0.5 : 0.6, ax ? 0.6 : 0.5, 20, c0);
        // Conos en el frente; por detrás, caja lisa.
        if (flip) continue;
        const [bx, by] = ax ? [x + 0.25, 0.8] : [0.8, y + 0.25];
        P.blob(bx, by, 6, 2, c1);
        P.blob(bx, by, 14, 3, shade(c1, -0.3));
      }
      return;
    }
    case "piano": case "lightpiano": {
      const light = item.kind === "lightpiano";
      const len = ax ? fw : fh;
      const dep = ax ? fh : fw;
      // t de la trasera al teclado; girado 180° el teclado queda detrás del mueble.
      const T = (t: number, d: number) => (flip ? dep - t - d : t);
      const box = (s: number, t: number, z: number, ds: number, dt: number, h: number, c: string, outline = true) =>
        ax ? P.box(s, T(t, dt), z, ds, dt, h, c, outline) : P.box(T(t, dt), s, z, dt, ds, h, c, outline);
      const kz = light ? 10 : 12;
      const keys = () => {
        if (light) {
          if (ax) legs(P, 0.15, T(0.2, 0.5), len - 0.3, 0.5, kz, c1);
          else legs(P, T(0.2, 0.5), 0.15, 0.5, len - 0.3, kz, c1);
        }
        box(0.08, light ? 0.2 : 0.75, kz, len - 0.16, 0.45, 3, c0);
        for (let i = 0; 0.22 + i * 0.14 <= len - 0.1; i++) box(0.12 + i * 0.14, light ? 0.24 : 0.8, kz + 3, 0.1, 0.3, 1, "#f8f4ec", false);
      };
      if (flip || light) keys();
      if (!light) box(0.05, 0.05, 0, len - 0.1, 0.7, 30, c0);
      if (!flip && !light) keys();
      return;
    }
    case "monument": case "statue": case "fountain": {
      if (item.kind === "fountain") {
        P.disc(fw / 2, fh / 2, 0, fw * 0.48, shade(c0, -0.3));
        for (let z = 1; z < 7; z++) P.disc(fw / 2, fh / 2, z, fw * 0.46, z === 6 ? c0 : shade(c0, -0.12));
        P.disc(fw / 2, fh / 2, 6, fw * 0.36, c1);
        P.box(fw / 2 - 0.1, fh / 2 - 0.1, 6, 0.2, 0.2, 16, c0);
        P.disc(fw / 2, fh / 2, 22, 0.3, c0);
        return;
      }
      P.box(0.2, 0.2, 0, fw - 0.4, fh - 0.4, 8, c0);
      P.box(0.35, 0.35, 8, fw - 0.7, fh - 0.7, 4, shade(c0, 0.1));
      if (item.kind === "statue") {
        // Banda delantera: de espaldas queda detrás del cuerpo.
        const sash = () => P.box(fw / 2 - 0.25, flip ? fh / 2 - 0.25 : fh / 2 + 0.1, 22, 0.5, 0.15, 5, c1);
        if (flip) sash();
        P.box(fw / 2 - 0.2, fh / 2 - 0.15, 12, 0.4, 0.3, 18, c0);
        P.blob(fw / 2, fh / 2, 34, 4, c0);
        if (!flip) sash();
      } else {
        P.box(fw / 2 - 0.3, fh / 2 - 0.3, 12, 0.6, 0.6, 30, c0);
        P.box(fw / 2 - 0.4, fh / 2 - 0.2, 42, 0.8, 0.4, 6, c1);
        P.box(fw / 2 - 0.35, fh / 2 - 0.15, 48, 0.7, 0.3, 3, "#f3e2bf");
      }
      return;
    }
    case "trophy": {
      P.box(0.35, 0.35, 0, 0.3, 0.3, 3, c1);
      P.box(0.46, 0.46, 3, 0.08, 0.08, 4, c0, false);
      P.disc(0.5, 0.5, 7, 0.18, shade(c0, -0.15));
      P.disc(0.5, 0.5, 10, 0.18, c0);
      P.dot(0.42, 0.42, 11, "#fff6d8");
      return;
    }
    case "figurine": {
      P.box(0.3, 0.3, 0, 0.4, 0.4, 2, "#7a4f31");
      P.blob(0.5, 0.5, 6, 3, c0);
      P.blob(0.52, 0.45, 11, 2, c0);
      P.dot(0.46, 0.4, 13, "#3d4450");
      P.dot(0.58, 0.42, 13, "#3d4450");
      return;
    }
    default: {
      P.box(0.1, 0.1, 0, fw - 0.2, fh - 0.2, 10, c0);
    }
  }
}

/** Piezas de pared (cuadros, relojes, apliques…) sobre el plano de la pared. */
export function paintWallItem(W: WallPainter, item: CatalogItem, u: number, len: number): void {
  const [c0 = "#b9824a", c1 = "#7a4f31"] = item.colors;
  const v = ART_VARIANT[item.id] ?? "";
  const a = u + 0.12;
  const b = u + len - 0.12;
  switch (item.kind) {
    case "frame": {
      W.frame(a, 22, b, 42, c1, c0);
      if (v === "madrid") {
        W.rect(a + 0.15, 25, b - 0.15, 32, "#f3c178");
        for (let i = 0; i < 4; i++) W.rect(a + 0.12 + i * 0.16, 25, a + 0.22 + i * 0.16, 31 + (i % 2) * 4, "#a24d3c");
      } else if (len > 1) {
        W.rect(a + 0.1, 25, b - 0.1, 30, "#6fa36b");
        W.rect(a + 0.6, 30, a + 1.0, 36, "#f3e2bf");
      } else {
        W.rect(a + 0.25, 26, a + 0.3, 36, "#4f9a52");
        W.rect(a + 0.32, 30, a + 0.5, 34, "#7cbf5a");
      }
      return;
    }
    case "poster": {
      W.rect(a + 0.05, 20, b - 0.05, 44, c0);
      W.rect(a + 0.15, 34, b - 0.15, 40, c1);
      W.line(a + 0.15, 26, b - 0.15, 26, shade(c0, -0.4));
      W.line(a + 0.15, 29, b - 0.3, 29, shade(c0, -0.4));
      return;
    }
    case "clock": {
      const cu = u + len / 2;
      W.frame(cu - 0.32, 28, cu + 0.32, 44, c1, c0);
      W.line(cu, 36, cu, 41, "#3d4450");
      W.line(cu, 36, cu + 0.15, 36, "#3d4450");
      if (item.fx === "stars" || item.fx === "gears") for (let i = 0; i < 4; i++) W.dot(cu - 0.2 + i * 0.13, 31 + (i % 2) * 9, "#e0b04a");
      return;
    }
    case "wallshelf": {
      W.rect(a, 30, b, 32, c1);
      W.line(a, 32, b, 32, shade(c1, -0.4));
      for (let i = 0; i < len * 7; i++) W.rect(a + 0.05 + i * 0.12, 32, a + 0.13 + i * 0.12, 39 + (i % 3) * 2, (v === "" ? BOOKS : ["#f3e2bf", "#e0b04a"])[i % (v === "" ? 8 : 2)]!);
      if (item.fx === "stars") W.rect(u + len / 2 - 0.1, 40, u + len / 2 + 0.1, 44, "#f3e2bf");
      return;
    }
    case "garland": {
      for (let i = 0; i <= len * 8; i++) {
        const uu = a + (i / (len * 8)) * (b - a);
        const sag = Math.sin((i / (len * 8)) * Math.PI) * 5;
        W.dot(uu, 48 - sag, c1);
        if (i % 2 === 0) W.dot(uu, 47 - sag, c0);
      }
      return;
    }
    case "sconce": {
      const cu = u + len / 2;
      W.rect(cu - 0.06, 32, cu + 0.06, 38, c1);
      W.rect(cu - 0.16, 38, cu + 0.16, 44, c0);
      return;
    }
    case "curtain": {
      W.rect(a - 0.05, 52, b + 0.05, 54, c1);
      for (let i = 0; i < len * 6; i++) W.rect(a + i * (1 / 6), 14, a + i * (1 / 6) + 0.12, 52, i % 2 ? shade(c0, -0.15) : c0);
      return;
    }
    case "board": {
      W.frame(a, 22, b, 44, c1, c0);
      for (let i = 0; i < 5; i++) W.rect(a + 0.15 + i * 0.32, 27 + (i % 2) * 6, a + 0.35 + i * 0.32, 33 + (i % 2) * 6, ["#f3e2bf", "#7cc4e8", "#f3c178", "#d77f8e", "#ffffff"][i]!);
      return;
    }
    case "tvwall": {
      W.frame(a, 24, b, 44, "#2a2e36", c1);
      W.rect(a + 0.15, 30, a + 0.7, 32, "#ffffff");
      W.rect(a + 0.15, 35, b - 0.3, 37, alpha("#ffffff", 0.7));
      return;
    }
    case "window": {
      W.frame(a, 16, b, 48, c1, c0);
      W.line(u + len / 2, 17, u + len / 2, 47, c1);
      return;
    }
    case "plaque": {
      W.frame(a + 0.1, 28, b - 0.1, 40, shade(c1, -0.2), c0);
      W.line(a + 0.25, 34, b - 0.25, 34, c1);
      return;
    }
    case "calendar": {
      W.rect(a + 0.1, 24, b - 0.1, 44, "#f8f4ec");
      W.rect(a + 0.1, 40, b - 0.1, 44, c1);
      for (let i = 0; i < 9; i++) W.dot(a + 0.2 + (i % 3) * 0.2, 28 + Math.floor(i / 3) * 4, i === 4 ? c0 : "#8c9aa8");
      return;
    }
    case "hangplant": {
      const cu = u + len / 2;
      W.line(cu, 56, cu, 46, "#7a4f31");
      W.rect(cu - 0.18, 40, cu + 0.18, 46, c1);
      for (let i = 0; i < 6; i++) W.rect(cu - 0.3 + i * 0.1, 30 + (i % 3) * 3, cu - 0.22 + i * 0.1, 42, i % 2 ? c0 : shade(c0, -0.15));
      return;
    }
    case "vgarden": {
      W.frame(a, 12, b, 50, c1, shade(c1, -0.3));
      for (let i = 0; i < len * 10; i++) for (let j = 0; j < 6; j++) if ((i * 3 + j * 5) % 4 !== 0) W.dot(a + 0.08 + i * 0.09, 16 + j * 6 + (i % 2) * 2, (i + j) % 3 ? c0 : shade(c0, 0.25));
      return;
    }
    default:
      W.frame(a, 24, b, 40, c1, c0);
  }
}

/** Mezcla del tono de la sala con la luz cálida de nivel 2+. */
export function warm(color: string, level: number): string {
  return level >= 2 ? mix(color, "#ffcf8a", 0.06) : color;
}
