"use client";

import { useEffect, useState } from "react";
import { ACHIEVEMENTS } from "@/game/data/achievements";
import { ALL_ITEMS, findItem } from "@/game/data/catalog";
import { LEVELS, MAX_LEVEL } from "@/game/data/levels";
import { getMission } from "@/game/data/missions";
import { DAY_MS, type Command, type GameState } from "@/game/engine";
import { activeMissions } from "@/game/engine/missions";
import { rotationFor } from "@/game/engine/shop";
import { run } from "@/game/store";
import { addDays, formatDateKey, madridDateKey, madridMidnightMs } from "@/game/time";
import { report } from "./ShopPanel";
import { Button, Section } from "./ui";

type Notify = (m: string, k?: "ok" | "error") => void;

const FAKE_LIBRARIES = ["sim-biblio-retiro", "sim-biblio-chamberi", "sim-biblio-lavapies", "sim-biblio-moncloa"];

/**
 * Modo desarrollador del entorno de pruebas. Solo se monta con `next dev` y el flag activo;
 * todo lo que hace pasa por el mismo motor (`dispatch`) que el juego normal.
 */
export function DevPanel({ state, now, notify, showAllRooms, setShowAllRooms, previewCat, setPreviewCat }: {
  state: GameState;
  now: number;
  notify: Notify;
  showAllRooms: boolean;
  setShowAllRooms: (v: boolean) => void;
  previewCat: boolean;
  setPreviewCat: (v: boolean) => void;
}) {
  const [level, setLevel] = useState(state.level);
  useEffect(() => setLevel(state.level), [state.level]);
  const [days, setDays] = useState(7);
  const [achievement, setAchievement] = useState(ACHIEVEMENTS[0]!.id);
  const [itemId, setItemId] = useState("L001");
  const [date, setDate] = useState(madridDateKey(now));
  const today = madridDateKey(now);
  const exec = (cmd: Command) => report(run(cmd), notify);
  const setOffset = (offsetMs: number) => exec({ type: "dev_clock", offsetMs });
  const missions = activeMissions(state, today, now);
  const lastReport = [...state.reports].reverse().find((r) => !r.invalidated);
  const activeReservations = state.reservations.filter((r) => r.state === "active");

  return (
    <div className="space-y-6">
      <p className="rounded-xl bg-amber-100 p-3 text-xs font-semibold text-amber-900 ring-1 ring-amber-300">
        Modo desarrollador · solo en local (`next dev`). Todo se guarda en este navegador; no toca la base de datos.
      </p>

      <Section title="Nivel">
        <div className="flex gap-2">
          <select value={level} onChange={(e) => setLevel(Number(e.target.value))} aria-label="Nivel"
            className="min-w-0 flex-1 rounded-xl bg-white px-2 py-2 text-sm ring-1 ring-slate-200">
            {LEVELS.map((l) => <option key={l.level} value={l.level}>{l.level} · {l.title} ({l.reports} rep.)</option>)}
          </select>
          <Button onClick={() => exec({ type: "dev_set_level", level })}>Aplicar</Button>
        </div>
        <p className="text-[11px] text-slate-500">Subir entrega cada nivel una sola vez (monedas y regalos). Bajar no quita nada; lo colocado en salas bloqueadas vuelve al inventario. Para repetir las animaciones, reinicia el progreso.</p>
        <div className="flex flex-wrap gap-1.5">
          <Button variant="secondary" disabled={state.level >= MAX_LEVEL} onClick={() => exec({ type: "dev_set_level", level: state.level + 1 })}>Subir 1 nivel</Button>
          <Button variant="secondary" disabled={state.level <= 0} onClick={() => exec({ type: "dev_set_level", level: state.level - 1 })}>Bajar 1 nivel</Button>
        </div>
      </Section>

      <Section title="Monedas" aside={`Saldo: ${state.balance}`}>
        <div className="flex flex-wrap gap-1.5">
          {[10, 100, 1000].map((d) => <Button key={d} variant="secondary" onClick={() => exec({ type: "dev_coins", delta: d })}>+{d}</Button>)}
          {[-10, -100].map((d) => <Button key={d} variant="secondary" onClick={() => exec({ type: "dev_coins", delta: d })}>{d}</Button>)}
          <Button variant="secondary" onClick={() => exec({ type: "dev_coins", delta: -state.balance })}>Dejar a 0</Button>
        </div>
      </Section>

      <Section title="Reportes válidos simulados" aside={`${state.validReportCount} válidos`}>
        <div className="flex flex-wrap gap-1.5">
          <Button onClick={() => exec({ type: "report_valid", reportId: `sim-${Date.now().toString(36)}`, libraryId: FAKE_LIBRARIES[state.reports.length % FAKE_LIBRARIES.length]!, simulated: true })}>
            Simular 1 reporte
          </Button>
          <Button variant="secondary" disabled={!lastReport} onClick={() => lastReport && exec({ type: "report_invalidated", reportId: lastReport.id })}>Anular el último</Button>
        </div>
        <div className="flex items-center gap-2">
          <input type="number" min={1} max={120} value={days} onChange={(e) => setDays(Math.max(1, Math.min(120, Number(e.target.value) || 1)))} aria-label="Días"
            className="w-20 rounded-xl bg-white px-2 py-2 text-sm ring-1 ring-slate-200" />
          <Button variant="secondary" onClick={() => exec({ type: "dev_report_days", days })}>Reportar los últimos {days} días</Button>
        </div>
        <p className="text-[11px] text-slate-500">Sirve para probar rachas, protectores (domingos de semanas completas) e hitos de 3, 7, 14, 30, 60 y 100 días.</p>
      </Section>

      <Section title="Reloj del juego" aside={state.devClockOffset ? `${(state.devClockOffset / DAY_MS).toFixed(2)} días adelantado` : "hora real"}>
        <p className="text-xs text-slate-600">Ahora en el juego: {new Date(now).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}</p>
        <div className="flex flex-wrap gap-1.5">
          <Button variant="secondary" onClick={() => setOffset(state.devClockOffset + 3_600_000)}>+1 hora</Button>
          <Button variant="secondary" onClick={() => setOffset(state.devClockOffset + DAY_MS)}>+1 día</Button>
          <Button variant="secondary" onClick={() => setOffset(state.devClockOffset + 7 * DAY_MS)}>+1 semana</Button>
          <Button variant="secondary" onClick={() => setOffset(madridMidnightMs(addDays(today, 1)) - 60_000 - Date.now())}>Ir a las 23:59</Button>
          <Button variant="ghost" onClick={() => setOffset(0)}>Hora real</Button>
        </div>
        <div className="flex gap-2">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Fecha del juego" className="min-w-0 flex-1 rounded-xl bg-white px-2 py-2 text-sm ring-1 ring-slate-200" />
          <Button variant="secondary" onClick={() => date && setOffset(madridMidnightMs(date) + 12 * 3_600_000 - Date.now())}>Ir a ese día (12:00)</Button>
        </div>
        <p className="text-[11px] text-slate-500">Cambia la tienda diaria, las misiones, las reservas de 72 h y las rachas. Con reloj adelantado, un día sin reportar consume protector.</p>
      </Section>

      <Section title="Tienda: próximos especiales">
        <ul className="space-y-1 text-xs">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => {
            const d = addDays(today, i);
            const ids = state.rotations[d]?.ids ?? rotationFor(d, state.rotations);
            return (
              <li key={d} className="rounded-lg bg-white px-2 py-1.5 ring-1 ring-slate-200">
                <span className="font-semibold">{formatDateKey(d, true)}:</span>{" "}
                {ids.map((id) => `${findItem(id)?.name} (${id[0]}, nv ${findItem(id)?.minLevel})`).join(" · ")}
              </li>
            );
          })}
        </ul>
        {activeReservations.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-2 text-xs">
            <span>Reserva de {findItem(r.itemId)?.name}</span>
            <Button variant="secondary" onClick={() => exec({ type: "dev_admin_refund", id: r.id })}>Retirada admin. (reembolsa señal)</Button>
          </div>
        ))}
      </Section>

      <Section title="Misiones">
        <div className="flex flex-wrap gap-1.5">
          <Button variant="secondary" onClick={() => exec({ type: "dev_reset_missions", period: "daily" })}>Reasignar diarias</Button>
          <Button variant="secondary" onClick={() => exec({ type: "dev_reset_missions", period: "weekly" })}>Reasignar semanales</Button>
        </div>
        <ul className="space-y-1">
          {missions.map(({ assignment: a, def }) => (
            <li key={a.id} className="flex items-center justify-between gap-2 rounded-lg bg-white px-2 py-1.5 text-xs ring-1 ring-slate-200">
              <span className="min-w-0 truncate"><b>{def.id}</b> {def.name}{a.completedAt ? " ✓" : ""}{a.claimedAt ? " (cobrada)" : ""}</span>
              <span className="flex shrink-0 gap-1">
                {getMission(a.missionId).rule.type === "community" && (
                  <Button variant="ghost" onClick={() => exec({ type: "dev_community", missionId: a.id, amount: 5 })}>+5 comunidad</Button>
                )}
                <Button variant="ghost" disabled={!!a.completedAt} onClick={() => exec({ type: "dev_complete_mission", id: a.id })}>Completar</Button>
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Logros y mascotas">
        <div className="flex gap-2">
          <select value={achievement} onChange={(e) => setAchievement(e.target.value)} aria-label="Logro" className="min-w-0 flex-1 rounded-xl bg-white px-2 py-2 text-sm ring-1 ring-slate-200">
            {ACHIEVEMENTS.map((a) => <option key={a.id} value={a.id}>{a.id} · {a.name}{a.secret ? " (secreto)" : ""}{state.achievements[a.id] ? " ✓" : ""}</option>)}
          </select>
          <Button onClick={() => exec({ type: "dev_unlock_achievement", id: achievement })}>Desbloquear</Button>
        </div>
        <Button variant="secondary" onClick={() => ACHIEVEMENTS.forEach((a) => run({ type: "dev_unlock_achievement", id: a.id }))}>Desbloquear los 40</Button>
        <label className="flex items-center gap-2 text-xs text-slate-700">
          <input type="checkbox" checked={previewCat} onChange={(e) => setPreviewCat(e.target.checked)} className="accent-amber-500" />
          Ver al gato antes del nivel 3 (solo vista previa)
        </label>
        <Button variant="secondary" onClick={() => exec({ type: "cat_nap_seen" })}>Marcar siesta del gato vista</Button>
      </Section>

      <Section title="Objetos">
        <div className="flex gap-2">
          <select value={itemId} onChange={(e) => setItemId(e.target.value)} aria-label="Objeto" className="min-w-0 flex-1 rounded-xl bg-white px-2 py-2 text-sm ring-1 ring-slate-200">
            {ALL_ITEMS.map((i) => <option key={i.id} value={i.id}>{i.id} · {i.name}</option>)}
          </select>
          <Button onClick={() => exec({ type: "dev_grant_item", itemId })}>Conceder</Button>
        </div>
        <p className="text-[11px] text-slate-500">Lo concedido no se puede vender (no se pagó). Para probar ventas, compra en la tienda con monedas añadidas.</p>
      </Section>

      <Section title="Ampliaciones">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={showAllRooms} onChange={(e) => setShowAllRooms(e.target.checked)} className="accent-amber-500" />
          Ver todas las salas (también las bloqueadas, solo vista)
        </label>
      </Section>

      <Section title="Reiniciar">
        <Button variant="danger" onClick={() => confirm("¿Borrar todo el progreso de pruebas de este navegador?") && exec({ type: "dev_reset" })}>
          Reiniciar todo el progreso de pruebas
        </Button>
      </Section>
    </div>
  );
}
