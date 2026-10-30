"use client";

import { useEffect, useMemo } from "react";

const COLORS = ["#10b981", "#34d399", "#fbbf24", "#38bdf8", "#f472b6", "#a78bfa"];
const PIECES = 18;

/** Ráfaga de confeti CSS (sin librerías) y vibración corta en móviles que la admiten. */
export function Celebration() {
  const pieces = useMemo(
    () =>
      Array.from({ length: PIECES }, (_, i) => {
        const angle = (i / PIECES) * Math.PI * 2 + (i % 3) * 0.2;
        const distance = 46 + (i % 4) * 14;
        return {
          x: `${Math.round(Math.cos(angle) * distance)}px`,
          y: `${Math.round(Math.sin(angle) * distance - 18)}px`,
          r: `${(i % 2 ? 1 : -1) * (180 + i * 25)}deg`,
          color: COLORS[i % COLORS.length],
          round: i % 3 === 0,
          delay: (i % 5) * 18,
        };
      }),
    [],
  );

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    try {
      navigator.vibrate?.(35);
    } catch {
      // Algunos navegadores lo bloquean sin gesto reciente: no importa.
    }
  }, []);

  return (
    <span className="pointer-events-none absolute top-1/2 left-6 z-10" aria-hidden>
      {pieces.map((p, i) => (
        <span
          key={i}
          className={`confetti-piece absolute block ${p.round ? "size-1.5 rounded-full" : "h-2.5 w-1 rounded-[1px]"}`}
          style={
            {
              background: p.color,
              animationDelay: `${p.delay}ms`,
              "--x": p.x,
              "--y": p.y,
              "--r": p.r,
            } as React.CSSProperties
          }
        />
      ))}
    </span>
  );
}
