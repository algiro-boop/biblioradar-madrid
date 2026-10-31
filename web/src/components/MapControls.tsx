"use client";

import { LoaderCircle, LocateFixed, Moon, Sun } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";

const BUTTON =
  "relative grid size-11 place-items-center transition-[background-color,color,scale] duration-150 active:scale-[0.94] focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none focus-visible:ring-inset";

/**
 * Botonera flotante sobre el mapa (como los controles de un mapa nativo): tema claro/oscuro
 * arriba y «Cerca de mí» abajo, al alcance del pulgar.
 */
export function MapControls({
  near,
  locating,
  onToggleNear,
}: {
  near: boolean;
  locating: boolean;
  onToggleNear: () => void;
}) {
  const { theme, toggle } = useTheme();
  const dark = theme === "dark";
  return (
    <div className="pointer-events-auto flex w-11 flex-col overflow-hidden rounded-2xl bg-white/95 shadow-lg shadow-black/15 ring-1 ring-slate-900/10 backdrop-blur">
      <button
        type="button"
        onClick={(e) => toggle(e.currentTarget)}
        aria-label={dark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
        title={dark ? "Modo claro" : "Modo oscuro"}
        className={`${BUTTON} text-slate-600 hover:bg-slate-100 hover:text-slate-900`}
      >
        {/* Los dos iconos se cruzan girando; el visible depende de la clase `dark`, sin parpadeo al hidratar. */}
        <Sun
          aria-hidden
          className="absolute size-5 scale-50 rotate-90 text-amber-400 opacity-0 transition-[rotate,scale,opacity] duration-300 ease-[var(--ease-out-quint)] dark:scale-100 dark:rotate-0 dark:opacity-100"
        />
        <Moon
          aria-hidden
          className="absolute size-5 transition-[rotate,scale,opacity] duration-300 ease-[var(--ease-out-quint)] dark:scale-50 dark:-rotate-90 dark:opacity-0"
        />
      </button>
      <span className="mx-2.5 h-px bg-slate-200" aria-hidden />
      <button
        type="button"
        onClick={onToggleNear}
        disabled={locating}
        aria-pressed={near}
        aria-label="Cerca de mí: ordenar por distancia"
        title="Cerca de mí"
        className={`${BUTTON} ${near ? "bg-sky-50 text-sky-600" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}
      >
        {locating ? (
          <LoaderCircle aria-hidden className="size-5 animate-spin" />
        ) : (
          <LocateFixed aria-hidden className={`size-5 ${near ? "anim-pop" : ""}`} key={String(near)} />
        )}
      </button>
    </div>
  );
}
