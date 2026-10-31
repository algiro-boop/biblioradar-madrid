"use client";

import { Check, Flame, Palmtree, Shield, Timer, Users } from "lucide-react";
import { LEVELS, MAX_LEVEL, nextLevel, nextRewardText } from "@/game/data/levels";
import { communityMissionsEnabled } from "@/game/data/missions";
import type { GameState } from "@/game/engine";
import { activeMissions } from "@/game/engine/missions";
import { activeVacation, MAX_PROTECTORS, STREAK_MILESTONES, vacationDaysUsed, VACATION_MAX_CONSECUTIVE, VACATION_MAX_PER_YEAR } from "@/game/engine/streak";
import { run } from "@/game/store";
import { addDays, formatCountdown, formatDateKey, madridDateKey, madridMidnightMs, msUntilMadridMidnight, weekDates, weekStart, yearOf } from "@/game/time";
import { report } from "./ShopPanel";
import { Button, Coins, Empty, ProgressBar, Section } from "./ui";

type Notify = (m: string, k?: "ok" | "error") => void;

// ---------------------------------------------------------------- misiones

export function MissionsPanel({ state, now, notify }: { state: GameState; now: number; notify: Notify }) {
  if (state.level < 1) return <Empty>Las misiones empiezan en el nivel 1.</Empty>;
  const today = madridDateKey(now);
  const all = activeMissions(state, today, now);
  const daily = all.filter((m) => m.assignment.period === "daily");
  const weekly = all.filter((m) => m.assignment.period === "weekly");
  const weekEnd = madridMidnightMs(addDays(weekStart(today), 7));
  return (
    <div className="space-y-5">
      <Section title="Diarias" aside={<span className="inline-flex items-center gap-1"><Timer className="size-3.5" aria-hidden />{formatCountdown(msUntilMadridMidnight(now))}</span>}>
        {daily.map((m) => <MissionCard key={m.assignment.id} m={m} notify={notify} />)}
      </Section>
      <Section title="Semanales" aside={<span className="inline-flex items-center gap-1"><Timer className="size-3.5" aria-hidden />{formatCountdown(weekEnd - now)}</span>}>
        {weekly.map((m) => <MissionCard key={m.assignment.id} m={m} notify={notify} />)}
      </Section>
      <p className="text-xs text-slate-500">
        Las misiones de reportes solo avanzan con reportes válidos.
        {communityMissionsEnabled()
          ? <> En las comunitarias el progreso del resto de la comunidad está <strong>simulado</strong>; para cobrarlas hay que aportar al menos un reporte válido.</>
          : " Pronto llegarán misiones comunitarias con objetivos para todo Madrid."}
      </p>
    </div>
  );
}

function MissionCard({ m, notify }: { m: ReturnType<typeof activeMissions>[number]; notify: Notify }) {
  const { assignment: a, def, value, community, goal } = m;
  const done = !!a.completedAt;
  const claimed = !!a.claimedAt;
  return (
    <div className={`rounded-2xl p-3 ring-1 ${claimed ? "bg-slate-50 ring-slate-200 opacity-70" : done ? "bg-emerald-50 ring-emerald-300" : "bg-white ring-slate-200"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            {community && <Users className="size-3.5 text-sky-600" aria-label="Comunitaria" />}
            {def.name}
          </p>
          <p className="text-xs text-slate-600">{goal}</p>
        </div>
        <Coins value={def.reward} className="text-sm" />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <ProgressBar value={value} max={a.target} tone={community ? "sky" : "emerald"} />
        <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-600">{Math.min(value, a.target)}/{a.target}</span>
      </div>
      {community && (
        <p className="mt-1 text-[11px] text-slate-500">
          Progreso global simulado · {community.contributed ? "ya has aportado ✓" : "aún no has aportado"}
        </p>
      )}
      {done && !claimed && (
        <Button variant="gold" className="mt-2 w-full" onClick={() => report(run({ type: "claim_mission", id: a.id }), notify, "coin")}>
          Reclamar {def.reward} monedas
        </Button>
      )}
      {claimed && <p className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700"><Check className="size-3.5" aria-hidden />Reclamada</p>}
    </div>
  );
}

// ---------------------------------------------------------------- progreso, racha y vacaciones

export function ProgressPanel({ state, now, notify }: { state: GameState; now: number; notify: Notify }) {
  const today = madridDateKey(now);
  const next = nextLevel(state.level);
  const current = LEVELS[state.level]!;
  const dates = new Set(state.reports.filter((r) => !r.invalidated).map((r) => r.date));
  const vacation = activeVacation(state.vacations, dates, today);
  const used = vacationDaysUsed(state.vacations, dates, yearOf(today), today);
  const s = state.streak;
  // Calendario de las últimas 4 semanas (lunes a domingo).
  const firstWeek = weekStart(addDays(today, -21));
  const weeks = [0, 1, 2, 3].map((i) => weekDates(addDays(firstWeek, i * 7)));
  const frozen = new Set(s.frozenDates);
  const consumed = new Set(s.consumedDates);

  return (
    <div className="space-y-6">
      <Section title="Nivel">
        <div className="rounded-2xl bg-gradient-to-br from-amber-50 to-white p-4 ring-1 ring-amber-200">
          <p className="text-xs font-semibold text-amber-800">Nivel {state.level} de {MAX_LEVEL}</p>
          <p className="text-lg font-bold">{current.title}</p>
          <p className="text-sm text-slate-600">{state.validReportCount} reportes válidos en total</p>
          {next && (
            <div className="mt-3 space-y-1.5">
              <ProgressBar value={state.validReportCount - current.reports} max={next.reports - current.reports} tone="amber" />
              <p className="text-xs text-slate-600">{nextRewardText(state.validReportCount)}</p>
            </div>
          )}
        </div>
        <ol className="space-y-1">
          {LEVELS.slice(1).map((l) => {
            const reached = state.level >= l.level;
            return (
              <li key={l.level} className={`flex gap-3 rounded-xl px-3 py-2 text-sm ${l.level === state.level ? "bg-amber-100 ring-1 ring-amber-300" : reached ? "bg-white" : "bg-slate-50 text-slate-500"}`}>
                <span className={`grid size-7 shrink-0 place-items-center rounded-lg text-xs font-bold ${reached ? "bg-amber-400 text-amber-950" : "bg-slate-200 text-slate-500"}`}>{l.level}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{l.title} <span className="font-normal text-slate-500">· {l.reports} reportes</span></p>
                  <p className="text-xs text-slate-500">{l.summary}</p>
                </div>
                <Coins value={l.coins} className="shrink-0 text-xs" />
              </li>
            );
          })}
        </ol>
      </Section>

      <Section title="Racha">
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat icon={<Flame className="size-4 text-orange-500" aria-hidden />} label="Actual" value={`${s.current} d`} />
          <Stat icon={<Flame className="size-4 text-slate-400" aria-hidden />} label="Mejor" value={`${s.best} d`} />
          <Stat icon={<Shield className="size-4 text-sky-600" aria-hidden />} label="Protectores" value={`${s.protectors}/${MAX_PROTECTORS}`} />
        </div>
        <p className="text-xs text-slate-600">
          {s.reportedToday ? "Hoy ya has reportado: racha a salvo." : s.current > 0 ? "Hoy aún no has reportado: tienes hasta las 23:59 (hora de Madrid)." : "Haz un reporte válido para empezar una racha."}
          {" "}Ganas un protector por cada semana completa (lunes a domingo); se gasta solo si fallas un día.
        </p>
        <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-200">
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold text-slate-400">
            {["L", "M", "X", "J", "V", "S", "D"].map((d) => <span key={d}>{d}</span>)}
          </div>
          {weeks.map((w) => (
            <div key={w[0]} className="mt-1 grid grid-cols-7 gap-1">
              {w.map((d) => {
                const kind = d > today ? "future" : dates.has(d) ? "report" : frozen.has(d) ? "vacation" : consumed.has(d) ? "shield" : d === today ? "today" : "miss";
                const cls = {
                  report: "bg-orange-400 text-white", vacation: "bg-teal-200 text-teal-900", shield: "bg-sky-200 text-sky-900",
                  today: "bg-white ring-2 ring-orange-300 text-slate-700", miss: "bg-slate-100 text-slate-400", future: "bg-transparent text-slate-300",
                }[kind];
                return (
                  <span key={d} title={`${formatDateKey(d, true)} · ${{ report: "con reporte", vacation: "vacaciones", shield: "protector usado", today: "hoy", miss: "sin reporte", future: "" }[kind]}`}
                    className={`grid aspect-square place-items-center rounded-md text-[10px] font-semibold ${cls}`}>
                    {kind === "shield" ? "🛡" : kind === "vacation" ? "🌴" : Number(d.slice(8))}
                  </span>
                );
              })}
            </div>
          ))}
          <p className="mt-2 flex flex-wrap gap-x-3 text-[10px] text-slate-500">
            <span><i className="mr-1 inline-block size-2 rounded-sm bg-orange-400" />Reporte</span>
            <span><i className="mr-1 inline-block size-2 rounded-sm bg-sky-200" />Protector</span>
            <span><i className="mr-1 inline-block size-2 rounded-sm bg-teal-200" />Vacaciones</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {STREAK_MILESTONES.map((m) => (
            <span key={m.days} className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${s.best >= m.days ? "bg-orange-100 text-orange-800 ring-orange-300" : "bg-white text-slate-500 ring-slate-200"}`}>
              {m.days} días · {m.coins}{m.item ? " + premio" : ""}
            </span>
          ))}
        </div>
      </Section>

      <Section title="Modo vacaciones" aside={`${used}/${VACATION_MAX_PER_YEAR} días en ${yearOf(today)}`}>
        <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-200">
          {vacation ? (
            <>
              <p className="flex items-center gap-2 text-sm font-semibold text-teal-800"><Palmtree className="size-4" aria-hidden />De vacaciones desde el {formatDateKey(vacation.start)}</p>
              <p className="mt-1 text-xs text-slate-600">Tu racha está congelada hasta el {formatDateKey(vacation.plannedEnd)} como máximo. Tu primer reporte las termina.</p>
              <Button variant="secondary" className="mt-2" onClick={() => report(run({ type: "vacation_end" }), notify)}>Terminar vacaciones</Button>
            </>
          ) : (
            <>
              <p className="text-xs text-slate-600">
                Congela la racha hasta {VACATION_MAX_CONSECUTIVE} días seguidos y {VACATION_MAX_PER_YEAR} al año. No cuentan como reporte ni completan misiones. Si hoy ya has reportado, empiezan mañana.
              </p>
              <Button variant="secondary" className="mt-2" disabled={state.level < 1} onClick={() => report(run({ type: "vacation_start" }), notify)}>
                <Palmtree className="size-4" aria-hidden />Activar vacaciones
              </Button>
            </>
          )}
        </div>
      </Section>

      <Section title="Movimientos de monedas" aside={<Coins value={state.balance} />}>
        {state.ledger.length ? (
          <ul className="divide-y divide-slate-100 rounded-2xl bg-white ring-1 ring-slate-200">
            {state.ledger.slice(-25).reverse().map((e) => (
              <li key={e.key} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                <span className="min-w-0 truncate text-slate-700">{e.label}</span>
                <span className={`shrink-0 font-bold tabular-nums ${e.delta >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{e.delta >= 0 ? "+" : ""}{e.delta}</span>
              </li>
            ))}
          </ul>
        ) : <Empty>Aún no hay movimientos.</Empty>}
      </Section>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white p-2.5 ring-1 ring-slate-200">
      <div className="flex justify-center">{icon}</div>
      <p className="mt-0.5 text-base font-bold tabular-nums">{value}</p>
      <p className="text-[10px] font-semibold text-slate-500 uppercase">{label}</p>
    </div>
  );
}
