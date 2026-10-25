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

/** Traduce errores de la Geolocation API a mensajes de UI. */
export function geolocationError(error: { code: number } | null | undefined): ReportError {
  // 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT
  if (error?.code === 1) {
    return {
      kind: "geo_denied",
      message:
        "Necesitamos tu ubicación para comprobar que estás en la biblioteca. Actívala en los ajustes del navegador.",
    };
  }
  if (error?.code === 3) {
    return {
      kind: "geo_unavailable",
      message: "El GPS ha tardado demasiado. Prueba de nuevo, mejor cerca de una ventana.",
    };
  }
  return {
    kind: "geo_unavailable",
    message: "No hemos podido obtener tu ubicación. Comprueba que el GPS está activado.",
  };
}

export class GeolocationFailure extends Error {
  readonly reportError: ReportError;
  constructor(reportError: ReportError) {
    super(reportError.message);
    this.name = "GeolocationFailure";
    this.reportError = reportError;
  }
}

/**
 * Promesa sobre `getCurrentPosition`. Rechaza con `GeolocationFailure`.
 * `maximumAge: 0`: cada intento pide una posición nueva (y el permiso, si el navegador lo permite).
 */
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
      (err) => reject(new GeolocationFailure(geolocationError(err))),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0, ...options },
    );
  });
}
