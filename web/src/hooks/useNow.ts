"use client";

import { useEffect, useState } from "react";

/** Marca de tiempo que se renueva periódicamente para "hace X min" y caducidades. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
