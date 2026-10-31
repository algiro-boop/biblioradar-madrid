"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { findItem } from "@/game/data/catalog";
import { roomAt } from "@/game/data/levels";
import { itemLookup, rotationsFor, validateLayout } from "@/game/engine/layout";
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

type Notify = (message: string, kind?: "ok" | "error") => void;

const SAVE_DELAY = 600;

/**
 * Edición libre con guardado optimista: cada cambio válido se ve al instante y se guarda (con el
 * motor como autoridad) tras una breve pausa. Si el motor lo rechaza, se vuelve a lo guardado.
 */
export function useEditor(state: GameState, notify: Notify, onPlaced?: () => void) {
  const [pending, setPending] = useState<{ placements: Placement[]; styles: Record<string, RoomStyle> } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [ghost, setGhost] = useState<EditorGhost | null>(null);
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

  const check = useCallback(
    (g: Omit<EditorGhost, "valid" | "reason">): EditorGhost => {
      const others = placements.filter((p) => p.uid !== g.uid);
      const issues = validateLayout([...others, { uid: g.uid, room: g.room, x: g.x, y: g.y, rot: g.rot }], state.inventory, state.level, state.expansions);
      return { ...g, valid: issues.length === 0, reason: issues[0]?.reason };
    },
    [placements, state.inventory, state.level, state.expansions],
  );

  /** Primera posición libre de la sala para un objeto (para que aparezca ya en un sitio válido). */
  const findSpot = useCallback(
    (uid: string, itemId: string, room: string): EditorGhost => {
      const item = findItem(itemId)!;
      const def = roomAt(room, state.level, state.expansions[room]);
      const rots = rotationsFor(item);
      let fallback: EditorGhost | null = null;
      const cx = Math.floor(def.w / 2);
      const cy = Math.floor(def.h / 2);
      const cells: [number, number][] = [];
      for (let x = 0; x < def.w; x++) for (let y = 0; y < def.h; y++) cells.push([x, y]);
      cells.sort((a, b) => Math.abs(a[0] - cx) + Math.abs(a[1] - cy) - (Math.abs(b[0] - cx) + Math.abs(b[1] - cy)));
      for (const rot of rots) {
        const candidates: [number, number][] = item.layer === "wall" ? Array.from({ length: rot % 2 ? def.h : def.w }, (_, i) => [i, 0]) : cells;
        for (const [x, y] of candidates) {
          const g = check({ uid, itemId, room, x, y, rot, fresh: true });
          if (g.valid) return g;
          fallback ??= g;
        }
      }
      return fallback ?? check({ uid, itemId, room, x: cx, y: cy, rot: rots[0] ?? 0, fresh: true });
    },
    [check, state.level, state.expansions],
  );

  const startPlace = useCallback(
    (uid: string, room: string) => {
      const owned = state.inventory.find((o) => o.uid === uid);
      if (!owned) return;
      setSelected(null);
      setGhost(findSpot(uid, owned.itemId, room));
    },
    [state.inventory, findSpot],
  );

  const startMove = useCallback(
    (uid: string) => {
      const p = placements.find((x) => x.uid === uid);
      const item = itemOf(uid);
      if (!p || !item) return;
      setGhost(check({ uid, itemId: item.id, room: p.room, x: p.x, y: p.y, rot: p.rot, fresh: false }));
    },
    [placements, itemOf, check],
  );

  const moveGhost = useCallback(
    (x: number, y: number, rot?: number) => {
      setGhost((g) => (g ? check({ ...g, x, y, rot: rot ?? g.rot }) : g));
    },
    [check],
  );

  const nextRot = (itemId: string, rot: number) => {
    const rots = rotationsFor(findItem(itemId)!);
    return rots[(rots.indexOf(rot) + 1) % rots.length] ?? rot;
  };

  const rotateGhost = useCallback(() => {
    setGhost((g) => {
      if (!g) return g;
      const item = findItem(g.itemId)!;
      const rot = nextRot(g.itemId, g.rot);
      // En pared, girar cambia de pared: se reinicia el hueco para no salirse.
      return check({ ...g, rot, x: item.layer === "wall" ? 0 : g.x });
    });
  }, [check]);

  const placeGhost = useCallback(() => {
    if (!ghost) return;
    if (!ghost.valid) {
      notify(ghost.reason ?? "Ahí no cabe.", "error");
      return;
    }
    const next = [...placements.filter((p) => p.uid !== ghost.uid), { uid: ghost.uid, room: ghost.room, x: ghost.x, y: ghost.y, rot: ghost.rot }];
    if (commit(next)) {
      setGhost(null);
      setSelected(ghost.uid);
      onPlaced?.();
    }
  }, [ghost, placements, commit, notify, onPlaced]);

  const rotateSelected = useCallback(() => {
    const p = placements.find((x) => x.uid === selected);
    const item = selected ? itemOf(selected) : undefined;
    if (!p || !item) return;
    const rot = nextRot(item.id, p.rot);
    if (item.layer === "wall") {
      // Cambiar de pared: se busca el primer hueco libre en la otra.
      const g = findSpot(p.uid, item.id, p.room);
      const other = Array.from({ length: 12 }, (_, x) => check({ uid: p.uid, itemId: item.id, room: p.room, x, y: 0, rot, fresh: false })).find((c) => c.valid);
      const target = other ?? g;
      if (!target.valid) return notify(target.reason ?? "No cabe en la otra pared.", "error");
      commit([...placements.filter((x) => x.uid !== p.uid), { ...p, x: target.x, rot: target.rot }]);
      return;
    }
    commit(placements.map((x) => (x.uid === p.uid ? { ...x, rot } : x)));
  }, [placements, selected, itemOf, commit, check, findSpot, notify]);

  const nudgeSelected = useCallback(
    (dx: number, dy: number) => {
      const p = placements.find((x) => x.uid === selected);
      if (!p) return;
      commit(placements.map((x) => (x.uid === p.uid ? { ...x, x: x.x + dx, y: itemOf(p.uid)?.layer === "wall" ? 0 : x.y + dy } : x)));
    },
    [placements, selected, itemOf, commit],
  );

  const storeSelected = useCallback(() => {
    if (!selected) return;
    if (commit(placements.filter((p) => p.uid !== selected))) setSelected(null);
  }, [selected, placements, commit]);

  const setStyle = useCallback(
    (room: string, kind: keyof RoomStyle, id: string) => {
      const current = styles[room] ?? { floor: "floor-roble", wall: "wall-crema", window: "window-madera" };
      commit(placements, { ...styles, [room]: { ...current, [kind]: id } });
    },
    [styles, placements, commit],
  );

  const cancel = useCallback(() => {
    setGhost(null);
    setSelected(null);
  }, []);

  return {
    placements, styles, selected, setSelected, ghost, saving: pending !== null,
    startPlace, startMove, moveGhost, rotateGhost, placeGhost, rotateSelected, nudgeSelected, storeSelected, setStyle, cancel, flush,
  };
}

export type Editor = ReturnType<typeof useEditor>;
