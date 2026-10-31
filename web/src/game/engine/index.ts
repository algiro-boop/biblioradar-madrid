/**
 * Motor de gamificación: `dispatch(state, command, ctx)` → nuevo estado. Es la autoridad de
 * todas las reglas (nunca se confía en precios, saldo, nivel ni coordenadas del cliente) y es
 * idempotente: cada abono tiene una clave única en el libro de monedas.
 */

import { getAchievement } from "../data/achievements";
import { findItem, getItem } from "../data/catalog";
import { DEFAULT_STYLE, getRoom, hasFeature, LEVELS, levelForReports, MAX_LEVEL, nextExpansionPrice, roomAt, ROOMS, STYLES } from "../data/levels";
import { getMission } from "../data/missions";
import { NEIGHBORS } from "../data/neighbors";
import { addDays, DAY_MS, madridDateKey, weekStart } from "../time";
import { pendingAchievements } from "./achievements";
import { itemLookup, saveFacts, validateLayout } from "./layout";
import { assignMissions, availableStyles, communityProgress, updateMissions } from "./missions";
import { RESERVATION_HOURS, reservationDeposit, resaleValue, rotationFor, ROTATION_SEED_VERSION } from "./shop";
import { activeVacation, computeStreak, planVacation, STREAK_MILESTONES } from "./streak";
import type { Celebration, Command, CommandResult, Ctx, GameState, ItemSource, OwnedItem, Placement, SaveFacts } from "./types";

export * from "./types";

/** Monedas por reporte válido según su orden en el día local de Madrid (§4.1). */
export const REPORT_COINS = [10, 8, 6, 5];
export const REPORT_COINS_AFTER = 3;
export const coinsForOrdinal = (ordinal: number) => REPORT_COINS[ordinal - 1] ?? REPORT_COINS_AFTER;
export const MAX_PURCHASE_QTY = 10;
const MAX_REQUEST_LOG = 200;
const MAX_NAME = 40;

/** Revisión actual de la estructura guardada. */
export const SCHEMA = 2;

export function initialState(userId: string, now: number): GameState {
  const roomStyles = Object.fromEntries(ROOMS.map((r) => [r.id, { ...DEFAULT_STYLE }]));
  return {
    version: 1, schema: SCHEMA, userId, createdAt: now, seq: 0, name: "Mi biblioteca", nameCustomized: false,
    validReportCount: 0, level: 0, reports: [], ledger: [], balance: 0, inventory: [], placements: [],
    roomStyles, styleGifts: [], rotations: {}, reservations: [], missions: [], community: {}, achievements: {},
    showcase: [], frame: "madera", frames: ["madera"], badges: [], vacations: [],
    streak: { current: 0, best: 0, protectors: 0, protectorsEarned: 0, consumedDates: [], frozenDates: [], perfectWeeks: [], reportedToday: false },
    realViews: [], virtualVisits: [], likes: {}, likeLog: [], layoutSaves: [], showcaseChanges: [], musicSaves: [], nameSaves: [],
    levelUps: [], placedEver: [], catNapSeen: false, catName: "Mishi", processedRequests: [],
    settings: { music: { enabled: true, track: "lofi", volume: 0.5 }, sfx: true, sfxVolume: 0.6, publish: false, alias: "" },
    expansions: {}, celebrations: [], devClockOffset: 0,
  };
}

/**
 * Actualiza un estado guardado con una estructura anterior (muta y devuelve el mismo objeto).
 * Esquema 2: salas ampliables y sonido activado por defecto (una sola vez; después se respeta
 * lo que elija el usuario). Publicación y alias se conservan tal cual.
 */
export function migrateState(state: GameState): GameState {
  if ((state.schema ?? 1) >= SCHEMA) return state;
  state.expansions ??= {};
  const settings = state.settings as Partial<GameState["settings"]>;
  state.settings = {
    music: { ...(settings.music ?? { track: "lofi", volume: 0.5 }), enabled: true },
    sfx: true,
    sfxVolume: settings.sfxVolume ?? 0.6,
    publish: settings.publish ?? false,
    alias: settings.alias ?? "",
  };
  state.schema = SCHEMA;
  return state;
}

// ---------------------------------------------------------------- libro de monedas

function credit(state: GameState, source: string, sourceId: string, delta: number, at: number, label: string): boolean {
  const key = `${source}:${sourceId}`;
  if (state.ledger.some((e) => e.key === key)) return false;
  if (state.balance + delta < 0) throw new GameError("Saldo insuficiente.");
  state.balance += delta;
  state.ledger.push({ key, source, sourceId, delta, at, balance: state.balance, label });
  return true;
}

class GameError extends Error {}

function nextUid(state: GameState, itemId: string): string {
  state.seq += 1;
  return `${itemId}-${state.seq.toString(36)}`;
}

function grantItem(state: GameState, itemId: string, source: ItemSource, paid: number, at: number): OwnedItem {
  const owned: OwnedItem = {
    uid: nextUid(state, itemId), itemId, source, paid,
    // Solo lo comprado con monedas se revende; regalos, logros y rachas nunca generan saldo.
    resellable: source === "purchase",
    acquiredAt: at,
  };
  state.inventory.push(owned);
  return owned;
}

function celebrate(state: GameState, c: Celebration) {
  if (!state.celebrations.some((x) => x.id === c.id)) state.celebrations.push(c);
}

// ---------------------------------------------------------------- niveles

function applyLevel(state: GameState, now: number, today: string) {
  const target = levelForReports(state.validReportCount);
  for (let level = 1; level <= target; level++) {
    const def = LEVELS[level]!;
    const first = credit(state, "level", String(level), def.coins, now, `Nivel ${level}: ${def.title}`);
    if (!first) continue;
    state.levelUps.push({ level, at: now, date: today });
    for (const gift of def.gifts) {
      const qty = gift.qty ?? 1;
      for (let i = 0; i < qty; i++) {
        const owned = grantItem(state, gift.item, "level_reward", 0, now);
        const spot = gift.place?.[i];
        if (spot) tryPlace(state, { uid: owned.uid, room: spot.room, x: spot.x, y: spot.y, rot: spot.rot ?? 0 }, level);
      }
    }
    for (const s of def.styles ?? []) if (!state.styleGifts.includes(s)) state.styleGifts.push(s);
    if (def.features.includes("maxBadge") && !state.badges.includes("nivel-maximo")) state.badges.push("nivel-maximo");
    celebrate(state, { id: `level:${level}`, type: "level", level });
    celebrateGrowth(state, level);
    if (def.features.includes("room2") || def.features.includes("floor2") || def.features.includes("finalRoom")) {
      const room = ROOMS.find((r) => r.level === level);
      if (room) celebrate(state, { id: `room:${room.id}`, type: "room", room: room.id });
    }
  }
  state.level = target;
}

/** Coloca un regalo si cabe sin romper la distribución; si no, se queda en el inventario. */
function tryPlace(state: GameState, p: Placement, level: number) {
  const next = [...state.placements, p];
  if (!validateLayout(next, state.inventory, Math.max(level, state.level), state.expansions).length) {
    state.placements = next;
    if (!state.placedEver.includes(p.uid)) state.placedEver.push(p.uid);
  }
}

/**
 * Retira (al inventario) solo lo que ya no cabe: una sala que vuelve a bloquearse o encoge al bajar
 * de nivel (reporte anulado o modo desarrollador). Al crecer nunca se mueve nada. Avisa al usuario.
 */
function fitPlacements(state: GameState, now: number) {
  let removed = 0;
  for (let guard = 0; guard < 4; guard++) {
    const issues = validateLayout(state.placements, state.inventory, state.level, state.expansions);
    if (!issues.length) break;
    const bad = new Set(issues.map((i) => i.uid));
    const before = state.placements.length;
    state.placements = state.placements.filter((p) => !bad.has(p.uid));
    removed += before - state.placements.length;
  }
  if (removed) celebrate(state, { id: `relocated:${now}`, type: "relocated", count: removed });
}

/** Celebración de las salas que crecen solas al alcanzar `level`. */
function celebrateGrowth(state: GameState, level: number) {
  for (const spec of ROOMS) {
    if (spec.level >= level || !spec.sizes.some((s) => s.level === level)) continue;
    const room = roomAt(spec.id, level, state.expansions[spec.id]);
    celebrate(state, { id: `grow:${spec.id}:${level}`, type: "expansion", room: spec.id, w: room.w, h: room.h, auto: true });
  }
}

// ---------------------------------------------------------------- liquidación periódica

function reportDates(state: GameState): Set<string> {
  return new Set(state.reports.filter((r) => !r.invalidated).map((r) => r.date));
}

/** Se ejecuta antes de cada comando: caducidades, misiones del periodo, rotación, racha y logros. */
function settle(state: GameState, now: number, today: string, facts?: SaveFacts) {
  if (!state.rotations[today]) state.rotations[today] = { ids: rotationFor(today, state.rotations), seedVersion: ROTATION_SEED_VERSION };
  for (const r of state.reservations) {
    if (r.state === "active" && now >= r.expiresAt) {
      r.state = "expired";
      r.closedAt = r.expiresAt;
    }
  }
  const dates = reportDates(state);
  // Vacaciones agotadas: se cierran con su fin efectivo.
  for (const v of state.vacations) if (!v.end && v.plannedEnd < today) {
    v.end = v.plannedEnd;
    v.closedReason = "limit";
  }
  const before = state.streak;
  state.streak = computeStreak(dates, state.vacations, today);
  if (state.streak.protectorsEarned > before.protectorsEarned) celebrate(state, { id: `protector:${state.streak.protectorsEarned}`, type: "protector" });
  for (const m of STREAK_MILESTONES) {
    if (state.streak.best >= m.days && credit(state, "streak", String(m.days), m.coins, now, `Racha de ${m.days} días`)) {
      if (m.item) grantItem(state, m.item, "streak", 0, now);
      celebrate(state, { id: `streak:${m.days}`, type: "streak", days: m.days, coins: m.coins });
    }
  }
  assignMissions(state, today, now);
  updateMissions(state, today, now, facts);
  // Logros (pueden encadenarse: un logro con recompensa puede desbloquear otro).
  for (let guard = 0; guard < 5; guard++) {
    const pending = pendingAchievements(state, communityMissionsDone(state, now));
    if (!pending.length) break;
    for (const def of pending) unlockAchievement(state, def.id, now);
  }
}

function communityMissionsDone(state: GameState, now: number): number {
  return state.missions.filter((m) => {
    if (getMission(m.missionId).rule.type !== "community" || !m.completedAt) return false;
    return communityProgress(state, m, now).contributed;
  }).length;
}

function unlockAchievement(state: GameState, id: string, now: number) {
  if (state.achievements[id]) return;
  const def = getAchievement(id);
  state.achievements[id] = { unlockedAt: now };
  credit(state, "achievement", id, def.coins, now, `Logro: ${def.name}`);
  if (def.reward?.startsWith("X")) grantItem(state, def.reward, "achievement", 0, now);
  else if (def.reward?.startsWith("badge:") && !state.badges.includes(def.reward.slice(6))) state.badges.push(def.reward.slice(6));
  else if (def.reward?.startsWith("frame:") && !state.frames.includes(def.reward.slice(6))) state.frames.push(def.reward.slice(6));
  celebrate(state, { id: `achievement:${id}`, type: "achievement", achievementId: id });
}

export function showcaseCapacity(state: GameState): number {
  if (!hasFeature(state.level, "showcase")) return 0;
  return hasFeature(state.level, "bigShowcase") ? 8 : 3;
}

// ---------------------------------------------------------------- comandos

function apply(state: GameState, cmd: Command, now: number, today: string): { message?: string; facts?: SaveFacts } {
  switch (cmd.type) {
    case "tick": case "ack_celebration": return {};

    case "report_valid": {
      // Idempotente por ID de reporte: repetir el callback no duplica nada.
      if (state.reports.some((r) => r.id === cmd.reportId)) return { message: "Reporte ya contabilizado." };
      const at = Math.min(cmd.at ?? now, now);
      const date = madridDateKey(at);
      const ordinal = state.reports.filter((r) => r.date === date && !r.invalidated).length + 1;
      const coins = coinsForOrdinal(ordinal);
      state.reports.push({ id: cmd.reportId, libraryId: cmd.libraryId, at, date, ordinal, coins, simulated: cmd.simulated });
      state.validReportCount += 1;
      credit(state, "report", cmd.reportId, coins, now, `Reporte válido (${ordinal}.º del día)`);
      applyLevel(state, now, today);
      // El primer reporte posterior cierra unas vacaciones activas.
      for (const v of state.vacations) if (!v.end && v.start <= date && date <= v.plannedEnd) {
        v.end = addDays(date, -1);
        v.closedReason = "report";
      }
      return { message: `+${coins} monedas` };
    }

    case "report_invalidated": {
      const report = state.reports.find((r) => r.id === cmd.reportId);
      if (!report || report.invalidated) return {};
      report.invalidated = true;
      state.validReportCount = Math.max(0, state.validReportCount - 1);
      // Reversión controlada sin saldo negativo; los premios de nivel ya entregados se conservan.
      const reversal = Math.min(report.coins, state.balance);
      credit(state, "report_reversal", report.id, -reversal, now, "Reporte anulado por moderación");
      state.level = levelForReports(state.validReportCount);
      return { message: "Reporte anulado." };
    }

    case "view_library": {
      // Una consulta por biblioteca y día basta para misiones y logros (sin contar clics repetidos).
      if (!state.realViews.some((v) => v.libraryId === cmd.libraryId && v.date === today))
        state.realViews.push({ libraryId: cmd.libraryId, at: now, date: today });
      return {};
    }

    case "visit_virtual": {
      if (!NEIGHBORS.some((n) => n.id === cmd.ownerId)) throw new GameError("Esa biblioteca no es pública.");
      const existing = state.virtualVisits.find((v) => v.ownerId === cmd.ownerId && v.date === today);
      if (!existing) state.virtualVisits.push({ ownerId: cmd.ownerId, room: cmd.room, at: now, date: today });
      else if (cmd.room && !existing.room) existing.room = cmd.room;
      return {};
    }

    case "like": {
      if (!NEIGHBORS.some((n) => n.id === cmd.ownerId)) throw new GameError("No puedes dar me gusta a esta biblioteca.");
      state.likes[cmd.ownerId] = cmd.liked;
      if (cmd.liked && !state.likeLog.some((l) => l.ownerId === cmd.ownerId)) state.likeLog.push({ ownerId: cmd.ownerId, date: today });
      return {};
    }

    case "purchase": {
      if (state.processedRequests.includes(cmd.requestId)) return { message: "Compra ya procesada." };
      if (!hasFeature(state.level, "shop")) throw new GameError("La tienda se abre en el nivel 1.");
      const item = findItem(cmd.itemId);
      if (!item || item.rarity === "X") throw new GameError("Ese artículo no está a la venta.");
      if (item.minLevel > state.level) throw new GameError(`Necesitas nivel ${item.minLevel}.`);
      const qty = Math.floor(cmd.qty);
      if (qty < 1 || qty > MAX_PURCHASE_QTY) throw new GameError("Cantidad no válida.");
      if (item.rarity !== "P" && !state.rotations[today]?.ids.includes(item.id)) throw new GameError("Ese especial ya no está en la tienda de hoy.");
      if (state.balance < item.price * qty) throw new GameError("No tienes monedas suficientes.");
      for (let i = 0; i < qty; i++) {
        const owned = grantItem(state, item.id, "purchase", item.price, now);
        credit(state, "purchase", owned.uid, -item.price, now, `Compra: ${item.name}`);
      }
      state.processedRequests = [...state.processedRequests, cmd.requestId].slice(-MAX_REQUEST_LOG);
      return { message: qty > 1 ? `${qty} × ${item.name} al inventario` : `${item.name} al inventario` };
    }

    case "sell": {
      const owned = state.inventory.find((o) => o.uid === cmd.uid);
      if (!owned || owned.soldAt) throw new GameError("Ese objeto ya no está en tu inventario.");
      if (!owned.resellable) throw new GameError("Los regalos no se pueden vender.");
      const refund = resaleValue(owned.paid);
      owned.soldAt = now;
      state.placements = state.placements.filter((p) => p.uid !== owned.uid);
      credit(state, "sell", owned.uid, refund, now, `Venta: ${getItem(owned.itemId).name}`);
      return { message: `+${refund} monedas` };
    }

    case "reserve": {
      if (!hasFeature(state.level, "shop")) throw new GameError("La tienda se abre en el nivel 1.");
      const item = findItem(cmd.itemId);
      if (!item || item.rarity === "P" || item.rarity === "X") throw new GameError("Solo se reservan especiales.");
      if (!state.rotations[today]?.ids.includes(item.id)) throw new GameError("Ese especial no está hoy en la tienda.");
      if (item.minLevel > state.level) throw new GameError(`Necesitas nivel ${item.minLevel}.`);
      if (state.reservations.some((r) => r.state === "active" && r.itemId === item.id)) throw new GameError("Ya tienes una reserva activa de este artículo.");
      if (state.balance >= item.price) throw new GameError("Tienes saldo suficiente: puedes comprarlo directamente.");
      const deposit = reservationDeposit(item.price);
      if (state.balance < deposit) throw new GameError(`La señal es de ${deposit} monedas.`);
      state.seq += 1;
      const id = `res-${state.seq.toString(36)}`;
      state.reservations.push({ id, itemId: item.id, price: item.price, deposit, createdAt: now, expiresAt: now + RESERVATION_HOURS * 3_600_000, state: "active" });
      credit(state, "reservation", id, -deposit, now, `Señal de reserva: ${item.name}`);
      return { message: `Reservado 72 h. Te faltan ${item.price - deposit} monedas.` };
    }

    case "complete_reservation": {
      const r = state.reservations.find((x) => x.id === cmd.id);
      if (!r || r.state !== "active") throw new GameError(r?.state === "expired" ? "La reserva caducó." : "La reserva no está activa.");
      const due = r.price - r.deposit;
      if (state.balance < due) throw new GameError(`Te faltan ${due - state.balance} monedas.`);
      r.state = "completed";
      r.closedAt = now;
      const owned = grantItem(state, r.itemId, "purchase", r.price, now);
      credit(state, "reservation_payment", r.id, -due, now, `Pago de reserva: ${getItem(r.itemId).name}`);
      return { message: `${getItem(owned.itemId).name} al inventario` };
    }

    case "cancel_reservation": {
      const r = state.reservations.find((x) => x.id === cmd.id);
      if (!r || r.state !== "active") throw new GameError("La reserva no está activa.");
      r.state = "cancelled";
      r.closedAt = now;
      return { message: "Reserva cancelada. La señal no se devuelve." };
    }

    case "save_layout": {
      if (!hasFeature(state.level, "editor")) throw new GameError("El editor se abre en el nivel 1.");
      const issues = validateLayout(cmd.placements, state.inventory, state.level, state.expansions);
      if (issues.length) throw new GameError(issues[0]!.reason);
      const styles = { ...state.roomStyles };
      for (const [room, style] of Object.entries(cmd.styles)) {
        getRoom(room);
        const current = state.roomStyles[room] ?? DEFAULT_STYLE;
        for (const kind of ["floor", "wall", "window"] as const) {
          if (style[kind] === current[kind]) continue;
          if (!hasFeature(state.level, "styles") || !availableStyles(state, kind).includes(style[kind]))
            throw new GameError("Ese acabado aún no está disponible.");
          if (!STYLES.some((s) => s.id === style[kind])) throw new GameError("Acabado desconocido.");
        }
        styles[room] = { ...style };
      }
      const facts = saveFacts(state.placements, cmd.placements, state.roomStyles, styles, itemLookup(state));
      state.placements = cmd.placements.map((p) => ({ uid: p.uid, room: p.room, x: p.x, y: p.y, rot: p.rot }));
      state.roomStyles = styles;
      for (const uid of facts.newlyPlaced) if (!state.placedEver.includes(uid)) state.placedEver.push(uid);
      if (facts.changed) state.layoutSaves = [...state.layoutSaves, { at: now, date: today, facts }].slice(-120);
      return { facts };
    }

    case "set_name": {
      const name = cmd.name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
      if (name.length < 2) throw new GameError("Escribe al menos 2 caracteres.");
      if (!hasFeature(state.level, "name")) throw new GameError("Podrás nombrarla en el nivel 1.");
      if (name !== state.name) {
        state.name = name;
        if (!state.nameCustomized) state.nameSaves.push(today);
        state.nameCustomized = true;
      }
      return { message: "Nombre guardado" };
    }

    case "set_cat_name": {
      if (!hasFeature(state.level, "cat")) throw new GameError("El gato llega en el nivel 3.");
      const name = cmd.name.trim().slice(0, 20);
      if (name.length < 1) throw new GameError("Ponle un nombre.");
      state.catName = name;
      return { message: `¡Hola, ${name}!` };
    }

    case "set_showcase": {
      const cap = showcaseCapacity(state);
      if (!cap) throw new GameError("La vitrina se abre en el nivel 1.");
      const ids = [...new Set(cmd.ids)].filter((id) => state.achievements[id]).slice(0, cap);
      const frame = cmd.frame && state.frames.includes(cmd.frame) ? cmd.frame : state.frame;
      if (JSON.stringify(ids) !== JSON.stringify(state.showcase) && !state.showcaseChanges.includes(today)) state.showcaseChanges.push(today);
      state.showcase = ids;
      state.frame = frame;
      return {};
    }

    case "claim_mission": {
      const a = state.missions.find((m) => m.id === cmd.id);
      if (!a) throw new GameError("Misión desconocida.");
      if (!a.completedAt) throw new GameError("Aún no está completada.");
      if (a.claimedAt) return { message: "Ya reclamada." };
      const def = getMission(a.missionId);
      a.claimedAt = now;
      credit(state, "mission", a.id, def.reward, now, `Misión: ${def.name}`);
      return { message: `+${def.reward} monedas` };
    }

    case "set_settings": {
      if (cmd.music) {
        const next = { ...state.settings.music, ...cmd.music, volume: Math.min(1, Math.max(0, cmd.music.volume ?? state.settings.music.volume)) };
        // Solo un cambio real cuenta para la misión (no alternar repetidamente).
        if (JSON.stringify(next) !== JSON.stringify(state.settings.music) && !state.musicSaves.includes(today)) state.musicSaves.push(today);
        state.settings.music = next;
      }
      if (cmd.sfx !== undefined) state.settings.sfx = cmd.sfx;
      if (cmd.sfxVolume !== undefined) state.settings.sfxVolume = Math.min(1, Math.max(0, cmd.sfxVolume));
      if (cmd.publish !== undefined) state.settings.publish = cmd.publish;
      if (cmd.alias !== undefined) state.settings.alias = cmd.alias.trim().slice(0, 24);
      return {};
    }

    case "buy_expansion": {
      if (state.processedRequests.includes(cmd.requestId)) return { message: "Ampliación ya procesada." };
      const spec = getRoom(cmd.room);
      if (spec.level > state.level || state.level < 1) throw new GameError("Esa sala aún no está desbloqueada.");
      const bought = state.expansions[spec.id] ?? 0;
      const price = nextExpansionPrice(spec.id, bought);
      if (price === null) throw new GameError("Esta sala ya tiene el tamaño máximo.");
      if (state.balance < price) throw new GameError(`Necesitas ${price} monedas.`);
      credit(state, "expansion", `${spec.id}:${bought + 1}`, -price, now, `Ampliación: ${spec.name}`);
      state.expansions[spec.id] = bought + 1;
      state.processedRequests = [...state.processedRequests, cmd.requestId].slice(-MAX_REQUEST_LOG);
      const room = roomAt(spec.id, state.level, bought + 1);
      celebrate(state, { id: `buy:${spec.id}:${bought + 1}`, type: "expansion", room: spec.id, w: room.w, h: room.h, auto: false });
      return { message: `${spec.name}: ahora ${room.w} × ${room.h}` };
    }

    case "cat_nap_seen": {
      if (!hasFeature(state.level, "cat")) return {};
      state.catNapSeen = true;
      return {};
    }

    case "vacation_start": {
      const plan = planVacation(state.vacations, reportDates(state), today);
      if ("error" in plan) throw new GameError(plan.error);
      state.seq += 1;
      state.vacations.push({ id: `vac-${state.seq.toString(36)}`, start: plan.start, plannedEnd: plan.end, createdAt: now });
      return { message: `Vacaciones del ${plan.start} al ${plan.end} como máximo.` };
    }

    case "vacation_end": {
      const v = activeVacation(state.vacations, reportDates(state), today);
      if (!v) throw new GameError("No tienes vacaciones activas.");
      v.end = addDays(today, -1);
      v.closedReason = "manual";
      if (v.end < v.start) state.vacations = state.vacations.filter((x) => x !== v);
      return { message: "Vacaciones terminadas. ¡Bienvenido de vuelta!" };
    }

    // ------------------------------------------------------------ modo desarrollador
    case "dev_set_level": {
      const level = Math.max(0, Math.min(MAX_LEVEL, Math.floor(cmd.level)));
      state.validReportCount = LEVELS[level]!.reports;
      applyLevel(state, now, today);
      state.level = level;
      return { message: `Nivel ${level}` };
    }
    case "dev_coins": {
      state.seq += 1;
      const delta = Math.max(-state.balance, Math.round(cmd.delta));
      credit(state, "dev", `coins-${state.seq}`, delta, now, "Ajuste del modo desarrollador");
      return {};
    }
    case "dev_clock": {
      state.devClockOffset = cmd.offsetMs;
      return {};
    }
    case "dev_report_days": {
      // Reportes válidos simulados en los últimos N días (incluido hoy) para probar rachas.
      const perDay = Math.max(1, Math.min(5, cmd.perDay ?? 1));
      for (let i = cmd.days - 1; i >= 0; i--) {
        const date = addDays(today, -i);
        for (let k = 0; k < perDay; k++) {
          state.seq += 1;
          const at = Math.min(now, Date.parse(`${date}T10:00:00Z`) + k * 60_000);
          apply(state, { type: "report_valid", reportId: `sim-${state.seq}`, libraryId: "simulada", at, simulated: true }, now, today);
        }
      }
      return { message: `Simulados ${cmd.days} días con reporte` };
    }
    case "dev_complete_mission": {
      const a = state.missions.find((m) => m.id === cmd.id);
      if (a && !a.completedAt) a.completedAt = now;
      return {};
    }
    case "dev_reset_missions": {
      const key = cmd.period === "daily" ? today : weekStart(today);
      state.missions = state.missions.filter((m) => !(m.period === cmd.period && m.periodKey === key));
      for (const k of Object.keys(state.community)) if (k.startsWith(`${key}:`) && cmd.period === "weekly") delete state.community[k];
      return { message: "Misiones reasignadas" };
    }
    case "dev_unlock_achievement": {
      unlockAchievement(state, cmd.id, now);
      return {};
    }
    case "dev_grant_item": {
      grantItem(state, getItem(cmd.itemId).id, "dev", 0, now);
      return { message: `${getItem(cmd.itemId).name} al inventario` };
    }
    case "dev_community": {
      const instance = state.community[cmd.missionId];
      if (instance) instance.devBonus += cmd.amount;
      return {};
    }
    case "dev_admin_refund": {
      // Retirada administrativa o error del sistema: la señal sí se devuelve.
      const r = state.reservations.find((x) => x.id === cmd.id);
      if (!r || r.state !== "active") throw new GameError("La reserva no está activa.");
      r.state = "refunded";
      r.closedAt = now;
      credit(state, "reservation_refund", r.id, r.deposit, now, "Reembolso de señal (retirada administrativa)");
      return { message: "Señal reembolsada" };
    }
    case "dev_reset":
      return {};
  }
}

export interface DispatchOutcome {
  state: GameState;
  result: CommandResult;
}

/**
 * Ejecuta un comando de forma transaccional: o se aplica entero o el estado queda igual.
 * `ctx.now` es el reloj del servidor; en pruebas incluye el desplazamiento del modo desarrollador.
 */
export function dispatch(prev: GameState, cmd: Command, ctx: Ctx): DispatchOutcome {
  if (cmd.type === "dev_reset") return { state: initialState(prev.userId, ctx.now), result: { ok: true, message: "Progreso reiniciado" } };
  const state = migrateState(structuredClone(prev));
  const now = ctx.now;
  const today = madridDateKey(now);
  try {
    settle(state, now, today);
    if (cmd.type === "ack_celebration") state.celebrations = state.celebrations.filter((c) => c.id !== cmd.id);
    const { message, facts } = apply(state, cmd, now, today);
    // Si el nivel bajó (reporte anulado, modo desarrollador), lo que ya no cabe vuelve al inventario.
    fitPlacements(state, now);
    settle(state, now, today, facts);
    return { state, result: { ok: true, message } };
  } catch (err) {
    if (err instanceof GameError) return { state: prev, result: { ok: false, error: err.message } };
    throw err;
  }
}

export function gameNow(state: Pick<GameState, "devClockOffset">, realNow: number): number {
  return realNow + state.devClockOffset;
}

export { DAY_MS };
