"use client";

import { useState } from "react";
import { toggleTag, type ReportTag } from "@/lib/community";
import { Celebration } from "./Celebration";
import { ReportTagSelector } from "./CommunityStatus";
import { CircleAlert, CircleCheck, LoaderCircle, MapPin, RotateCw, TriangleAlert } from "lucide-react";
import { useReport } from "@/hooks/useReport";
import { REPORT_OPTIONS, reportSummary } from "@/lib/reports";
import type { Library, ReportValue, UserPosition } from "@/lib/types";

// Literales completos para que Tailwind detecte las clases. Del verde (vacía) al rojo (completa).
const BUTTON_STYLES: Record<ReportValue, { button: string; dot: string }> = {
  20: {
    button: "border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 active:bg-emerald-200 focus-visible:ring-emerald-500",
    dot: "bg-emerald-500",
  },
  40: {
    button: "border-lime-200 bg-lime-50 text-lime-950 hover:bg-lime-100 active:bg-lime-200 focus-visible:ring-lime-500",
    dot: "bg-lime-500",
  },
  75: {
    button: "border-amber-200 bg-amber-50 text-amber-950 hover:bg-amber-100 active:bg-amber-200 focus-visible:ring-amber-500",
    dot: "bg-amber-400",
  },
  90: {
    button: "border-orange-200 bg-orange-50 text-orange-950 hover:bg-orange-100 active:bg-orange-200 focus-visible:ring-orange-500",
    dot: "bg-orange-500",
  },
  100: {
    button: "border-red-200 bg-red-50 text-red-900 hover:bg-red-100 active:bg-red-200 focus-visible:ring-red-500",
    dot: "bg-red-600",
  },
};

export function ReportButtons({
  library,
  locate,
  locationGranted = false,
  onReported,
  compact = false,
  tagsEnabled = true,
}: {
  library: Pick<Library, "id" | "lat" | "lng" | "name">;
  locate: () => Promise<UserPosition>;
  /** Si aún no hay permiso, al enviar se explica por qué se pide la ubicación. */
  locationGranted?: boolean;
  onReported?: (libraryId: string, value: ReportValue) => void;
  compact?: boolean;
  tagsEnabled?: boolean;
}) {
  const { phase, error, activeValue, recent, cooldownMinutes, submit } = useReport({
    library,
    locate,
    onReported,
  });
  const [selectedValue, setSelectedValue] = useState<ReportValue | null>(null);
  const [tags, setTags] = useState<ReportTag[]>([]);
  const busy = phase === "locating" || phase === "sending";
  const coolingDown = cooldownMinutes > 0 && phase !== "success";

  return (
    <div className="space-y-3">
      <div
        className={compact ? "grid grid-cols-5 gap-1.5" : "flex flex-col gap-2"}
        role="group"
        aria-label="Enviar reporte de ocupación"
      >
        {REPORT_OPTIONS.map((opt) => {
          const isActive = (selectedValue ?? activeValue) === opt.value;
          const styles = BUTTON_STYLES[opt.value];
          const dot = isActive && busy ? (
            <LoaderCircle className="size-4 shrink-0 animate-spin" />
          ) : (
            <span key={String(isActive)} className={`size-3 shrink-0 rounded-full ${styles.dot} ${isActive ? "anim-pop ring-4 ring-white/70" : ""}`} aria-hidden />
          );
          return (
            <button
              key={opt.value}
              type="button"
              disabled={busy || cooldownMinutes > 0}
              onClick={() => setSelectedValue(opt.value)}
              aria-pressed={isActive}
              aria-label={`${opt.label}: ${opt.description} (${opt.value}%)`}
              className={`rounded-2xl border font-semibold transition active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                styles.button
              } ${isActive ? "opacity-100! scale-[1.02] shadow-md ring-2 ring-offset-1 ring-slate-900/20" : ""} ${
                compact
                  ? "flex min-h-16 flex-col items-center justify-center gap-1 px-1 py-2 text-center text-[11px] leading-tight"
                  : "flex min-h-14 items-center gap-3 px-3.5 py-2.5 text-left"
              }`}
            >
              {dot}
              {compact ? (
                <span>{opt.label}</span>
              ) : (
                <span className="min-w-0 flex-1">
                  <span className="block text-sm leading-tight">{opt.label}</span>
                  <span className="block text-xs font-normal opacity-75">{opt.description}</span>
                </span>
              )}
              <span className={`font-medium tabular-nums opacity-70 ${compact ? "text-[10px]" : "text-xs"}`}>
                {opt.value}%
              </span>
            </button>
          );
        })}
      </div>

      {tagsEnabled && <ReportTagSelector selected={tags} onToggle={(tag) => setTags((old) => toggleTag(old, tag))} disabled={busy || cooldownMinutes > 0} />}
      <button type="button" disabled={selectedValue === null || busy || cooldownMinutes > 0}
        onClick={() => selectedValue !== null && void submit(selectedValue, tagsEnabled ? tags : [])}
        className={`w-full rounded-2xl px-4 py-3 text-sm font-semibold text-white shadow-sm transition active:scale-[0.98] disabled:opacity-40 disabled:shadow-none ${
          selectedValue !== null && !busy && cooldownMinutes === 0
            ? "bg-gradient-to-r from-slate-900 to-emerald-800 hover:shadow-md hover:shadow-emerald-900/20"
            : "bg-slate-900"
        }`}>
        Enviar reporte
      </button>

      <div aria-live="polite" className="min-h-0 text-sm">
        {phase === "locating" &&
          (locationGranted ? (
            <p className="flex items-center gap-2 text-slate-600">
              <MapPin className="size-4 shrink-0" /> Comprobando tu ubicación…
            </p>
          ) : (
            <p className="flex items-start gap-2 rounded-xl bg-sky-50 p-3 text-sky-950" role="status">
              <MapPin className="mt-0.5 size-4 shrink-0" />
              <span>
                <strong className="font-semibold">Activa la ubicación para enviar.</strong> La necesitamos para
                verificar que estás en la biblioteca (a menos de 250 m). Acepta el aviso del navegador.
              </span>
            </p>
          ))}
        {phase === "sending" && (
          <p className="flex items-center gap-2 text-slate-600">
            <LoaderCircle className="size-4 shrink-0 animate-spin" /> Enviando reporte…
          </p>
        )}
        {phase === "success" && activeValue !== null && (
          <p className="anim-rise relative flex items-start gap-2 rounded-xl bg-emerald-50 p-3 text-emerald-900 ring-1 ring-emerald-200">
            <Celebration />
            <CircleCheck className="anim-pop mt-0.5 size-4 shrink-0" />
            <span>
              ¡Gracias! Has indicado que {reportSummary(activeValue)}. Tu reporte ya cuenta para el resto de
              estudiantes.
            </span>
          </p>
        )}
        {phase === "error" && error && (
          <p
            className={`flex items-start gap-2 rounded-xl p-3 ${
              error.kind === "rate_limit" ? "bg-amber-50 text-amber-950" : "bg-red-50 text-red-900"
            }`}
            role="alert"
          >
            {error.kind === "rate_limit" ? (
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            ) : (
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
            )}
            <span className="min-w-0 flex-1">{error.message}</span>
            {/* Tiempo agotado o sin señal: se puede reintentar sin pasar por la ayuda de permisos. */}
            {error.kind === "geo_unavailable" && activeValue != null && (
              <button
                type="button"
                onClick={() => void submit(activeValue, tagsEnabled ? tags : [])}
                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-800"
              >
                <RotateCw className="size-3" /> Reintentar
              </button>
            )}
          </p>
        )}
        {phase === "idle" && coolingDown && (
          <p className="text-slate-500">
            {recent?.value != null
              ? `Ya reportaste que ${reportSummary(recent.value)}. `
              : "Ya reportaste esta biblioteca. "}
            Podrás volver a hacerlo en {cooldownMinutes} min.
          </p>
        )}
        {phase === "idle" && !coolingDown && !compact && (
          <p className="text-xs text-slate-500">
            {locationGranted
              ? "Usamos tu ubicación solo para comprobar que estás a menos de 250 m."
              : "Al enviar te pediremos la ubicación, solo para comprobar que estás a menos de 250 m."}{" "}
            No pedimos cuenta ni guardamos tu nombre.
          </p>
        )}
      </div>
    </div>
  );
}
