import type { ReportError, UserPosition } from "./types";

/** Mismo radio terrestre que el trigger `validate_report` en PostgreSQL. */
export const EARTH_RADIUS_M = 6371000;
/** El servidor rechaza distancias >= 250 m. */
export const REPORT_RADIUS_M = 250;
/** Distancia para sugerir un reporte de forma proactiva. */
export const PROXIMITY_RADIUS_M = 150;

export const MADRID_CENTER: [number, number] = [40.4168, -3.7038];

export interface LatLng {
  lat: number;
  lng: number;
}

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Haversine idéntico al SQL: 2R·asin(√a), con `a` acotado a [0, 1]. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const h =
    Math.sin(toRad(a.lat - b.lat) / 2) ** 2 +
    Math.cos(toRad(b.lat)) * Math.cos(toRad(a.lat)) * Math.sin(toRad(a.lng - b.lng) / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

export function canReportFrom(distanceM: number): boolean {
  return Number.isFinite(distanceM) && distanceM < REPORT_RADIUS_M;
}

export function isInProximity(distanceM: number): boolean {
  return Number.isFinite(distanceM) && distanceM < PROXIMITY_RADIUS_M;
}

export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) return "—";
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  return `${km.toLocaleString("es-ES", { maximumFractionDigits: km < 10 ? 1 : 0 })} km`;
}

export function hasGeolocation(): boolean {
  return typeof navigator !== "undefined" && "geolocation" in navigator;
}

export function toUserPosition(pos: GeolocationPosition): UserPosition {
  return {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracy: pos.coords.accuracy,
    timestamp: pos.timestamp,
  };
}

/** Códigos de `GeolocationPositionError`. */
export const PERMISSION_DENIED = 1;
export const POSITION_UNAVAILABLE = 2;
export const TIMEOUT = 3;

/** Una posición de hace menos de esto se reutiliza: evita re-escanear Wi-Fi/GPS en cada pulsación. */
export const POSITION_MAX_AGE_MS = 60_000;

/** Traduce errores de la Geolocation API a mensajes de UI. Solo el código 1 es un bloqueo. */
export function geolocationError(error: { code: number } | null | undefined): ReportError {
  if (error?.code === PERMISSION_DENIED) {
    return {
      kind: "geo_denied",
      message:
        "Necesitamos tu ubicación para comprobar que estás en la biblioteca. Actívala en los ajustes del navegador.",
    };
  }
  if (error?.code === TIMEOUT) {
    return {
      kind: "geo_unavailable",
      message: "No hemos podido obtener tu ubicación a tiempo. Comprueba el Wi-Fi o el GPS y vuelve a intentarlo.",
    };
  }
  return {
    kind: "geo_unavailable",
    message: "Tu dispositivo no ha podido determinar la ubicación ahora mismo. Comprueba que está activada y vuelve a intentarlo.",
  };
}

export class GeolocationFailure extends Error {
  readonly reportError: ReportError;
  /** Código de la Geolocation API (1 denegado, 2 no disponible, 3 tiempo agotado) o null. */
  readonly code: number | null;
  constructor(reportError: ReportError, code: number | null = null) {
    super(reportError.message);
    this.name = "GeolocationFailure";
    this.reportError = reportError;
    this.code = code;
  }
}

/** Promesa sobre `getCurrentPosition`. Rechaza con `GeolocationFailure` (con su código). */
export function getCurrentPosition(options?: PositionOptions): Promise<UserPosition> {
  return new Promise((resolve, reject) => {
    if (!hasGeolocation()) {
      reject(
        new GeolocationFailure({
          kind: "geo_unavailable",
          message: "Tu navegador no permite obtener la ubicación.",
        }),
      );
      return;
    }
    if (typeof window !== "undefined" && !window.isSecureContext) {
      reject(
        new GeolocationFailure({
          kind: "insecure_context",
          message: "La ubicación solo funciona en una conexión segura (HTTPS).",
        }),
      );
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(toUserPosition(pos)),
      (err) => reject(new GeolocationFailure(geolocationError(err), err.code)),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: POSITION_MAX_AGE_MS, ...options },
    );
  });
}

/**
 * Posición para reportar o filtrar por cercanía.
 * - `fresh`: solo al reintentar tras un bloqueo de permisos se exige una lectura nueva
 *   (`maximumAge: 0`); en el resto se acepta una de hasta 60 s.
 * - Si la alta precisión falla por TIMEOUT o POSITION_UNAVAILABLE (habitual en ordenadores,
 *   que no tienen GPS), se repite sin alta precisión: la posición por Wi-Fi llega al instante.
 */
export async function requestPosition(
  { fresh = false }: { fresh?: boolean } = {},
  get: (options: PositionOptions) => Promise<UserPosition> = getCurrentPosition,
): Promise<UserPosition> {
  const maximumAge = fresh ? 0 : POSITION_MAX_AGE_MS;
  try {
    return await get({ enableHighAccuracy: true, timeout: 15000, maximumAge });
  } catch (error) {
    const code = error instanceof GeolocationFailure ? error.code : null;
    if (code !== TIMEOUT && code !== POSITION_UNAVAILABLE) throw error;
    return get({ enableHighAccuracy: false, timeout: 15000, maximumAge });
  }
}
