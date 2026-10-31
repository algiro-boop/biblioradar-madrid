/**
 * Sol de Madrid y luz del juego. La altura del sol sale de las fórmulas de baja precisión del
 * Almanaque Náutico (error < 0,1°), así el amanecer, el atardecer y la noche de la biblioteca
 * coinciden con los de Madrid cualquier día del año, cambios de hora incluidos.
 */

import { DAY_MS, madridMidnightMs } from "./time";

const LAT = 40.4168;
const LON = -3.7038;
const RAD = Math.PI / 180;
/** 2000-01-01 12:00 UTC (época J2000). */
const J2000 = 946_728_000_000;
/** Altura del sol en la salida y la puesta oficiales (refracción y radio del disco). */
export const HORIZON = -0.833;

/** Altura del sol en grados y si aún no ha pasado por el mediodía solar. */
export function sunPosition(ms: number): { elevation: number; morning: boolean } {
  const d = (ms - J2000) / DAY_MS;
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const lon = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const tilt = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(tilt) * Math.sin(lon), Math.cos(lon));
  const dec = Math.asin(Math.sin(tilt) * Math.sin(lon));
  const sidereal = (280.46061837 + 360.98564736629 * d + LON) * RAD;
  // Ángulo horario en (−π, π]: negativo antes del mediodía solar.
  const hour = Math.atan2(Math.sin(sidereal - ra), Math.cos(sidereal - ra));
  const sinAlt = Math.sin(LAT * RAD) * Math.sin(dec) + Math.cos(LAT * RAD) * Math.cos(dec) * Math.cos(hour);
  return { elevation: Math.asin(sinAlt) / RAD, morning: hour < 0 };
}

/** Salida y puesta del sol en Madrid ese día (instantes UTC), buscadas minuto a minuto. */
export function sunTimes(key: string): { sunrise: number; sunset: number } {
  const start = madridMidnightMs(key);
  let sunrise = start + 7 * 3_600_000;
  let sunset = start + 19 * 3_600_000;
  let prev = sunPosition(start).elevation;
  for (let m = 1; m <= 1440; m++) {
    const t = start + m * 60_000;
    const cur = sunPosition(t).elevation;
    // Interpolación lineal dentro del minuto en que cruza el horizonte.
    const at = t - 60_000 + ((HORIZON - prev) / (cur - prev)) * 60_000;
    if (prev < HORIZON && cur >= HORIZON) sunrise = at;
    if (prev >= HORIZON && cur < HORIZON) sunset = at;
    prev = cur;
  }
  return { sunrise, sunset };
}

export type SkyPhase = "night" | "dawn" | "day" | "dusk";

export interface Daylight {
  phase: SkyPhase;
  elevation: number;
  /** Cielo de las ventanas: arriba y junto al horizonte. */
  zenith: string;
  horizon: string;
  /**
   * Velos sobre toda la sala, en orden: penumbra (azul de noche, violeta con el sol bajo) y
   * brillo de color (rosa al alba, naranja al atardecer). Un solo velo cálido no se distingue
   * sobre suelos de madera, que ya son anaranjados.
   */
  veils: { color: string; alpha: number }[];
  /** Oscuridad (0–0,34): aviva los halos de las lámparas. */
  night: number;
  /** Visibilidad de estrellas y luna (0–1). */
  stars: number;
  /** Nubes blancas de día (0–1). */
  clouds: number;
  /** Disco del sol en la ventana: altura (0 abajo, 1 arriba) y color; null si no se ve. */
  sun: { y: number; color: string } | null;
  /** Haz de luz en el suelo: color y largo en casillas; null sin sol. */
  beam: { color: string; length: number } | null;
}

// Fotogramas por altura del sol. Mañana y tarde comparten el cénit; el horizonte y el velo
// cambian: el alba tira a rosa y melocotón, el atardecer a naranja y rojo.
const SKY: [number, string, string, string][] = [
  // altura, cénit, horizonte al alba, horizonte al atardecer
  [-12, "#121735", "#1b2142", "#1b2142"],
  [-7, "#232a55", "#5a4a7a", "#4f3f72"],
  [-3, "#3d4a86", "#e08aa8", "#e0603e"],
  [0, "#6f8ccc", "#ffa8a8", "#ff7434"],
  [4, "#86b4e2", "#ffd0bc", "#ffa04c"],
  [10, "#94cdf0", "#d8eef8", "#ecdcbc"],
  [20, "#9fd3f0", "#c4e7f6", "#c4e7f6"],
];
const VEIL: [number, string, string, number, string, string, number][] = [
  // altura, penumbra al alba / al atardecer y opacidad, brillo al alba / al atardecer y opacidad
  [-12, "#12163a", "#12163a", 0.34, "#b0609a", "#a04870", 0],
  [-7, "#1e1c52", "#1e1a4a", 0.28, "#b0609a", "#a04870", 0.06],
  [-3, "#2e2a66", "#32224e", 0.2, "#ff8aa8", "#ff6a4a", 0.16],
  [0, "#3a3a78", "#4a2a5a", 0.12, "#ffa0a8", "#ff6a2a", 0.24],
  [4, "#3a3a78", "#4a2a5a", 0.05, "#ffc0a8", "#ff8a3a", 0.16],
  [10, "#3a3a78", "#4a2a5a", 0, "#ffe0b0", "#ffc890", 0],
];

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

function hexMix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) + (((pb >> s) & 255) - ((pa >> s) & 255)) * t);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0")}`;
}

/** Fotograma interpolado de una tabla ordenada por altura. */
function frame<T extends [number, ...unknown[]]>(table: T[], e: number): [T, T, number] {
  if (e <= table[0]![0]) return [table[0]!, table[0]!, 0];
  for (let i = 1; i < table.length; i++) {
    const hi = table[i]!;
    if (e <= hi[0]) {
      const lo = table[i - 1]!;
      return [lo, hi, (e - lo[0]) / (hi[0] - lo[0])];
    }
  }
  const last = table[table.length - 1]!;
  return [last, last, 0];
}

/** Instante representativo de cada momento de ese día (vista previa del modo desarrollador). */
export function phaseInstant(key: string, phase: SkyPhase): number {
  const { sunrise, sunset } = sunTimes(key);
  if (phase === "dawn") return sunrise + 6 * 60_000;
  if (phase === "dusk") return sunset - 12 * 60_000;
  if (phase === "night") return sunset + 150 * 60_000;
  return (sunrise + sunset) / 2;
}

/** Luz de la biblioteca en un instante, según el sol real de Madrid. */
export function daylight(ms: number): Daylight {
  const { elevation: e, morning } = sunPosition(ms);
  const [s0, s1, st] = frame(SKY, e);
  const [v0, v1, vt] = frame(VEIL, e);
  const side = morning ? 2 : 3;
  const veil = (color: number, opacity: number) => ({
    color: hexMix(v0[color] as string, v1[color] as string, vt),
    alpha: (v0[opacity] as number) + ((v1[opacity] as number) - (v0[opacity] as number)) * vt,
  });
  const phase: SkyPhase = e < -8 ? "night" : e < 8 ? (morning ? "dawn" : "dusk") : "day";
  const golden = clamp01((12 - e) / 12);
  return {
    phase,
    elevation: e,
    zenith: hexMix(s0[1], s1[1], st),
    horizon: hexMix(s0[side] as string, s1[side] as string, st),
    veils: [veil(morning ? 1 : 2, 3), veil(morning ? 4 : 5, 6)].filter((v) => v.alpha > 0.005),
    night: clamp01((3 - e) / 15) * 0.34,
    stars: clamp01((-4 - e) / 6),
    clouds: clamp01((e - 2) / 8),
    sun: e > -1.5 && e < 14 ? { y: clamp01((e + 1.5) / 15.5), color: hexMix("#ff5a24", "#fff1b0", clamp01(e / 12)) } : null,
    beam: e > 0 ? { color: hexMix("#ffecb4", morning ? "#ffb48a" : "#ff9a50", golden), length: 3.2 + golden * 2.4 } : null,
  };
}
