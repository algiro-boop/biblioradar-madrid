"use client";

import { List, Map as MapIcon } from "lucide-react";
import type { ViewMode } from "./Header";

const OPTIONS = [
  { value: "map", label: "Mapa", Icon: MapIcon },
  { value: "list", label: "Lista", Icon: List },
] as const;

/** Conmutador flotante Mapa/Lista (solo móvil): libera la fila de búsqueda y deja más mapa a la vista. */
export function ViewToggle({ view, onChange }: { view: ViewMode; onChange: (v: ViewMode) => void }) {
  // Píldora oscura en modo claro y de superficie en oscuro. Con las escalas invertidas de
  // globals.css, `dark:bg-white` es la superficie oscura y `dark:bg-slate-900` el tono claro.
  return (
    <div
      role="tablist"
      aria-label="Vista"
      className="pointer-events-auto relative mx-auto flex w-max rounded-full bg-slate-900/90 p-1 shadow-xl shadow-black/25 ring-1 ring-white/10 backdrop-blur dark:bg-white/90 dark:ring-slate-200"
    >
      {/* Indicador que se desliza bajo la opción activa. */}
      <span
        aria-hidden
        className={`absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-white shadow-sm transition-transform dark:bg-slate-900 duration-300 ease-[var(--ease-out-quint)] ${
          view === "list" ? "translate-x-full" : "translate-x-0"
        }`}
      />
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={view === value}
          onClick={() => onChange(value)}
          className={`relative flex h-10 w-[5.5rem] items-center justify-center gap-1.5 rounded-full text-sm font-semibold transition-[color,scale] duration-200 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
            view === value
              ? "text-slate-900 dark:text-white"
              : "text-white/80 hover:text-white dark:text-slate-600 dark:hover:text-slate-900"
          }`}
        >
          <Icon className="size-4" aria-hidden />
          {label}
        </button>
      ))}
    </div>
  );
}
