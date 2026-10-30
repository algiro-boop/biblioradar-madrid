"use client";
import { TAG_GROUPS, TAG_LABELS, activeTags, liveLabel, type ReportTag } from "@/lib/community";
import type { OccupancyStatus } from "@/lib/types";

export function LiveStatusBadge({ status, now, onReport }: {
  status: OccupancyStatus | null; now: number; onReport: () => void;
}) {
  const label = liveLabel(status, now);
  if (!label) return null;
  if (label.startsWith("📊")) return <button type="button" onClick={onReport}
    className="rounded-full bg-slate-100 px-2.5 py-1 text-left text-xs font-medium text-slate-600 hover:bg-slate-200 focus-visible:outline-2">{label}</button>;
  return <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
    <span aria-hidden className="size-2 rounded-full bg-emerald-500 motion-safe:animate-pulse" />{label}</span>;
}
export function ActiveTags({ status, now }: { status: OccupancyStatus | null; now: number }) {
  const tags = activeTags(status, now);
  if (!tags.length) return null;
  return <div className="mt-2 flex flex-wrap gap-1" aria-label="Ambiente reportado recientemente">
    {tags.map((tag) => <span key={tag} className="rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-700">{TAG_LABELS[tag]}</span>)}
  </div>;
}
export function ReportTagSelector({ selected, onToggle, disabled = false }: {
  selected: ReportTag[]; onToggle: (tag: ReportTag) => void; disabled?: boolean;
}) {
  return <fieldset disabled={disabled} className="space-y-2">
    <legend className="mb-2 text-sm font-semibold text-slate-700">¿Cómo está el ambiente? (Opcional)</legend>
    {TAG_GROUPS.map((group) => <div key={group.label} role="group" aria-label={group.label} className="flex flex-wrap gap-1.5">
      {group.tags.map((tag) => <button key={tag} type="button" aria-pressed={selected.includes(tag)}
        onClick={() => onToggle(tag)} className={`rounded-full border px-2.5 py-2 text-xs transition disabled:opacity-50 ${selected.includes(tag)
          ? "border-emerald-500 bg-emerald-50 font-semibold text-emerald-900" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"}`}>{TAG_LABELS[tag]}</button>)}
    </div>)}
  </fieldset>;
}
