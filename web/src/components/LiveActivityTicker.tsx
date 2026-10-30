"use client";
import { useEffect, useState } from "react";
import { TAG_LABELS, recentAt, type CommunityReport } from "@/lib/community";

export function LiveActivityTicker({ reports, now, onSelect }: {
  reports: CommunityReport[]; now: number; onSelect: (id: string) => void;
}) {
  const [engaged, setEngaged] = useState(false);
  const [paused, setPaused] = useState(false);
  const [index, setIndex] = useState(0);
  const recent = reports.filter((r) => recentAt(r.created_at, now, 180)).slice(0, 5);
  useEffect(() => {
    if (recent.length < 2 || paused || engaged || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setIndex((i) => i + 1), 8_000);
    return () => window.clearInterval(timer);
  }, [recent.length, paused, engaged]);
  const report = recent[index % Math.max(1, recent.length)];
  return <section onMouseEnter={() => setEngaged(true)} onMouseLeave={() => setEngaged(false)}
    onFocusCapture={() => setEngaged(true)} onBlurCapture={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setEngaged(false); }} aria-label="Actividad en vivo en Madrid" className="pointer-events-auto mx-3 mb-2 rounded-2xl bg-white/95 p-3 text-xs text-slate-600 shadow-sm ring-1 ring-slate-200 lg:mt-2">
    <p className="mb-1 font-semibold text-slate-800">Actividad en vivo en Madrid</p>
    {report ? <>
      <button type="button" onClick={() => onSelect(report.library_id)} key={`${report.library_id}-${report.created_at}`} className="motion-safe:animate-[activity-in_250ms_ease-out] block w-full rounded-lg text-left hover:text-slate-950 focus-visible:outline-2">
        ⚡ {Math.floor((now - Date.parse(report.created_at)) / 60_000) < 2 ? "Ahora" : `Hace ${Math.floor((now - Date.parse(report.created_at)) / 60_000)} min`} en <strong>{report.library_name}</strong>: {report.reported_value}% ocupada
        {report.tags.map((tag) => <span key={tag}> · {TAG_LABELS[tag]}</span>)}
      </button>
      {recent.length > 1 && <div className="mt-1 flex justify-end gap-2">
        <button type="button" aria-label="Actividad anterior" onClick={() => setIndex((i) => (i + recent.length - 1) % recent.length)}>←</button>
        <button type="button" onClick={() => setPaused((p) => !p)} aria-label={paused ? "Reanudar actividad" : "Pausar actividad"}>{paused ? "Reanudar" : "Pausar"}</button>
        <span>{index % recent.length + 1}/{recent.length}</span>
        <button type="button" aria-label="Actividad siguiente" onClick={() => setIndex((i) => i + 1)}>→</button>
      </div>}
    </> : <p>📡 Radar en directo listo · ¿Estás en una biblioteca? Sé el primero en confirmar el ambiente hoy</p>}
  </section>;
}
