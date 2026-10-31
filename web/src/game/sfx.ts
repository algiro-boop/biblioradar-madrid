import { getGameState } from "./store";

/** Efecto de sonido de la interfaz, solo si el usuario los activó en Ajustes. */
export function sfx(kind: "coin" | "place" | "level" | "click" | "error") {
  if (!getGameState().settings.sfx) return;
  void import("./audio").then(({ audio }) => audio().sfx(kind));
}
