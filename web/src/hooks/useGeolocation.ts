"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GeolocationFailure, getCurrentPosition, hasGeolocation, toUserPosition } from "@/lib/geo";
import type { ReportError, UserPosition } from "@/lib/types";

export type GeoStatus = "idle" | "locating" | "granted" | "denied" | "unavailable";

export interface GeolocationState {
  status: GeoStatus;
  position: UserPosition | null;
  error: ReportError | null;
  /** Pide una posición fresca (muestra el diálogo de permiso si hace falta) y empieza a seguirla. */
  locate: () => Promise<UserPosition>;
}

export function useGeolocation(): GeolocationState {
  const [status, setStatus] = useState<GeoStatus>("idle");
  const [position, setPosition] = useState<UserPosition | null>(null);
  const [error, setError] = useState<ReportError | null>(null);
  const watchIdRef = useRef<number | null>(null);

  const startWatching = useCallback(() => {
    if (watchIdRef.current !== null || !hasGeolocation()) return;
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setPosition(toUserPosition(pos));
        setStatus("granted");
        setError(null);
      },
      (err) => {
        if (err.code === 1) {
          setStatus("denied");
          if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
          watchIdRef.current = null;
        }
      },
      { enableHighAccuracy: true, maximumAge: 60_000, timeout: 30_000 },
    );
  }, []);

  // Solo se sigue la posición sin preguntar si el permiso ya estaba concedido.
  useEffect(() => {
    if (!hasGeolocation()) {
      setStatus("unavailable");
      return;
    }
    let permission: PermissionStatus | null = null;
    let cancelled = false;
    const onChange = () => {
      if (!permission) return;
      if (permission.state === "granted") startWatching();
      if (permission.state === "denied") setStatus("denied");
    };
    navigator.permissions
      ?.query({ name: "geolocation" })
      .then((p) => {
        if (cancelled) return;
        permission = p;
        p.addEventListener("change", onChange);
        onChange();
      })
      .catch(() => {
        // Safari antiguo no soporta la consulta: esperar a que el usuario lo pida.
      });
    return () => {
      cancelled = true;
      permission?.removeEventListener("change", onChange);
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    };
  }, [startWatching]);

  const locate = useCallback(async () => {
    setStatus((s) => (s === "granted" ? s : "locating"));
    try {
      const pos = await getCurrentPosition();
      setPosition(pos);
      setStatus("granted");
      setError(null);
      startWatching();
      return pos;
    } catch (err) {
      const reportError =
        err instanceof GeolocationFailure
          ? err.reportError
          : { kind: "geo_unavailable" as const, message: "No se pudo obtener tu ubicación." };
      setError(reportError);
      setStatus(reportError.kind === "geo_denied" ? "denied" : position ? "granted" : "idle");
      throw err instanceof GeolocationFailure ? err : new GeolocationFailure(reportError);
    }
  }, [position, startWatching]);

  return { status, position, error, locate };
}
