"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { prefersReducedMotion } from "@/lib/motion";
import { resolveTheme, THEME_STORAGE_KEY, type Theme } from "@/lib/theme";

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

const getSnapshot = (): Theme => (document.documentElement.classList.contains("dark") ? "dark" : "light");

function apply(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}

function readStored(): string | null {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Tema actual (la clase `dark` de <html> la pone el script de arranque de layout.tsx). */
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, () => "light" as Theme);

  // Sin elección guardada, se sigue el tema del sistema también si cambia con la app abierta.
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => apply(resolveTheme(readStored(), media.matches));
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  /** Cambia el tema con un círculo que se expande desde `origin` (View Transitions, si existen). */
  const toggle = useCallback((origin?: HTMLElement | null) => {
    const next: Theme = getSnapshot() === "dark" ? "light" : "dark";
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Sin almacenamiento la elección dura hasta recargar.
    }
    if (!document.startViewTransition || prefersReducedMotion() || !origin) {
      apply(next);
      return;
    }
    const rect = origin.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    const transition = document.startViewTransition(() => apply(next));
    transition.ready
      .then(() => {
        document.documentElement.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
          { duration: 520, easing: "cubic-bezier(0.23, 1, 0.32, 1)", pseudoElement: "::view-transition-new(root)" },
        );
      })
      // Si el navegador omite la transición (pestaña oculta…), el tema ya se aplicó igualmente.
      .catch(() => {});
  }, []);

  return { theme, toggle };
}
