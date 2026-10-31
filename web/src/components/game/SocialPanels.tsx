"use client";

import { Heart, Music, Volume2 } from "lucide-react";
import { useState } from "react";
import { hasFeature } from "@/game/data/levels";
import { NEIGHBORS } from "@/game/data/neighbors";
import type { GameState, MusicSettings } from "@/game/engine";
import { run } from "@/game/store";
import { madridDateKey } from "@/game/time";
import { sfx } from "@/game/sfx";
import { report } from "./ShopPanel";
import { Button, Section } from "./ui";

type Notify = (m: string, k?: "ok" | "error") => void;

// ---------------------------------------------------------------- visitas

export function VisitPanel({ state, now, onVisit, notify }: { state: GameState; now: number; onVisit: (id: string) => void; notify: Notify }) {
  const today = madridDateKey(now);
  return (
    <div className="space-y-6">
      <PublicLibrary key={state.settings.alias} state={state} notify={notify} />
      <Section title="Otras bibliotecas">
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
      </Section>
    </div>
  );
}

/**
 * «Mi biblioteca pública»: privada por defecto. Publicarla exige alias y una confirmación
 * explícita; dejar de publicarla es inmediato y no borra nada. Sin rankings.
 */
function PublicLibrary({ state, notify }: { state: GameState; notify: Notify }) {
  const [alias, setAlias] = useState(state.settings.alias);
  const [confirming, setConfirming] = useState(false);
  const published = state.settings.publish;
  const saveAlias = () => {
    run({ type: "set_settings", alias: alias.trim() });
    notify("Alias guardado", "ok");
  };
  return (
    <Section title="Mi biblioteca pública" aside={published ? <span className="font-semibold text-emerald-700">Publicada</span> : <span className="font-semibold">Privada</span>}>
      <div className="space-y-3 rounded-2xl bg-white p-3 ring-1 ring-slate-200">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); saveAlias(); }}>
          <input value={alias} onChange={(e) => setAlias(e.target.value)} maxLength={24} placeholder="Alias público" aria-label="Alias público"
            className="min-w-0 flex-1 rounded-xl bg-slate-50 px-3 py-2 text-sm ring-1 ring-slate-200 focus:ring-2 focus:ring-sky-500 focus:outline-none" />
          <Button type="submit" variant="secondary" disabled={alias.trim() === state.settings.alias}>Guardar</Button>
        </form>
        {published ? (
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-slate-600">Otras personas pueden verla (solo mirar) como «{state.settings.alias}».</p>
            <Button variant="secondary" onClick={() => { run({ type: "set_settings", publish: false }); notify("Tu biblioteca vuelve a ser privada.", "ok"); }}>Hacer privada</Button>
          </div>
        ) : confirming ? (
          <div className="space-y-2 rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200">
            <p className="text-xs text-amber-900">
              Vas a publicar tu biblioteca con el alias «{state.settings.alias}». Se verán tus salas y muebles; nunca tu ubicación, tus reportes ni tu nombre real. Puedes hacerla privada cuando quieras.
            </p>
            <div className="flex gap-2">
              <Button onClick={() => { run({ type: "set_settings", publish: true }); setConfirming(false); notify("Biblioteca publicada", "ok"); }}>Sí, publicarla</Button>
              <Button variant="ghost" onClick={() => setConfirming(false)}>Cancelar</Button>
            </div>
          </div>
        ) : (
          <Button className="w-full" disabled={!state.settings.alias} onClick={() => setConfirming(true)}>
            {state.settings.alias ? "Publicar mi biblioteca…" : "Elige un alias para poder publicarla"}
          </Button>
        )}
        <p className="text-[11px] text-slate-500">Es privada por defecto. En este entorno de pruebas no se envía a ningún sitio.</p>
      </div>
    </Section>
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
