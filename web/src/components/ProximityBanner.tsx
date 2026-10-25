"use client";

import { ChevronRight, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRecentReportsVersion } from "@/hooks/useReport";
import { getRecentReport } from "@/lib/device";
import { haversineMeters, isInProximity } from "@/lib/geo";
import type { LibraryWithOccupancy, ReportValue, UserPosition } from "@/lib/types";
import { ReportButtons } from "./ReportButtons";

const DISMISSED_KEY = "biblioradar:proximity-dismissed:v1";
const SUCCESS_VISIBLE_MS = 4500;

function readDismissed(): Set<string> {
  try {
    const raw = window.sessionStorage.getItem(DISMISSED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function writeDismissed(ids: Set<string>) {
  try {
    window.sessionStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids]));
  } catch {
    // Sin sessionStorage el descarte dura hasta recargar.
  }
}

export function ProximityBanner({
  libraries,
  position,
  hidden,
  now,
  locate,
  onReported,
  onOpen,
}: {
  libraries: LibraryWithOccupancy[];
  position: UserPosition | null;
  hidden: boolean;
  now: number;
  locate: () => Promise<UserPosition>;
  onReported: (libraryId: string, value: ReportValue) => void;
  onOpen: (libraryId: string) => void;
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  // Biblioteca recién reportada desde el banner: se mantiene visible para mostrar la confirmación.
  const [stickyId, setStickyId] = useState<string | null>(null);
  const reportsVersion = useRecentReportsVersion();

  useEffect(() => setDismissed(readDismissed()), []);

  const dismiss = useCallback((id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev).add(id);
      writeDismissed(next);
      return next;
    });
    setStickyId((s) => (s === id ? null : s));
  }, []);

  const candidate = useMemo(() => {
    if (stickyId) return libraries.find((l) => l.id === stickyId) ?? null;
    if (!position) return null;
    let best: { lib: LibraryWithOccupancy; d: number } | null = null;
    for (const lib of libraries) {
      const d = haversineMeters(position, lib);
      if (!isInProximity(d) || dismissed.has(lib.id)) continue;
      if (getRecentReport(lib.id, now)) continue;
      if (!best || d < best.d) best = { lib, d };
    }
    return best?.lib ?? null;
    // reportsVersion invalida el cálculo cuando se registra un reporte.
  }, [libraries, position, dismissed, now, stickyId, reportsVersion]);

  useEffect(() => {
    if (!stickyId) return;
    const t = window.setTimeout(() => dismiss(stickyId), SUCCESS_VISIBLE_MS);
    return () => window.clearTimeout(t);
  }, [stickyId, dismiss]);

  const handleReported = useCallback(
    (libraryId: string, value: ReportValue) => {
      setStickyId(libraryId);
      onReported(libraryId, value);
    },
    [onReported],
  );

  if (!candidate || hidden) return null;

  return (
    <aside
      className="pointer-events-auto mx-auto w-full max-w-md rounded-3xl bg-white p-4 shadow-2xl ring-1 ring-slate-900/10 animate-[banner-in_300ms_ease-out]"
      aria-label="Reporte rápido de ocupación"
    >
      <div className="mb-3 flex items-start gap-2">
        <p className="flex-1 text-sm leading-snug text-slate-800">
          📍 Parece que estás en <strong className="font-semibold text-slate-900">{candidate.name}</strong>.
          ¿Confirmas con un toque si hay sitio?
        </p>
        <button
          type="button"
          onClick={() => dismiss(candidate.id)}
          className="-mt-1 -mr-1 rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          aria-label="Ahora no"
        >
          <X className="size-4" />
        </button>
      </div>
      <ReportButtons library={candidate} locate={locate} locationGranted onReported={handleReported} compact />
      <button
        type="button"
        onClick={() => onOpen(candidate.id)}
        className="mt-2 inline-flex items-center gap-0.5 text-xs font-medium text-slate-500 hover:text-slate-900"
      >
        Ver detalle <ChevronRight className="size-3.5" />
      </button>
    </aside>
  );
}
