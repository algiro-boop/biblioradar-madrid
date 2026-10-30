"use client";

import { Armchair, CalendarClock, Clock, MapPin, Navigation, Users, X } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { formatDistance } from "@/lib/geo";
import {
  formatClock,
  formatOccupancy,
  formatRelativeTime,
  getOccupancyLevel,
  LEVEL_STYLES,
  LEVEL_TEXT,
} from "@/lib/occupancy";
import type { LibraryWithOccupancy, ReportValue, UserPosition } from "@/lib/types";
import { InstitutionBadge } from "./Badges";
import { ActiveTags, LiveStatusBadge } from "./CommunityStatus";
import { CapacityText } from "./CapacityText";
import { GoogleBusyness } from "./GoogleBusyness";
import { FullReportNotice } from "./FullReportNotice";
import { ReportButtons } from "./ReportButtons";
import { ShareButtons } from "./ShareButtons";

function directionsUrl(library: LibraryWithOccupancy): string {
  const params = new URLSearchParams({ api: "1", destination: `${library.lat},${library.lng}` });
  if (library.google_place_id) params.set("destination_place_id", library.google_place_id);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function Breakdown({
  title,
  value,
  detail,
  icon,
}: {
  title: string;
  value: number | null;
  detail: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
        {icon}
        {title}
      </div>
      <div className="mt-1 text-xl font-bold tabular-nums text-slate-900">
        {value === null ? <span className="text-base font-semibold text-slate-400">Sin datos</span> : `${value}%`}
      </div>
      <p className="mt-0.5 text-xs leading-snug text-slate-500">{detail}</p>
    </div>
  );
}

export function LibraryDrawer({
  library: selected,
  distanceM,
  now,
  locate,
  locationGranted,
  onReported,
  onClose,
  reportFocusKey = 0,
  tagsEnabled = true,
}: {
  library: LibraryWithOccupancy | null;
  distanceM: number | null;
  now: number;
  locate: () => Promise<UserPosition>;
  /** Permiso ya concedido: si no, se explica al enviar por qué se pide la ubicación. */
  locationGranted: boolean;
  onReported: (libraryId: string, value: ReportValue) => void;
  onClose: () => void;
  reportFocusKey?: number;
  tagsEnabled?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const reportRef = useRef<HTMLElement>(null);
  const focusReport = () => {
    reportRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    reportRef.current?.focus({ preventScroll: true });
  };
  const dragStartRef = useRef<number | null>(null);
  const [dragY, setDragY] = useState(0);
  // Se conserva la última biblioteca para que el contenido no desaparezca durante la animación de cierre.
  const [last, setLast] = useState(selected);
  if (selected && selected !== last) setLast(selected);
  const library = selected ?? last;
  const open = selected !== null;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    closeRef.current?.focus({ preventScroll: true });
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    setDragY(0);
    panelRef.current?.querySelector("[data-scroll]")?.scrollTo({ top: 0 });
  }, [library?.id]);

  useEffect(() => {
    if (open && reportFocusKey > 0) {
      reportRef.current?.scrollIntoView({ block: "start" });
      reportRef.current?.focus({ preventScroll: true });
    }
  }, [open, library?.id, reportFocusKey]);

  // Gesto "deslizar hacia abajo para cerrar" desde el asa del bottom sheet.
  const onPointerDown = (e: ReactPointerEvent) => {
    dragStartRef.current = e.clientY;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    if (dragStartRef.current === null) return;
    setDragY(Math.max(0, e.clientY - dragStartRef.current));
  };
  const onPointerUp = () => {
    if (dragStartRef.current === null) return;
    dragStartRef.current = null;
    if (dragY > 90) onClose();
    setDragY(0);
  };

  const status = library?.occupancy ?? null;
  const level = getOccupancyLevel(status);
  const styles = LEVEL_STYLES[level];
  const pct = status?.final_occupancy_pct ?? null;
  const validUntil = formatClock(status?.base_valid_until);
  const hours = library?.opening_hours.normalized_text || library?.opening_hours.raw_text || "";

  const googleBits: string[] = [];
  if (status?.google_live_pct != null) googleBits.push(`Google en vivo ${status.google_live_pct}%`);
  if (status?.google_hist_pct != null) googleBits.push(`histórico ${status.google_hist_pct}%`);

  return (
    <>
      <div
        className={`fixed inset-0 z-[1100] bg-slate-950/30 transition-opacity lg:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-drawer-title"
        aria-hidden={!open}
        inert={!open}
        style={dragY ? { transform: `translateY(${dragY}px)`, transition: "none" } : undefined}
        className={`fixed inset-x-0 bottom-0 z-[1200] flex max-h-[88dvh] flex-col sm:max-h-[65dvh] rounded-t-3xl bg-white shadow-2xl transition-transform duration-300 ease-out lg:inset-x-auto lg:top-3 lg:right-3 lg:bottom-3 lg:max-h-none lg:w-[360px] xl:w-[420px] lg:rounded-3xl ${
          open ? "translate-y-0 lg:translate-x-0" : "translate-y-full lg:translate-x-[calc(100%+1.5rem)] lg:translate-y-0"
        }`}
      >
        {library && (
          <>
            <div
              className="flex touch-none cursor-grab justify-center pt-2.5 pb-1 lg:hidden"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <span className="h-1.5 w-10 rounded-full bg-slate-300" aria-hidden />
            </div>

            <div className="flex items-start gap-3 px-5 pt-2 pb-3 lg:pt-5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <InstitutionBadge institution={library.institution} />
                  {library.district && <span className="text-xs font-medium text-slate-500">{library.district}</span>}
                </div>
                <h2 id="library-drawer-title" className="mt-1.5 text-lg leading-snug font-bold text-slate-900">
                  {library.name}
                </h2>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={onClose}
                className="-mr-1 rounded-full p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:outline-none"
                aria-label="Cerrar detalle"
              >
                <X className="size-5" />
              </button>
            </div>

            <div data-scroll className="flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <MapPin className="size-4 shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate" title={library.address}>
                    {library.address}
                  </span>
                  {distanceM !== null && (
                    <span className="block text-xs text-slate-400">A {formatDistance(distanceM)} de ti</span>
                  )}
                </span>
                <a
                  href={directionsUrl(library)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
                >
                  <Navigation className="size-3.5" /> Cómo llegar
                </a>
              </div>

              <section aria-label="Ocupación actual" className="rounded-3xl p-4 ring-1 ring-inset ring-slate-200">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">Ocupación ahora</p>
                    <p
                      className={`mt-1 font-extrabold tabular-nums ${
                        pct === null || level === "closed" ? "text-2xl text-slate-400" : "text-5xl text-slate-900"
                      }`}
                    >
                      {level === "closed" ? "Cerrada" : formatOccupancy(pct)}
                    </p>
                    <CapacityText library={library} className="mt-1 block text-sm font-medium text-slate-600" />
                    <FullReportNotice status={status} now={now} />
                  </div>
                  <span
                    className={`mb-1 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ring-1 ring-inset ${styles.soft}`}
                  >
                    <span className={`size-2 rounded-full ${styles.dot}`} aria-hidden />
                    {level === "closed" ? "Cerrada" : pct === null ? "Sin datos" : LEVEL_TEXT[level]}
                  </span>
                </div>
                <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                  {pct !== null && level !== "closed" && (
                    <div className={`h-full rounded-full ${styles.bar} transition-all`} style={{ width: `${Math.max(pct, 3)}%` }} />
                  )}
                </div>
                <div className="mt-3"><LiveStatusBadge status={status} now={now} onReport={focusReport} /><ActiveTags status={status} now={now} /></div>
                <div className="mt-3 space-y-1 text-xs text-slate-500">
                  <p className="font-medium text-slate-700">{status?.primary_source ?? "Sin datos de ocupación"}</p>
                  <p className="flex items-center gap-1.5">
                    <Clock className="size-3.5" />
                    {library.estimatedLocally
                      ? `Estimación de las ${formatClock(new Date(now).toISOString())} (hora de Madrid)`
                      : `Actualizado ${formatRelativeTime(status?.updated_at, now)}`}
                  </p>
                </div>
                <div className="mt-4 border-t border-slate-100 pt-4">
                  <ShareButtons library={library} />
                </div>
              </section>

              {open && <GoogleBusyness key={library.id} library={library} />}

              <section aria-label="Desglose de la estimación" className="grid grid-cols-2 gap-2.5">
                <Breakdown
                  title="Estimación base"
                  value={status?.predicted_base_pct ?? null}
                  icon={<Armchair className="size-3.5" />}
                  detail={[
                    status?.predicted_base_pct != null ? status.base_source : "Sin estimación vigente",
                    googleBits.join(" · "),
                    validUntil && status?.predicted_base_pct != null ? `Válida hasta las ${validUntil}` : "",
                  ]
                    .filter(Boolean)
                    .join(". ")}
                />
                <Breakdown
                  title="Comunidad"
                  value={status?.crowd_pct ?? null}
                  icon={<Users className="size-3.5" />}
                  detail={
                    status && status.active_reports_count > 0
                      ? `${status.active_reports_count} ${status.active_reports_count === 1 ? "reporte" : "reportes"} usados en el cálculo (últimos 90 min)`
                      : "Sin reportes para el cálculo en los últimos 90 min"
                  }
                />
              </section>

              <section aria-labelledby="hours-title">
                <h3 id="hours-title" className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                  <CalendarClock className="size-4 text-slate-400" /> Horario
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                  {hours || "Horario no disponible. Consulta la web oficial de la biblioteca."}
                </p>
                {hours && library.opening_hours.requires_review && (
                  <p className="mt-1 text-xs text-slate-400">Texto de la fuente oficial; puede variar en festivos.</p>
                )}
              </section>

              <section ref={reportRef} tabIndex={-1} aria-labelledby="report-title" className="rounded-3xl bg-slate-50 p-4 ring-1 ring-inset ring-slate-200">
                <h3 id="report-title" className="text-base font-bold text-slate-900">
                  ¿Estás aquí? Ayuda a otros estudiantes
                </h3>
                <p className="mt-0.5 mb-3 text-sm text-slate-500">Dinos cómo está la sala ahora mismo.</p>
                <ReportButtons tagsEnabled={tagsEnabled} key={library.id} library={library} locate={locate} locationGranted={locationGranted} onReported={onReported} />
              </section>
            </div>
          </>
        )}
      </div>
    </>
  );
}
