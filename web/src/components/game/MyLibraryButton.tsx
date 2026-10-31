"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { run, useGameState } from "@/game/store";

/** Acceso flotante a «Mi Biblioteca» y racha (solo se monta con el flag del entorno de pruebas). */
export function MyLibraryButton() {
  return (
    <div className="flex items-end gap-2">
      <Link
        href="/mi-biblioteca"
        aria-label="Abrir Mi Biblioteca"
        title="Mi Biblioteca"
        className="pointer-events-auto flex h-11 items-center gap-2 rounded-2xl bg-white/95 px-2.5 text-sm font-semibold text-slate-700 shadow-lg shadow-black/15 ring-1 ring-slate-900/10 backdrop-blur transition-[background-color,scale] duration-150 hover:bg-slate-100 active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
      >
        <PixelLibraryIcon />
        <span className="hidden sm:inline">Mi Biblioteca</span>
        <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-amber-800 uppercase">Pruebas</span>
      </Link>
      <StreakChip />
    </div>
  );
}

/** Llama animada con los días de racha; al tocarla, racha actual, récord y protectores. */
function StreakChip() {
  const state = useGameState();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const { current, best, protectors, reportedToday } = state.streak;

  // Liquida la racha al abrir el mapa (medianoche, protectores) como hace la biblioteca.
  useEffect(() => {
    run({ type: "tick" });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (state.level < 1 && current === 0) return null;

  return (
    <div ref={box} className="pointer-events-auto relative">
      <button
        type="button"
        aria-expanded={open}
        aria-label={`Racha de ${current} ${current === 1 ? "día" : "días"}. Ver detalles`}
        onClick={() => setOpen((o) => !o)}
        className="flex h-11 items-center gap-1 rounded-2xl bg-white/95 pr-3 pl-2 text-base font-bold text-orange-600 tabular-nums shadow-lg shadow-black/15 ring-1 ring-slate-900/10 backdrop-blur transition-[scale] duration-150 active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
      >
        <PixelFlame lit={reportedToday} />
        {current}
      </button>
      {open && (
        <div role="dialog" aria-label="Tu racha" className="anim-menu absolute bottom-[3.25rem] left-0 w-64 rounded-2xl bg-white p-4 text-slate-800 shadow-2xl ring-1 ring-slate-900/10" style={{ transformOrigin: "bottom left" }}>
          <div className="flex items-center gap-3">
            <PixelFlame lit={reportedToday} big />
            <div>
              <p className="text-2xl leading-none font-bold text-orange-600 tabular-nums">{current} {current === 1 ? "día" : "días"}</p>
              <p className="mt-1 text-xs text-slate-500">{reportedToday ? "Hoy ya has reportado. ¡Sigue así!" : "Reporta hoy en una biblioteca para mantenerla."}</p>
            </div>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-center">
            <div className="rounded-xl bg-slate-100 p-2">
              <dt className="text-[11px] font-semibold text-slate-500">Récord</dt>
              <dd className="text-lg font-bold tabular-nums">{best}</dd>
            </div>
            <div className="rounded-xl bg-slate-100 p-2">
              <dt className="text-[11px] font-semibold text-slate-500">Protectores</dt>
              <dd className="text-lg font-bold tabular-nums">🛡️ {protectors}</dd>
            </div>
          </dl>
          <p className="mt-2 text-[11px] text-slate-500">Un protector salva la racha si un día no reportas. Se ganan con semanas completas.</p>
        </div>
      )}
    </div>
  );
}

/** Llama pixel art 8×10 que parpadea (quieta si el sistema pide menos movimiento). */
function PixelFlame({ lit, big = false }: { lit: boolean; big?: boolean }) {
  const outer = lit ? "#f97316" : "#f59e0b";
  const inner = lit ? "#fde047" : "#fcd34d";
  return (
    <svg viewBox="0 0 8 10" className={`${big ? "size-10" : "size-6"} br-flame ${lit ? "" : "opacity-70 saturate-50"}`} shapeRendering="crispEdges" aria-hidden>
      <style>{`
        @keyframes br-flicker { 0%,100% { transform: scale(1,1) } 30% { transform: scale(0.94,1.06) } 60% { transform: scale(1.05,0.95) } }
        @keyframes br-core { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-0.5px) } }
        .br-flame { transform-origin: 50% 100%; animation: br-flicker 0.9s steps(3) infinite; }
        .br-flame .core { animation: br-core 0.6s steps(2) infinite; }
        @media (prefers-reduced-motion: reduce) { .br-flame, .br-flame .core { animation: none; } }
      `}</style>
      <g fill={outer}>
        <rect x="3" y="0" width="1" height="1" />
        <rect x="3" y="1" width="2" height="1" />
        <rect x="2" y="2" width="3" height="1" />
        <rect x="1" y="3" width="5" height="2" />
        <rect x="5" y="2" width="1" height="1" />
        <rect x="0" y="5" width="8" height="3" />
        <rect x="1" y="8" width="6" height="1" />
        <rect x="2" y="9" width="4" height="1" />
      </g>
      <g className="core" fill={inner}>
        <rect x="3" y="4" width="2" height="1" />
        <rect x="2" y="5" width="4" height="3" />
        <rect x="3" y="8" width="2" height="1" />
      </g>
      <rect x="3" y="6" width="2" height="2" fill="#fff7d6" />
    </svg>
  );
}

/** Icono pixel art 12×12 (estantería con libros) para casar con la estética del juego. */
function PixelLibraryIcon() {
  const px: [number, number, number, number, string][] = [
    [1, 1, 10, 10, "#7a4f31"], [2, 2, 8, 3, "#f3e2bf"], [2, 6, 8, 4, "#f3e2bf"],
    [2, 2, 2, 3, "#b84a44"], [4, 2, 1, 3, "#4c78b5"], [5, 3, 2, 2, "#d6a33a"], [8, 2, 2, 3, "#5f8f5a"],
    [2, 7, 1, 3, "#7b5aa6"], [3, 6, 2, 4, "#3f8f8a"], [6, 7, 2, 3, "#b84a44"], [8, 6, 1, 4, "#d6a33a"],
  ];
  return (
    <svg viewBox="0 0 12 12" className="size-6" shapeRendering="crispEdges" aria-hidden>
      {px.map(([x, y, w, h, c], i) => (
        <rect key={i} x={x} y={y} width={w} height={h} fill={c} />
      ))}
    </svg>
  );
}
