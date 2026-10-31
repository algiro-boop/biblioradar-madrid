"use client";

import { GraduationCap, Heart, Music, Sparkles, Volume2 } from "lucide-react";
import { useState } from "react";
import { hasFeature } from "@/game/data/levels";
import { SHOWCASES } from "@/game/data/showcases";
import type { GameState, MusicSettings } from "@/game/engine";
import { run } from "@/game/store";
import { sfx } from "@/game/sfx";
import { report } from "./ShopPanel";
import { Button, Section } from "./ui";

type Notify = (m: string, k?: "ok" | "error") => void;

// ---------------------------------------------------------------- visitas

export function VisitPanel({ state, onVisit }: { state: GameState; onVisit: (id: string) => void }) {
  return (
    <div className="space-y-6">
      <Section title="Inspiración" aside={`${SHOWCASES.length} bibliotecas`}>
        <p className="text-xs text-slate-500">Montadas con piezas del catálogo para que veas todo lo que se puede construir.</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
          {SHOWCASES.map((n) => (
            <button key={n.id} type="button" onClick={() => onVisit(n.id)}
              className="flex w-full items-start gap-3 rounded-2xl bg-gradient-to-br from-amber-50 to-rose-50 p-3 text-left ring-1 ring-amber-200 transition-[scale,box-shadow] hover:shadow-md active:scale-[0.98]">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-amber-200 text-amber-900" aria-hidden><Sparkles className="size-5" /></span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                  <span className="truncate">{n.libraryName}</span>
                  {state.likes[n.id] && <Heart className="size-3.5 shrink-0 fill-rose-500 text-rose-500" aria-label="Te gusta" />}
                </span>
                <span className="mt-0.5 block text-xs leading-snug text-slate-600">{n.blurb}</span>
                <span className="mt-1 block text-[11px] font-semibold text-amber-800">Nivel {n.level} · {n.rooms.length} {n.rooms.length === 1 ? "sala" : "salas"}</span>
              </span>
            </button>
          ))}
        </div>
      </Section>
      <PublicLibrary />
    </div>
  );
}

/**
 * «Mi biblioteca pública»: aún no hay servidor que guarde y enseñe bibliotecas de otras personas,
 * así que se anuncia sin ofrecer un «Publicar» que no llegaría a nadie.
 */
function PublicLibrary() {
  return (
    <Section title="Mi biblioteca pública" aside={<span className="font-semibold text-sky-700">Próximamente</span>}>
      <p className="rounded-2xl bg-white p-3 text-xs text-slate-600 ring-1 ring-slate-200">
        Pronto podrás publicar tu biblioteca con un alias para que otras personas la visiten (solo mirar). De momento tu
        biblioteca se guarda solo en este dispositivo y nadie más la ve.
      </p>
    </Section>
  );
}

// ---------------------------------------------------------------- ajustes

const TRACKS: { id: MusicSettings["track"]; name: string }[] = [
  { id: "lofi", name: "Lo-fi de estudio" },
  { id: "jazz", name: "Jazz de café" },
  { id: "rain", name: "Lluvia y piano" },
];

export function SettingsPanel({ state, notify, onTutorial }: { state: GameState; notify: Notify; onTutorial: () => void }) {
  const [name, setName] = useState(state.name);
  const [cat, setCat] = useState(state.catName);
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

      <Section title="Ayuda">
        <Button variant="secondary" onClick={onTutorial}>
          <GraduationCap className="size-4" aria-hidden />Ver el tutorial otra vez
        </Button>
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
            <input type="range" min={0} max={1} step={0.05} value={music.volume} aria-label="Volumen de la música"
              onChange={(e) => run({ type: "set_settings", music: { volume: Number(e.target.value) } })} className="flex-1 accent-emerald-600" />
          </label>
          <p className="text-[11px] text-slate-500">Composiciones originales generadas en tu dispositivo. Empiezan a sonar tras tu primer toque y se pausan al salir de la biblioteca o cambiar de pestaña.</p>
        </div>
        <div className="space-y-3 rounded-2xl bg-white p-3 ring-1 ring-slate-200">
          <label className="flex items-center justify-between gap-2 text-sm font-semibold">
            <span className="inline-flex items-center gap-2"><Volume2 className="size-4" aria-hidden />Efectos de sonido</span>
            <input type="checkbox" role="switch" checked={state.settings.sfx} onChange={(e) => run({ type: "set_settings", sfx: e.target.checked })} className="size-5 accent-emerald-600" />
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <Volume2 className="size-4" aria-hidden />
            <input type="range" min={0} max={1} step={0.05} value={state.settings.sfxVolume} aria-label="Volumen de los efectos" disabled={!state.settings.sfx}
              onChange={(e) => run({ type: "set_settings", sfxVolume: Number(e.target.value) })} onPointerUp={() => sfx("select")} className="flex-1 accent-emerald-600 disabled:opacity-40" />
          </label>
        </div>
      </Section>

    </div>
  );
}
