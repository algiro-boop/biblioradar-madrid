"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { findItem } from "@/game/data/catalog";
import { roomAt } from "@/game/data/levels";
import { footprint, itemLookup, rotationsFor, validateLayout } from "@/game/engine/layout";
import type { GameState, Placement, RoomStyle } from "@/game/engine/types";
import { run } from "@/game/store";

export interface EditorGhost {
  uid: string;
  itemId: string;
  room: string;
  x: number;
  y: number;
  rot: number;
  valid: boolean;
  reason?: string;
  /** Viene del inventario (aún no estaba colocado). */
  fresh: boolean;
}

/** Pieza de un grupo en movimiento, relativa a la esquina del grupo. */
interface Piece {
  uid: string;
  itemId: string;
  dx: number;
  dy: number;
  rot: number;
}

/** Movimiento en curso: un objeto o un grupo, anclado en (x, y). */
interface Move {
  room: string;
  x: number;
  y: number;
  pieces: Piece[];
  fresh: boolean;
}

/** Colocaciones absolutas de un movimiento. */
const piecesAt = (m: Move): Placement[] => m.pieces.map((p) => ({ uid: p.uid, room: m.room, x: m.x + p.dx, y: m.y + p.dy, rot: p.rot }));

type Notify = (message: string, kind?: "ok" | "error") => void;

const SAVE_DELAY = 600;

const nextRot = (itemId: string, rot: number) => {
  const rots = rotationsFor(findItem(itemId)!);
  return rots[(rots.indexOf(rot) + 1) % rots.length] ?? rot;
};

/**
 * Edición libre con guardado optimista: cada cambio válido se ve al instante y se guarda (con el
 * motor como autoridad) tras una breve pausa. Si el motor lo rechaza, se vuelve a lo guardado.
 *
 * Admite selección múltiple: un grupo (p. ej. una mesa con sus sillas) se mueve y se gira de una
 * vez, respetando cuadrícula, colisiones y límites de la sala. La colocación desde el inventario
 * puede ser continua: tras dejar un objeto, aparece el siguiente igual que quede guardado.
 */
export function useEditor(state: GameState, notify: Notify, onPlaced?: () => void) {
  const [pending, setPending] = useState<{ placements: Placement[]; styles: Record<string, RoomStyle> } | null>(null);
  const [selected, setSelectedState] = useState<string[]>([]);
  const [multi, setMulti] = useState(false);
  const [move, setMove] = useState<Move | null>(null);
  /** Colocación continua: catálogo del objeto que se va colocando. */
  const [series, setSeries] = useState<string | null>(null);
  const seriesPlaced = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  const placements = pending?.placements ?? state.placements;
  const styles = pending?.styles ?? state.roomStyles;
  const itemOf = useMemo(() => itemLookup(state), [state]);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const p = pendingRef.current;
    if (!p) return;
    const result = run({ type: "save_layout", placements: p.placements, styles: p.styles });
    if (!result.ok) notify(`No se guardó: ${result.error}`, "error");
    setPending(null);
  }, [notify]);

  useEffect(() => () => flush(), [flush]);

  const commit = useCallback(
    (next: Placement[], nextStyles: Record<string, RoomStyle> = styles): boolean => {
      const issues = validateLayout(next, state.inventory, state.level, state.expansions);
      if (issues.length) {
        notify(issues[0]!.reason, "error");
        return false;
      }
      setPending({ placements: next, styles: nextStyles });
      pendingRef.current = { placements: next, styles: nextStyles };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_DELAY);
      return true;
    },
    [state.inventory, state.level, state.expansions, styles, notify, flush],
  );

  /** Valida un movimiento entero (todas sus piezas a la vez). */
  const validate = useCallback(
    (m: Move): { valid: boolean; reason?: string } => {
      const uids = new Set(m.pieces.map((p) => p.uid));
      const issues = validateLayout([...placements.filter((p) => !uids.has(p.uid)), ...piecesAt(m)], state.inventory, state.level, state.expansions);
      return { valid: issues.length === 0, reason: issues[0]?.reason };
    },
    [placements, state.inventory, state.level, state.expansions],
  );

  const status = useMemo(() => (move ? validate(move) : null), [move, validate]);
  const ghosts = useMemo<EditorGhost[]>(
    () => (move && status ? piecesAt(move).map((p, i) => ({ ...p, itemId: move.pieces[i]!.itemId, valid: status.valid, reason: status.reason, fresh: move.fresh })) : []),
    [move, status],
  );
  /** Fantasma principal (el ancla); en un grupo, el resto están en `ghosts`. */
  const ghost = ghosts[0] ?? null;

  /** Primera posición libre de la sala para un objeto (para que aparezca ya en un sitio válido). */
  const findSpot = useCallback(
    (uid: string, itemId: string, room: string, near?: { x: number; y: number }): Move => {
      const item = findItem(itemId)!;
      const def = roomAt(room, state.level, state.expansions[room]);
      const rots = rotationsFor(item);
      const cx = near?.x ?? Math.floor(def.w / 2);
      const cy = near?.y ?? Math.floor(def.h / 2);
      const cells: [number, number][] = [];
      for (let x = 0; x < def.w; x++) for (let y = 0; y < def.h; y++) cells.push([x, y]);
      cells.sort((a, b) => Math.abs(a[0] - cx) + Math.abs(a[1] - cy) - (Math.abs(b[0] - cx) + Math.abs(b[1] - cy)));
      let fallback: Move | null = null;
      for (const rot of rots) {
        const candidates: [number, number][] = item.layer === "wall" ? Array.from({ length: rot % 2 ? def.h : def.w }, (_, i) => [i, 0]) : cells;
        for (const [x, y] of candidates) {
          const m: Move = { room, x, y, pieces: [{ uid, itemId, dx: 0, dy: 0, rot }], fresh: true };
          if (validate(m).valid) return m;
          fallback ??= m;
        }
      }
      return fallback ?? { room, x: cx, y: cy, pieces: [{ uid, itemId, dx: 0, dy: 0, rot: rots[0] ?? 0 }], fresh: true };
    },
    [validate, state.level, state.expansions],
  );

  const setSelected = useCallback((uid: string | null) => setSelectedState(uid ? [uid] : []), []);

  /** En modo múltiple, tocar añade o quita del grupo. */
  const toggleSelected = useCallback((uid: string) => {
    setSelectedState((s) => (s.includes(uid) ? s.filter((x) => x !== uid) : [...s, uid]));
  }, []);

  const startPlace = useCallback(
    (uid: string, room: string, continuous = false) => {
      const owned = state.inventory.find((o) => o.uid === uid);
      if (!owned) return;
      setSelectedState([]);
      setSeries(continuous ? owned.itemId : null);
      seriesPlaced.current = 0;
      setMove(findSpot(uid, owned.itemId, room));
    },
    [state.inventory, findSpot],
  );

  /** Empieza a mover un objeto o, si forma parte de la selección, todo el grupo. */
  const startMove = useCallback(
    (uid: string) => {
      const uids = selected.includes(uid) && selected.length > 1 ? selected : [uid];
      const list = uids.flatMap((u) => {
        const p = placements.find((x) => x.uid === u);
        const item = itemOf(u);
        return p && item ? [{ p, item }] : [];
      });
      if (!list.length) return;
      const room = list[0]!.p.room;
      if (list.length > 1 && list.some(({ p, item }) => item.layer === "wall" || p.room !== room)) {
        notify("Los objetos de pared se mueven de uno en uno.", "error");
        return;
      }
      const x = Math.min(...list.map(({ p }) => p.x));
      const y = Math.min(...list.map(({ p }) => p.y));
      setSeries(null);
      setMove({ room, x, y, fresh: false, pieces: list.map(({ p, item }) => ({ uid: p.uid, itemId: item.id, dx: p.x - x, dy: p.y - y, rot: p.rot })) });
    },
    [selected, placements, itemOf, notify],
  );

  const moveGhost = useCallback((x: number, y: number, rot?: number) => {
    setMove((m) => {
      if (!m) return m;
      if (rot !== undefined && m.pieces.length === 1) return { ...m, x, y, pieces: [{ ...m.pieces[0]!, rot }] };
      return { ...m, x, y };
    });
  }, []);

  /** Gira el objeto, o el grupo entero 90° alrededor de su esquina (las sillas siguen mirando a la mesa). */
  const rotateGhost = useCallback(() => {
    setMove((m) => {
      if (!m) return m;
      if (m.pieces.length === 1) {
        const p = m.pieces[0]!;
        const item = findItem(p.itemId)!;
        // En pared, girar cambia de pared: se reinicia el hueco para no salirse.
        return { ...m, x: item.layer === "wall" ? 0 : m.x, pieces: [{ ...p, rot: nextRot(p.itemId, p.rot) }] };
      }
      const turned = m.pieces.map((p) => {
        const item = findItem(p.itemId)!;
        const { w, h } = item.layer === "small" ? { w: 1, h: 1 } : footprint(item, p.rot);
        const rots = rotationsFor(item);
        const want = (p.rot + 1) % 4;
        const rot = rots.includes(want) ? want : rots.includes(want % 2) ? want % 2 : p.rot;
        const n = item.layer === "small" ? { w: 1, h: 1 } : footprint(item, rot);
        // Centro girado (x, y) → (−y, x) y nueva esquina.
        const cx = -(p.dy + h / 2);
        const cy = p.dx + w / 2;
        return { ...p, rot, dx: Math.round(cx - n.w / 2), dy: Math.round(cy - n.h / 2) };
      });
      const minX = Math.min(...turned.map((p) => p.dx));
      const minY = Math.min(...turned.map((p) => p.dy));
      return { ...m, pieces: turned.map((p) => ({ ...p, dx: p.dx - minX, dy: p.dy - minY })) };
    });
  }, []);

  const placeGhost = useCallback(() => {
    if (!move || !status) return;
    if (!status.valid) {
      notify(status.reason ?? "Ahí no cabe.", "error");
      return;
    }
    const uids = new Set(move.pieces.map((p) => p.uid));
    const next = [...placements.filter((p) => !uids.has(p.uid)), ...piecesAt(move)];
    if (!commit(next)) return;
    onPlaced?.();
    // Colocación continua: siguiente unidad igual del inventario, junto a la anterior.
    if (series && move.fresh) {
      seriesPlaced.current += 1;
      const placed = new Set(next.map((p) => p.uid));
      const following = state.inventory.find((o) => o.itemId === series && !o.soldAt && !placed.has(o.uid));
      if (following) {
        const spot = findSpot(following.uid, following.itemId, move.room, { x: move.x + 1, y: move.y });
        const rot = move.pieces[0]!.rot;
        const same: Move = { ...spot, pieces: [{ ...spot.pieces[0]!, rot }] };
        setMove(validate(same).valid ? same : spot);
        return;
      }
      setSeries(null);
      if (seriesPlaced.current > 1) notify("Has colocado todas las unidades.");
    }
    setMove(null);
    setSelectedState([...uids]);
  }, [move, status, placements, commit, notify, onPlaced, series, state.inventory, findSpot, validate]);

  /** Unidades de la serie que aún quedan en el inventario (incluida la que se está colocando). */
  const remaining = useMemo(() => {
    if (!series) return 0;
    const placed = new Set(placements.map((p) => p.uid));
    return state.inventory.filter((o) => o.itemId === series && !o.soldAt && !placed.has(o.uid)).length;
  }, [series, placements, state.inventory]);

  const rotateSelected = useCallback(() => {
    if (selected.length > 1) {
      // Grupo: se gira como un bloque y se deja como movimiento para confirmar.
      startMove(selected[0]!);
      rotateGhost();
      return;
    }
    const uid = selected[0];
    const p = placements.find((x) => x.uid === uid);
    const item = uid ? itemOf(uid) : undefined;
    if (!p || !item) return;
    const rot = nextRot(item.id, p.rot);
    if (item.layer === "wall") {
      // Cambiar de pared: se busca el primer hueco libre en la otra.
      const def = roomAt(p.room, state.level, state.expansions[p.room]);
      const len = rot % 2 ? def.h : def.w;
      const other = Array.from({ length: len }, (_, x) => ({ room: p.room, x, y: 0, fresh: false, pieces: [{ uid: p.uid, itemId: item.id, dx: 0, dy: 0, rot }] }))
        .find((m) => validate(m).valid);
      if (!other) return notify("No cabe en la otra pared.", "error");
      commit([...placements.filter((x) => x.uid !== p.uid), { ...p, x: other.x, rot }]);
      return;
    }
    commit(placements.map((x) => (x.uid === p.uid ? { ...x, rot } : x)));
  }, [placements, selected, itemOf, commit, validate, notify, startMove, rotateGhost, state.level, state.expansions]);

  const nudgeSelected = useCallback(
    (dx: number, dy: number) => {
      if (!selected.length) return;
      const set = new Set(selected);
      commit(placements.map((x) => (set.has(x.uid) ? { ...x, x: x.x + dx, y: itemOf(x.uid)?.layer === "wall" ? 0 : x.y + dy } : x)));
    },
    [placements, selected, itemOf, commit],
  );

  const storeSelected = useCallback(() => {
    if (!selected.length) return;
    const set = new Set(selected);
    if (commit(placements.filter((p) => !set.has(p.uid)))) setSelectedState([]);
  }, [selected, placements, commit]);

  const setStyle = useCallback(
    (room: string, kind: keyof RoomStyle, id: string) => {
      const current = styles[room] ?? { floor: "floor-roble", wall: "wall-crema", window: "window-madera" };
      commit(placements, { ...styles, [room]: { ...current, [kind]: id } });
    },
    [styles, placements, commit],
  );

  const cancel = useCallback(() => {
    setMove(null);
    setSeries(null);
    setSelectedState([]);
  }, []);

  return {
    placements, styles, selected, setSelected, toggleSelected, multi, setMulti, ghost, ghosts, series, remaining, saving: pending !== null,
    startPlace, startMove, moveGhost, rotateGhost, placeGhost, rotateSelected, nudgeSelected, storeSelected, setStyle, cancel, flush,
  };
}

export type Editor = ReturnType<typeof useEditor>;
