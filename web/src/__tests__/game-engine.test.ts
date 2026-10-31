import { describe, expect, it } from "vitest";
import { ACHIEVEMENTS } from "@/game/data/achievements";
import { ALL_ITEMS, EXCLUSIVE_ITEMS, getItem, PERMANENT_ITEMS, SPECIAL_ITEMS } from "@/game/data/catalog";
import { LEVELS, roomAt, roomMax, ROOMS } from "@/game/data/levels";
import { DAILY_MISSIONS, getMission, WEEKLY_MISSIONS } from "@/game/data/missions";
import { NEIGHBORS } from "@/game/data/neighbors";
import { coinsForOrdinal, dispatch, initialState, migrateState, type Command, type GameState } from "@/game/engine";
import { validateLayout } from "@/game/engine/layout";
import { drawRotation, rotationFor } from "@/game/engine/shop";
import { computeStreak } from "@/game/engine/streak";
import { addDays, madridDateKey, madridMidnightMs } from "@/game/time";

// Martes 3 de noviembre de 2026, 12:00 en Madrid.
const T0 = Date.parse("2026-11-03T11:00:00Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function run(state: GameState, cmd: Command, now = T0) {
  const out = dispatch(state, cmd, { now });
  return out;
}

function ok(state: GameState, cmd: Command, now = T0): GameState {
  const out = run(state, cmd, now);
  if (!out.result.ok) throw new Error(`${cmd.type}: ${out.result.error}`);
  return out.state;
}

function report(state: GameState, id: string, now = T0, libraryId = "lib-1"): GameState {
  return ok(state, { type: "report_valid", reportId: id, libraryId }, now);
}

function withReports(n: number, now = T0): GameState {
  let s = initialState("tester", now);
  for (let i = 0; i < n; i++) s = report(s, `r${i}`, now);
  return s;
}

describe("catálogo y datos", () => {
  it("tiene los totales exactos de la especificación", () => {
    expect(PERMANENT_ITEMS).toHaveLength(90);
    expect(SPECIAL_ITEMS).toHaveLength(60);
    expect(SPECIAL_ITEMS.filter((i) => i.rarity === "R")).toHaveLength(24);
    expect(SPECIAL_ITEMS.filter((i) => i.rarity === "E")).toHaveLength(20);
    expect(SPECIAL_ITEMS.filter((i) => i.rarity === "L")).toHaveLength(16);
    expect(LEVELS).toHaveLength(16);
    expect(DAILY_MISSIONS).toHaveLength(45);
    expect(WEEKLY_MISSIONS).toHaveLength(30);
    expect(ACHIEVEMENTS).toHaveLength(40);
    expect(ACHIEVEMENTS.filter((a) => a.secret)).toHaveLength(5);
    expect(new Set(ALL_ITEMS.map((i) => i.id)).size).toBe(ALL_ITEMS.length);
  });

  it("respeta rangos de precio por rareza y la suma de 830 monedas de nivel", () => {
    for (const i of PERMANENT_ITEMS) {
      expect(i.price).toBeGreaterThanOrEqual(5);
      expect(i.price).toBeLessThanOrEqual(60);
    }
    for (const i of SPECIAL_ITEMS) {
      const [min, max] = { R: [40, 70], E: [80, 130], L: [150, 250] }[i.rarity as "R" | "E" | "L"];
      expect(i.price).toBeGreaterThanOrEqual(min!);
      expect(i.price).toBeLessThanOrEqual(max!);
    }
    expect(LEVELS.reduce((n, l) => n + l.coins, 0)).toBe(830);
    expect(LEVELS.map((l) => l.reports)).toEqual([0, 1, 3, 6, 10, 16, 25, 35, 48, 65, 100, 125, 155, 190, 240, 300]);
  });

  it("recompensas de misiones: diarias 5/8/12, semanales 20–60", () => {
    for (const m of DAILY_MISSIONS) expect([5, 8, 12]).toContain(m.reward);
    for (const m of WEEKLY_MISSIONS) expect([20, 30, 40, 50, 60]).toContain(m.reward);
    expect(WEEKLY_MISSIONS.filter((m) => m.category === "community")).toHaveLength(8);
  });

  it("todos los regalos colocados de nivel caben sin colisiones", () => {
    const s = ok(initialState("t", T0), { type: "dev_set_level", level: 15 });
    expect(validateLayout(s.placements, s.inventory, 15)).toEqual([]);
    const placedGifts = LEVELS.flatMap((l) => l.gifts.flatMap((g) => g.place ?? []));
    expect(s.placements).toHaveLength(placedGifts.length);
  });

  it("las bibliotecas vecinas ficticias son distribuciones válidas", () => {
    for (const n of NEIGHBORS) {
      const inventory = n.placements.map((p, i) => ({ uid: `u${i}`, itemId: p.itemId, source: "dev" as const, paid: 0, resellable: false, acquiredAt: 0 }));
      const placements = n.placements.map((p, i) => ({ uid: `u${i}`, room: p.room, x: p.x, y: p.y, rot: p.rot }));
      expect(validateLayout(placements, inventory, 15), n.alias).toEqual([]);
    }
  });
});

describe("niveles y reportes (§14.1–3)", () => {
  it("cuenta nueva: L0, 0 monedas, biblioteca vacía", () => {
    const s = ok(initialState("t", T0), { type: "tick" });
    expect(s.level).toBe(0);
    expect(s.balance).toBe(0);
    expect(s.placements).toEqual([]);
    expect(s.missions).toEqual([]);
  });

  it("primer reporte válido: L1, 10 + 10 monedas + logro A01, sala y vitrina; repetir no duplica", () => {
    let s = report(initialState("t", T0), "rep-1");
    expect(s.level).toBe(1);
    const coinsFrom = (src: string) => s.ledger.filter((e) => e.source === src).reduce((n, e) => n + e.delta, 0);
    expect(coinsFrom("report")).toBe(10);
    expect(coinsFrom("level")).toBe(10);
    expect(s.achievements.A01).toBeDefined();
    expect(s.placements.map((p) => s.inventory.find((o) => o.uid === p.uid)!.itemId).sort()).toEqual(["P001", "P011", "P011", "P021", "X01"]);
    const balance = s.balance;
    s = report(s, "rep-1");
    expect(s.balance).toBe(balance);
    expect(s.validReportCount).toBe(1);
  });

  it("monedas por orden del día: 10/8/6/5/3/3 y reinicio al día siguiente", () => {
    expect([1, 2, 3, 4, 5, 6].map(coinsForOrdinal)).toEqual([10, 8, 6, 5, 3, 3]);
    let s = initialState("t", T0);
    for (let i = 0; i < 6; i++) s = report(s, `a${i}`, T0 + i * 1000);
    expect(s.reports.map((r) => r.coins)).toEqual([10, 8, 6, 5, 3, 3]);
    s = report(s, "b0", T0 + DAY);
    expect(s.reports.at(-1)!.coins).toBe(10);
  });

  it("el día es el de Madrid: 23:30 y 00:30 locales son días distintos; el cambio de hora no duplica", () => {
    // 25 oct 2026: termina el horario de verano (03:00 → 02:00).
    const late = Date.parse("2026-10-24T21:30:00Z"); // 23:30 del 24 en Madrid
    const early = Date.parse("2026-10-24T22:30:00Z"); // 00:30 del 25 en Madrid
    expect(madridDateKey(late)).toBe("2026-10-24");
    expect(madridDateKey(early)).toBe("2026-10-25");
    expect(madridMidnightMs("2026-10-26") - madridMidnightMs("2026-10-25")).toBe(25 * HOUR);
    expect(madridMidnightMs("2026-03-30") - madridMidnightMs("2026-03-29")).toBe(23 * HOUR);
  });

  it("cada umbral concede su nivel una sola vez y L5/L10/L15 abren salas sin borrar nada", () => {
    let s = initialState("t", T0);
    for (let i = 0; i < 300; i++) {
      s = report(s, `x${i}`, T0 + Math.floor(i / 5) * DAY);
      const expected = [...LEVELS].reverse().find((l) => i + 1 >= l.reports)!.level;
      expect(s.level).toBe(expected);
    }
    expect(s.ledger.filter((e) => e.source === "level")).toHaveLength(15);
    expect(s.ledger.filter((e) => e.source === "level").reduce((n, e) => n + e.delta, 0)).toBe(830);
    expect(s.placements.filter((p) => p.room === "r1").length).toBeGreaterThanOrEqual(10);
    expect(s.celebrations.filter((c) => c.type === "room").map((c) => (c as { room: string }).room)).toEqual(["r2", "r3", "r4"]);
    expect(s.badges).toContain("nivel-maximo");
  });

  it("subir varios niveles de golpe entrega cada premio exactamente una vez", () => {
    const s = ok(initialState("t", T0), { type: "dev_set_level", level: 5 });
    expect(s.ledger.filter((e) => e.source === "level").map((e) => e.sourceId)).toEqual(["1", "2", "3", "4", "5"]);
    const again = ok(ok(s, { type: "dev_set_level", level: 2 }), { type: "dev_set_level", level: 5 });
    expect(again.ledger.filter((e) => e.source === "level")).toHaveLength(5);
  });

  it("un reporte anulado no deja saldo negativo ni duplica premios", () => {
    let s = report(initialState("t", T0), "bad");
    s = ok(s, { type: "dev_coins", delta: -s.balance });
    s = ok(s, { type: "report_invalidated", reportId: "bad" });
    expect(s.balance).toBe(0);
    expect(s.validReportCount).toBe(0);
    expect(s.level).toBe(0);
  });
});

describe("inventario, tienda y reventa (§14.4–5, 8, 9)", () => {
  const rich = () => ok(ok(initialState("t", T0), { type: "dev_set_level", level: 15 }), { type: "dev_coins", delta: 5000 });

  it("comprar dos iguales descuenta dos veces y crea dos instancias; vender devuelve floor(p/2) una vez", () => {
    let s = rich();
    const before = s.balance;
    s = ok(s, { type: "purchase", itemId: "P012", qty: 2, requestId: "req-1" });
    expect(s.balance).toBe(before - 14);
    const bought = s.inventory.filter((o) => o.itemId === "P012");
    expect(bought).toHaveLength(2);
    // Reintento con el mismo request_id: idempotente.
    s = ok(s, { type: "purchase", itemId: "P012", qty: 2, requestId: "req-1" });
    expect(s.inventory.filter((o) => o.itemId === "P012")).toHaveLength(2);
    s = ok(s, { type: "sell", uid: bought[0]!.uid });
    expect(s.balance).toBe(before - 14 + 3);
    expect(run(s, { type: "sell", uid: bought[0]!.uid }).result.ok).toBe(false);
  });

  it("los regalos de nivel no se venden ni generan saldo", () => {
    const s = rich();
    const gift = s.inventory.find((o) => o.source === "level_reward")!;
    expect(gift.resellable).toBe(false);
    expect(run(s, { type: "sell", uid: gift.uid }).result).toEqual({ ok: false, error: "Los regalos no se pueden vender." });
  });

  it("no se compra por encima del nivel ni sin saldo; en L0 la tienda está cerrada", () => {
    const l0 = ok(initialState("t", T0), { type: "dev_coins", delta: 100 });
    expect(run(l0, { type: "purchase", itemId: "P011", qty: 1, requestId: "a" }).result.ok).toBe(false);
    const l1 = ok(initialState("t", T0), { type: "dev_set_level", level: 1 });
    expect(run(l1, { type: "purchase", itemId: "P090", qty: 1, requestId: "b" }).result).toEqual({ ok: false, error: "Necesitas nivel 12." });
    expect(run(l1, { type: "purchase", itemId: "P008", qty: 1, requestId: "c" }).result).toEqual({ ok: false, error: "No tienes monedas suficientes." });
  });

  it("rechaza colocar en celdas ocupadas, puertas, salas bloqueadas o muebles ajenos; permite recolocar", () => {
    let s = ok(ok(initialState("t", T0), { type: "dev_set_level", level: 1 }), { type: "dev_coins", delta: 100 });
    s = ok(s, { type: "purchase", itemId: "P011", qty: 1, requestId: "c1" });
    const chair = s.inventory.find((o) => o.itemId === "P011" && o.source === "purchase")!;
    const save = (extra: object) => run(s, { type: "save_layout", placements: [...s.placements, { uid: chair.uid, rot: 0, ...extra } as never], styles: {} });
    expect(save({ room: "r1", x: 3, y: 3 }).result).toEqual({ ok: false, error: "Choca con otro mueble." });
    expect(save({ room: "r1", x: 0, y: 6 }).result).toEqual({ ok: false, error: "Bloquea la puerta." });
    expect(save({ room: "r2", x: 3, y: 3 }).result).toEqual({ ok: false, error: "Esa sala aún no está desbloqueada." });
    expect(save({ room: "r1", x: 10, y: 0 }).result).toEqual({ ok: false, error: "Se sale de la sala." });
    expect(run(s, { type: "save_layout", placements: [...s.placements, { uid: "ajeno", room: "r1", x: 6, y: 6, rot: 0 }], styles: {} }).result.ok).toBe(false);
    s = save({ room: "r1", x: 6, y: 6 }).state;
    expect(s.placements.some((p) => p.uid === chair.uid)).toBe(true);
    // Recolocar y guardar en el inventario no cuesta nada.
    const balance = s.balance;
    s = ok(s, { type: "save_layout", placements: s.placements.filter((p) => p.uid !== chair.uid), styles: {} });
    expect(s.balance).toBe(balance);
  });

  it("objetos pequeños sobre superficies sí, sobre sillas no", () => {
    let s = ok(ok(initialState("t", T0), { type: "dev_set_level", level: 7 }), { type: "dev_coins", delta: 500 });
    s = ok(s, { type: "purchase", itemId: "P071", qty: 1, requestId: "pc" });
    const pc = s.inventory.find((o) => o.itemId === "P071")!;
    const onTable = run(s, { type: "save_layout", placements: [...s.placements, { uid: pc.uid, room: "r1", x: 3, y: 3, rot: 0 }], styles: {} });
    expect(onTable.result.ok).toBe(true);
    const onChair = run(s, { type: "save_layout", placements: [...s.placements, { uid: pc.uid, room: "r1", x: 2, y: 3, rot: 0 }], styles: {} });
    expect(onChair.result).toEqual({ ok: false, error: "No cabe encima de ese mueble." });
  });

  it("rotación: 3 especiales globales iguales para todos, cambian a medianoche de Madrid y siempre uno de L1", () => {
    const a = ok(initialState("ana", T0), { type: "tick" });
    const b = ok(initialState("beto", T0), { type: "tick" });
    const today = madridDateKey(T0);
    expect(a.rotations[today]!.ids).toHaveLength(3);
    expect(a.rotations[today]!.ids).toEqual(b.rotations[today]!.ids);
    const beforeMidnight = madridMidnightMs(addDays(today, 1)) - 1000;
    const after = madridMidnightMs(addDays(today, 1)) + 1000;
    expect(madridDateKey(beforeMidnight)).toBe(today);
    expect(ok(a, { type: "tick" }, after).rotations[addDays(today, 1)]).toBeDefined();
    let date = "2026-11-02";
    for (let i = 0; i < 200; i++, date = addDays(date, 1)) {
      const ids = drawRotation(date, new Set());
      expect(new Set(ids).size).toBe(3);
      expect(ids.some((id) => getItem(id).minLevel === 1)).toBe(true);
    }
  });

  it("rotación: frecuencias por hueco ≈ 60/30/10 y tope de L10 el primer mes", () => {
    const counts = { R: 0, E: 0, L: 0 };
    let date = "2027-01-01";
    const n = 3000;
    for (let i = 0; i < n; i++, date = addDays(date, 1)) for (const id of drawRotation(date, new Set())) counts[getItem(id).rarity as "R"]++;
    expect(counts.R / (3 * n)).toBeCloseTo(0.6, 1);
    expect(counts.E / (3 * n)).toBeCloseTo(0.3, 1);
    expect(counts.L / (3 * n)).toBeCloseTo(0.1, 1);
    for (let d = "2026-11-02", i = 0; i < 30; i++, d = addDays(d, 1)) for (const id of drawRotation(d, new Set())) expect(getItem(id).minLevel).toBeLessThanOrEqual(10);
  });

  it("la rotación publicada no cambia al refrescar y evita repetir piezas de los 3 días anteriores", () => {
    const snaps: Record<string, { ids: string[] }> = {};
    let date = "2027-03-01";
    for (let i = 0; i < 40; i++, date = addDays(date, 1)) {
      const ids = rotationFor(date, snaps);
      expect(rotationFor(date, { ...snaps, [date]: { ids } })).toEqual(ids);
      const recent = [1, 2, 3].flatMap((k) => snaps[addDays(date, -k)]?.ids ?? []);
      for (const id of ids) expect(recent).not.toContain(id);
      snaps[date] = { ids };
    }
  });

  it("especiales comprados siguen en el inventario al cambiar el día", () => {
    let s = ok(ok(initialState("t", T0), { type: "dev_set_level", level: 15 }), { type: "dev_coins", delta: 5000 });
    const special = s.rotations[madridDateKey(T0)]!.ids[0]!;
    s = ok(s, { type: "purchase", itemId: special, qty: 2, requestId: "sp" });
    s = ok(s, { type: "tick" }, T0 + 3 * DAY);
    expect(s.inventory.filter((o) => o.itemId === special)).toHaveLength(2);
    expect(run(s, { type: "purchase", itemId: special, qty: 1, requestId: "sp2" }, T0 + 3 * DAY).result.ok).toBe(s.rotations[madridDateKey(T0 + 3 * DAY)]!.ids.includes(special));
  });

  it("reserva: señal del 10 % hacia arriba, 72 h, pago del resto y caducidad", () => {
    let s = ok(initialState("t", T0), { type: "dev_set_level", level: 15 });
    const special = s.rotations[madridDateKey(T0)]!.ids.find((id) => getItem(id).minLevel <= 15)!;
    const price = getItem(special).price;
    s = ok(s, { type: "dev_coins", delta: -s.balance + Math.ceil(price * 0.1) + 1 });
    s = ok(s, { type: "reserve", itemId: special });
    const r = s.reservations[0]!;
    expect(r.deposit).toBe(Math.ceil(price * 0.1));
    expect(r.expiresAt - T0).toBe(72 * HOUR);
    expect(run(s, { type: "reserve", itemId: special }).result.ok).toBe(false);
    // Pagar justo en el vencimiento falla: gana la caducidad del servidor.
    s = ok(s, { type: "dev_coins", delta: price });
    expect(run(s, { type: "complete_reservation", id: r.id }, r.expiresAt).result).toEqual({ ok: false, error: "La reserva caducó." });
    const paid = ok(s, { type: "complete_reservation", id: r.id }, r.expiresAt - 1);
    expect(paid.inventory.filter((o) => o.itemId === special)).toHaveLength(1);
    expect(paid.inventory.find((o) => o.itemId === special)!.paid).toBe(price);
    expect(run(paid, { type: "complete_reservation", id: r.id }, r.expiresAt - 1).result.ok).toBe(false);
  });

  it("reserva: retirada administrativa reembolsa la señal; cancelar no", () => {
    let s = ok(initialState("t", T0), { type: "dev_set_level", level: 15 });
    const special = s.rotations[madridDateKey(T0)]!.ids[0]!;
    s = ok(s, { type: "dev_coins", delta: -s.balance + 30 });
    s = ok(s, { type: "reserve", itemId: special });
    const deposit = s.reservations[0]!.deposit;
    const refunded = ok(s, { type: "dev_admin_refund", id: s.reservations[0]!.id });
    expect(refunded.balance).toBe(30);
    const cancelled = ok(s, { type: "cancel_reservation", id: s.reservations[0]!.id });
    expect(cancelled.balance).toBe(30 - deposit);
  });
});

describe("misiones (§14.6–7)", () => {
  it("asigna 3 diarias (contribución, decoración, exploración) y 5 semanales con 1–2 comunitarias", () => {
    for (let k = 0; k < 20; k++) {
      const s = ok(initialState(`user-${k}`, T0), { type: "dev_set_level", level: 1 + (k % 15) });
      const today = madridDateKey(T0);
      const daily = s.missions.filter((m) => m.period === "daily" && m.periodKey === today);
      expect(daily).toHaveLength(3);
      const defs = daily.map((m) => getMission(m.missionId));
      expect(defs.filter((d) => d.equivalence === "report1")).toHaveLength(1);
      for (const d of defs) expect(d.minLevel).toBeLessThanOrEqual(s.level);
      const weekly = s.missions.filter((m) => m.period === "weekly");
      expect(weekly).toHaveLength(5);
      const community = weekly.filter((m) => getMission(m.missionId).category === "community").length;
      expect(community).toBeGreaterThanOrEqual(1);
      expect(community).toBeLessThanOrEqual(2);
    }
  });

  it("no repite una diaria de los 3 días anteriores", () => {
    let s = ok(initialState("u", T0), { type: "dev_set_level", level: 9 });
    const byDay: string[][] = [];
    for (let d = 0; d < 12; d++) {
      s = ok(s, { type: "tick" }, T0 + d * DAY);
      const key = madridDateKey(T0 + d * DAY);
      byDay.push(s.missions.filter((m) => m.period === "daily" && m.periodKey === key && !m.fallback).map((m) => m.missionId));
    }
    for (let d = 3; d < byDay.length; d++) for (const id of byDay[d]!) for (const prev of byDay.slice(d - 3, d)) expect(prev).not.toContain(id);
  });

  it("completar la de reporte con un reporte válido y reclamarla una sola vez", () => {
    let s = ok(initialState("u", T0), { type: "dev_set_level", level: 1 });
    const contrib = s.missions.find((m) => m.period === "daily" && getMission(m.missionId).category === "contribution")!;
    s = report(s, "m1");
    expect(s.missions.find((m) => m.id === contrib.id)!.completedAt).toBeDefined();
    const before = s.balance;
    s = ok(s, { type: "claim_mission", id: contrib.id });
    expect(s.balance).toBe(before + getMission(contrib.missionId).reward);
    s = ok(s, { type: "claim_mission", id: contrib.id });
    expect(s.balance).toBe(before + getMission(contrib.missionId).reward);
  });

  it("comunitaria: sin contribución no cobra; con contribución cobra solo si se alcanza el objetivo", () => {
    let s = ok(initialState("u", T0), { type: "dev_set_level", level: 1 });
    const community = s.missions.find((m) => getMission(m.missionId).category === "community")!;
    s = ok(s, { type: "dev_community", missionId: community.id, amount: 999 });
    expect(s.missions.find((m) => m.id === community.id)!.completedAt).toBeUndefined();
    s = report(s, "c1", T0, community.library?.id ?? "lib-1");
    expect(s.missions.find((m) => m.id === community.id)!.completedAt).toBeDefined();
    const target = s.community[community.id]!.target;
    expect(ok(s, { type: "tick" }, T0 + DAY).community[community.id]!.target).toBe(target);
  });

  it("la misión de decoración solo avanza con cambios reales", () => {
    let s = ok(initialState("u", T0), { type: "dev_set_level", level: 1 });
    s.missions = s.missions.filter((m) => m.period === "weekly");
    s.missions.push({ id: `${madridDateKey(T0)}:D19`, missionId: "D19", period: "daily", periodKey: madridDateKey(T0), assignedAt: T0, target: 1 });
    s = ok(s, { type: "save_layout", placements: s.placements, styles: {} });
    expect(s.missions.find((m) => m.missionId === "D19")!.completedAt).toBeUndefined();
    const moved = s.placements.map((p) => (p.uid.startsWith("P011") && p.x === 5 ? { ...p, x: 6 } : p));
    s = ok(s, { type: "save_layout", placements: moved, styles: {} });
    expect(s.missions.find((m) => m.missionId === "D19")!.completedAt).toBeDefined();
  });
});

describe("rachas, protectores y vacaciones (§14.10)", () => {
  const dates = (start: string, n: number) => Array.from({ length: n }, (_, i) => addDays(start, i));

  it("una semana natural completa da 1 protector, máximo 5", () => {
    // 2 nov 2026 es lunes.
    const seven = computeStreak(new Set(dates("2026-11-02", 7)), [], "2026-11-08");
    expect(seven.protectors).toBe(1);
    const crossing = computeStreak(new Set(dates("2026-11-04", 7)), [], "2026-11-10");
    expect(crossing.protectors).toBe(0);
    const many = computeStreak(new Set(dates("2026-11-02", 7 * 7)), [], addDays("2026-11-02", 48));
    expect(many.protectors).toBe(5);
  });

  it("una ausencia consume un protector y mantiene la racha sin incrementarla", () => {
    const days = new Set([...dates("2026-11-02", 7), "2026-11-10"]);
    const s = computeStreak(days, [], "2026-11-10");
    expect(s.consumedDates).toEqual(["2026-11-09"]);
    expect(s.current).toBe(8);
    const broken = computeStreak(new Set([...dates("2026-11-02", 7), "2026-11-11"]), [], "2026-11-11");
    expect(broken.current).toBe(1);
  });

  it("hoy sin reporte aún no rompe la racha", () => {
    const s = computeStreak(new Set(dates("2026-11-01", 3)), [], "2026-11-04");
    expect(s.current).toBe(3);
    expect(s.reportedToday).toBe(false);
  });

  it("vacaciones: congelan sin gastar protector, máximo 14 seguidos y 30 por año", () => {
    let s = ok(initialState("u", T0), { type: "dev_report_days", days: 5 });
    expect(s.streak.current).toBe(5);
    s = ok(s, { type: "vacation_start" });
    const vac = s.vacations[0]!;
    expect(vac.start).toBe(addDays(madridDateKey(T0), 1));
    expect(addDays(vac.start, 13)).toBe(vac.plannedEnd);
    // 10 días después, sin reportar, la racha sigue en 5 y sin protectores consumidos.
    s = ok(s, { type: "tick" }, T0 + 10 * DAY);
    expect(s.streak.current).toBe(5);
    expect(s.streak.consumedDates).toEqual([]);
    // Volver con un reporte: suma y cierra las vacaciones.
    s = report(s, "back", T0 + 10 * DAY);
    expect(s.streak.current).toBe(6);
    expect(s.vacations[0]!.end).toBe(addDays(madridDateKey(T0), 9));
    // Agotar el año: 9 + 14 + quedan 7.
    s = ok(s, { type: "vacation_start" }, T0 + 11 * DAY);
    s = report(s, "back2", T0 + 26 * DAY);
    s = ok(s, { type: "vacation_start" }, T0 + 27 * DAY);
    const last = s.vacations.at(-1)!;
    expect(Math.round((Date.parse(last.plannedEnd) - Date.parse(last.start)) / DAY) + 1).toBe(30 - 9 - 14);
  });

  it("los hitos de racha pagan una vez y la de 30 días da su premio exclusivo", () => {
    let s = ok(initialState("u", T0), { type: "dev_report_days", days: 30 });
    expect(s.streak.best).toBe(30);
    expect(s.ledger.filter((e) => e.source === "streak").map((e) => e.delta)).toEqual([15, 30, 50, 100]);
    expect(s.inventory.some((o) => o.itemId === "X09")).toBe(true);
    s = ok(s, { type: "tick" }, T0 + 5 * DAY);
    expect(s.ledger.filter((e) => e.source === "streak")).toHaveLength(4);
  });

  it("un reporte validado tarde recalcula el día correcto", () => {
    let s = ok(initialState("u", T0), { type: "dev_report_days", days: 3 });
    s = ok(s, { type: "tick" }, T0 + 2 * DAY);
    expect(s.streak.current).toBe(0);
    // Llega tarde la validación del reporte de ayer (hecho a su hora): la racha se recupera.
    s = ok(s, { type: "report_valid", reportId: "late", libraryId: "l", at: T0 + DAY }, T0 + 2 * DAY);
    expect(s.streak.current).toBe(4);
  });
});

describe("logros (§14.11)", () => {
  it("los secretos solo se desbloquean una vez y entregan su premio", () => {
    let s = ok(initialState("u", T0), { type: "dev_set_level", level: 3 });
    s = ok(s, { type: "cat_nap_seen" });
    expect(s.achievements.A36).toBeDefined();
    expect(s.inventory.filter((o) => o.itemId === "X13")).toHaveLength(1);
    s = ok(s, { type: "cat_nap_seen" });
    expect(s.inventory.filter((o) => o.itemId === "X13")).toHaveLength(1);
    expect(s.ledger.filter((e) => e.key === "achievement:A36")).toHaveLength(1);
  });

  it("vitrina: hasta 3 trofeos desde L1 y 8 desde L11", () => {
    let s = ok(initialState("u", T0), { type: "dev_set_level", level: 1 });
    for (const id of ["A01", "A02", "A03", "A04"]) s = ok(s, { type: "dev_unlock_achievement", id });
    s = ok(s, { type: "set_showcase", ids: ["A01", "A02", "A03", "A04"] });
    expect(s.showcase).toHaveLength(3);
    expect(s.achievements.A26).toBeDefined();
    s = ok(s, { type: "dev_set_level", level: 11 });
    s = ok(s, { type: "set_showcase", ids: ["A01", "A02", "A03", "A04"] });
    expect(s.showcase).toHaveLength(4);
  });

  it("visitas y me gusta: IDs distintos, un like por biblioteca", () => {
    let s = ok(initialState("u", T0), { type: "dev_set_level", level: 1 });
    s = ok(s, { type: "visit_virtual", ownerId: NEIGHBORS[0]!.id });
    s = ok(s, { type: "visit_virtual", ownerId: NEIGHBORS[0]!.id });
    expect(s.virtualVisits).toHaveLength(1);
    expect(s.achievements.A30).toBeDefined();
    s = ok(s, { type: "like", ownerId: NEIGHBORS[0]!.id, liked: true });
    s = ok(s, { type: "like", ownerId: NEIGHBORS[0]!.id, liked: false });
    s = ok(s, { type: "like", ownerId: NEIGHBORS[0]!.id, liked: true });
    expect(s.likeLog).toHaveLength(1);
    expect(run(s, { type: "visit_virtual", ownerId: "privada" }).result.ok).toBe(false);
  });
});

describe("salas amplias y ampliaciones", () => {
  it("crecen solas al subir de nivel, solo hacia +x/+y y con un máximo fijo en L15", () => {
    for (const spec of ROOMS) {
      let prev = roomAt(spec.id, spec.level);
      for (let level = spec.level; level <= 15; level++) {
        const r = roomAt(spec.id, level);
        expect(r.w).toBeGreaterThanOrEqual(prev.w);
        expect(r.h).toBeGreaterThanOrEqual(prev.h);
        // Puerta, escalera y ventanas ya visibles no cambian de sitio.
        expect(r.door).toBe(spec.door);
        for (const win of prev.windows) expect(r.windows).toContainEqual(win);
        prev = r;
      }
      expect(roomAt(spec.id, 15, 99)).toEqual(roomMax(spec.id));
    }
    expect(roomAt("r1", 1).w * roomAt("r1", 1).h).toBeGreaterThan(64);
    expect(roomMax("r4").w * roomMax("r4").h).toBeGreaterThanOrEqual(18 * 16);
  });

  it("al crecer conserva todos los muebles y avisa de la ampliación", () => {
    let s = withReports(5);
    const before = s.placements.map((p) => ({ ...p }));
    s = withReportsFrom(s, 6 - 5);
    expect(s.level).toBe(3);
    for (const p of before) expect(s.placements).toContainEqual(p);
    expect(s.celebrations.some((c) => c.type === "expansion" && c.room === "r1" && c.auto)).toBe(true);
  });

  it("ampliación comprable: precio creciente, idempotente, límite y nunca obligatoria", () => {
    let s = ok(ok(initialState("t", T0), { type: "dev_set_level", level: 5 }), { type: "dev_coins", delta: 1000 });
    expect(run(s, { type: "buy_expansion", room: "r3", requestId: "x" }).result.ok).toBe(false);
    const coins = s.balance;
    s = ok(s, { type: "buy_expansion", room: "r1", requestId: "e1" });
    s = ok(s, { type: "buy_expansion", room: "r1", requestId: "e1" });
    expect(s.expansions.r1).toBe(1);
    expect(s.balance).toBe(coins - 150);
    s = ok(s, { type: "buy_expansion", room: "r1", requestId: "e2" });
    expect(s.balance).toBe(coins - 450);
    expect(run(s, { type: "buy_expansion", room: "r1", requestId: "e3" }).result).toEqual({ ok: false, error: "Esta sala ya tiene el tamaño máximo." });
    // La sala desbloqueada por nivel ya es accesible sin comprar nada.
    expect(roomAt("r2", 5).w).toBeGreaterThan(0);
    // Las casillas nuevas se pueden decorar.
    s = ok(s, { type: "purchase", itemId: "P011", qty: 1, requestId: "c" });
    const chair = s.inventory.find((o) => o.itemId === "P011" && o.source === "purchase")!;
    const r = roomAt("r1", s.level, s.expansions.r1);
    s = ok(s, { type: "save_layout", placements: [...s.placements, { uid: chair.uid, room: "r1", x: r.w - 1, y: r.h - 1, rot: 0 }], styles: {} });
    expect(s.placements.some((p) => p.uid === chair.uid)).toBe(true);
  });

  it("si una sala encoge o se bloquea, lo que no cabe vuelve al inventario con aviso", () => {
    let s = ok(ok(initialState("t", T0), { type: "dev_set_level", level: 15 }), { type: "dev_coins", delta: 100 });
    s = ok(s, { type: "purchase", itemId: "P011", qty: 1, requestId: "c" });
    const chair = s.inventory.find((o) => o.itemId === "P011" && o.source === "purchase")!;
    s = ok(s, { type: "save_layout", placements: [...s.placements, { uid: chair.uid, room: "r1", x: 13, y: 12, rot: 0 }], styles: {} });
    const inR4 = s.placements.filter((p) => p.room === "r4").length;
    expect(inR4).toBeGreaterThan(0);
    s = ok(s, { type: "dev_set_level", level: 1 });
    expect(s.placements.some((p) => p.uid === chair.uid || p.room === "r4")).toBe(false);
    expect(s.inventory.some((o) => o.uid === chair.uid && !o.soldAt)).toBe(true);
    expect(s.celebrations.some((c) => c.type === "relocated")).toBe(true);
  });

  it("migra partidas antiguas: sonido activado, ampliaciones vacías y alias/publicación intactos", () => {
    const old = withReports(1) as GameState & Record<string, unknown>;
    delete old.schema;
    delete (old as Partial<GameState>).expansions;
    old.settings = { music: { enabled: false, track: "jazz", volume: 0.3 }, sfx: false, publish: true, alias: "Lectora" } as never;
    const s = migrateState(structuredClone(old));
    expect(s.settings).toEqual({ music: { enabled: true, track: "jazz", volume: 0.3 }, sfx: true, sfxVolume: 0.6, publish: true, alias: "Lectora" });
    expect(s.expansions).toEqual({});
    // Después se respeta la elección del usuario.
    const muted = ok(s, { type: "set_settings", sfx: false });
    expect(migrateState(structuredClone(muted)).settings.sfx).toBe(false);
  });
});

function withReportsFrom(state: GameState, n: number): GameState {
  let s = state;
  for (let i = 0; i < n; i++) s = report(s, `extra${i}`);
  return s;
}
