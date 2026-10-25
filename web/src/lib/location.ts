import { GeolocationFailure, PERMISSION_DENIED } from "./geo";
import type { UserPosition } from "./types";

/** Para qué se pide la ubicación: cambia la explicación del aviso. */
export type LocationPurpose = "report" | "near";

export type LocationPlatform = "ios-safari" | "ios-chrome" | "android-chrome" | "desktop";

export const PURPOSE_TEXT: Record<LocationPurpose, string> = {
  report:
    "Necesitamos tu ubicación para verificar que estás en la sala (a menos de 250 m) antes de aceptar tu reporte.",
  near: "Necesitamos tu ubicación para encontrar las bibliotecas cercanas y ordenarlas por distancia.",
};

export const UNLOCK_STEPS: Record<LocationPlatform, { browser: string; step: string; extra?: string }> = {
  "ios-safari": {
    browser: "iPhone / iPad · Safari",
    step: "Toca «aA» junto a la dirección → Ajustes del sitio web → Ubicación → Permitir.",
    extra: "Si sigue sin funcionar: Ajustes → Privacidad y seguridad → Localización → Sitios web de Safari → Mientras se usa.",
  },
  "ios-chrome": {
    browser: "iPhone / iPad · Chrome",
    step: "Ajustes del iPhone → Chrome → Localización → Mientras se usa la app.",
  },
  "android-chrome": {
    browser: "Android · Chrome",
    step: "Toca el icono de ajustes o el candado junto a la URL → Permisos → Ubicación → Permitir.",
    extra: "Comprueba también que la ubicación del móvil está activada en los ajustes rápidos.",
  },
  desktop: {
    browser: "Ordenador",
    step: "Haz clic en el candado o el icono de ajustes junto a la URL → Ubicación → Permitir.",
  },
};

/** Navegador del usuario para mostrar primero sus instrucciones. */
export function detectPlatform(userAgent: string, maxTouchPoints = 0): LocationPlatform {
  // iPadOS se presenta como Mac de escritorio, pero con pantalla táctil.
  const ios = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  if (ios) return /CriOS|FxiOS|EdgiOS/.test(userAgent) ? "ios-chrome" : "ios-safari";
  if (/Android/.test(userAgent)) return "android-chrome";
  return "desktop";
}

/** Solo PERMISSION_DENIED (código 1) es un bloqueo; un TIMEOUT nunca abre la ayuda de permisos. */
export function isPermissionDenied(error: unknown): boolean {
  return error instanceof GeolocationFailure && error.code === PERMISSION_DENIED;
}

/**
 * Cada llamada vuelve a pedir la posición, también tras un "No".
 * Si el navegador responde PERMISSION_DENIED, delega en `onBlocked`, que muestra la ayuda y
 * resuelve con la posición cuando el usuario reintenta con éxito, o rechaza si la cierra.
 */
export async function locateWithHelp(
  locate: () => Promise<UserPosition>,
  purpose: LocationPurpose,
  onBlocked: (purpose: LocationPurpose) => Promise<UserPosition>,
): Promise<UserPosition> {
  try {
    return await locate();
  } catch (error) {
    if (!isPermissionDenied(error)) throw error;
    return onBlocked(purpose);
  }
}
