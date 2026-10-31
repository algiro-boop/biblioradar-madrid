"use client";

import { Gift, MapPin } from "lucide-react";
import { useMemo, useState } from "react";
import { ACHIEVEMENTS, type AchievementCategory } from "@/game/data/achievements";
import { findItem, type CatalogItem } from "@/game/data/catalog";
import { showcaseCapacity, type GameState, type OwnedItem, type Placement } from "@/game/engine";
import { resaleValue } from "@/game/engine/shop";
import { run } from "@/game/store";
import { report } from "./ShopPanel";
import { AchievementIcon, Button, Coin, Coins, Empty, Modal, RARITY_STYLE, Section, Thumb } from "./ui";

type Notify = (m: string, k?: "ok" | "error") => void;

// ---------------------------------------------------------------- inventario

export function InventoryPanel({ state, placements, onPlace, notify }: {
  state: GameState;
  placements: Placement[];
  onPlace: (uid: string) => void;
  notify: Notify;
}) {
  const [selling, setSelling] = useState<OwnedItem | null>(null);
  const placed = useMemo(() => new Set(placements.map((p) => p.uid)), [placements]);
  const groups = useMemo(() => {
    const map = new Map<string, OwnedItem[]>();
    for (const o of state.inventory) if (!o.soldAt) map.set(o.itemId, [...(map.get(o.itemId) ?? []), o]);
    return [...map.entries()].map(([id, owned]) => ({ item: findItem(id)!, owned })).sort((a, b) => a.item.name.localeCompare(b.item.name, "es"));
  }, [state.inventory]);

  if (state.level < 1) return <Empty>Tu inventario aparecerá en el nivel 1, con los primeros muebles de regalo.</Empty>;
  if (!groups.length) return <Empty>No tienes objetos todavía.</Empty>;

  const stored = groups.filter((g) => g.owned.some((o) => !placed.has(o.uid)));

  return (
    <div className="space-y-5">
      <p className="text-xs text-slate-500">
        {stored.length ? `${stored.length} tipos de objeto guardados listos para colocar.` : "Todo está colocado."} Los regalos no se venden; lo comprado se revende por la mitad de lo pagado.
      </p>
      <div className="space-y-2">
        {groups.map(({ item, owned }) => {
          const free = owned.filter((o) => !placed.has(o.uid));
          const sellable = [...free, ...owned.filter((o) => placed.has(o.uid))].find((o) => o.resellable);
          return (
            <div key={item.id} className="flex items-center gap-3 rounded-2xl bg-white p-2.5 ring-1 ring-slate-200">
              <Thumb item={item} className="h-12 w-14" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{item.name}</p>
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                  <span>{owned.length - free.length}/{owned.length} colocados</span>
                  {item.rarity !== "P" && <span className={`rounded px-1 text-[10px] font-bold uppercase ${RARITY_STYLE[item.rarity].chip}`}>{RARITY_STYLE[item.rarity].label}</span>}
                  {owned.every((o) => !o.resellable) && <span className="inline-flex items-center gap-0.5 text-emerald-700"><Gift className="size-3" aria-hidden />Regalo</span>}
                </p>
              </div>
              <div className="flex shrink-0 flex-col gap-1">
                <Button variant="secondary" disabled={!free.length} onClick={() => onPlace(free[0]!.uid)}>
                  <MapPin className="size-3.5" aria-hidden />Colocar
                </Button>
                {sellable && <Button variant="ghost" onClick={() => setSelling(sellable)}>Vender</Button>}
              </div>
            </div>
          );
        })}
      </div>
      {selling && <SellDialog owned={selling} item={findItem(selling.itemId)!} placed={placed.has(selling.uid)} onClose={() => setSelling(null)} notify={notify} />}
    </div>
  );
}

function SellDialog({ owned, item, placed, onClose, notify }: { owned: OwnedItem; item: CatalogItem; placed: boolean; onClose: () => void; notify: Notify }) {
  const value = resaleValue(owned.paid);
  return (
    <Modal title={`Vender ${item.name}`} onClose={onClose}>
      <Thumb item={item} className="h-24" />
      <h2 className="mt-3 text-lg font-bold">¿Vender {item.name}?</h2>
      <p className="mt-1 text-sm text-slate-600">
        Pagaste {owned.paid} monedas y recibirás <strong className="inline-flex items-center gap-1"><Coin />{value}</strong>. {placed && "Se retirará de tu sala. "}La venta es definitiva.
      </p>
      <div className="mt-4 flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onClose}>No, conservar</Button>
        <Button variant="danger" className="flex-1" onClick={() => {
          report(run({ type: "sell", uid: owned.uid }), notify, "coin");
          onClose();
        }}>Vender por {value}</Button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- logros y vitrina

const CATEGORIES: AchievementCategory[] = ["Contribución", "Constancia", "Decoración", "Exploración", "Comunidad", "Mascotas", "Cultura"];
const FRAME_LABEL: Record<string, string> = { madera: "Madera", oro: "Oro", estelar: "Estelar" };
const BADGE_LABEL: Record<string, string> = { honorifico: "Insignia honorífica", "nivel-maximo": "Nivel máximo" };

export function AchievementsPanel({ state, notify }: { state: GameState; notify: Notify }) {
  const cap = showcaseCapacity(state);
  const unlocked = ACHIEVEMENTS.filter((a) => state.achievements[a.id]).length;
  const toggle = (id: string) => {
    const has = state.showcase.includes(id);
    if (!has && state.showcase.length >= cap) return notify(`La vitrina admite ${cap} logros.`, "error");
    run({ type: "set_showcase", ids: has ? state.showcase.filter((x) => x !== id) : [...state.showcase, id] });
  };
  return (
    <div className="space-y-5">
      <Section title="Vitrina" aside={cap ? `${state.showcase.length}/${cap}` : "Nivel 1"}>
        {cap ? (
          <>
            <div className="flex min-h-14 flex-wrap gap-2 rounded-2xl bg-gradient-to-b from-amber-50 to-white p-3 ring-1 ring-amber-200">
              {state.showcase.length ? state.showcase.map((id) => {
                const a = ACHIEVEMENTS.find((x) => x.id === id)!;
                return <AchievementIcon key={id} icon={a.icon} />;
              }) : <span className="text-xs text-slate-500">Elige logros desbloqueados para exponerlos en tu biblioteca.</span>}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold text-slate-600">Marco:</span>
              {state.frames.map((f) => (
                <button key={f} type="button" aria-pressed={state.frame === f} onClick={() => run({ type: "set_showcase", ids: state.showcase, frame: f })}
                  className={`rounded-full px-2.5 py-1 font-semibold ring-1 ${state.frame === f ? "bg-amber-400 text-amber-950 ring-amber-500" : "bg-white text-slate-600 ring-slate-200"}`}>
                  {FRAME_LABEL[f] ?? f}
                </button>
              ))}
            </div>
          </>
        ) : <Empty>La vitrina se abre en el nivel 1.</Empty>}
        {state.badges.length > 0 && (
          <p className="text-xs text-slate-600">Insignias: {state.badges.map((b) => BADGE_LABEL[b] ?? b).join(" · ")}</p>
        )}
      </Section>

      <p className="text-sm font-semibold text-slate-700">{unlocked} de {ACHIEVEMENTS.length} logros</p>
      {CATEGORIES.map((cat) => (
        <Section key={cat} title={cat}>
          <div className="space-y-1.5">
            {ACHIEVEMENTS.filter((a) => a.category === cat).map((a) => {
              const got = state.achievements[a.id];
              const hidden = a.secret && !got;
              return (
                <div key={a.id} className={`flex items-center gap-3 rounded-2xl p-2.5 ring-1 ${got ? "bg-white ring-amber-200" : "bg-slate-50 ring-slate-200"}`}>
                  <AchievementIcon icon={a.icon} locked={!got} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{hidden ? "Logro secreto" : a.name}</p>
                    <p className="text-xs text-slate-500">{hidden ? "Sigue jugando para descubrirlo." : a.description}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
                      <Coins value={a.coins} />
                      {a.rewardLabel && !hidden && <span>+ {a.rewardLabel}</span>}
                      {got && <span>· {new Date(got.unlockedAt).toLocaleDateString("es-ES", { timeZone: "Europe/Madrid" })}</span>}
                    </p>
                  </div>
                  {got && cap > 0 && (
                    <label className="flex shrink-0 flex-col items-center text-[10px] text-slate-500">
                      <input type="checkbox" checked={state.showcase.includes(a.id)} onChange={() => toggle(a.id)} className="size-4 accent-amber-500" />
                      Vitrina
                    </label>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      ))}
    </div>
  );
}
