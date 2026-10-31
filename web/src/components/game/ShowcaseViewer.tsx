"use client";

import { Minus, Plus, Scan, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ACHIEVEMENTS, type AchievementDef as Achievement } from "@/game/data/achievements";
import { showcaseCapacity, type GameState } from "@/game/engine";
import { sfx } from "@/game/sfx";
import { run } from "@/game/store";
import { AchievementIcon, Button, Coins } from "./ui";

type Notify = (m: string, k?: "ok" | "error") => void;

const FRAMES: Record<string, { wood: string; edge: string; glow: string; name: string }> = {
  madera: { wood: "#8a5a34", edge: "#5a3a22", glow: "rgba(255,226,170,0.35)", name: "Madera" },
  oro: { wood: "#b98a2c", edge: "#7a5a16", glow: "rgba(255,214,110,0.5)", name: "Oro" },
  estelar: { wood: "#3c3366", edge: "#211b45", glow: "rgba(180,150,255,0.45)", name: "Estelar" },
};

const MIN = 1;
const MAX = 3;

/**
 * Vitrina ampliada a pantalla completa: los logros expuestos en sus baldas y, debajo, todos los
 * logros. Zoom con botones, pellizco o Ctrl + rueda; se recorre arrastrando o desplazando.
 */
export function ShowcaseViewer({ state, notify, onClose }: { state: GameState; notify: Notify; onClose: () => void }) {
  const [zoom, setZoom] = useState(1);
  const [open, setOpen] = useState<Achievement | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const pinch = useRef<{ d: number; z: number } | null>(null);
  const cap = showcaseCapacity(state);
  const frame = FRAMES[state.frame] ?? FRAMES.madera!;
  const shown = state.showcase.map((id) => ACHIEVEMENTS.find((a) => a.id === id)).filter((a): a is Achievement => !!a);
  const slots = Math.max(cap, shown.length, 3);
  const perShelf = slots > 8 ? 5 : slots > 4 ? 4 : 3;
  const shelves = Array.from({ length: Math.ceil(slots / perShelf) }, (_, i) => Array.from({ length: perShelf }, (_, j) => i * perShelf + j).filter((n) => n < slots));
  const unlocked = ACHIEVEMENTS.filter((a) => state.achievements[a.id]).length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") (open ? setOpen(null) : onClose());
      if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(MAX, z + 0.25));
      if (e.key === "-") setZoom((z) => Math.max(MIN, z - 0.25));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Ctrl + rueda (y el pellizco del trackpad) acercan sin hacer zoom a toda la página.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom((z) => Math.min(MAX, Math.max(MIN, z * (e.deltaY < 0 ? 1.08 : 1 / 1.08))));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const toggle = (a: Achievement) => {
    const has = state.showcase.includes(a.id);
    if (!has && state.showcase.length >= cap) return notify(`La vitrina admite ${cap} logros.`, "error");
    run({ type: "set_showcase", ids: has ? state.showcase.filter((x) => x !== a.id) : [...state.showcase, a.id] });
    sfx(has ? "store" : "place");
  };

  const touches = (e: React.TouchEvent) => (e.touches.length === 2 ? Math.hypot(e.touches[0]!.clientX - e.touches[1]!.clientX, e.touches[0]!.clientY - e.touches[1]!.clientY) : 0);

  return (
    <div className="fixed inset-0 z-[3000] flex flex-col bg-[#1d1611]/95 text-[#fff6e3] backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Vitrina de logros">
      <header className="flex items-center gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-bold">Vitrina de {state.name}</h2>
          <p className="text-xs text-[#f3e2bf]/70">{shown.length}/{cap} expuestos · {unlocked} de {ACHIEVEMENTS.length} logros · marco {frame.name.toLowerCase()}</p>
        </div>
        <div className="flex overflow-hidden rounded-2xl bg-[#ffffff]/10 ring-1 ring-[#ffffff]/15">
          <button type="button" aria-label="Alejar" className="grid size-10 place-items-center hover:bg-[#ffffff]/10 disabled:opacity-40" disabled={zoom <= MIN} onClick={() => setZoom((z) => Math.max(MIN, z - 0.25))}><Minus className="size-4" aria-hidden /></button>
          <span className="grid w-12 place-items-center text-xs font-bold tabular-nums">{Math.round(zoom * 100)} %</span>
          <button type="button" aria-label="Acercar" className="grid size-10 place-items-center hover:bg-[#ffffff]/10 disabled:opacity-40" disabled={zoom >= MAX} onClick={() => setZoom((z) => Math.min(MAX, z + 0.25))}><Plus className="size-4" aria-hidden /></button>
          <button type="button" aria-label="Tamaño original" className="grid size-10 place-items-center hover:bg-[#ffffff]/10" onClick={() => setZoom(1)}><Scan className="size-4" aria-hidden /></button>
        </div>
        <button type="button" onClick={onClose} aria-label="Cerrar la vitrina" className="grid size-10 place-items-center rounded-2xl bg-[#ffffff]/10 ring-1 ring-[#ffffff]/15 hover:bg-[#ffffff]/20"><X className="size-5" aria-hidden /></button>
      </header>

      <div ref={scroller} className="min-h-0 flex-1 overflow-auto overscroll-contain px-3 pb-[max(1rem,env(safe-area-inset-bottom))]"
        onTouchStart={(e) => { const d = touches(e); if (d) pinch.current = { d, z: zoom }; }}
        onTouchMove={(e) => { const d = touches(e); if (d && pinch.current) setZoom(Math.min(MAX, Math.max(MIN, pinch.current.z * (d / pinch.current.d)))); }}
        onTouchEnd={() => { pinch.current = null; }}>
        <div className="mx-auto origin-top-left transition-[width] duration-150" style={{ width: `${zoom * 100}%`, maxWidth: `${zoom * 40}rem`, ["--z" as string]: zoom }}>
          {/* Mueble vitrina con baldas, cristal y luz */}
          <div className="rounded-2xl p-2.5 shadow-2xl" style={{ background: frame.wood, boxShadow: `0 0 40px ${frame.glow}, inset 0 0 0 3px ${frame.edge}` }}>
            <div className="rounded-xl p-2" style={{ background: "linear-gradient(160deg,#fdf6e6 0%,#efe0bf 100%)", boxShadow: `inset 0 0 0 2px ${frame.edge}` }}>
              {shelves.map((row, i) => (
                <div key={i} className="relative">
                  <div className="grid gap-2 px-1 pt-2 pb-1" style={{ gridTemplateColumns: `repeat(${perShelf}, minmax(0, 1fr))` }}>
                    {row.map((n) => {
                      const a = shown[n];
                      return a ? (
                        <button key={n} type="button" onClick={() => { setOpen(a); sfx("select"); }} title={a.name}
                          className="group flex flex-col items-center gap-1 rounded-lg p-1 text-[#3b2a20] transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none">
                          <AchievementIcon icon={a.icon} className="aspect-square w-full max-w-[calc(6rem*var(--z))] text-[length:calc(min(2.6rem,7vw)*var(--z))]" />
                          <span className="line-clamp-2 text-center text-[length:calc(11px*var(--z))] leading-tight font-semibold">{a.name}</span>
                        </button>
                      ) : (
                        <div key={n} className="flex aspect-square w-full max-w-[calc(6rem*var(--z))] items-center justify-center justify-self-center rounded-lg border-2 border-dashed border-[#78350f]/25 text-[10px] text-[#78350f]/60">
                          {n < cap ? "Libre" : "Nivel +"}
                        </div>
                      );
                    })}
                  </div>
                  {/* Balda */}
                  <div className="h-2.5 rounded-sm" style={{ background: frame.wood, boxShadow: `0 3px 0 ${frame.edge}` }} />
                </div>
              ))}
            </div>
          </div>
          <p className="mt-2 text-center text-[11px] text-[#f3e2bf]/60">Toca un logro para verlo de cerca. Pellizca, usa +/− o Ctrl + rueda para acercar.</p>

          {/* Todos los logros */}
          <h3 className="mt-5 mb-2 text-xs font-bold tracking-wider text-[#f3e2bf]/70 uppercase">Todos los logros</h3>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {ACHIEVEMENTS.map((a) => {
              const got = !!state.achievements[a.id];
              const hidden = a.secret && !got;
              return (
                <button key={a.id} type="button" onClick={() => { setOpen(a); sfx("select"); }}
                  className={`flex flex-col items-center gap-1 rounded-xl p-1.5 ring-1 ${got ? "bg-[#ffffff]/10 ring-amber-300/40" : "bg-[#ffffff]/5 ring-[#ffffff]/10"} ${state.showcase.includes(a.id) ? "ring-2 ring-amber-300" : ""}`}>
                  <AchievementIcon icon={a.icon} locked={!got} className="aspect-square w-full text-[length:calc(min(2.2rem,6vw)*var(--z))]" />
                  <span className="line-clamp-2 text-center text-[length:calc(10px*var(--z))] leading-tight">{hidden ? "Secreto" : a.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-[3100] grid place-items-end bg-black/50 p-3 sm:place-items-center" onClick={() => setOpen(null)}>
          <div role="dialog" aria-modal="true" aria-label={open.name} onClick={(e) => e.stopPropagation()}
            className="anim-dialog w-full max-w-sm rounded-3xl bg-white p-5 text-center text-slate-900 shadow-2xl">
            {(() => {
              const got = state.achievements[open.id];
              const hidden = open.secret && !got;
              return (
                <>
                  <div className="flex justify-center"><AchievementIcon icon={open.icon} locked={!got} className="size-24 text-5xl" /></div>
                  <h3 className="mt-3 text-lg font-bold">{hidden ? "Logro secreto" : open.name}</h3>
                  <p className="mt-1 text-sm text-slate-600">{hidden ? "Sigue jugando para descubrirlo." : open.description}</p>
                  <p className="mt-2 flex items-center justify-center gap-2 text-xs text-slate-500">
                    <Coins value={open.coins} />
                    {open.rewardLabel && !hidden && <span>+ {open.rewardLabel}</span>}
                    {got && <span>· conseguido el {new Date(got.unlockedAt).toLocaleDateString("es-ES", { timeZone: "Europe/Madrid" })}</span>}
                  </p>
                  <div className="mt-4 flex gap-2">
                    {got && cap > 0 && (
                      <Button variant={state.showcase.includes(open.id) ? "secondary" : "gold"} className="flex-1" onClick={() => toggle(open)}>
                        {state.showcase.includes(open.id) ? "Quitar de la vitrina" : "Exponer en la vitrina"}
                      </Button>
                    )}
                    <Button variant="ghost" className="flex-1" onClick={() => setOpen(null)}>Cerrar</Button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
