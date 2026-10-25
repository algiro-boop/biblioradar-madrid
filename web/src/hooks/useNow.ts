"use client";

import { useEffect, useState } from "react";

/**
 * Marca de tiempo para "hace X min", caducidades y la estimación horaria local.
 * Los ticks se alinean con el reloj (p. ej. :00 y :30 s), así a las 09:00:00 se recalcula al
 * instante, y se renueva al volver a la pestaña, donde los temporizadores pueden congelarse.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer = 0;
    const tick = () => {
      setNow(Date.now());
      timer = window.setTimeout(tick, intervalMs - (Date.now() % intervalMs));
    };
    timer = window.setTimeout(tick, intervalMs - (Date.now() % intervalMs));
    const onVisible = () => {
      if (document.visibilityState === "visible") setNow(Date.now());
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs]);
  return now;
}
