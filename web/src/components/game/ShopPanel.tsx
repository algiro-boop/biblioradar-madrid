"use client";

import { Lock, Timer } from "lucide-react";
import { useMemo, useState } from "react";
import { findItem, PERMANENT_ITEMS, shopGroup, type CatalogItem } from "@/game/data/catalog";
import { MAX_PURCHASE_QTY, type GameState } from "@/game/engine";
import { reservationDeposit } from "@/game/engine/shop";
import { sfx } from "@/game/sfx";
import { run } from "@/game/store";
import { formatCountdown, madridDateKey, msUntilMadridMidnight } from "@/game/time";
import { Button, Coin, Coins, Empty, Modal, RARITY_STYLE, Section, Thumb } from "./ui";

const GROUPS = ["Todo", "Mesas", "Asientos", "Libros", "Plantas", "Luz y cuadros", "Tecnología", "Cultura y música", "Decoración"];

export function ShopPanel({ state, now, notify }: { state: GameState; now: number; notify: (m: string, k?: "ok" | "error") => void }) {
  const [group, setGroup] = useState("Todo");
  const [affordable, setAffordable] = useState(false);
  const [detail, setDetail] = useState<CatalogItem | null>(null);
  const today = madridDateKey(now);
  const specials = (state.rotations[today]?.ids ?? []).map((id) => findItem(id)!).filter(Boolean);
  const reservations = state.reservations.filter((r) => r.state === "active");

  const list = useMemo(
    () => PERMANENT_ITEMS.filter((i) => (group === "Todo" || shopGroup(i) === group) && (!affordable || (i.price <= state.balance && i.minLevel <= state.level)))
      .sort((a, b) => a.minLevel - b.minLevel || a.price - b.price),
    [group, affordable, state.balance, state.level],
  );

  if (state.level < 1) return <Empty>La tienda abre en el nivel 1. Haz tu primer reporte válido para construir la primera sala.</Empty>;

  return (
    <div className="space-y-5">
      <Section title="Especiales de hoy" aside={<span className="inline-flex items-center gap-1"><Timer className="size-3.5" aria-hidden />Cambian en {formatCountdown(msUntilMadridMidnight(now))}</span>}>
        <div className="grid grid-cols-3 gap-2">
          {specials.map((item) => (
            <ItemCard key={item.id} item={item} state={state} onOpen={() => setDetail(item)} special />
          ))}
        </div>
        <p className="text-xs text-slate-500">Iguales para todos. Lo que compres es tuyo para siempre aunque salga de la tienda.</p>
      </Section>

      {reservations.length > 0 && (
        <Section title="Reservas activas">
          {reservations.map((r) => {
            const item = findItem(r.itemId)!;
            const due = r.price - r.deposit;
            return (
              <div key={r.id} className="flex items-center gap-3 rounded-2xl bg-white p-3 ring-1 ring-slate-200">
                <Thumb item={item} className="h-12 w-12" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{item.name}</p>
                  <p className="text-xs text-slate-500">Señal {r.deposit} · faltan {due} · caduca en {formatCountdown(r.expiresAt - now)}</p>
                </div>
                <div className="flex flex-col gap-1">
                  <Button disabled={state.balance < due} onClick={() => report(run({ type: "complete_reservation", id: r.id }), notify, "coin")}>Pagar {due}</Button>
                  <Button variant="ghost" onClick={() => confirm("¿Cancelar la reserva? La señal no se devuelve.") && report(run({ type: "cancel_reservation", id: r.id }), notify)}>Cancelar</Button>
                </div>
              </div>
            );
          })}
        </Section>
      )}

      <Section title="Catálogo permanente" aside={`${list.length} artículos`}>
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {GROUPS.map((g) => (
            <button key={g} type="button" onClick={() => setGroup(g)} aria-pressed={group === g}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition-colors ${group === g ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-100"}`}>
              {g}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={affordable} onChange={(e) => setAffordable(e.target.checked)} className="accent-emerald-600" />
          Solo lo que puedo comprar ahora
        </label>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-3">
          {list.map((item) => <ItemCard key={item.id} item={item} state={state} onOpen={() => setDetail(item)} />)}
        </div>
      </Section>

      {detail && <BuyDialog item={detail} state={state} special={detail.rarity !== "P"} onClose={() => setDetail(null)} notify={notify} />}
    </div>
  );
}

function ItemCard({ item, state, onOpen, special = false }: { item: CatalogItem; state: GameState; onOpen: () => void; special?: boolean }) {
  const locked = item.minLevel > state.level;
  const owned = state.inventory.filter((o) => o.itemId === item.id && !o.soldAt).length;
  const style = RARITY_STYLE[item.rarity];
  return (
    <button type="button" onClick={onOpen}
      className={`group relative flex flex-col items-stretch rounded-2xl bg-white p-2 text-left ring-1 transition-[scale,box-shadow] duration-150 hover:shadow-md active:scale-[0.97] ${special ? `ring-2 ${style.ring}` : "ring-slate-200"}`}>
      {special && <span className={`absolute top-1.5 left-1.5 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase ${style.chip}`}>{style.label}</span>}
      {owned > 0 && <span className="absolute top-1.5 right-1.5 rounded-md bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-800">×{owned}</span>}
      <Thumb item={item} className={`h-16 ${locked ? "opacity-40 grayscale" : ""}`} />
      <span className="mt-1 line-clamp-2 min-h-8 text-[11px] leading-tight font-semibold text-slate-800">{item.name}</span>
      <span className="mt-1 flex items-center justify-between text-xs">
        <Coins value={item.price} className={state.balance >= item.price ? "text-slate-800" : "text-slate-400"} />
        {locked && <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-slate-500"><Lock className="size-3" aria-hidden />Nv {item.minLevel}</span>}
      </span>
    </button>
  );
}

function BuyDialog({ item, state, special, onClose, notify }: { item: CatalogItem; state: GameState; special: boolean; onClose: () => void; notify: (m: string, k?: "ok" | "error") => void }) {
  const [qty, setQty] = useState(1);
  const locked = item.minLevel > state.level;
  const total = item.price * qty;
  const canBuy = !locked && state.balance >= total;
  const deposit = reservationDeposit(item.price);
  const canReserve = special && !locked && state.balance < item.price && state.balance >= deposit
    && !state.reservations.some((r) => r.state === "active" && r.itemId === item.id);
  const style = RARITY_STYLE[item.rarity];
  return (
    <Modal title={item.name} onClose={onClose}>
      <div className="rounded-2xl bg-gradient-to-b from-amber-50 to-white p-3 ring-1 ring-amber-100">
        <Thumb item={item} className="h-36" />
      </div>
      <div className="mt-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">{item.name}</h2>
          <p className="text-xs text-slate-500">{item.category} · {item.w}×{item.h} · nivel {item.minLevel}</p>
        </div>
        <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${style.chip}`}>{style.label}</span>
      </div>
      <p className="mt-2 text-sm text-slate-600">{item.interaction}</p>
      {locked ? (
        <p className="mt-4 rounded-xl bg-slate-100 p-3 text-sm text-slate-600"><Lock className="mr-1 inline size-4" aria-hidden />Se desbloquea en el nivel {item.minLevel}.</p>
      ) : (
        <>
          <div className="mt-4 flex items-center justify-between rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200">
            <span className="text-sm font-semibold">Cantidad</span>
            <div className="flex items-center gap-2">
              <Button variant="secondary" className="w-9" onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1}>−</Button>
              <span className="w-6 text-center font-bold tabular-nums">{qty}</span>
              <Button variant="secondary" className="w-9" onClick={() => setQty((q) => Math.min(MAX_PURCHASE_QTY, q + 1))} disabled={qty >= MAX_PURCHASE_QTY}>+</Button>
            </div>
          </div>
          <Button className="mt-3 w-full" disabled={!canBuy} onClick={() => {
            const r = run({ type: "purchase", itemId: item.id, qty, requestId: `${item.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
            report(r, notify, "coin");
            if (r.ok) onClose();
          }}>
            Comprar por <Coin /> {total}
          </Button>
          {!canBuy && <p className="mt-2 text-center text-xs text-slate-500">Te faltan {total - state.balance} monedas.</p>}
          {canReserve && (
            <Button variant="secondary" className="mt-2 w-full" onClick={() => {
              const r = run({ type: "reserve", itemId: item.id });
              report(r, notify);
              if (r.ok) onClose();
            }}>
              Reservar 72 h con señal de {deposit}
            </Button>
          )}
          {special && <p className="mt-2 text-xs text-slate-500">Reserva: pagas el 10 % ahora y guardas el precio 72 horas. Si caduca o la cancelas, la señal no se devuelve.</p>}
        </>
      )}
    </Modal>
  );
}

export function report(r: { ok: true; message?: string } | { ok: false; error: string }, notify: (m: string, k?: "ok" | "error") => void, sound?: "coin" | "place") {
  if (r.ok) {
    if (r.message) notify(r.message, "ok");
    if (sound) sfx(sound);
  } else {
    notify(r.error, "error");
    sfx("error");
  }
}
