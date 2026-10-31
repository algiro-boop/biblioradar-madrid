"use client";

import Link from "next/link";

/** Acceso flotante a «Mi Biblioteca» (solo se monta con el flag del entorno de pruebas). */
export function MyLibraryButton() {
  return (
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
