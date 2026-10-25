"use client";

import { LoaderCircle, LocateFixed, RotateCw, X } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import {
  detectPlatform,
  PURPOSE_TEXT,
  UNLOCK_STEPS,
  type LocationPlatform,
  type LocationPurpose,
} from "@/lib/location";

/** Ayuda cuando el navegador tiene la ubicación bloqueada. Reintenta sin recargar la página. */
export function LocationHelpModal({
  purpose,
  retrying,
  retryError,
  onRetry,
  onClose,
}: {
  purpose: LocationPurpose;
  retrying: boolean;
  retryError: string | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  const retryRef = useRef<HTMLButtonElement>(null);
  const platform = useMemo<LocationPlatform>(
    () => (typeof navigator === "undefined" ? "desktop" : detectPlatform(navigator.userAgent, navigator.maxTouchPoints)),
    [],
  );
  const others = (Object.keys(UNLOCK_STEPS) as LocationPlatform[]).filter((p) => p !== platform);
  const main = UNLOCK_STEPS[platform];

  useEffect(() => {
    retryRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[1300] flex items-end justify-center bg-slate-950/40 p-3 md:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="location-help-title"
        aria-describedby="location-help-why"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-3xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl"
      >
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-sky-50 text-sky-700" aria-hidden>
            <LocateFixed className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="location-help-title" className="text-base font-bold text-slate-900">
              Activa la ubicación
            </h2>
            <p id="location-help-why" className="mt-1 text-sm text-slate-600">
              {PURPOSE_TEXT[purpose]} Tu navegador la tiene bloqueada para esta web.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mt-1 -mr-1 rounded-full p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            aria-label="Cerrar"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="mt-4 rounded-2xl bg-slate-50 p-3.5 ring-1 ring-inset ring-slate-200">
          <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{main.browser}</p>
          <p className="mt-1 text-sm font-medium text-slate-900">{main.step}</p>
          {main.extra && <p className="mt-1.5 text-xs text-slate-500">{main.extra}</p>}
        </div>

        <details className="mt-2 text-sm text-slate-600">
          <summary className="cursor-pointer py-1 text-xs font-medium text-slate-500">¿Usas otro navegador?</summary>
          <ul className="mt-1 space-y-2">
            {others.map((p) => (
              <li key={p}>
                <span className="font-semibold text-slate-800">{UNLOCK_STEPS[p].browser}:</span> {UNLOCK_STEPS[p].step}
              </li>
            ))}
          </ul>
        </details>

        {retryError && (
          <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-950" role="alert">
            {retryError}
          </p>
        )}

        <button
          ref={retryRef}
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 text-sm font-semibold text-white hover:bg-slate-700 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-60"
        >
          {retrying ? <LoaderCircle className="size-4 animate-spin" /> : <RotateCw className="size-4" />}
          Ya lo he activado, volver a intentar
        </button>
      </div>
    </div>
  );
}
