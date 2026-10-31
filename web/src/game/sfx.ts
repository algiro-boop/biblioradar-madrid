import { audio } from "./audio";
import { getGameState } from "./store";

export type SfxKind =
  | "tab" | "select" | "buy" | "sell" | "coin" | "place" | "rotate" | "pickup" | "store"
  | "expansion" | "level" | "unlock" | "mission" | "achievement" | "error" | "click";

/** Separación mínima entre dos sonidos iguales (ms): nada se repite en ráfaga por renders o errores. */
const GAP: Partial<Record<SfxKind, number>> = { error: 1000, level: 1500, achievement: 900, mission: 700, expansion: 1200, unlock: 1200 };
const last = new Map<SfxKind, number>();
let unlocked = false;

/**
 * Desbloquea el audio ya. Hay que llamarlo dentro de un gesto (Safari solo deja arrancar el
 * contexto de audio en el propio toque), p. ej. al pulsar «Mi Biblioteca» en el mapa: así la
 * música suena en cuanto se abre la biblioteca, sin otro toque.
 */
export function unlockAudioNow() {
  if (typeof window === "undefined") return;
  unlocked = true;
  audio().unlock();
}

/**
 * Los navegadores no dejan sonar audio hasta el primer gesto. Si ya lo hubo (se llegó desde el mapa)
 * suena enseguida; si no, se espera al primero. Devuelve una función para dejar de escuchar.
 */
export function unlockAudioOnGesture(onUnlock?: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const go = () => {
    unlockAudioNow();
    onUnlock?.();
    off();
  };
  const off = () => {
    window.removeEventListener("pointerdown", go, true);
    window.removeEventListener("keydown", go, true);
  };
  // Activación «pegajosa» del documento: Chrome y Firefox dejan reanudar el audio sin otro toque.
  if (!unlocked && navigator.userActivation?.hasBeenActive) unlockAudioNow();
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
  audio().sfx(kind, volume);
}
