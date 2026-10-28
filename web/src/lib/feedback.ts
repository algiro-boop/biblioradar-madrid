import { isValidDeviceHash } from "./device";
import { retrySeconds, type RpcErrorLike } from "./reports";
import { getSupabase } from "./supabase";

export const FEEDBACK_CATEGORIES = [
  { value: "nueva_biblioteca", label: "Añadir biblioteca" },
  { value: "error_horario", label: "Corregir horario" },
  { value: "sugerencia", label: "Sugerencia" },
  { value: "bug_app", label: "Reportar fallo" },
  { value: "otro", label: "Otro" },
] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number]["value"];
export type FeedbackInput = {
  category: FeedbackCategory;
  message: string;
  libraryId: string | null;
  contactInfo: string;
  deviceHash: string;
};

export function feedbackValidation(input: Pick<FeedbackInput, "category" | "message" | "contactInfo">): string | null {
  if (!FEEDBACK_CATEGORIES.some((c) => c.value === input.category)) return "Elige un tipo de mensaje.";
  const length = [...input.message.trim()].length;
  if (length < 5 || length > 1000) return "Escribe un mensaje de entre 5 y 1000 caracteres.";
  if ([...input.contactInfo.trim()].length > 200) return "El contacto admite hasta 200 caracteres.";
  return null;
}

export function feedbackError(error: RpcErrorLike): string {
  if (error.code === "P0001") {
    const seconds = retrySeconds(error.details, 3600);
    return seconds
      ? `Has alcanzado los 3 envíos por hora. Prueba de nuevo en ${Math.ceil(seconds / 60)} min.`
      : "Has alcanzado los 3 envíos por hora. Vuelve a intentarlo más tarde.";
  }
  if (error.code === "22023" || error.code === "23503") return "Revisa el mensaje y la biblioteca seleccionada.";
  return "No se pudo enviar. Comprueba tu conexión y vuelve a intentarlo.";
}

export async function submitFeedback(input: FeedbackInput): Promise<{ ok: true } | { ok: false; message: string }> {
  const invalid = feedbackValidation(input);
  if (invalid) return { ok: false, message: invalid };
  if (!isValidDeviceHash(input.deviceHash)) return { ok: false, message: "No se pudo identificar el dispositivo. Recarga la página." };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const { data, error } = await getSupabase().rpc("submit_feedback", {
      p_category: input.category,
      p_message: input.message.trim(),
      p_device_hash: input.deviceHash,
      p_library_id: input.libraryId || null,
      p_contact_info: input.contactInfo.trim() || null,
    }).abortSignal(controller.signal);
    if (error) return { ok: false, message: feedbackError(error) };
    if (typeof data !== "string" || !data) return { ok: false, message: "No se ha podido confirmar el envío. Inténtalo más tarde." };
    return { ok: true };
  } catch {
    return { ok: false, message: feedbackError({}) };
  } finally {
    clearTimeout(timeout);
  }
}
