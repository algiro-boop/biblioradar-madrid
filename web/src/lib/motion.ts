/** Utilidades de animación sin DOM (testeables en Node). */

export const PIN_DELAY_BUCKETS = 8;

/** Retardo escalonado para listas: crece con el índice hasta `max` ms. */
export function staggerDelay(index: number, step = 35, max = 280): number {
  return Math.min(Math.max(index, 0) * step, max);
}

/**
 * Cubo de retardo estable por biblioteca (pin-d0…pin-d7). Estable para que un cambio de icono
 * no altere `animation-delay` y no vuelva a ocultar un pin ya mostrado.
 */
export function pinDelayBucket(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(hash) % PIN_DELAY_BUCKETS;
}

export function easeOutCubic(t: number): number {
  const x = Math.min(Math.max(t, 0), 1);
  return 1 - (1 - x) ** 3;
}

/** Valor intermedio de un contador animado en el instante `elapsed` (ms). */
export function countUpValue(from: number, to: number, elapsed: number, duration: number): number {
  if (duration <= 0) return to;
  return Math.round(from + (to - from) * easeOutCubic(elapsed / duration));
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
