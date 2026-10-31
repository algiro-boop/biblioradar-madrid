"use client";

import { useEffect, useRef, useState } from "react";
import { createPromo, FPS, FRAMES, H, W, type Promo } from "@/game/ad/promo";

declare global {
  interface Window {
    __promo?: Promo & { snapshot(quality?: number): string };
  }
}

/**
 * Estudio del anuncio (solo en desarrollo). Expone `window.__promo` para que el script de
 * grabación pida los fotogramas en orden; con `?preview` además lo reproduce en bucle.
 */
export default function PromoStudio() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState("Preparando…");

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let raf = 0;
    let alive = true;
    void createPromo(canvas).then((promo) => {
      if (!alive) return;
      window.__promo = { ...promo, snapshot: (q = 0.92) => canvas.toDataURL("image/jpeg", q) };
      setStatus(`Listo · ${FRAMES} fotogramas a ${FPS} fps`);
      if (!new URLSearchParams(location.search).has("preview")) {
        promo.renderFrame(0);
        return;
      }
      let i = 0;
      const t0 = performance.now();
      const loop = () => {
        const want = Math.floor(((performance.now() - t0) / 1000) * FPS);
        while (i <= want && i < FRAMES) promo.renderFrame(i++);
        if (i < FRAMES) raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    });
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <main className="grid min-h-dvh place-items-center gap-3 bg-neutral-900 p-4 text-sm text-neutral-300">
      <canvas ref={ref} width={W} height={H} className="h-[85dvh] w-auto rounded-xl shadow-2xl" />
      <p data-promo-status>{status}</p>
    </main>
  );
}
