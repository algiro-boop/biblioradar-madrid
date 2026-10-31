import { getGameState } from "./store";

export type SfxKind =
  | "tab" | "select" | "buy" | "sell" | "coin" | "place" | "rotate" | "pickup" | "store"
  | "expansion" | "level" | "unlock" | "mission" | "achievement" | "error" | "click";

/** Separación mínima entre dos sonidos iguales (ms): nada se repite en ráfaga por renders o errores. */
const GAP: Partial<Record<SfxKind, number>> = { error: 1000, level: 1500, achievement: 900, mission: 700, expansion: 1200, unlock: 1200 };
const last = new Map<SfxKind, number>();
let unlocked = false;

/**
 * Los navegadores no dejan sonar audio hasta el primer gesto: se espera a él y entonces se crea
 * (o reanuda) el contexto de audio. Devuelve una función para dejar de escuchar.
 */
export function unlockAudioOnGesture(onUnlock?: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const go = () => {
    unlocked = true;
    void import("./audio").then(({ audio }) => audio().unlock());
    onUnlock?.();
    off();
  };
  const off = () => {
    window.removeEventListener("pointerdown", go, true);
    window.removeEventListener("keydown", go, true);
  };
  if (unlocked) {
    queueMicrotask(() => onUnlock?.());
    return () => {};
  }
  window.addEventListener("pointerdown", go, true);
  window.addEventListener("keydown", go, true);
  return off;
}

/** Efecto de sonido breve (activados por defecto; se silencian y regulan en Ajustes). */
export function sfx(kind: SfxKind) {
  const { settings } = getGameState();
  if (!settings.sfx || !unlocked) return;
  const now = performance.now();
  if (now - (last.get(kind) ?? -1e9) < (GAP[kind] ?? 70)) return;
  last.set(kind, now);
  const volume = settings.sfxVolume ?? 0.6;
  if (volume <= 0) return;
  void import("./audio").then(({ audio }) => audio().sfx(kind, volume));
}
