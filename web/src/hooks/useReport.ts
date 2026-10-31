"use client";

import type { ReportTag } from "@/lib/community";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getDeviceHash,
  getRecentReport,
  InsecureContextError,
  minutesUntilNextReport,
  recordRecentReport,
  REPORT_COOLDOWN_MS,
  subscribeRecentReports,
  type RecentReport,
} from "@/lib/device";
import { canReportFrom, GeolocationFailure, haversineMeters } from "@/lib/geo";
import { rateLimitError, tooFarError } from "@/lib/reports";
import { submitReport } from "@/lib/supabase";
import type { Library, ReportError, ReportValue, UserPosition } from "@/lib/types";
import { useNow } from "./useNow";

export type ReportPhase = "idle" | "locating" | "sending" | "success" | "error";

export interface ReportState {
  phase: ReportPhase;
  error: ReportError | null;
  /** Valor pulsado en el envío en curso o en el último envío. */
  activeValue: ReportValue | null;
  recent: RecentReport | null;
  cooldownMinutes: number;
  submit: (value: ReportValue, tags?: ReportTag[]) => Promise<void>;
  reset: () => void;
}

/** Versión del registro local de reportes: cambia cuando se registra uno (en esta u otra pestaña). */
export function useRecentReportsVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => subscribeRecentReports(() => setVersion((v) => v + 1)), []);
  return version;
}

export function useReport(options: {
  library: Pick<Library, "id" | "lat" | "lng">;
  locate: () => Promise<UserPosition>;
  onReported?: (libraryId: string, value: ReportValue) => void;
}): ReportState {
  const { library, locate, onReported } = options;
  const [phase, setPhase] = useState<ReportPhase>("idle");
  const [error, setError] = useState<ReportError | null>(null);
  const [activeValue, setActiveValue] = useState<ReportValue | null>(null);
  const busyRef = useRef(false);
  useRecentReportsVersion();
  const now = useNow(15_000);

  // Cambiar de biblioteca reinicia el formulario.
  useEffect(() => {
    setPhase("idle");
    setError(null);
    setActiveValue(null);
  }, [library.id]);

  const recent = getRecentReport(library.id, now);
  const cooldownMinutes = minutesUntilNextReport(library.id, now);

  // Pasado el límite de 30 min (o si se borra el registro) se vuelve a permitir reportar.
  useEffect(() => {
    if (phase === "success" && cooldownMinutes === 0) setPhase("idle");
  }, [phase, cooldownMinutes]);

  const fail = useCallback((e: ReportError) => {
    setError(e);
    setPhase("error");
  }, []);

  const submit = useCallback(
    async (value: ReportValue, tags: ReportTag[] = []) => {
      if (busyRef.current) return;
      const wait = minutesUntilNextReport(library.id);
      if (wait > 0) {
        fail(rateLimitError(wait));
        return;
      }
      busyRef.current = true;
      setActiveValue(value);
      setError(null);
      setPhase("locating");
      try {
        let position: UserPosition;
        try {
          position = await locate();
        } catch (err) {
          fail(
            err instanceof GeolocationFailure
              ? err.reportError
              : { kind: "geo_unavailable", message: "No se pudo obtener tu ubicación." },
          );
          return;
        }
        const distance = haversineMeters(position, library);
        if (!canReportFrom(distance)) {
          fail(tooFarError(distance, position.accuracy));
          return;
        }
        setPhase("sending");
        let deviceHash: string;
        try {
          deviceHash = await getDeviceHash();
        } catch (err) {
          fail({
            kind: "insecure_context",
            message:
              err instanceof InsecureContextError
                ? err.message
                : "No se pudo generar el identificador del dispositivo.",
          });
          return;
        }
        const result = await submitReport({
          libraryId: library.id,
          value,
          tags,
          deviceHash,
          lat: position.lat,
          lng: position.lng,
        });
        if (!result.ok) {
          // Conservar solo la espera pendiente: un rechazo a los 29 min no añade otros 30.
          if (result.error.kind === "rate_limit") {
            const remaining = (result.error.retryAfterSeconds ?? REPORT_COOLDOWN_MS / 1000) * 1000;
            recordRecentReport(library.id, null, Date.now() - REPORT_COOLDOWN_MS + remaining);
          }
          fail(result.error);
          return;
        }
        recordRecentReport(library.id, value);
        // Solo en el entorno de pruebas: el reporte aceptado suma en «Mi Biblioteca».
        if (process.env.NEXT_PUBLIC_GAMIFICATION === "1") void import("@/game/bridge").then((m) => m.reportValid(result.reportId, library.id));
        setPhase("success");
        onReported?.(library.id, value);
      } finally {
        busyRef.current = false;
      }
    },
    [library, locate, onReported, fail],
  );

  const reset = useCallback(() => {
    setPhase("idle");
    setError(null);
  }, []);

  return { phase, error, activeValue, recent, cooldownMinutes, submit, reset };
}
