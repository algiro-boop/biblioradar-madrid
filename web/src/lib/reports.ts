import { formatDistance, REPORT_RADIUS_M } from "./geo";
import type { ReportError, ReportValue } from "./types";

export const REPORT_VALUES: readonly ReportValue[] = [20, 40, 75, 90, 100];

export const REPORT_OPTIONS: ReadonlyArray<{
  value: ReportValue;
  label: string;
  description: string;
  /** Frase para "Has indicado que…" / "Ya reportaste que…". */
  summary: string;
}> = [
  { value: 20, label: "Casi vacía", description: "Mesas prácticamente desiertas", summary: "está casi vacía" },
  { value: 40, label: "Bastante sitio", description: "Muchas mesas libres", summary: "hay bastante sitio" },
  {
    value: 75,
    label: "Pocos sitios",
    description: "Hay que buscar hueco o compartir mesa",
    summary: "quedan pocos sitios",
  },
  { value: 90, label: "Casi llena", description: "Sitios muy contados y sueltos", summary: "está casi llena" },
  { value: 100, label: "Completa", description: "Sin sitio libre", summary: "está completa" },
];

export function isReportValue(value: unknown): value is ReportValue {
  return (REPORT_VALUES as readonly unknown[]).includes(value);
}

export function reportSummary(value: ReportValue): string {
  return REPORT_OPTIONS.find((o) => o.value === value)?.summary ?? "";
}

/** Forma común de `PostgrestError` y de errores de red de supabase-js. */
export interface RpcErrorLike {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

const NETWORK_PATTERN = /failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout|aborted/i;

/** Mapea los errores SQL de `submit_report` (P0001 / 22023) y de transporte a mensajes de UI. */
export function mapReportError(error: RpcErrorLike | null | undefined): ReportError {
  const code = error?.code ?? "";
  const message = error?.message ?? "";
  if (code === "P0001") {
    return {
      kind: "rate_limit",
      retryAfterSeconds: retrySeconds(error?.details, 1800),
      message: "Ya enviaste un reporte de esta biblioteca. Solo se permite uno cada 30 minutos.",
    };
  }
  if (code === "22023") {
    if (/250\s*metros/i.test(message)) {
      return {
        kind: "too_far",
        message: `Debes estar a menos de ${REPORT_RADIUS_M} m de la biblioteca para reportar.`,
      };
    }
    return {
      kind: "invalid",
      message: "No hemos podido validar el reporte. Recarga la página y vuelve a intentarlo.",
    };
  }
  if (NETWORK_PATTERN.test(message) || (typeof navigator !== "undefined" && navigator.onLine === false)) {
    return {
      kind: "network",
      message: "Sin conexión con el servidor. Comprueba tu conexión e inténtalo de nuevo.",
    };
  }
  return {
    kind: "unknown",
    message: "Algo ha fallado al enviar el reporte. Inténtalo de nuevo en unos segundos.",
  };
}

/** Mensaje cuando la comprobación en cliente ya detecta que el usuario está lejos. */
export function tooFarError(distanceM: number, accuracyM?: number): ReportError {
  const accuracy =
    accuracyM !== undefined && Number.isFinite(accuracyM) && accuracyM > 100
      ? ` (precisión del GPS: ±${formatDistance(accuracyM)})`
      : "";
  return {
    kind: "too_far",
    message: `Estás a ${formatDistance(distanceM)} de la biblioteca${accuracy}. Debes estar a menos de ${REPORT_RADIUS_M} m para reportar.`,
  };
}

export function rateLimitError(minutesLeft: number): ReportError {
  return {
    kind: "rate_limit",
    message:
      minutesLeft > 0
        ? `Ya reportaste aquí. Podrás volver a hacerlo en ${minutesLeft} min.`
        : "Ya reportaste aquí hace poco. Solo se permite un reporte cada 30 minutos.",
  };
}

/** PostgreSQL devuelve el plazo restante; rechazar valores corruptos o excesivos. */
export function retrySeconds(details: string | null | undefined, maximum: number): number | undefined {
  try {
    const n: unknown = JSON.parse(details ?? "null")?.retry_after_seconds;
    return typeof n === "number" && Number.isFinite(n) && n > 0 && n <= maximum
      ? Math.ceil(n) : undefined;
  } catch {
    return undefined;
  }
}
