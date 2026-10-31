/**
 * Bibliotecas virtuales públicas FICTICIAS para el entorno de pruebas: permiten probar visitas,
 * «me gusta» y las misiones de exploración sin otros usuarios reales. Alias inventados.
 */

import { seeded, shuffle } from "../rng";
import type { RoomStyle } from "../engine/types";

export interface NeighborPlacement {
  itemId: string;
  room: string;
  x: number;
  y: number;
  rot: number;
}

export interface NeighborLibrary {
  id: string;
  alias: string;
  libraryName: string;
  level: number;
  rooms: string[];
  styles: Record<string, RoomStyle>;
  placements: NeighborPlacement[];
}

// Distribuciones base válidas (sala 8×8, puerta en la casilla 6 de la pared izquierda).
const TEMPLATES: NeighborPlacement[][] = [
  [
    { itemId: "P006", room: "r1", x: 3, y: 3, rot: 0 }, { itemId: "P015", room: "r1", x: 3, y: 2, rot: 1 },
    { itemId: "P015", room: "r1", x: 5, y: 5, rot: 3 }, { itemId: "P028", room: "r1", x: 4, y: 0, rot: 0 },
    { itemId: "P034", room: "r1", x: 0, y: 1, rot: 0 }, { itemId: "P052", room: "r1", x: 1, y: 3, rot: 0 },
    { itemId: "P048", room: "r1", x: 2, y: 0, rot: 1 }, { itemId: "P041", room: "r1", x: 4, y: 4, rot: 0 },
    { itemId: "P083", room: "r1", x: 6, y: 6, rot: 2 },
  ],
  [
    { itemId: "P002", room: "r1", x: 4, y: 4, rot: 0 }, { itemId: "P012", room: "r1", x: 3, y: 4, rot: 0 },
    { itemId: "P012", room: "r1", x: 6, y: 5, rot: 2 }, { itemId: "P022", room: "r1", x: 0, y: 2, rot: 1 },
    { itemId: "P038", room: "r1", x: 6, y: 1, rot: 0 }, { itemId: "P053", room: "r1", x: 4, y: 4, rot: 0 },
    { itemId: "P044", room: "r1", x: 4, y: 0, rot: 0 }, { itemId: "P086", room: "r1", x: 1, y: 0, rot: 0 },
    { itemId: "P087", room: "r1", x: 3, y: 0, rot: 0 },
  ],
  [
    { itemId: "P072", room: "r1", x: 2, y: 2, rot: 0 }, { itemId: "P016", room: "r1", x: 4, y: 2, rot: 2 },
    { itemId: "P080", room: "r1", x: 4, y: 5, rot: 0 }, { itemId: "P018", room: "r1", x: 5, y: 4, rot: 1 },
    { itemId: "P023", room: "r1", x: 5, y: 0, rot: 0 }, { itemId: "P033", room: "r1", x: 7, y: 0, rot: 0 },
    { itemId: "P078", room: "r1", x: 1, y: 0, rot: 1 }, { itemId: "P066", room: "r1", x: 2, y: 5, rot: 1 },
  ],
  [
    { itemId: "P081", room: "r1", x: 3, y: 5, rot: 3 }, { itemId: "P084", room: "r1", x: 3, y: 3, rot: 0 },
    { itemId: "P019", room: "r1", x: 5, y: 2, rot: 2 }, { itemId: "P029", room: "r1", x: 0, y: 0, rot: 0 },
    { itemId: "P043", room: "r1", x: 7, y: 1, rot: 0 }, { itemId: "P051", room: "r1", x: 3, y: 3, rot: 0 },
    { itemId: "P050", room: "r1", x: 4, y: 0, rot: 0 }, { itemId: "P031", room: "r1", x: 2, y: 0, rot: 0 },
    { itemId: "P054", room: "r1", x: 6, y: 6, rot: 0 },
  ],
];

const ALIASES = ["Lucía_lee", "Marcos.estudia", "Biblio de Inés", "Hugo y sus apuntes", "Claudia Reads", "Dani del Retiro", "Noa y el gato", "Rincón de Pablo"];
const NAMES = ["La Buhardilla", "El Atril", "Sala Malasaña", "Rincón del Café", "Torre de Papel", "La Quietud", "Casa del Gato", "Biblioteca Lavapiés"];
const FLOORS = ["floor-roble", "floor-ajedrez", "floor-moqueta", "floor-terracota", "floor-espiga"];
const WALLS = ["wall-crema", "wall-salvia", "wall-azul", "wall-ladrillo"];

export const NEIGHBORS: NeighborLibrary[] = ALIASES.map((alias, i) => {
  const rand = seeded(`neighbor:${i}`);
  const template = TEMPLATES[i % TEMPLATES.length]!;
  const styles: Record<string, RoomStyle> = {
    r1: { floor: FLOORS[i % FLOORS.length]!, wall: WALLS[(i * 3) % WALLS.length]!, window: i % 2 ? "window-arco" : "window-madera" },
  };
  const rooms = ["r1"];
  const placements = [...template];
  if (i % 3 === 0) {
    rooms.push("r2");
    styles.r2 = { floor: FLOORS[(i + 2) % FLOORS.length]!, wall: WALLS[(i + 1) % WALLS.length]!, window: "window-madera" };
    const extra = shuffle(rand, TEMPLATES.filter((t) => t !== template))[0]!;
    // La sala 2 tiene ventanas en 1–2 y 5–6: lo colgado en la pared derecha pasa al hueco 3–4.
    placements.push(...extra.map((p) => ({ ...p, room: "r2", x: p.rot === 0 && ["P050", "P044"].includes(p.itemId) ? 3 : p.x })));
  }
  return { id: `vecino-${i + 1}`, alias, libraryName: NAMES[i]!, level: 3 + ((i * 5) % 9), rooms, styles, placements };
});
