"use client";

import { CircleAlert, CircleCheck, LoaderCircle, MapPin, TriangleAlert } from "lucide-react";
import { useReport } from "@/hooks/useReport";
import { REPORT_OPTIONS } from "@/lib/reports";
import type { Library, ReportValue, UserPosition } from "@/lib/types";

const BUTTON_STYLES: Record<ReportValue, string> = {
  30: "border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 active:bg-emerald-200 focus-visible:ring-emerald-500",
  75: "border-amber-200 bg-amber-50 text-amber-950 hover:bg-amber-100 active:bg-amber-200 focus-visible:ring-amber-500",
  100: "border-red-200 bg-red-50 text-red-900 hover:bg-red-100 active:bg-red-200 focus-visible:ring-red-500",
};

const VALUE_TEXT: Record<ReportValue, string> = {
  30: "hay sitio",
  75: "quedan pocos sitios",
  100: "está llena",
};

export function ReportButtons({
  library,
  locate,
  onReported,
  compact = false,
}: {
  library: Pick<Library, "id" | "lat" | "lng" | "name">;
  locate: () => Promise<UserPosition>;
  onReported?: (libraryId: string, value: ReportValue) => void;
  compact?: boolean;
}) {
  const { phase, error, activeValue, recent, cooldownMinutes, submit } = useReport({
    library,
    locate,
    onReported,
  });
  const busy = phase === "locating" || phase === "sending";
  const coolingDown = cooldownMinutes > 0 && phase !== "success";

  return (
    <div className="space-y-3">
      <div className={`grid grid-cols-3 ${compact ? "gap-2" : "gap-2.5"}`} role="group" aria-label="Enviar reporte de ocupación">
        {REPORT_OPTIONS.map((opt) => {
          const isActive = activeValue === opt.value && (busy || phase === "success");
          return (
            <button
              key={opt.value}
              type="button"
              disabled={busy || cooldownMinutes > 0}
              onClick={() => void submit(opt.value)}
              className={`flex flex-col items-center justify-center rounded-2xl border text-center font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                compact ? "min-h-16 px-1.5 py-2 text-xs" : "min-h-20 px-2 py-3 text-sm"
              } ${BUTTON_STYLES[opt.value]} ${isActive ? "opacity-100! ring-2 ring-offset-1 ring-slate-900/20" : ""}`}
            >
              <span className={compact ? "text-lg leading-none" : "text-2xl leading-none"} aria-hidden>
                {isActive && busy ? <LoaderCircle className="mx-auto size-6 animate-spin" /> : opt.emoji}
              </span>
              <span className="mt-1.5 leading-tight">{opt.label}</span>
              <span className="text-[11px] font-medium opacity-70">{opt.hint}</span>
            </button>
          );
        })}
      </div>

      <div aria-live="polite" className="min-h-0 text-sm">
        {phase === "locating" && (
          <p className="flex items-center gap-2 text-slate-600">
            <MapPin className="size-4 shrink-0" /> Comprobando tu ubicación…
          </p>
        )}
        {phase === "sending" && (
          <p className="flex items-center gap-2 text-slate-600">
            <LoaderCircle className="size-4 shrink-0 animate-spin" /> Enviando reporte…
          </p>
        )}
        {phase === "success" && activeValue !== null && (
          <p className="flex items-start gap-2 rounded-xl bg-emerald-50 p-3 text-emerald-900">
            <CircleCheck className="mt-0.5 size-4 shrink-0" />
            <span>
              ¡Gracias! Has indicado que {VALUE_TEXT[activeValue]}. Tu reporte ya cuenta para el resto de
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
            <span>{error.message}</span>
          </p>
        )}
        {phase === "idle" && coolingDown && (
          <p className="text-slate-500">
            {recent?.value != null
              ? `Ya reportaste que ${VALUE_TEXT[recent.value]}. `
              : "Ya reportaste esta biblioteca. "}
            Podrás volver a hacerlo en {cooldownMinutes} min.
          </p>
        )}
        {phase === "idle" && !coolingDown && !compact && (
          <p className="text-xs text-slate-500">
            Usamos tu ubicación solo para comprobar que estás a menos de 250 m. No pedimos cuenta ni guardamos
            tu nombre.
          </p>
        )}
      </div>
    </div>
  );
}
