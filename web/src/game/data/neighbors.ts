/**
 * Bibliotecas virtuales que se pueden visitar (solo mirar) y que cuentan para las visitas,
 * los «me gusta» y las misiones de exploración. Aún no hay bibliotecas de otras personas.
 */

import type { RoomStyle } from "../engine/types";
import { SHOWCASES } from "./showcases";

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
  /** Solo en las bibliotecas de muestra: una frase que la presenta. */
  blurb?: string;
}

/** Bibliotecas que se pueden visitar: por ahora solo las de muestra del equipo. */
export const NEIGHBORS: NeighborLibrary[] = SHOWCASES;
