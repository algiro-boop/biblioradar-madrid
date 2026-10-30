"use client";

import { ArrowUpRight, LoaderCircle, Radio, RotateCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { TAG_LABELS, recentAt, type CommunityReport } from "@/lib/community";

export function LiveActivityFeed({ reports, now, onSelect }: {
  reports: CommunityReport[]; now: number; onSelect: (id: string) => void;
}) {
  const recent = reports.filter((r) => recentAt(r.created_at, now, 180)).slice(0, 5);
  if (!recent.length) return <div className="rounded-2xl bg-slate-50 px-5 py-8 text-center dark:bg-slate-800">
    <Radio aria-hidden className="mx-auto mb-3 size-7 text-emerald-600" />
    <p className="font-semibold">Radar en directo listo</p>
    <p className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-300">¿Estás en una biblioteca? Sé el primero en confirmar el ambiente hoy</p>
  </div>;
  return <ul className="space-y-2" aria-label="Reportes recientes de Madrid">
    {recent.map((report, index) => {
      const minutes = Math.floor((now - Date.parse(report.created_at)) / 60_000);
      return <li key={`${report.library_id}-${report.created_at}-${index}`}>
        <button type="button" onClick={() => onSelect(report.library_id)}
          className="group w-full rounded-2xl border border-slate-200 p-4 text-left transition hover:border-emerald-300 hover:bg-emerald-50/50 focus-visible:outline-2 focus-visible:outline-emerald-600 dark:border-slate-700 dark:hover:bg-slate-800">
          <span className="flex items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
            <span>{minutes < 2 ? "Ahora" : `Hace ${minutes} min`} · {report.district}</span>
            <ArrowUpRight aria-hidden className="size-4 shrink-0" />
          </span>
          <span className="mt-1.5 block text-sm font-semibold">{report.library_name}</span>
          <span className="mt-2 inline-flex rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">{report.reported_value}% ocupada</span>
          {report.tags.length > 0 && <span className="mt-2 flex flex-wrap gap-1.5">
            {report.tags.map((tag) => <span key={tag} className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">{TAG_LABELS[tag]}</span>)}
          </span>}
        </button>
      </li>;
    })}
  </ul>;
}

/** A single header action; the feed only occupies the screen after an explicit request. */
export function LiveActivityButton({ reports, now, onSelect, loading = false, error = null, onRefresh }: {
  reports: CommunityReport[]; now: number; onSelect: (id: string) => void;
  loading?: boolean; error?: string | null; onRefresh?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(true);
  const count = reports.filter((r) => recentAt(r.created_at, now, 180)).slice(0, 5).length;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && dialog && !dialog.open) dialog.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);

  function close() {
    dialogRef.current?.close();
    setOpen(false);
    if (restoreFocus.current) openerRef.current?.focus({ preventScroll: true });
  }

  return <>
    <button ref={openerRef} type="button" aria-haspopup="dialog" aria-expanded={open}
      aria-label="Ver actividad en vivo en Madrid"
      onClick={() => { restoreFocus.current = true; setOpen(true); onRefresh?.(); }}
      className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-xl px-2 text-xs font-medium text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-emerald-600">
      <Radio aria-hidden className="size-4 text-emerald-600" /> Actividad
      {count > 0 && <span key={count} className="anim-pop grid min-w-4 place-items-center rounded-full bg-emerald-100 px-1 text-[10px] font-semibold text-emerald-800">{count}</span>}
    </button>
    <dialog ref={dialogRef} aria-labelledby="activity-title" aria-describedby="activity-description"
      onCancel={() => setOpen(false)}
      onClose={() => { setOpen(false); if (restoreFocus.current) openerRef.current?.focus({ preventScroll: true }); }}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        const r = e.currentTarget.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();
      }}
      className="feedback-dialog rounded-3xl bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/40 dark:bg-slate-900 dark:text-slate-100">
      {open && <div className="flex max-h-[inherit] flex-col p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="mb-4 flex shrink-0 items-start justify-between gap-3">
          <div>
            <h2 id="activity-title" className="flex items-center gap-2 text-lg font-bold"><Radio aria-hidden className="size-5 text-emerald-600" />Actividad en vivo</h2>
            <p id="activity-description" className="mt-1 text-sm text-slate-500 dark:text-slate-300">Madrid · Últimas 3 horas. Toca una biblioteca para verla en el mapa.</p>
          </div>
          <button type="button" autoFocus onClick={close} aria-label="Cerrar actividad"
            className="grid size-11 shrink-0 place-items-center rounded-full hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-emerald-600 dark:hover:bg-slate-800"><X className="size-5" /></button>
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain p-0.5">
          {loading && <p role="status" className="mb-3 flex items-center gap-2 text-sm text-slate-500"><LoaderCircle aria-hidden className="size-4 animate-spin" />Actualizando actividad…</p>}
          {error && <p role="alert" className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">{error}</p>}
          {(reports.length > 0 || (!loading && !error)) && <LiveActivityFeed reports={reports} now={now} onSelect={(id) => {
            restoreFocus.current = false;
            close();
            onSelect(id);
          }} />}
        </div>
        {onRefresh && <button type="button" onClick={onRefresh} disabled={loading}
          className="mt-4 inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-200">
          <RotateCw aria-hidden className="size-4" />{error ? "Reintentar" : "Actualizar actividad"}
        </button>}
      </div>}
    </dialog>
  </>;
}
