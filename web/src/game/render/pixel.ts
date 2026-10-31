/**
 * Primitivas pixel art sin antialiasing: todo se pinta con fillRect en coordenadas enteras sobre
 * un lienzo a resolución nativa, que luego se escala con vecino más próximo.
 */

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type Pt = [number, number];

/**
 * Casilla isométrica 2:1 en píxeles nativos. Las alturas (z) se expresan en «unidades» y se
 * proyectan multiplicadas por ZS: el arte se diseñó en unidades y se pinta a doble resolución,
 * con líneas y detalles de 1 píxel real (más finos que una unidad).
 */
export const ZS = 2;
export const TW = 32 * ZS;
export const TH = 16 * ZS;
export const WALL_H = 60;

export function rect(ctx: Ctx2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

export function dot(ctx: Ctx2D, x: number, y: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
}

/** Relleno de polígono convexo por líneas de barrido (bordes nítidos). */
export function poly(ctx: Ctx2D, pts: Pt[], color: string) {
  if (pts.length < 3) return;
  ctx.fillStyle = color;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of pts) {
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  for (let y = Math.floor(minY); y < Math.ceil(maxY); y++) {
    const sy = y + 0.5;
    let x0 = Infinity;
    let x1 = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i]!;
      const [bx, by] = pts[(i + 1) % pts.length]!;
      if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) {
        const x = ax + ((sy - ay) / (by - ay)) * (bx - ax);
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
      }
    }
    if (x1 > x0) ctx.fillRect(Math.round(x0), y, Math.max(1, Math.round(x1) - Math.round(x0)), 1);
  }
}

/** Línea de Bresenham (las de pendiente 2:1 salen como en el pixel art isométrico clásico). */
export function line(ctx: Ctx2D, x0: number, y0: number, x1: number, y1: number, color: string) {
  ctx.fillStyle = color;
  let ax = Math.round(x0);
  let ay = Math.round(y0);
  const bx = Math.round(x1);
  const by = Math.round(y1);
  const dx = Math.abs(bx - ax);
  const dy = -Math.abs(by - ay);
  const sx = ax < bx ? 1 : -1;
  const sy = ay < by ? 1 : -1;
  let err = dx + dy;
  for (let guard = 0; guard < 2000; guard++) {
    ctx.fillRect(ax, ay, 1, 1);
    if (ax === bx && ay === by) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      ax += sx;
    }
    if (e2 <= dx) {
      err += dx;
      ay += sy;
    }
  }
}

export function ellipse(ctx: Ctx2D, cx: number, cy: number, rx: number, ry: number, color: string) {
  ctx.fillStyle = color;
  for (let y = -ry; y <= ry; y++) {
    const half = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y / (ry + 0.5)) ** 2)));
    ctx.fillRect(Math.round(cx - half), Math.round(cy + y), half * 2 + 1, 1);
  }
}

// ------------------------------------------------------------------ color

function parse(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;

const shadeCache = new Map<string, string>();

/** Aclara (amt > 0) u oscurece (amt < 0) con un ligero giro cálido en las sombras. */
export function shade(hex: string, amt: number): string {
  const key = `${hex}|${amt}`;
  const hit = shadeCache.get(key);
  if (hit) return hit;
  const [r, g, b] = parse(hex);
  const out = amt >= 0
    ? toHex(r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt)
    : toHex(r * (1 + amt) + 6 * -amt, g * (1 + amt), b * (1 + amt) + 14 * -amt);
  shadeCache.set(key, out);
  return out;
}

export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  return toHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

export function alpha(hex: string, a: number): string {
  const [r, g, b] = parse(hex);
  return `rgba(${r},${g},${b},${a})`;
}

// ------------------------------------------------------------------ proyección

export interface Iso {
  /** Origen en pantalla de la esquina (0,0) del suelo. */
  ox: number;
  oy: number;
}

export function project(o: Iso, gx: number, gy: number, z = 0): Pt {
  return [o.ox + (gx - gy) * (TW / 2), o.oy + (gx + gy) * (TH / 2) - z * ZS];
}

/** Inversa de `project` sobre el plano del suelo (z = 0). */
export function unproject(o: Iso, sx: number, sy: number): Pt {
  const a = (sx - o.ox) / (TW / 2);
  const b = (sy - o.oy) / (TH / 2);
  return [(a + b) / 2, (b - a) / 2];
}

export interface Tone {
  top: string;
  left: string;
  right: string;
  line: string;
}

export function tone(base: string): Tone {
  return { top: shade(base, 0.16), left: base, right: shade(base, -0.2), line: shade(base, -0.5) };
}

/**
 * Pintor en coordenadas locales de casilla (x, y) y altura en píxeles (z), desplazado al
 * origen del objeto. Es lo que usan los dibujantes de muebles.
 */
export class Painter {
  constructor(public ctx: Ctx2D, public o: Iso) {}

  p(x: number, y: number, z = 0): Pt {
    return project(this.o, x, y, z);
  }

  /** Prisma isométrico con caras superior, izquierda y derecha y contorno superior. */
  box(x: number, y: number, z: number, w: number, d: number, h: number, color: string | Tone, outline = true) {
    const t = typeof color === "string" ? tone(color) : color;
    const top = z + h;
    const A = this.p(x, y, top);
    const B = this.p(x + w, y, top);
    const C = this.p(x + w, y + d, top);
    const D = this.p(x, y + d, top);
    if (h > 0) {
      poly(this.ctx, [D, C, this.p(x + w, y + d, z), this.p(x, y + d, z)], t.left);
      poly(this.ctx, [B, C, this.p(x + w, y + d, z), this.p(x + w, y, z)], t.right);
    }
    poly(this.ctx, [A, B, C, D], t.top);
    if (outline) {
      line(this.ctx, A[0], A[1], B[0], B[1], t.line);
      line(this.ctx, A[0], A[1], D[0], D[1], t.line);
      if (h > 0.5 && t.top.startsWith("#")) {
        // Canto delantero iluminado: da volumen y define la silueta a doble resolución.
        const hl = shade(t.top, 0.22);
        line(this.ctx, D[0], D[1], C[0], C[1], hl);
        line(this.ctx, C[0], C[1], B[0], B[1], hl);
      }
      if (h > 1) {
        const bottom = this.p(x + w, y + d, z);
        line(this.ctx, C[0], C[1] + 1, bottom[0], bottom[1] - 1, shade(t.left, -0.28));
      }
    }
  }

  quad(points: [number, number, number][], color: string) {
    poly(this.ctx, points.map(([x, y, z]) => this.p(x, y, z)), color);
  }

  /** Punto de una unidad (ZS × ZS píxeles). */
  dot(x: number, y: number, z: number, color: string) {
    const [sx, sy] = this.p(x, y, z);
    rect(this.ctx, sx, sy, ZS, ZS, color);
  }

  /** Píxel real (detalle fino). */
  px(x: number, y: number, z: number, color: string) {
    const [sx, sy] = this.p(x, y, z);
    dot(this.ctx, sx, sy, color);
  }

  line(a: [number, number, number], b: [number, number, number], color: string) {
    const [x0, y0] = this.p(...a);
    const [x1, y1] = this.p(...b);
    line(this.ctx, x0, y0, x1, y1, color);
  }

  /** Columna vertical desde z hasta z + h (unidades); anchura en unidades. */
  vline(x: number, y: number, z: number, h: number, color: string, width = 1) {
    const [sx, sy] = this.p(x, y, z);
    rect(this.ctx, sx, sy - h * ZS, width * ZS, h * ZS, color);
  }

  /** Elipse horizontal (disco visto en isométrico) centrada en (x, y, z); r en casillas. */
  disc(x: number, y: number, z: number, r: number, color: string) {
    const [sx, sy] = this.p(x, y, z);
    ellipse(this.ctx, sx, sy, Math.max(1, r * TW * 0.5), Math.max(1, r * TH * 0.5), color);
  }

  /** Bola (hojas, esferas) de radio r en unidades. */
  blob(x: number, y: number, z: number, r: number, color: string) {
    const [sx, sy] = this.p(x, y, z);
    const R = r * ZS;
    ellipse(this.ctx, sx, sy, R, Math.max(1, Math.round(R * 0.85)), color);
  }

  /** Bola con luz arriba-izquierda y sombra abajo-derecha (follaje, cojines, esferas). */
  ball(x: number, y: number, z: number, r: number, color: string) {
    const [sx, sy] = this.p(x, y, z);
    const R = r * ZS;
    const ry = Math.max(1, Math.round(R * 0.85));
    ellipse(this.ctx, sx, sy, R, ry, shade(color, -0.22));
    ellipse(this.ctx, sx - Math.round(R * 0.15), sy - Math.round(ry * 0.15), Math.round(R * 0.8), Math.round(ry * 0.8), color);
    ellipse(this.ctx, sx - Math.round(R * 0.35), sy - Math.round(ry * 0.4), Math.max(1, Math.round(R * 0.3)), Math.max(1, Math.round(ry * 0.25)), shade(color, 0.25));
  }
}

/** Pintor sobre el plano de una pared: u a lo largo de la pared (casillas), v altura (px). */
export class WallPainter {
  constructor(public ctx: Ctx2D, public o: Iso, public wall: "R" | "L", public lift = 0.02) {}

  p(u: number, v: number): Pt {
    return this.wall === "R" ? project(this.o, u, this.lift, v) : project(this.o, this.lift, u, v);
  }

  rect(u0: number, v0: number, u1: number, v1: number, color: string) {
    poly(this.ctx, [this.p(u0, v0), this.p(u1, v0), this.p(u1, v1), this.p(u0, v1)], color);
  }

  dot(u: number, v: number, color: string) {
    const [x, y] = this.p(u, v);
    rect(this.ctx, x, y, ZS, ZS, color);
  }

  line(u0: number, v0: number, u1: number, v1: number, color: string) {
    const [x0, y0] = this.p(u0, v0);
    const [x1, y1] = this.p(u1, v1);
    line(this.ctx, x0, y0, x1, y1, color);
  }

  /** Marco con borde de 1 píxel (en unidades de pared). */
  frame(u0: number, v0: number, u1: number, v1: number, border: string, fill: string) {
    this.rect(u0, v0, u1, v1, border);
    const bu = 1.5 / TW;
    this.rect(u0 + bu * 2, v0 + 1.5, u1 - bu * 2, v1 - 1.5, fill);
  }
}

/**
 * Contorno de 1 píxel alrededor de lo opaco de un lienzo (estilo sprite): se pinta solo en los
 * píxeles transparentes que tocan uno opaco, sin tapar el dibujo.
 */
export function outlineCanvas(canvas: HTMLCanvasElement, color: [number, number, number, number]) {
  const ctx = canvas.getContext("2d")!;
  const { width: w, height: h } = canvas;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const solid = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) solid[i] = d[i * 4 + 3]! > 90 ? 1 : 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (solid[i]) continue;
    const n = (x > 0 && solid[i - 1]) || (x < w - 1 && solid[i + 1]) || (y > 0 && solid[i - w]) || (y < h - 1 && solid[i + w]);
    if (!n || d[i * 4 + 3]! > 0) continue;
    d[i * 4] = color[0];
    d[i * 4 + 1] = color[1];
    d[i * 4 + 2] = color[2];
    d[i * 4 + 3] = color[3];
  }
  ctx.putImageData(img, 0, 0);
}
