/**
 * Enlace entre la app de BiblioRadar y el juego. Se importa de forma dinámica y solo con el
 * flag de pruebas activo, así que no añade nada al bundle público.
 *
 * Aviso: en local, un reporte real sigue yendo a la base de datos configurada en `.env.local`.
 * Para probar el juego sin tocar datos reales usa «Simular reporte» del modo desarrollador.
 */

import { run } from "./store";

/** Un reporte aceptado por el servidor cuenta como válido para el juego (idempotente por ID). */
export function reportValid(reportId: string, libraryId: string) {
  run({ type: "report_valid", reportId, libraryId });
}

/** Consulta de la ficha de una biblioteca real (misiones de exploración). */
export function viewLibrary(libraryId: string) {
  run({ type: "view_library", libraryId });
}
