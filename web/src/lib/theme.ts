export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "biblioradar:theme";

/** Lo elegido en la app manda; si no hay elección, se sigue al sistema. */
export function resolveTheme(stored: string | null, systemDark: boolean): Theme {
  if (stored === "light" || stored === "dark") return stored;
  return systemDark ? "dark" : "light";
}

/**
 * Se ejecuta en <head> antes de pintar para que no aparezca un destello claro al abrir en
 * modo oscuro. Debe coincidir con `resolveTheme` (va como texto, no puede importarlo).
 */
export const THEME_INIT_SCRIPT = `(function(){try{var s=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});var d=s==="dark"||(s!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.classList.toggle("dark",d);r.style.colorScheme=d?"dark":"light"}catch(e){}})()`;
