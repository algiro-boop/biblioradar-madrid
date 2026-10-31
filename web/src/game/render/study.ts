/**
 * Sala de estudio viva: materiales sobre la mesa de cada estudiante según su carrera (ambientación
 * ficticia, no ocupación real). Se pintan en el plano del tablero, orientados hacia quien estudia,
 * en la mitad de la casilla más cercana a su silla para no invadir al de enfrente.
 */

import type { Cell } from "../engine/layout";
import type { Act, Discipline } from "./characters";
import { alpha, Painter, shade } from "./pixel";

export interface StudyKit {
  discipline: Discipline;
  laptop: boolean;
  bottle: boolean;
  coffee: boolean;
  seed: number;
}

/** Hueco de trabajo en una mesa: borde más cercano al asiento, dirección hacia la mesa y altura. */
export interface DeskSpot {
  edge: [number, number];
  dir: Cell;
  z: number;
  /** La mesa ya tiene ordenador (escritorio informático o PC encima). */
  pc: boolean;
  /** Hay un objeto decorativo en esa casilla: se reduce el material. */
  crowded: boolean;
}

const LAPTOP_ODDS: Record<Discipline, number> = {
  medicina: 0.3, derecho: 0.35, ingenieria: 0.8, matematicas: 0.35, arquitectura: 0.55, historia: 0.25,
};

export function makeKit(discipline: Discipline, rand: () => number): StudyKit {
  return { discipline, laptop: rand() < LAPTOP_ODDS[discipline], bottle: rand() < 0.6, coffee: rand() < 0.35, seed: Math.floor(rand() * 1000) };
}

const INK = "#2f3540";
const PAPER = "#f8f4ec";

export function drawDeskProps(P: Painter, desk: DeskSpot, kit: StudyKit, act: Act, t: number) {
  const F = desk.dir;
  const R: Cell = [-F[1], F[0]];
  const z = desk.z + 0.1;
  const W = (r: number, f: number): [number, number] => [desk.edge[0] + R[0] * r + F[0] * f, desk.edge[1] + R[1] * r + F[1] * f];
  const quad = (r0: number, f0: number, r1: number, f1: number, c: string, dz = 0) =>
    P.quad([[...W(r0, f0), z + dz], [...W(r1, f0), z + dz], [...W(r1, f1), z + dz], [...W(r0, f1), z + dz]], c);
  const seg = (r0: number, f0: number, r1: number, f1: number, c: string, dz = 0.05) => P.line([...W(r0, f0), z + dz], [...W(r1, f1), z + dz], c);
  const slab = (r0: number, f0: number, r1: number, f1: number, h: number, c: string, dz = 0) => {
    const [ax, ay] = W(r0, f0);
    const [bx, by] = W(r1, f1);
    P.box(Math.min(ax, bx), Math.min(ay, by), z + dz, Math.abs(bx - ax), Math.abs(by - ay), h, c);
  };
  const vert = (r0: number, r1: number, f0: number, f1: number, z0: number, z1: number, c: string) =>
    P.quad([[...W(r0, f0), z + z0], [...W(r1, f0), z + z0], [...W(r1, f1), z + z1], [...W(r0, f1), z + z1]], c);
  const textLines = (r0: number, r1: number, f0: number, f1: number, n: number, c = "#b9b2a5") => {
    for (let i = 0; i < n; i++) {
      const f = f0 + ((f1 - f0) * (i + 0.5)) / n;
      seg(r0, f, r1 - ((i * 37 + kit.seed) % 5) * 0.015, f, c);
    }
  };
  /** Libro o cuaderno abierto con lomo central; devuelve las páginas para dibujar encima. */
  const openBook = (r0: number, r1: number, f0: number, f1: number, cover: string) => {
    quad(r0 - 0.02, f0 - 0.02, r1 + 0.02, f1 + 0.02, cover);
    quad(r0, f0, r1, f1, PAPER, 0.15);
    seg((r0 + r1) / 2, f0, (r0 + r1) / 2, f1, shade(PAPER, -0.25), 0.2);
  };
  const crowded = desk.crowded;
  const backFacing = F[0] + F[1] < 0;
  const laptop = (kit.laptop || kit.discipline === "ingenieria" && !crowded) && !desk.pc;

  // ---------------------------------------------------------------- documento principal
  const main: [number, number, number, number] = laptop ? [-0.47, 0.06, -0.2, 0.34] : [-0.24, 0.05, 0.24, 0.38];
  const [mr0, mf0, mr1, mf1] = main;
  const mid = (mr0 + mr1) / 2;
  const pageTurn = act === "turn" ? (t % 1.2) / 1.2 : -1;
  switch (kit.discipline) {
    case "medicina": {
      openBook(mr0, mr1, mf0, mf1, "#a63d3d");
      // Lámina anatómica: figura humana con órganos en rojo
      const cx = (mr0 + mid) / 2;
      const cf = (mf0 + mf1) / 2;
      P.disc(...W(cx, cf - 0.08), z + 0.3, 0.03, "#c94a4a");
      seg(cx, cf - 0.05, cx, cf + 0.07, "#c94a4a", 0.3);
      seg(cx - 0.05, cf - 0.02, cx + 0.05, cf - 0.02, "#c94a4a", 0.3);
      seg(cx, cf + 0.07, cx - 0.04, cf + 0.13, "#c94a4a", 0.3);
      seg(cx, cf + 0.07, cx + 0.04, cf + 0.13, "#c94a4a", 0.3);
      P.px(...W(cx + 0.01, cf), z + 0.4, "#7a1f2a");
      textLines(mid + 0.02, mr1 - 0.02, mf0 + 0.02, mf1 - 0.02, 5);
      if (!crowded) {
        // Fichas de repaso
        for (let i = 0; i < 3; i++) quad(0.28 + i * 0.012, 0.08 + i * 0.015, 0.44 + i * 0.012, 0.2 + i * 0.015, i === 2 ? "#ffffff" : "#eef2f5", 0.2 + i * 0.25);
        quad(0.3, 0.12, 0.42, 0.13, "#d77f8e", 1);
      }
      break;
    }
    case "derecho": {
      openBook(mr0, mr1, mf0, mf1, "#5a2430");
      textLines(mr0 + 0.02, mid - 0.02, mf0 + 0.02, mf1 - 0.02, 7, "#a9a196");
      textLines(mid + 0.02, mr1 - 0.02, mf0 + 0.02, mf1 - 0.02, 7, "#a9a196");
      // Pestañas adhesivas asomando
      for (let i = 0; i < 3; i++) quad(mr1 - 0.02, mf0 + 0.04 + i * 0.08, mr1 + 0.03, mf0 + 0.08 + i * 0.08, ["#f2e24a", "#ef8fb0", "#7cc4e8"][i]!, 0.2);
      if (!crowded) {
        // Código grueso cerrado con banda dorada
        slab(0.27, 0.06, 0.46, 0.34, 2.6, "#7a2f3a");
        seg(0.27, 0.12, 0.46, 0.12, "#e0b04a", 2.75);
      }
      break;
    }
    case "ingenieria": {
      quad(mr0, mf0, mr1, mf1, "#2f5f9e");
      for (let i = 1; i < 5; i++) seg(mr0 + ((mr1 - mr0) * i) / 5, mf0, mr0 + ((mr1 - mr0) * i) / 5, mf1, alpha("#ffffff", 0.25));
      for (let i = 1; i < 4; i++) seg(mr0, mf0 + ((mf1 - mf0) * i) / 4, mr1, mf0 + ((mf1 - mf0) * i) / 4, alpha("#ffffff", 0.25));
      P.disc(...W(mid, (mf0 + mf1) / 2), z + 0.2, 0.06, "#e8f1ff");
      P.disc(...W(mid, (mf0 + mf1) / 2), z + 0.25, 0.035, "#2f5f9e");
      seg(mr0 + 0.03, mf1 - 0.04, mr1 - 0.03, mf1 - 0.04, "#e8f1ff");
      if (!crowded) {
        slab(0.3, 0.3, 0.42, 0.42, 0.8, "#3d4450");
        quad(0.32, 0.32, 0.4, 0.36, "#9fd6a0", 0.9);
      }
      break;
    }
    case "matematicas": {
      quad(mr0, mf0, mr1, mf1, "#fbf8f0");
      for (let i = 1; i < 6; i++) seg(mr0, mf0 + ((mf1 - mf0) * i) / 6, mr1, mf0 + ((mf1 - mf0) * i) / 6, alpha("#7cc4e8", 0.45));
      for (let i = 1; i < 6; i++) seg(mr0 + ((mr1 - mr0) * i) / 6, mf0, mr0 + ((mr1 - mr0) * i) / 6, mf1, alpha("#7cc4e8", 0.3));
      // Fórmulas: integrales y fracciones garabateadas
      for (let i = 0; i < 4; i++) {
        const f = mf0 + 0.05 + i * 0.075;
        seg(mr0 + 0.03, f, mr0 + 0.05, f - 0.03, INK, 0.2);
        seg(mr0 + 0.07, f, mr0 + 0.14 + (i % 2) * 0.06, f, INK, 0.2);
        seg(mr0 + 0.07, f - 0.02, mr0 + 0.12, f - 0.02, INK, 0.2);
      }
      if (!crowded) {
        slab(0.29, 0.1, 0.4, 0.28, 0.8, "#2a2f38");
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) P.px(...W(0.31 + i * 0.03, 0.16 + j * 0.035), z + 0.9, "#d8dde3");
        seg(0.27, 0.32, 0.45, 0.38, "#e0b04a", 0.6);
      }
      break;
    }
    case "arquitectura": {
      quad(mr0 - 0.02, mf0, mr1 + 0.02, mf1 + 0.04, "#fdfdfb");
      // Plano de planta: muros y una puerta en arco
      const a = mr0 + 0.04;
      const b = mr1 - 0.04;
      const c = mf0 + 0.04;
      const d = mf1 - 0.02;
      seg(a, c, b, c, INK, 0.2);
      seg(b, c, b, d, INK, 0.2);
      seg(a, d, b, d, INK, 0.2);
      seg(a, c, a, d, INK, 0.2);
      seg((a + b) / 2, c, (a + b) / 2, (c + d) / 2, INK, 0.2);
      seg(a, (c + d) / 2, (a + b) / 2 - 0.04, (c + d) / 2, INK, 0.2);
      if (!crowded) {
        // Escuadra translúcida y regla
        P.quad([[...W(0.26, 0.06), z + 0.4], [...W(0.46, 0.06), z + 0.4], [...W(0.26, 0.3), z + 0.4]], alpha("#7cc4e8", 0.55));
        seg(0.26, 0.06, 0.46, 0.06, "#4c78b5", 0.45);
        slab(-0.4, 0.4, 0.4, 0.44, 0.4, "#e8d9b8");
      }
      break;
    }
    default: {
      // Historia: mapa antiguo con costas y ruta, y libro de cuero
      quad(mr0, mf0, mr1, mf1, "#e8d2a6");
      quad(mr0 + 0.02, mf0 + 0.02, mr1 - 0.02, mf1 - 0.02, "#efdcb5", 0.05);
      seg(mr0 + 0.04, mf0 + 0.1, mid, mf0 + 0.06, "#8a6a3f", 0.1);
      seg(mid, mf0 + 0.06, mr1 - 0.05, mf0 + 0.16, "#8a6a3f", 0.1);
      seg(mr0 + 0.06, mf1 - 0.06, mr1 - 0.08, mf1 - 0.1, "#8a6a3f", 0.1);
      for (let i = 0; i < 4; i++) P.px(...W(mr0 + 0.07 + i * 0.07, mf0 + 0.2 + (i % 2) * 0.02), z + 0.2, "#b84a44");
      if (!crowded) {
        slab(0.27, 0.08, 0.46, 0.34, 2.2, "#6b4226");
        seg(0.27, 0.2, 0.46, 0.2, "#e0b04a", 2.35);
      }
    }
  }
  // Página que pasa (libros abiertos)
  if (pageTurn >= 0 && (kit.discipline === "medicina" || kit.discipline === "derecho")) {
    const k = pageTurn;
    const lift = Math.sin(k * Math.PI) * 5;
    const end = mid + (mr1 - mid) * Math.cos(k * Math.PI);
    P.quad([[...W(mid, mf0), z + 0.3], [...W(end, mf0), z + 0.3 + lift], [...W(end, mf1), z + 0.3 + lift], [...W(mid, mf1), z + 0.3]], "#ffffff");
  }
  // Subrayado que avanza
  if (act === "highlight") {
    const k = (t % 4) / 4;
    const f = mf0 + (mf1 - mf0) * 0.45;
    quad(mr0 + 0.04, f - 0.012, mr0 + 0.04 + (mr1 - mr0 - 0.08) * k, f + 0.012, alpha("#f2e24a", 0.85), 0.3);
  } else if (kit.discipline !== "ingenieria") {
    const f = mf0 + (mf1 - mf0) * 0.45;
    quad(mr0 + 0.04, f - 0.012, mr0 + 0.04 + (mr1 - mr0 - 0.08) * 0.55, f + 0.012, alpha("#f2e24a", 0.6), 0.3);
  }
  // Apuntes que crecen al escribir
  if (act === "write") {
    const n = 1 + (Math.floor(t / 1.4) % 5);
    for (let i = 0; i < n; i++) seg(mid + 0.03, mf0 + 0.05 + i * 0.05, mid + 0.06 + ((i * 3 + kit.seed) % 4) * 0.03, mf0 + 0.05 + i * 0.05, "#2c3f6e", 0.3);
  }
  // Bolígrafo o subrayador cuando no está en la mano
  if (act !== "write" && act !== "highlight") seg(mr1 - 0.1, mf1 - 0.02, mr1 - 0.02, mf1 - 0.12, (kit.seed % 2) ? "#2c3f6e" : "#f2e24a", 0.6);

  // ---------------------------------------------------------------- portátil
  if (laptop) {
    const typing = act === "type";
    slab(-0.14, 0.1, 0.24, 0.34, 0.6, "#c9ced6");
    quad(-0.11, 0.13, 0.21, 0.27, "#3d4450", 0.62);
    if (typing) for (let i = 0; i < 3; i++) P.px(...W(-0.08 + ((Math.floor(t * 9) + i * 5) % 8) * 0.035, 0.17 + i * 0.03), z + 0.7, "#f8f4ec");
    if (backFacing) {
      // Se ve la pantalla: contenido según la carrera
      vert(-0.14, 0.24, 0.34, 0.39, 0.6, 9.6, "#2a2f38");
      const screen = kit.discipline === "ingenieria" ? "#1d2633" : kit.discipline === "arquitectura" ? "#f4f6f8" : kit.discipline === "medicina" ? "#f6eeee" : "#fdfdfb";
      vert(-0.11, 0.21, 0.345, 0.385, 1.4, 8.8, screen);
      for (let i = 0; i < 5; i++) {
        const zz = 7.6 - i * 1.3;
        const len = 0.06 + ((i * 7 + kit.seed) % 5) * 0.035;
        const col = kit.discipline === "ingenieria" ? ["#7fd6b0", "#7cc4e8", "#f3c178"][i % 3]! : kit.discipline === "arquitectura" ? "#3d4450" : kit.discipline === "medicina" && i === 1 ? "#c94a4a" : "#9aa3ad";
        vert(-0.08 + (kit.discipline === "ingenieria" ? (i % 2) * 0.04 : 0), -0.08 + len, 0.346, 0.346 + (zz / 10) * 0.04, zz, zz + 0.6, col);
      }
      if (typing && Math.floor(t * 2) % 2 === 0) vert(0.12, 0.14, 0.346, 0.37, 2, 3, kit.discipline === "ingenieria" ? "#ffffff" : "#2c3f6e");
    } else {
      // Tapa por detrás con logotipo
      vert(-0.14, 0.24, 0.34, 0.39, 0.6, 9.6, "#b7bec8");
      vert(0.02, 0.08, 0.36, 0.37, 4.6, 5.6, "#f1ece2");
    }
  }

  // ---------------------------------------------------------------- bebida y extras
  const sideR = laptop ? 0.36 : -0.38;
  if (kit.bottle && act !== "drink" && !crowded) {
    slab(sideR - 0.05, 0.26, sideR + 0.05, 0.36, 6, "#7cc4e8");
    slab(sideR - 0.03, 0.28, sideR + 0.03, 0.34, 1.2, "#3d4450", 6);
  } else if (kit.coffee && act !== "drink" && !crowded) {
    slab(sideR - 0.05, 0.26, sideR + 0.05, 0.36, 3, "#f1ece2");
    quad(sideR - 0.04, 0.27, sideR + 0.04, 0.35, "#6b4226", 3);
  }
}
