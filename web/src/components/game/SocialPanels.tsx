"use client";

import { Heart, Music, Volume2 } from "lucide-react";
import { useState } from "react";
import { hasFeature } from "@/game/data/levels";
import { NEIGHBORS } from "@/game/data/neighbors";
import type { GameState, MusicSettings } from "@/game/engine";
import { run } from "@/game/store";
import { madridDateKey } from "@/game/time";
import { report } from "./ShopPanel";
import { Button, Section } from "./ui";

type Notify = (m: string, k?: "ok" | "error") => void;

// ---------------------------------------------------------------- visitas

export function VisitPanel({ state, now, onVisit }: { state: GameState; now: number; onVisit: (id: string) => void }) {
  const today = madridDateKey(now);
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        Bibliotecas virtuales públicas <strong>ficticias</strong> del entorno de pruebas, para probar visitas y «me gusta». Solo se puede mirar: nadie toca la biblioteca de nadie.
      </p>
      <div className="space-y-2">
        {NEIGHBORS.map((n) => {
          const visited = state.virtualVisits.some((v) => v.ownerId === n.id && v.date === today);
          return (
            <button key={n.id} type="button" onClick={() => onVisit(n.id)}
              className="flex w-full items-center gap-3 rounded-2xl bg-white p-3 text-left ring-1 ring-slate-200 transition-[scale,box-shadow] hover:shadow-md active:scale-[0.98]">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-amber-100 text-lg" aria-hidden>🏛️</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{n.libraryName}</span>
                <span className="block text-xs text-slate-500">de {n.alias} · nivel {n.level} · {n.rooms.length} {n.rooms.length === 1 ? "sala" : "salas"}</span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1 text-[11px]">
                {state.likes[n.id] && <Heart className="size-4 fill-rose-500 text-rose-500" aria-label="Te gusta" />}
                {visited && <span className="rounded bg-emerald-100 px-1.5 font-semibold text-emerald-800">Visitada hoy</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- ajustes

const TRACKS: { id: MusicSettings["track"]; name: string }[] = [
  { id: "lofi", name: "Lo-fi de estudio" },
  { id: "jazz", name: "Jazz de café" },
  { id: "rain", name: "Lluvia y piano" },
];

export function SettingsPanel({ state, notify }: { state: GameState; notify: Notify }) {
  const [name, setName] = useState(state.name);
  const [cat, setCat] = useState(state.catName);
  const [alias, setAlias] = useState(state.settings.alias);
  const music = state.settings.music;
  return (
    <div className="space-y-6">
      <Section title="Tu biblioteca">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); report(run({ type: "set_name", name }), notify); }}>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} disabled={!hasFeature(state.level, "name")} aria-label="Nombre de la biblioteca"
            className="min-w-0 flex-1 rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-slate-200 focus:ring-2 focus:ring-sky-500 focus:outline-none disabled:opacity-50" />
          <Button type="submit" disabled={!hasFeature(state.level, "name") || name.trim() === state.name}>Guardar</Button>
        </form>
        {hasFeature(state.level, "cat") && (
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); report(run({ type: "set_cat_name", name: cat }), notify); }}>
            <input value={cat} onChange={(e) => setCat(e.target.value)} maxLength={20} aria-label="Nombre del gato"
              className="min-w-0 flex-1 rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-slate-200 focus:ring-2 focus:ring-sky-500 focus:outline-none" />
            <Button type="submit" variant="secondary" disabled={cat.trim() === state.catName}>Nombre del gato</Button>
          </form>
        )}
      </Section>

      <Section title="Música ambiente">
        <div className="space-y-3 rounded-2xl bg-white p-3 ring-1 ring-slate-200">
          <label className="flex items-center justify-between gap-2 text-sm font-semibold">
            <span className="inline-flex items-center gap-2"><Music className="size-4" aria-hidden />Música</span>
            <input type="checkbox" role="switch" checked={music.enabled} onChange={(e) => run({ type: "set_settings", music: { enabled: e.target.checked } })} className="size-5 accent-emerald-600" />
          </label>
          <div className="grid grid-cols-3 gap-1.5">
            {TRACKS.map((t) => (
              <button key={t.id} type="button" aria-pressed={music.track === t.id} onClick={() => run({ type: "set_settings", music: { track: t.id } })}
                className={`rounded-xl px-2 py-2 text-xs font-semibold ring-1 ${music.track === t.id ? "bg-emerald-600 text-white ring-emerald-600" : "bg-slate-50 text-slate-700 ring-slate-200"}`}>
                {t.name}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <Volume2 className="size-4" aria-hidden />
            <input type="range" min={0} max={1} step={0.05} value={music.volume} aria-label="Volumen"
              onChange={(e) => run({ type: "set_settings", music: { volume: Number(e.target.value) } })} className="flex-1 accent-emerald-600" />
          </label>
          <p className="text-[11px] text-slate-500">Composiciones originales generadas en tu dispositivo. Nunca suenan solas y se pausan al salir de la biblioteca o cambiar de pestaña.</p>
        </div>
        <label className="flex items-center justify-between gap-2 rounded-2xl bg-white p-3 text-sm font-semibold ring-1 ring-slate-200">
          Efectos de sonido
          <input type="checkbox" role="switch" checked={state.settings.sfx} onChange={(e) => run({ type: "set_settings", sfx: e.target.checked })} className="size-5 accent-emerald-600" />
        </label>
      </Section>

      <Section title="Privacidad">
        <div className="space-y-2 rounded-2xl bg-white p-3 ring-1 ring-slate-200">
          <label className="flex items-center justify-between gap-2 text-sm font-semibold">
            Biblioteca pública
            <input type="checkbox" role="switch" checked={state.settings.publish} onChange={(e) => run({ type: "set_settings", publish: e.target.checked })} className="size-5 accent-emerald-600" />
          </label>
          <p className="text-[11px] text-slate-500">Si la publicas, otros podrán verla (solo mirar) con tu alias. Nunca se muestra tu ubicación ni tus reportes. En pruebas no se envía a ningún sitio.</p>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run({ type: "set_settings", alias }); notify("Alias guardado", "ok"); }}>
            <input value={alias} onChange={(e) => setAlias(e.target.value)} maxLength={24} placeholder="Alias público" aria-label="Alias público"
              className="min-w-0 flex-1 rounded-xl bg-slate-50 px-3 py-2 text-sm ring-1 ring-slate-200 focus:ring-2 focus:ring-sky-500 focus:outline-none" />
            <Button type="submit" variant="secondary" disabled={alias === state.settings.alias}>Guardar</Button>
          </form>
        </div>
      </Section>
    </div>
  );
}
