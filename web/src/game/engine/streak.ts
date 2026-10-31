/**
 * Rachas, protectores y vacaciones (§9). La racha se recalcula siempre desde el historial de
 * días con reporte válido: una validación tardía corrige el día correcto sin castigar la latencia.
 */

import { addDays, daysBetween, weekDates, weekday, weekStart, yearOf } from "../time";
import type { StreakInfo, VacationPeriod } from "./types";

export const MAX_PROTECTORS = 5;
export const VACATION_MAX_CONSECUTIVE = 14;
export const VACATION_MAX_PER_YEAR = 30;

/** Hitos históricos de racha: monedas y premio cosmético exclusivo en 30 y 100 días. */
export const STREAK_MILESTONES: { days: number; coins: number; item?: string }[] = [
  { days: 3, coins: 15 },
  { days: 7, coins: 30 },
  { days: 14, coins: 50 },
  { days: 30, coins: 100, item: "X09" },
  { days: 60, coins: 150 },
  { days: 100, coins: 250, item: "X10" },
];

/** Fin efectivo de un periodo: el menor entre lo planificado, el cierre y el día antes del primer reporte. */
export function effectiveVacationEnd(v: VacationPeriod, reportDates: Set<string>, today: string): string {
  let end = v.end ?? v.plannedEnd;
  for (let d = v.start; daysBetween(d, end) >= 0 && daysBetween(d, today) >= 0; d = addDays(d, 1)) {
    if (reportDates.has(d)) {
      end = addDays(d, -1);
      break;
    }
  }
  return end;
}

/** Días de vacaciones ya consumidos en un año natural (hasta hoy incluido). */
export function vacationDaysUsed(vacations: VacationPeriod[], reportDates: Set<string>, year: number, today: string): number {
  let used = 0;
  for (const v of vacations) {
    const end = effectiveVacationEnd(v, reportDates, today);
    for (let d = v.start; daysBetween(d, end) >= 0 && daysBetween(d, today) >= 0; d = addDays(d, 1)) {
      if (yearOf(d) === year) used++;
    }
  }
  return used;
}

export function computeStreak(reportDates: Set<string>, vacations: VacationPeriod[], today: string): StreakInfo {
  const info: StreakInfo = {
    current: 0, best: 0, protectors: 0, protectorsEarned: 0,
    consumedDates: [], frozenDates: [], perfectWeeks: [], reportedToday: reportDates.has(today),
  };
  const sorted = [...reportDates].filter((d) => daysBetween(d, today) >= 0).sort();
  const first = sorted[0];
  if (!first) return info;
  const frozen = new Set<string>();
  for (const v of vacations) {
    const end = effectiveVacationEnd(v, reportDates, today);
    for (let d = v.start; daysBetween(d, end) >= 0; d = addDays(d, 1)) frozen.add(d);
  }
  for (let d = first; daysBetween(d, today) >= 0; d = addDays(d, 1)) {
    if (reportDates.has(d)) {
      info.current += 1;
      info.best = Math.max(info.best, info.current);
      // Semana natural completa: se concede al reportar su séptimo día (siempre el domingo).
      if (weekday(d) === 7 && weekDates(weekStart(d)).every((x) => reportDates.has(x))) {
        info.perfectWeeks.push(weekStart(d));
        if (info.protectors < MAX_PROTECTORS) {
          info.protectors += 1;
          info.protectorsEarned += 1;
        }
      }
      continue;
    }
    if (d === today) continue; // El día en curso aún no se ha perdido.
    if (frozen.has(d)) {
      info.frozenDates.push(d);
      continue;
    }
    if (info.current > 0 && info.protectors > 0) {
      info.protectors -= 1;
      info.consumedDates.push(d);
      continue;
    }
    info.current = 0;
  }
  return info;
}

/**
 * Inicio de unas vacaciones pedidas hoy: hoy si aún no hay reporte (primer día sin reporte),
 * o mañana. Nunca retroactivas: un día pasado ya protegido o perdido no se recupera.
 */
export function planVacation(
  vacations: VacationPeriod[], reportDates: Set<string>, today: string,
): { start: string; end: string } | { error: string } {
  if (activeVacation(vacations, reportDates, today)) return { error: "Ya tienes unas vacaciones activas." };
  const start = reportDates.has(today) ? addDays(today, 1) : today;
  let end = addDays(start, -1);
  const used = new Map<number, number>();
  for (let i = 0; i < VACATION_MAX_CONSECUTIVE; i++) {
    const d = addDays(start, i);
    const y = yearOf(d);
    if (!used.has(y)) used.set(y, vacationDaysUsed(vacations, reportDates, y, addDays(today, 400)));
    if (used.get(y)! >= VACATION_MAX_PER_YEAR) break;
    used.set(y, used.get(y)! + 1);
    end = d;
  }
  if (daysBetween(start, end) < 0) return { error: `Ya has usado los ${VACATION_MAX_PER_YEAR} días de vacaciones de este año.` };
  return { start, end };
}

export function activeVacation(vacations: VacationPeriod[], reportDates: Set<string>, today: string): VacationPeriod | null {
  return (
    vacations.find((v) => {
      const end = effectiveVacationEnd(v, reportDates, today);
      return daysBetween(v.start, end) >= 0 && daysBetween(today, end) >= 0;
    }) ?? null
  );
}
