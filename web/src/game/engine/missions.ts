/**
 * Asignación determinista de misiones (3 diarias, 5 semanales con 1–2 comunitarias) y cálculo
 * de progreso a partir de eventos verificables. Una misión completada queda así aunque luego
 * se deshaga la acción; la recompensa se reclama una sola vez.
 */

import { findItem, shopGroup, type CatalogItem, type Tag } from "../data/catalog";
import { hasFeature, LEVELS, MAX_LEVEL, roomsForLevel, STYLES } from "../data/levels";
import { DAILY_MISSIONS, getMission, WEEKLY_MISSIONS, type MissionDef, type MissionRule } from "../data/missions";
import { NEIGHBORS } from "../data/neighbors";
import { seeded, shuffle } from "../rng";
import { addDays, DAY_MS, daysBetween, madridMidnightMs, weekday, weekStart } from "../time";
import { adjacentPairs, catRestAccessible, cellsOf, itemLookup, placedInRoom } from "./layout";
import type { CommunityInstance, GameState, MissionAssignment, SaveFacts } from "./types";

const DAILY_NO_REPEAT_DAYS = 3;

function ownedItems(state: GameState): CatalogItem[] {
  return state.inventory.filter((o) => !o.soldAt).map((o) => findItem(o.itemId)).filter((i): i is CatalogItem => !!i);
}

function countTag(items: CatalogItem[], tag: Tag): number {
  return items.filter((i) => i.tags.includes(tag)).length;
}

/** ¿Puede el usuario completar la misión con lo que tiene (incluidos los regalos gratuitos)? */
export function feasible(state: GameState, def: MissionDef, today: string): boolean {
  if (state.level < def.minLevel) return false;
  const items = ownedItems(state);
  const has = (tag: Tag, n = 1) => countTag(items, tag) >= n;
  const rule = def.rule;
  switch (rule.type) {
    case "placeNew": case "validChange": return items.length >= 1;
    case "saveWithMin": return items.length >= rule.n;
    case "adjacent": return has(rule.a) && has(rule.b);
    case "placeTag": return has(rule.tag);
    case "decorChange": return items.some((i) => i.tags.some((t) => ["decor", "wallart", "plant", "lamp", "rug", "light"].includes(t)));
    case "roomTags": return rule.tags.every((t) => has(t as Tag));
    case "catRest": return hasFeature(state.level, "cat") && has("rest");
    case "placeKind": return items.some((i) => rule.kinds.includes(i.kind));
    case "roomsWithMin": return roomsForLevel(state.level).length >= rule.rooms && items.length >= rule.rooms * rule.n;
    case "floorChanged": return hasFeature(state.level, "styles") && availableStyles(state, "floor").length >= 2;
    case "uniqueTag": return countTag(items, rule.tag) >= rule.n;
    case "roomDistinct": return items.length >= rule.n;
    case "categories": return new Set(items.map(shopGroup)).size >= rule.n;
    case "plantsLamp": return has("plant", 2) && has("lamp");
    case "pcSeats": return has("pc", rule.n) && has("seat", rule.n);
    case "nameSaved": return !state.nameCustomized;
    case "like": return NEIGHBORS.some((n) => !state.likes[n.id]);
    case "virtualVisits": case "mixedViews": return NEIGHBORS.length >= (rule.type === "virtualVisits" ? rule.n : rule.virtual);
    case "showcaseChanged": return Object.keys(state.achievements).length >= 1;
    case "reportWeekdays":
      // W08 solo si aún queda lunes o martes; el fin de semana siempre está por delante.
      return rule.days.some((d) => d >= weekday(today));
    case "levelUp": {
      if (state.level >= MAX_LEVEL) return false;
      const missing = LEVELS[state.level + 1]!.reports - state.validReportCount;
      return missing <= 8 - weekday(today);
    }
    default: return true;
  }
}

export function availableStyles(state: GameState, kind: "floor" | "wall" | "window"): string[] {
  return STYLES.filter((s) => s.kind === kind && state.level >= s.minLevel && (!s.gift || state.styleGifts.includes(s.id))).map((s) => s.id);
}

function ruleSignature(rule: MissionRule): string {
  return JSON.stringify(rule);
}

function recentMissionIds(state: GameState, today: string): Set<string> {
  return new Set(
    state.missions
      .filter((m) => m.period === "daily" && daysBetween(m.periodKey, today) > 0 && daysBetween(m.periodKey, today) <= DAILY_NO_REPEAT_DAYS)
      .map((m) => m.missionId),
  );
}

/** Pasivas de consulta única para el respaldo cuando falta una categoría. */
const FALLBACK_IDS = ["D31", "D34", "D32", "D42", "D33", "D41"];

export function pickDaily(state: GameState, today: string): { ids: string[]; fallback: string[] } {
  const rand = seeded(`daily:${state.userId}:${today}`);
  const recent = recentMissionIds(state, today);
  const chosen: MissionDef[] = [];
  const fallback: string[] = [];
  const clash = (d: MissionDef) =>
    chosen.some((c) => c.id === d.id || (d.equivalence && c.equivalence === d.equivalence) || ruleSignature(c.rule) === ruleSignature(d.rule));
  for (const category of ["contribution", "decoration", "exploration"] as const) {
    const pool = DAILY_MISSIONS.filter((d) => d.category === category && !recent.has(d.id) && feasible(state, d, today) && !clash(d));
    if (pool.length) chosen.push(shuffle(rand, pool)[0]!);
  }
  // Respaldo documentado: consulta pasiva sin repetir objetivos equivalentes; si aun así faltan,
  // se relaja la regla de no repetir de los últimos 3 días antes que imponer algo imposible.
  for (const relaxRecent of [false, true]) {
    for (const id of shuffle(rand, FALLBACK_IDS)) {
      if (chosen.length >= 3) break;
      const def = getMission(id);
      if ((!relaxRecent && recent.has(id)) || clash(def) || !feasible(state, def, today)) continue;
      chosen.push(def);
      fallback.push(id);
    }
  }
  return { ids: chosen.map((d) => d.id), fallback };
}

export function pickWeekly(state: GameState, week: string, today: string): string[] {
  const rand = seeded(`weekly:${state.userId}:${week}`);
  const lastWeek = new Set(state.missions.filter((m) => m.period === "weekly" && m.periodKey === addDays(week, -7)).map((m) => m.missionId));
  const prefer = (list: MissionDef[]) => {
    const fresh = list.filter((d) => !lastWeek.has(d.id));
    return shuffle(rand, fresh.length ? fresh : list);
  };
  const ok = (d: MissionDef) => feasible(state, d, today);
  const communityCount = rand() < 0.5 ? 1 : 2;
  const community = prefer(WEEKLY_MISSIONS.filter((d) => d.category === "community" && ok(d))).slice(0, communityCount);
  const personal: MissionDef[] = [];
  const add = (d: MissionDef | undefined) => {
    if (d && !personal.some((p) => ruleSignature(p.rule) === ruleSignature(d.rule) || p.id === d.id)) personal.push(d);
  };
  const contribution = prefer(WEEKLY_MISSIONS.filter((d) => d.category === "contribution" && ok(d)));
  const decoration = prefer(WEEKLY_MISSIONS.filter((d) => d.category === "decoration" && ok(d)));
  const exploration = prefer(WEEKLY_MISSIONS.filter((d) => d.category === "exploration" && ok(d)));
  add(contribution[0]);
  add(decoration[0]);
  add(exploration[0]);
  const rest = shuffle(rand, [...contribution.slice(1, 2), ...decoration.slice(1), ...exploration.slice(1)]);
  for (const d of rest) if (personal.length < 5 - community.length) add(d);
  return [...community, ...personal].map((d) => d.id);
}

/** Datos de actividad comunitaria simulados del entorno de pruebas (media de 4 semanas). */
export function simulatedCommunityStats(week: string) {
  const rand = seeded(`community-stats:${week}`);
  return {
    reports: 18 + Math.floor(rand() * 40),
    users: 4 + Math.floor(rand() * 12),
    libraries: 3 + Math.floor(rand() * 8),
    libraryReports: 4 + Math.floor(rand() * 10),
    libraryUsers: 2 + Math.floor(rand() * 5),
    userDays: 10 + Math.floor(rand() * 25),
  };
}

/** Objetivo escalado (§7.2) fijado al empezar la semana. */
export function communityTarget(metric: string, example: number, week: string): number {
  const s = simulatedCommunityStats(week);
  switch (metric) {
    case "reports": return Math.max(3, Math.min(example, Math.ceil(0.7 * s.reports)));
    case "userDays": return Math.max(3, Math.min(example, Math.ceil(0.7 * s.userDays)));
    case "users": return Math.max(2, Math.min(example, Math.ceil(0.6 * s.users)));
    case "libraries": return Math.max(1, Math.min(example, s.libraries));
    case "libraryReports": return Math.max(3, Math.min(example, Math.ceil(0.7 * s.libraryReports)));
    case "libraryUsers": return Math.max(2, Math.min(example, Math.ceil(0.6 * s.libraryUsers)));
    default: return example;
  }
}

function habitualLibrary(state: GameState): { id: string; name: string } | null {
  const counts = new Map<string, number>();
  for (const r of state.reports) if (!r.invalidated) counts.set(r.libraryId, (counts.get(r.libraryId) ?? 0) + 1);
  let best: string | null = null;
  for (const [id, n] of counts) if (!best || n > counts.get(best)!) best = id;
  return best ? { id: best, name: "tu biblioteca habitual" } : null;
}

export function ensureCommunityInstance(state: GameState, missionId: string, week: string): CommunityInstance | null {
  const key = `${week}:${missionId}`;
  if (state.community[key]) return state.community[key];
  const def = getMission(missionId);
  if (def.rule.type !== "community") return null;
  const libraryMetric = def.rule.metric === "libraryReports" || def.rule.metric === "libraryUsers";
  const library = libraryMetric ? habitualLibrary(state) : null;
  const target = communityTarget(def.rule.metric, def.rule.example, week);
  const rand = seeded(`community:${key}`);
  const instance: CommunityInstance = {
    missionId, weekKey: week, target, library: library ?? undefined,
    // Ritmo del resto de la comunidad: unas semanas se alcanza y otras no (nunca se promete).
    simulatedBase: Math.round(target * (0.55 + rand() * 0.6)),
    devBonus: 0,
  };
  state.community[key] = instance;
  return instance;
}

export function assignMissions(state: GameState, today: string, now: number): void {
  if (state.level < 1) return;
  if (!state.missions.some((m) => m.period === "daily" && m.periodKey === today)) {
    const { ids, fallback } = pickDaily(state, today);
    for (const id of ids) {
      state.missions.push({ id: `${today}:${id}`, missionId: id, period: "daily", periodKey: today, assignedAt: now,
        target: targetOf(getMission(id)), fallback: fallback.includes(id) || undefined });
    }
  }
  const week = weekStart(today);
  if (!state.missions.some((m) => m.period === "weekly" && m.periodKey === week)) {
    for (let id of pickWeekly(state, week, today)) {
      const def = getMission(id);
      let assignment: MissionAssignment = { id: `${week}:${id}`, missionId: id, period: "weekly", periodKey: week, assignedAt: now, target: targetOf(def) };
      if (def.rule.type === "community") {
        let instance = ensureCommunityInstance(state, id, week);
        // Sin biblioteca con comunidad reciente suficiente: se sustituye por una misión general.
        if ((def.rule.metric === "libraryReports" || def.rule.metric === "libraryUsers") && !instance?.library) {
          id = state.missions.some((m) => m.id === `${week}:W19`) ? "W25" : "W19";
          instance = ensureCommunityInstance(state, id, week);
          assignment = { ...assignment, id: `${week}:${id}`, missionId: id, fallback: true };
        }
        if (state.missions.some((m) => m.id === assignment.id)) continue;
        assignment.target = instance!.target;
        assignment.library = instance!.library;
      }
      state.missions.push(assignment);
    }
  }
}

export function targetOf(def: MissionDef): number {
  const r = def.rule;
  switch (r.type) {
    case "reports": case "reportDays": case "placeNew": case "saveWithMin": case "uniqueTag": case "roomDistinct":
    case "saveDays": case "categories": case "realViews": case "virtualVisits": case "pcSeats": return r.n;
    case "roomsWithMin": return r.rooms;
    case "plantsLamp": return 3;
    case "mixedViews": return r.real + r.virtual;
    case "community": return r.example;
    default: return 1;
  }
}

function inPeriod(a: MissionAssignment, date: string): boolean {
  return a.period === "daily" ? date === a.periodKey : weekStart(date) === a.periodKey;
}

/** Progreso comunitario global (resto de la comunidad simulado + aportaciones propias). */
export function communityProgress(state: GameState, a: MissionAssignment, now: number): { global: number; contributed: boolean } {
  const instance = state.community[a.id];
  const def = getMission(a.missionId);
  if (!instance || def.rule.type !== "community") return { global: 0, contributed: false };
  const weekStartMs = madridMidnightMs(a.periodKey);
  const elapsed = Math.min(1, Math.max(0, (now - weekStartMs) / (7 * DAY_MS)));
  const reports = state.reports.filter((r) => !r.invalidated && inPeriod(a, r.date) && (!instance.library || r.libraryId === instance.library.id));
  const own = (() => {
    switch (def.rule.metric) {
      case "reports": case "libraryReports": return reports.length;
      case "userDays": return new Set(reports.map((r) => r.date)).size;
      case "libraries": return new Set(reports.map((r) => r.libraryId)).size;
      default: return reports.length ? 1 : 0;
    }
  })();
  const global = Math.floor(instance.simulatedBase * elapsed) + instance.devBonus + own;
  return { global, contributed: reports.length > 0 };
}

/** Valor actual de una misión. Las de editor solo avanzan en un guardado con cambios reales. */
export function missionValue(state: GameState, a: MissionAssignment, now: number, facts?: SaveFacts): number {
  const def = getMission(a.missionId);
  const rule = def.rule;
  const reports = state.reports.filter((r) => !r.invalidated && inPeriod(a, r.date));
  const dates = [...new Set(reports.map((r) => r.date))].sort();
  const itemOf = itemLookup(state);
  const placed = state.placements;
  const saving = !!facts?.changed;
  const saves = state.layoutSaves.filter((s) => s.facts.changed && inPeriod(a, s.date));
  const views = state.realViews.filter((v) => inPeriod(a, v.date));
  const visits = state.virtualVisits.filter((v) => inPeriod(a, v.date));
  const roomDefs = roomsForLevel(state.level, state.expansions);
  const rooms = roomDefs.map((r) => r.id);
  const roomCount = (room: string) => placedInRoom(placed, room).length;
  const placedItems = placed.map((p) => itemOf(p.uid)).filter((i): i is CatalogItem => !!i);
  switch (rule.type) {
    case "reports": return reports.length;
    case "reportDays": return dates.length;
    case "reportWeekdays": return dates.some((d) => rule.days.includes(weekday(d))) ? 1 : 0;
    case "reportNonConsecutive": return dates.some((d) => dates.some((e) => daysBetween(d, e) >= 2)) ? 1 : 0;
    case "placeNew": return new Set(saves.flatMap((s) => s.facts.newlyPlaced)).size;
    case "saveDays": return new Set(saves.map((s) => s.date)).size;
    case "realViews": {
      const habitual = habitualLibrary(state)?.id;
      const ok = views.filter((v) => {
        if (rule.mode === "notHabitual") return !habitual || v.libraryId !== habitual;
        if (rule.mode === "new7d")
          return !state.realViews.some((o) => o.libraryId === v.libraryId && o.at < v.at && v.at - o.at < 7 * DAY_MS);
        return true;
      });
      return new Set(ok.map((v) => v.libraryId)).size;
    }
    case "virtualVisits": return new Set(visits.filter((v) => !rule.room || v.room).map((v) => v.ownerId)).size;
    case "mixedViews":
      return Math.min(rule.real, new Set(views.map((v) => v.libraryId)).size) + Math.min(rule.virtual, new Set(visits.map((v) => v.ownerId)).size);
    case "like": return state.likeLog.some((l) => inPeriod(a, l.date)) ? 1 : 0;
    case "nameSaved": return state.nameSaves.some((d) => inPeriod(a, d)) ? 1 : 0;
    case "showcaseChanged": return state.showcaseChanges.some((d) => inPeriod(a, d)) ? 1 : 0;
    case "musicSaved": return state.musicSaves.some((d) => inPeriod(a, d)) ? 1 : 0;
    case "levelUp": return state.levelUps.some((l) => inPeriod(a, l.date)) ? 1 : 0;
    case "community": return communityProgress(state, a, now).global;
    default: break;
  }
  if (!saving || !facts) return 0;
  switch (rule.type) {
    case "saveWithMin": return Math.max(0, ...rooms.map(roomCount));
    case "adjacent": return (rule.a === "seat" ? facts.seatTableChanged : facts.pcSeatChanged) ? 1 : 0;
    case "validChange": return 1;
    case "placeTag": return facts.movedOrPlaced.some((uid) => itemOf(uid)?.tags.includes(rule.tag)) ? 1 : 0;
    case "decorChange": return facts.decorChanged ? 1 : 0;
    case "floorChanged": return facts.floorChanged ? 1 : 0;
    case "roomTags":
      return rooms.some((room) => roomHasTags(placedInRoom(placed, room), itemOf, rule.tags as Tag[], !!rule.zone)) ? 1 : 0;
    case "catRest": return roomDefs.some((room) => catRestAccessible(room, placed, itemOf)) ? 1 : 0;
    case "placeKind": return placedItems.some((i) => rule.kinds.includes(i.kind)) ? 1 : 0;
    case "roomsWithMin": return rooms.filter((room) => roomCount(room) >= rule.n).length;
    case "uniqueTag": return placed.filter((p) => itemOf(p.uid)?.tags.includes(rule.tag)).length;
    case "roomDistinct": return Math.max(0, ...rooms.map(roomCount));
    case "categories": return new Set(placedItems.map(shopGroup)).size;
    case "plantsLamp": return Math.min(2, countTag(placedItems, "plant")) + Math.min(1, countTag(placedItems, "lamp"));
    case "pcSeats": {
      const pairs = adjacentPairs(placed, itemOf, "pc", "seat");
      return Math.min(new Set(pairs.map(([pc]) => pc.uid)).size, new Set(pairs.map(([, s]) => s.uid)).size);
    }
    default: return 0;
  }
}

function roomHasTags(
  placements: ReturnType<typeof placedInRoom>, itemOf: (uid: string) => CatalogItem | undefined, tags: Tag[], zone: boolean,
): boolean {
  const byTag = tags.map((t) => placements.filter((p) => itemOf(p.uid)?.tags.includes(t)));
  if (byTag.some((list) => !list.length)) return false;
  if (!zone) return true;
  // «Rincón»: todas las piezas a 3 casillas o menos de la primera.
  const center = (p: (typeof placements)[number]) => {
    const item = itemOf(p.uid)!;
    const cell: [number, number] = item.layer === "small" || item.layer === "wall" ? [p.x, p.y] : cellsOf(item, p)[0]!;
    return cell;
  };
  return byTag[0]!.some((anchor) => {
    const [ax, ay] = center(anchor);
    return byTag.slice(1).every((list) => list.some((p) => {
      const [x, y] = center(p);
      return Math.max(Math.abs(x - ax), Math.abs(y - ay)) <= 3;
    }));
  });
}

/** Actualiza progreso y marca completadas las misiones del periodo en curso. */
export function updateMissions(state: GameState, today: string, now: number, facts?: SaveFacts): string[] {
  const completed: string[] = [];
  for (const a of state.missions) {
    if (a.completedAt || !inPeriod(a, today)) continue;
    const def = getMission(a.missionId);
    const value = missionValue(state, a, now, facts);
    if (def.rule.type !== "community") a.progress = Math.max(a.progress ?? 0, value);
    const done = def.rule.type === "community"
      ? value >= a.target && communityProgress(state, a, now).contributed
      : value >= a.target;
    if (done) {
      a.completedAt = now;
      completed.push(a.id);
    }
  }
  return completed;
}

/** Las misiones del periodo en curso para mostrar, con progreso calculado. */
export function activeMissions(state: GameState, today: string, now: number) {
  return state.missions
    .filter((a) => inPeriod(a, today))
    .map((a) => {
      const def = getMission(a.missionId);
      const value = a.completedAt ? a.target : Math.min(a.target, Math.max(a.progress ?? 0, missionValue(state, a, now)));
      const community = def.rule.type === "community" ? communityProgress(state, a, now) : null;
      const goal = def.goal.replace("{n}", String(a.target)).replace("{library}", a.library?.name ?? "una biblioteca");
      return { assignment: a, def, value: community ? Math.min(a.target, community.global) : value, community, goal };
    });
}
