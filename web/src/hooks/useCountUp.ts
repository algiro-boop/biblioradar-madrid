"use client";

import { useEffect, useRef, useState } from "react";
import { countUpValue, prefersReducedMotion } from "@/lib/motion";

/**
 * Número que sube (o baja) hasta `target`. Al cambiar `resetKey` vuelve a contar desde 0
 * (p. ej. al abrir otra biblioteca); un cambio de valor en vivo anima desde el valor actual.
 */
export function useCountUp(target: number | null, resetKey: unknown = null, duration = 700): number | null {
  const [value, setValue] = useState<number | null>(target);
  const valueRef = useRef<number | null>(target);
  const keyRef = useRef(resetKey);

  useEffect(() => {
    const reset = keyRef.current !== resetKey;
    keyRef.current = resetKey;
    if (target === null || prefersReducedMotion()) {
      valueRef.current = target;
      setValue(target);
      return;
    }
    const from = reset || valueRef.current === null ? 0 : valueRef.current;
    if (from === target) return;
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(t) {
      const next = countUpValue(from, target, t - start, duration);
      valueRef.current = next;
      setValue(next);
      if (next !== target) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [target, resetKey, duration]);

  return value;
}
