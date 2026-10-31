/**
 * Los 15 niveles de la especificación (§2). El nivel depende solo del total histórico de
 * reportes válidos. Cada regalo se entrega una vez, como instancia no vendible
 * (`source = level_reward`), y los de L1–L5 y L10 se colocan solos para que el cambio se vea.
 */

export type Feature =
  | "name" | "shop" | "editor" | "inventory" | "showcase" | "cat" | "librarian" | "room2" | "styles"
  | "floor2" | "bigShowcase" | "finalRoom" | "maxBadge";

export interface GiftPlacement {
  room: string;
  x: number;
  y: number;
  rot?: number;
}

export interface LevelGift {
  item: string;
  /** Una colocación por unidad; sin ella el regalo va al inventario. */
  place?: GiftPlacement[];
  qty?: number;
}

export interface LevelDef {
  level: number;
  reports: number;
  coins: number;
  title: string;
  summary: string;
  gifts: LevelGift[];
  features: Feature[];
  /** Estilos de suelo/pared/ventana que se regalan (L6). */
  styles?: string[];
  /** Estudiantes simultáneos como máximo en la biblioteca. */
  students: number;
  cinematic?: "build" | "cozy" | "cat" | "opening" | "expansion" | "floor" | "final";
}

/** Definición fija de una sala: lo que no cambia al ampliarla. */
export interface RoomSpec {
  id: string;
  name: string;
  floor: 0 | 1;
  level: number;
  /** Puerta en la pared izquierda (x = 0) a la altura `door`; casillas de acceso reservadas. */
  door: number | null;
  /** Escalera estructural (planta alta): rectángulo reservado por donde llegan los NPC. */
  stairs?: { x: number; y: number; w: number; h: number };
  /** Ventanas posibles en la pared derecha (y = 0); aparecen cuando la pared llega a ellas. */
  windows: { at: number; w: number }[];
  /** Crecimiento automático: tamaño a partir de cada nivel (siempre hacia +x / +y). */
  sizes: { level: number; w: number; h: number }[];
  /** Ampliaciones opcionales (+1 de ancho y +1 de fondo cada una), con su precio. */
  expansions: number[];
}

/**
 * Sala efectiva para un nivel y unas ampliaciones. Las salas solo crecen hacia +x / +y, de modo que
 * puerta, escalera, ventanas existentes y muebles colocados conservan sus coordenadas.
 */
export interface RoomDef extends Omit<RoomSpec, "sizes" | "expansions"> {
  w: number;
  h: number;
  /** Ampliaciones compradas aplicadas. */
  bought: number;
  /** Huecos de pared reservados para ventanas que aún no caben enteras. */
  futureWindows: { at: number; w: number }[];
}

export const ROOMS: RoomSpec[] = [
  {
    id: "r1", name: "Sala de estudio", floor: 0, level: 1, door: 6,
    windows: [{ at: 2, w: 2 }, { at: 9, w: 2 }, { at: 13, w: 2 }],
    sizes: [{ level: 1, w: 10, h: 9 }, { level: 3, w: 11, h: 10 }, { level: 6, w: 12, h: 11 }, { level: 9, w: 13, h: 12 }, { level: 13, w: 14, h: 13 }],
    expansions: [150, 300],
  },
  {
    id: "r2", name: "Sala de lectura", floor: 0, level: 5, door: 5,
    windows: [{ at: 1, w: 2 }, { at: 5, w: 2 }, { at: 10, w: 2 }],
    sizes: [{ level: 5, w: 10, h: 9 }, { level: 7, w: 11, h: 10 }, { level: 11, w: 12, h: 11 }, { level: 14, w: 13, h: 12 }],
    expansions: [200, 400],
  },
  {
    id: "r3", name: "Planta alta", floor: 1, level: 10, door: null, stairs: { x: 0, y: 5, w: 2, h: 2 },
    windows: [{ at: 1, w: 2 }, { at: 6, w: 2 }, { at: 10, w: 2 }],
    sizes: [{ level: 10, w: 11, h: 9 }, { level: 12, w: 12, h: 10 }, { level: 14, w: 13, h: 11 }],
    expansions: [250, 500],
  },
  {
    id: "r4", name: "Gran salón", floor: 1, level: 15, door: 7,
    windows: [{ at: 1, w: 2 }, { at: 4, w: 2 }, { at: 7, w: 2 }, { at: 11, w: 2 }, { at: 14, w: 2 }],
    sizes: [{ level: 15, w: 16, h: 14 }],
    expansions: [350, 700],
  },
];

export function getRoom(id: string): RoomSpec {
  const room = ROOMS.find((r) => r.id === id);
  if (!room) throw new Error(`Sala desconocida: ${id}`);
  return room;
}

/** Tamaño de una sala en un nivel con `bought` ampliaciones (antes de desbloquearla, el inicial). */
export function roomAt(id: string, level: number, bought = 0): RoomDef {
  const { sizes, expansions, ...spec } = getRoom(id);
  let size = sizes[0]!;
  for (const s of sizes) if (s.level <= level) size = s;
  const extra = Math.max(0, Math.min(expansions.length, Math.floor(bought)));
  const w = size.w + extra;
  const h = size.h + extra;
  return {
    ...spec, w, h, bought: extra,
    windows: spec.windows.filter((win) => win.at + win.w <= w),
    futureWindows: spec.windows.filter((win) => win.at < w && win.at + win.w > w),
  };
}

/** Tamaño máximo absoluto (nivel 15 con todas las ampliaciones): no hay más crecimiento. */
export function roomMax(id: string): RoomDef {
  return roomAt(id, MAX_LEVEL, getRoom(id).expansions.length);
}

/** Precio de la siguiente ampliación comprable, o null si ya está al máximo. */
export function nextExpansionPrice(id: string, bought: number): number | null {
  return getRoom(id).expansions[bought] ?? null;
}

export const LEVELS: LevelDef[] = [
  {
    level: 0, reports: 0, coins: 0, title: "Solar vacío", students: 0, features: [], gifts: [],
    summary: "Vista previa de tu biblioteca y de los próximos hitos.",
  },
  {
    level: 1, reports: 1, coins: 10, title: "Primera sala", students: 2, cinematic: "build",
    summary: "Se construye tu primera sala: mesa, 2 sillas, estantería y vitrina de logros. Entran 2 estudiantes.",
    features: ["name", "shop", "editor", "inventory", "showcase"],
    gifts: [
      { item: "P001", place: [{ room: "r1", x: 3, y: 3 }] },
      { item: "P011", qty: 2, place: [{ room: "r1", x: 2, y: 3, rot: 0 }, { room: "r1", x: 5, y: 4, rot: 2 }] },
      { item: "P021", place: [{ room: "r1", x: 4, y: 0 }] },
      { item: "X01", place: [{ room: "r1", x: 1, y: 0 }] },
    ],
  },
  {
    level: 2, reports: 3, coins: 15, title: "Ambiente acogedor", students: 3, cinematic: "cozy",
    summary: "Pack acogedor: planta, lámpara, cuadro y alfombra. Luz cálida y nuevas animaciones.",
    features: [],
    gifts: [
      { item: "P031", place: [{ room: "r1", x: 0, y: 1 }] },
      { item: "P043", place: [{ room: "r1", x: 7, y: 1 }] },
      { item: "P046", place: [{ room: "r1", x: 2, y: 0, rot: 1 }] },
      { item: "P051", place: [{ room: "r1", x: 3, y: 3 }] },
    ],
  },
  {
    level: 3, reports: 6, coins: 20, title: "Rincón de lectura", students: 4, cinematic: "cat",
    summary: "Sillón, estantería y lámpara de lectura. Llega un gato animado al que puedes poner nombre.",
    features: ["cat"],
    gifts: [
      { item: "P019", place: [{ room: "r1", x: 1, y: 4, rot: 1 }] },
      { item: "P022", place: [{ room: "r1", x: 0, y: 2, rot: 1 }] },
      { item: "P041", place: [{ room: "r1", x: 0, y: 4 }] },
    ],
  },
  {
    level: 4, reports: 10, coins: 25, title: "Inauguración", students: 5, cinematic: "opening",
    summary: "Recepción con mostrador, bibliotecario animado y más estudiantes. ¡Confeti!",
    features: ["librarian"],
    gifts: [{ item: "P061", place: [{ room: "r1", x: 5, y: 7 }] }],
  },
  {
    level: 5, reports: 16, coins: 50, title: "Segunda sala", students: 6, cinematic: "expansion",
    summary: "Segunda sala gratuita, amueblada en parte, y placa exclusiva no vendible.",
    features: ["room2"],
    gifts: [
      { item: "P004", place: [{ room: "r2", x: 3, y: 3 }] },
      { item: "P013", qty: 2, place: [{ room: "r2", x: 2, y: 3 }, { room: "r2", x: 5, y: 4 }] },
      { item: "P023", place: [{ room: "r2", x: 2, y: 0 }] },
      { item: "X02", place: [{ room: "r2", x: 3, y: 0, rot: 0 }] },
    ],
  },
  {
    level: 6, reports: 25, coins: 30, title: "Interiorismo", students: 7,
    summary: "Edición de paredes, suelos y ventanas. Suelo de espiga gratuito.",
    features: ["styles"], styles: ["floor-espiga"], gifts: [],
  },
  {
    level: 7, reports: 35, coins: 35, title: "Zona digital", students: 8,
    summary: "Ordenadores y escritorios informáticos. Pack informático gratuito.",
    features: [], gifts: [{ item: "P072" }, { item: "P016" }],
  },
  {
    level: 8, reports: 48, coins: 40, title: "Zona silenciosa", students: 9,
    summary: "Separadores y luces de lectura. Separador gratuito.",
    features: [], gifts: [{ item: "P066" }],
  },
  {
    level: 9, reports: 65, coins: 45, title: "Zona de descanso", students: 10,
    summary: "Sofás y sillones. Sofá gratuito.",
    features: [], gifts: [{ item: "P081" }],
  },
  {
    level: 10, reports: 100, coins: 100, title: "Segunda planta", students: 12, cinematic: "floor",
    summary: "Segunda planta gratuita con escalera y mobiliario inicial.",
    features: ["floor2"],
    gifts: [
      { item: "P006", place: [{ room: "r3", x: 4, y: 3 }] },
      { item: "P015", qty: 2, place: [{ room: "r3", x: 4, y: 2, rot: 1 }, { room: "r3", x: 5, y: 5, rot: 3 }] },
      { item: "P028", place: [{ room: "r3", x: 3, y: 0 }] },
    ],
  },
  {
    level: 11, reports: 125, coins: 50, title: "Zona cultural", students: 13,
    summary: "Expositores y vitrinas grandes. Vitrina decorativa gratuita y vitrina de logros grande (8 trofeos).",
    features: ["bigShowcase"], gifts: [{ item: "P070" }, { item: "X17" }],
  },
  {
    level: 12, reports: 155, coins: 60, title: "Diseño premium", students: 14,
    summary: "Mobiliario premium y estanterías de diseño. Librería monumental gratuita.",
    features: [], gifts: [{ item: "P030" }],
  },
  {
    level: 13, reports: 190, coins: 70, title: "Tecnología avanzada", students: 15,
    summary: "Pantallas interactivas. Pantalla exclusiva gratuita.",
    features: [], gifts: [{ item: "X05" }],
  },
  {
    level: 14, reports: 240, coins: 80, title: "Espacio monumental", students: 16,
    summary: "Grandes elementos centrales. Fuente de la lectura gratuita.",
    features: [], gifts: [{ item: "X06" }],
  },
  {
    level: 15, reports: 300, coins: 200, title: "Gran biblioteca", students: 18, cinematic: "final",
    summary: "Ampliación final: Gran salón, distintivo de nivel máximo y estatua exclusiva.",
    features: ["finalRoom", "maxBadge"],
    gifts: [{ item: "X07", place: [{ room: "r4", x: 4, y: 4 }] }],
  },
];

export const MAX_LEVEL = 15;

export function levelForReports(count: number): number {
  let level = 0;
  for (const def of LEVELS) if (count >= def.reports) level = def.level;
  return level;
}

export function nextLevel(level: number): LevelDef | null {
  return LEVELS[level + 1] ?? null;
}

export function hasFeature(level: number, feature: Feature): boolean {
  return LEVELS.some((l) => l.level <= level && l.features.includes(feature));
}

/** Salas desbloqueadas con su tamaño efectivo. */
export function roomsForLevel(level: number, expansions: Record<string, number> = {}): RoomDef[] {
  return ROOMS.filter((r) => r.level <= level).map((r) => roomAt(r.id, level, expansions[r.id]));
}

export function studentsForLevel(level: number): number {
  return LEVELS[Math.min(level, MAX_LEVEL)]!.students;
}

/** Texto de recompensa siguiente: «faltan N reportes válidos para …». */
export function nextRewardText(count: number): string | null {
  const next = LEVELS.find((l) => l.reports > count);
  if (!next) return null;
  const n = next.reports - count;
  return `Faltan ${n} ${n === 1 ? "reporte válido" : "reportes válidos"} para el nivel ${next.level}: ${next.title.toLowerCase()}`;
}

/**
 * Estilos de sala. Los de L6 se desbloquean con la edición; el de espiga es regalo exclusivo.
 * Los que tienen precio se compran en la tienda («Pared y suelo») a partir de su nivel.
 */
export interface StyleDef {
  id: string;
  kind: "floor" | "wall" | "window";
  name: string;
  colors: string[];
  minLevel: number;
  /** Dibujo del suelo (planks, tiles, checker…) o de la pared (wallpaper, brick, panels…). */
  pattern: string;
  /** Monedas que cuesta en la tienda; sin precio, se obtiene al llegar a su nivel. */
  price?: number;
  /** Solo si se ha recibido como regalo. */
  gift?: boolean;
}

export const STYLES: StyleDef[] = [
  { id: "floor-roble", kind: "floor", name: "Tarima de roble", colors: ["#c99a63", "#b98a55"], minLevel: 1, pattern: "planks" },
  { id: "floor-ajedrez", kind: "floor", name: "Baldosa ajedrez", colors: ["#e9e2d4", "#5d5a66"], minLevel: 6, pattern: "checker" },
  { id: "floor-moqueta", kind: "floor", name: "Moqueta verde", colors: ["#6f9461", "#668a59"], minLevel: 6, pattern: "carpet" },
  { id: "floor-terracota", kind: "floor", name: "Terracota", colors: ["#c77a52", "#b86c46"], minLevel: 6, pattern: "tiles" },
  { id: "floor-espiga", kind: "floor", name: "Parqué en espiga", colors: ["#a8743f", "#8d5e33"], minLevel: 6, pattern: "herringbone", gift: true },
  { id: "floor-pino", kind: "floor", name: "Tarima de pino", colors: ["#e3c693", "#cfae78"], minLevel: 2, pattern: "planks", price: 30 },
  { id: "floor-moqueta-azul", kind: "floor", name: "Moqueta azul", colors: ["#56739e", "#4b6791"], minLevel: 2, pattern: "carpet", price: 30 },
  { id: "floor-cuadros-rojos", kind: "floor", name: "Baldosa roja y crema", colors: ["#efe2c6", "#a8473e"], minLevel: 3, pattern: "checker", price: 45 },
  { id: "floor-nogal", kind: "floor", name: "Tarima de nogal", colors: ["#8f5f3a", "#7a4f2f"], minLevel: 4, pattern: "planks", price: 55 },
  { id: "floor-moqueta-burdeos", kind: "floor", name: "Moqueta burdeos", colors: ["#8e3d48", "#80353f"], minLevel: 5, pattern: "carpet", price: 65 },
  { id: "floor-hidraulica", kind: "floor", name: "Baldosa hidráulica", colors: ["#ece0c6", "#3f6f8a"], minLevel: 7, pattern: "hydraulic", price: 90 },
  { id: "floor-marmol", kind: "floor", name: "Mármol blanco", colors: ["#eeeae3", "#c8c1b6"], minLevel: 8, pattern: "marble", price: 110 },
  { id: "floor-pizarra", kind: "floor", name: "Pizarra", colors: ["#5d636b", "#4d535a"], minLevel: 9, pattern: "slate", price: 120 },
  { id: "floor-espiga-clara", kind: "floor", name: "Espiga de arce", colors: ["#d9b37d", "#c09862"], minLevel: 10, pattern: "herringbone", price: 140 },
  { id: "floor-mosaico", kind: "floor", name: "Mosaico romano", colors: ["#e6d3ad", "#9c5a3c"], minLevel: 12, pattern: "mosaic", price: 170 },
  { id: "floor-marmol-negro", kind: "floor", name: "Mármol negro", colors: ["#3b3b42", "#8c8577"], minLevel: 14, pattern: "marble", price: 210 },
  { id: "wall-crema", kind: "wall", name: "Crema", colors: ["#efe2c8", "#d9c7a5"], minLevel: 1, pattern: "wallpaper" },
  { id: "wall-salvia", kind: "wall", name: "Verde salvia", colors: ["#b9c9a7", "#9fb28b"], minLevel: 6, pattern: "wallpaper" },
  { id: "wall-azul", kind: "wall", name: "Azul noche", colors: ["#5b6d99", "#475984"], minLevel: 6, pattern: "wallpaper" },
  { id: "wall-ladrillo", kind: "wall", name: "Ladrillo visto", colors: ["#b8664a", "#9d5440"], minLevel: 6, pattern: "brick" },
  { id: "wall-melocoton", kind: "wall", name: "Melocotón", colors: ["#f2cfb6", "#dcae90"], minLevel: 2, pattern: "wallpaper", price: 30 },
  { id: "wall-lavanda", kind: "wall", name: "Lavanda", colors: ["#d4cae6", "#b3a6cf"], minLevel: 3, pattern: "wallpaper", price: 40 },
  { id: "wall-topos", kind: "wall", name: "Papel de topos", colors: ["#f3e7d0", "#c98552"], minLevel: 4, pattern: "dots", price: 55 },
  { id: "wall-rayas", kind: "wall", name: "Rayas marineras", colors: ["#eef1f4", "#5a7ca6"], minLevel: 5, pattern: "stripes", price: 65 },
  { id: "wall-madera", kind: "wall", name: "Boiserie de madera", colors: ["#a06f44", "#835a35"], minLevel: 7, pattern: "panels", price: 90 },
  { id: "wall-azulejo", kind: "wall", name: "Azulejo andaluz", colors: ["#f2ece1", "#2f6f9a"], minLevel: 8, pattern: "tiles", price: 110 },
  { id: "wall-ladrillo-blanco", kind: "wall", name: "Ladrillo blanco", colors: ["#ece6dc", "#d6cec2"], minLevel: 9, pattern: "brick", price: 120 },
  { id: "wall-verde-ingles", kind: "wall", name: "Verde inglés", colors: ["#466350", "#9db88f"], minLevel: 11, pattern: "damask", price: 150 },
  { id: "wall-burdeos", kind: "wall", name: "Damasco burdeos", colors: ["#7a3039", "#c98a6a"], minLevel: 13, pattern: "damask", price: 180 },
  { id: "wall-dorado", kind: "wall", name: "Papel dorado", colors: ["#e8cb7b", "#b8913f"], minLevel: 15, pattern: "damask", price: 230 },
  { id: "window-madera", kind: "window", name: "Ventana de madera", colors: ["#8d5e33", "#bfe3f2"], minLevel: 1, pattern: "frame" },
  { id: "window-arco", kind: "window", name: "Ventanal en arco", colors: ["#f1ece2", "#bfe3f2"], minLevel: 6, pattern: "arch" },
  { id: "window-vidriera", kind: "window", name: "Vidriera", colors: ["#4a3426", "#e7b85c"], minLevel: 6, pattern: "stained" },
];

export const DEFAULT_STYLE = { floor: "floor-roble", wall: "wall-crema", window: "window-madera" } as const;
