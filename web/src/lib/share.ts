import { getOccupancyLevel, LEVEL_TEXT } from "./occupancy";
import type { LibraryWithOccupancy } from "./types";

export const SITE_URL = "https://biblioradar-madrid.vercel.app";

/** Mensaje para recomendar la app en general (botón "Compartir app" del header). */
export const APP_SHARE_TEXT = `📡 ¿Buscas sitio para estudiar en Madrid? Mira en tiempo real la ocupación de 95 bibliotecas públicas y salas de estudio en BiblioRadar: ${SITE_URL}`;

/** El estado viene de un horario (revisado, de Google o publicado) que la da por cerrada. */
function isClosed(library: Pick<LibraryWithOccupancy, "occupancy">): boolean {
  const source = library.occupancy?.primary_source ?? library.occupancy?.base_source ?? "";
  return library.occupancy?.is_open_now === false || source.startsWith("Cerrada");
}

/** Texto para avisar a otros del aforo. `*texto*` es negrita en WhatsApp. */
export function shareText(library: Pick<LibraryWithOccupancy, "name" | "occupancy">): string {
  const pct = library.occupancy?.final_occupancy_pct ?? null;
  if (isClosed(library)) {
    return `📚 *${library.name}* está cerrada ahora mismo. Mira qué bibliotecas tienen sitio libre en Madrid: ${SITE_URL}`;
  }
  if (pct !== null) {
    const label = LEVEL_TEXT[getOccupancyLevel(library.occupancy)].toLowerCase();
    return `📚 En *${library.name}* hay ahora mismo un *${pct}% de ocupación* (${label}). Míralo en directo en BiblioRadar: ${SITE_URL}`;
  }

  // Sin porcentaje ni horario que la cierre: no se afirma que esté cerrada.
  return `📚 Mira cuánta gente hay en *${library.name}* y qué bibliotecas tienen sitio libre en Madrid: ${SITE_URL}`;
}

export function whatsappUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export type ShareOutcome = "shared" | "copied" | "cancelled" | "failed";

type ShareNavigator = Pick<Navigator, "clipboard"> & Partial<Pick<Navigator, "share">>;

/**
 * En móvil abre la hoja nativa de compartir si existe; si no (o si falla), copia al portapapeles.
 * Cerrar la hoja sin elegir destino no es un error.
 */
export async function shareOrCopy(text: string, nav: ShareNavigator, preferNative: boolean): Promise<ShareOutcome> {
  if (preferNative && typeof nav.share === "function") {
    try {
      await nav.share({ text });
      return "shared";
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return "cancelled";
    }
  }
  try {
    await nav.clipboard.writeText(text);
    return "copied";
  } catch {
    return "failed";
  }
}
