"use client";

import {
  Archive, ArrowLeft, Building2, Check, Flame, Heart, Layers, ListChecks, Lock, Maximize2, Move, Music, Package, Paintbrush, Pencil,
  RotateCw, Settings, Store, TrendingUp, Trophy, Users, Wrench, X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getAchievement } from "@/game/data/achievements";
import { findItem } from "@/game/data/catalog";
import { DEFAULT_STYLE, getRoom, hasFeature, LEVELS, nextExpansionPrice, roomAt, roomMax, ROOMS, roomsForLevel, STYLES, studentsForLevel, type RoomDef } from "@/game/data/levels";
import { NEIGHBORS } from "@/game/data/neighbors";
import { gameNow, type Celebration, type GameState } from "@/game/engine";
import { itemLookup } from "@/game/engine/layout";
import { activeMissions, availableStyles } from "@/game/engine/missions";
import type { SceneInput } from "@/game/render/scene";
import { SEAT_Z, type ScenePlacement } from "@/game/render/sim";
import { sfx, unlockAudioOnGesture } from "@/game/sfx";
import { getGameState, run, useGameState } from "@/game/store";
import { madridDateKey } from "@/game/time";
import { GAME_DEV_TOOLS } from "@/lib/gamification-flag";
import { AchievementsPanel, InventoryPanel } from "./CollectionPanels";
import { DevPanel } from "./DevPanel";
import { ShowcaseViewer } from "./ShowcaseViewer";
import { GameStage, type StageHandle, type StageTap } from "./GameStage";
import { MissionsPanel, ProgressPanel } from "./ProgressPanels";
import { report, ShopPanel } from "./ShopPanel";
import { SettingsPanel, VisitPanel } from "./SocialPanels";
import { AchievementIcon, Button, Coins, Modal, Thumb } from "./ui";
import { useEditor } from "./useEditor";

type Tab = "shop" | "inventory" | "missions" | "achievements" | "progress" | "visit" | "settings" | "dev";
type Toast = { id: number; text: string; kind: "ok" | "error" };

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: "missions", label: "Misiones", icon: <ListChecks className="size-5" aria-hidden /> },
  { id: "shop", label: "Tienda", icon: <Store className="size-5" aria-hidden /> },
  { id: "inventory", label: "Inventario", icon: <Package className="size-5" aria-hidden /> },
  { id: "achievements", label: "Logros", icon: <Trophy className="size-5" aria-hidden /> },
  { id: "progress", label: "Progreso", icon: <TrendingUp className="size-5" aria-hidden /> },
  { id: "visit", label: "Visitar", icon: <Users className="size-5" aria-hidden /> },
  { id: "settings", label: "Ajustes", icon: <Settings className="size-5" aria-hidden /> },
  ...(GAME_DEV_TOOLS ? [{ id: "dev" as Tab, label: "Dev", icon: <Wrench className="size-5" aria-hidden /> }] : []),
];

function useDesktop(): boolean {
  const [desktop, setDesktop] = useState(() => matchMedia("(min-width: 1024px)").matches);
  useEffect(() => {
    const mq = matchMedia("(min-width: 1024px)");
    const on = () => setDesktop(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return desktop;
}

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Reparte el alumnado del nivel entre las salas en proporción a sus asientos (un sofá de tres
 * cuenta tres). Una sala sin asientos recibe a quien hojea estanterías; el total nunca crece.
 */
function studentsByRoom(level: number, rooms: RoomDef[], placements: ScenePlacement[]): Record<string, number> {
  const total = studentsForLevel(level);
  const seats = rooms.map((r) => placements.filter((p) => p.room === r.id).reduce((n, p) => {
    const item = findItem(p.itemId);
    if (!item || item.layer !== "floor" || SEAT_Z[item.kind] === undefined) return n;
    return n + (item.kind === "sofa" || item.kind === "bench" ? Math.max(item.w, item.h) : 1);
  }, 0));
  const sum = seats.reduce((a, b) => a + b, 0);
  const out: Record<string, number> = {};
  if (!sum) {
    rooms.forEach((r, i) => (out[r.id] = Math.floor(total / rooms.length) + (i < total % rooms.length ? 1 : 0)));
    return out;
  }
  let left = total;
  rooms.forEach((r, i) => {
    out[r.id] = Math.min(left, Math.floor((total * seats[i]!) / sum));
    left -= out[r.id]!;
  });
  // El resto, a las salas con más asientos libres.
  const order = rooms.map((r, i) => ({ id: r.id, free: seats[i]! - out[r.id]! })).sort((a, b) => b.free - a.free);
  for (let i = 0; left > 0 && order.length; i = (i + 1) % order.length, left--) out[order[i]!.id]! += 1;
  return out;
}

export default function LibraryGame() {
  const state = useGameState();
  const desktop = useDesktop();
  const [realNow, setRealNow] = useState(() => Date.now());
  const now = gameNow(state, realNow);
  const [tab, setTab] = useState<Tab | null>(null);
  const [editing, setEditing] = useState(false);
  const [roomId, setRoomId] = useState("r1");
  const [visiting, setVisiting] = useState<string | null>(null);
  const [visitRoom, setVisitRoom] = useState("r1");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [showAllRooms, setShowAllRooms] = useState(false);
  const [previewCat, setPreviewCat] = useState(false);
  const [stylesOpen, setStylesOpen] = useState(false);
  const [audible, setAudible] = useState(false);
  const [overview, setOverview] = useState(false);
  const [expandOpen, setExpandOpen] = useState(false);
  const [showcaseOpen, setShowcaseOpen] = useState(false);
  const stageRef = useRef<StageHandle>(null);
  const activeTab = tab ?? (desktop ? "missions" : null);

  const notify = useCallback((text: string, kind: "ok" | "error" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 3800 : 2600);
  }, []);

  const editor = useEditor(state, notify, () => sfx("place"));

  // Audio: activado por defecto, pero el navegador solo deja sonar tras el primer gesto.
  useEffect(() => unlockAudioOnGesture(() => setAudible(true)), []);

  // Reloj: liquidación periódica (medianoche, caducidades, misiones) y cuentas atrás.
  useEffect(() => {
    run({ type: "tick" });
    let minute = 0;
    const id = setInterval(() => {
      setRealNow(Date.now());
      if (++minute % 4 === 0) run({ type: "tick" });
    }, 15_000);
    return () => clearInterval(id);
  }, []);

  // ------------------------------------------------------------ salas y escena
  // Las salas bloqueadas se previsualizan con el tamaño que tendrán al desbloquearse.
  const rooms = useMemo(
    () => (showAllRooms ? ROOMS : state.level === 0 ? [ROOMS[0]!] : roomsForLevel(state.level))
      .map((r) => roomAt(r.id, Math.max(state.level, r.level), state.expansions[r.id])),
    [showAllRooms, state.level, state.expansions],
  );
  const room = rooms.find((r) => r.id === roomId) ?? rooms[0]!;
  // En el nivel 0 no hay sala bloqueada que enseñar: se ve el solar vacío.
  const roomLocked = room.level > state.level && !(state.level === 0 && room.id === "r1");
  const itemOf = useMemo(() => itemLookup(state), [state]);
  const neighbor = visiting ? NEIGHBORS.find((n) => n.id === visiting) ?? null : null;
  const minute = Math.floor(now / 60_000) * 60_000;
  const catHere = (hasFeature(state.level, "cat") || previewCat) && !roomLocked;

  // Mientras se mueve un mueble (o un grupo), solo se ven sus fantasmas.
  const allPlacements = useMemo<ScenePlacement[]>(() => {
    const moving = new Set(editor.ghosts.filter((g) => !g.fresh).map((g) => g.uid));
    return editor.placements.filter((p) => !moving.has(p.uid)).flatMap((p) => {
      const item = itemOf(p.uid);
      return item ? [{ uid: p.uid, itemId: item.id, room: p.room, x: p.x, y: p.y, rot: p.rot }] : [];
    });
  }, [editor.placements, editor.ghosts, itemOf]);
  const unlocked = useMemo(() => (state.level === 0 ? [] : roomsForLevel(state.level, state.expansions)), [state.level, state.expansions]);
  const students = useMemo(() => studentsByRoom(state.level, unlocked, allPlacements), [state.level, unlocked, allPlacements]);
  // El gato y la bibliotecaria viven en la sala principal en la vista general.
  const inputFor = useCallback(
    (r: RoomDef, locked: boolean, home: boolean): SceneInput => ({
      room: r, placements: allPlacements.filter((p) => p.room === r.id), style: { ...DEFAULT_STYLE, ...editor.styles[r.id] },
      level: locked ? Math.max(1, state.level) : state.level, trophies: state.showcase.length, students: locked ? 0 : students[r.id] ?? 0,
      librarian: hasFeature(state.level, "librarian") && !locked && home, cat: catHere && home, now: minute,
    }),
    [allPlacements, editor.styles, state.level, state.showcase.length, students, catHere, minute],
  );
  const ownInput = useMemo<SceneInput>(() => inputFor(room, roomLocked, true), [inputFor, room, roomLocked]);
  // Vista general desde el nivel 1: las salas aún bloqueadas se ven como maqueta con candado.
  const canOverview = state.level >= 1 && !visiting && !editing;
  const overviewInputs = useMemo(
    () => (overview && canOverview
      ? ROOMS.map((spec) => {
        const locked = spec.level > state.level;
        return { ...inputFor(roomAt(spec.id, Math.max(state.level, spec.level), state.expansions[spec.id]), locked, spec.id === "r1"), locked };
      })
      : null),
    [overview, canOverview, inputFor, state.level, state.expansions],
  );

  const visitInput = useMemo<SceneInput | null>(() => {
    if (!neighbor) return null;
    const r = roomAt(neighbor.rooms.includes(visitRoom) ? visitRoom : neighbor.rooms[0]!, neighbor.level);
    return {
      room: r, style: { ...DEFAULT_STYLE, ...neighbor.styles[r.id] }, level: neighbor.level, trophies: 3,
      placements: neighbor.placements.map((p, i) => ({ ...p, uid: `${neighbor.id}-${i}` })).filter((p) => p.room === r.id),
      students: studentsForLevel(neighbor.level), librarian: neighbor.level >= 4, cat: neighbor.level >= 3, now: minute,
    };
  }, [neighbor, visitRoom, minute]);

  const input = visitInput ?? ownInput;
  const overlay = useMemo(
    () => (editing && !visiting
      ? { editing: true, selected: editor.selected, ghosts: editor.ghosts.filter((g) => g.room === room.id) }
      : { editing: false, selected: [], ghosts: [] }),
    [editing, visiting, editor.selected, editor.ghosts, room.id],
  );

  const canEdit = hasFeature(state.level, "editor") && !roomLocked && !visiting;
  useEffect(() => {
    if (!canEdit && editing) setEditing(false);
  }, [canEdit, editing]);

  // ------------------------------------------------------------ gestos sobre la escena
  const targetFor = useCallback(
    (tap: StageTap): { x: number; y: number; rot?: number } | null => {
      const g = editor.ghost;
      if (!g) return null;
      const item = findItem(g.itemId)!;
      if (item.layer === "wall") {
        if (tap.wall?.kind !== "wall") return null;
        const rot = tap.wall.wall === "R" ? 0 : 1;
        const len = rot ? room.h : room.w;
        return { x: Math.max(0, Math.min(len - item.w, Math.round(tap.wall.u - item.w / 2))), y: 0, rot };
      }
      return tap.floor?.kind === "floor" ? { x: tap.floor.x, y: tap.floor.y } : null;
    },
    [editor.ghost, room],
  );

  const onTap = useCallback(
    (tap: StageTap) => {
      if (visiting) {
        if (tap.hit) {
          run({ type: "visit_virtual", ownerId: visiting, room: input.room.id });
          const p = input.placements.find((x) => x.uid === tap.hit);
          if (p) notify(findItem(p.itemId)?.name ?? "");
        }
        return;
      }
      if (editing) {
        const g = editor.ghost;
        if (g) {
          const t = targetFor(tap);
          if (!t) return;
          if (t.x === g.x && t.y === g.y && (t.rot ?? g.rot) === g.rot) editor.placeGhost();
          else editor.moveGhost(t.x, t.y, t.rot);
          return;
        }
        if (tap.hit && tap.hit !== "cat") {
          if (editor.multi) {
            editor.toggleSelected(tap.hit);
            sfx("select");
          } else if (editor.selected.includes(tap.hit)) {
            editor.startMove(tap.hit);
            sfx("pickup");
          } else {
            editor.setSelected(tap.hit);
            sfx("select");
          }
        } else if (!editor.multi) editor.setSelected(null);
        return;
      }
      if (tap.hit === "cat") notify(`${state.catName} ronronea. 🐾`);
      else if (tap.hit) {
        const item = itemOf(tap.hit);
        // Tocar la vitrina de logros la abre en grande.
        if (item?.tags.includes("showcase")) {
          setShowcaseOpen(true);
          sfx("select");
        } else if (item) notify(`${item.name} · ${item.interaction}`);
      }
    },
    [visiting, editing, editor, targetFor, input, notify, state.catName, itemOf],
  );

  const onHover = useCallback(
    (tap: StageTap) => {
      if (!editing || !editor.ghost) return;
      const t = targetFor(tap);
      if (t && (t.x !== editor.ghost.x || t.y !== editor.ghost.y || (t.rot ?? editor.ghost.rot) !== editor.ghost.rot)) editor.moveGhost(t.x, t.y, t.rot);
    },
    [editing, editor, targetFor],
  );

  // Teclado: alternativa completa al ratón y al tacto en el editor.
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select, [role=dialog]")) return;
      const dirs: Record<string, [number, number]> = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] };
      const g = editor.ghost;
      if (dirs[e.key]) {
        e.preventDefault();
        const [dx, dy] = dirs[e.key]!;
        if (g) editor.moveGhost(g.x + dx, findItem(g.itemId)?.layer === "wall" ? 0 : g.y + dy);
        else editor.nudgeSelected(dx, dy);
      } else if (e.key === "r" || e.key === "R") {
        if (g) editor.rotateGhost();
        else editor.rotateSelected();
        sfx("rotate");
      } else if (e.key === "Enter" && g) {
        e.preventDefault();
        editor.placeGhost();
      } else if ((e.key === "m" || e.key === "M") && editor.selected.length) editor.startMove(editor.selected[0]!);
      else if ((e.key === "Delete" || e.key === "Backspace") && editor.selected.length) editor.storeSelected();
      else if (e.key === "Escape") {
        if (g || editor.selected.length) editor.cancel();
        else setEditing(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, editor]);

  // ------------------------------------------------------------ gato (siesta)
  const onCatNap = useCallback(() => {
    const s = state;
    if (hasFeature(s.level, "cat") && !s.catNapSeen && !visiting) {
      run({ type: "cat_nap_seen" });
      notify(`${s.catName} se ha quedado dormido en su rincón. 💤`);
    }
  }, [state, visiting, notify]);

  // ------------------------------------------------------------ música
  const music = state.settings.music;
  const prevEnabled = useRef(music.enabled);
  useEffect(() => {
    // Activarla en Ajustes es un gesto del usuario: a partir de ahí puede sonar.
    if (music.enabled && !prevEnabled.current) setAudible(true);
    void import("@/game/audio").then(({ audio }) => audio().setVolume(music.volume));
    prevEnabled.current = music.enabled;
  }, [music.enabled]);
  useEffect(() => {
    let cancelled = false;
    void import("@/game/audio").then(({ audio }) => {
      if (cancelled) return;
      if (music.enabled && audible && !document.hidden) void audio().play(music.track, music.volume);
      else audio().stop();
    });
    return () => {
      cancelled = true;
    };
  }, [music.enabled, music.track, music.volume, audible]);
  useEffect(() => {
    const onVis = () => void import("@/game/audio").then(({ audio }) => {
      const m = getGameState().settings.music;
      if (document.hidden) audio().stop();
      else if (m.enabled && audibleRef.current) void audio().play(m.track, m.volume);
    });
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      void import("@/game/audio").then(({ audio }) => audio().stop());
    };
  }, []);
  const audibleRef = useRef(audible);
  audibleRef.current = audible;

  const toggleMusic = () => {
    setAudible(true);
    run({ type: "set_settings", music: { enabled: !music.enabled } });
  };

  // ------------------------------------------------------------ celebraciones
  const celebration = state.celebrations[0] ?? null;
  const [revealed, setRevealed] = useState<string | null>(null);
  useEffect(() => {
    if (!celebration) return;
    const def = celebration.type === "level" ? LEVELS[celebration.level] : null;
    const sound = ({ level: "level", achievement: "achievement", room: "unlock", expansion: "expansion", streak: "mission", protector: "mission", relocated: "store" } as const)[celebration.type];
    if (sound) sfx(sound);
    if (celebration.type === "expansion" && celebration.room === room.id) stageRef.current?.burst();
    if (def?.cinematic) {
      if (def.cinematic === "expansion" || def.cinematic === "floor" || def.cinematic === "final") {
        const target = ROOMS.find((r) => r.level === def.level);
        if (target) setRoomId(target.id);
      } else if (def.cinematic === "build") setRoomId("r1");
      setVisiting(null);
      // Se deja ver la animación antes de la tarjeta.
      const play = setTimeout(() => stageRef.current?.play(def.cinematic!), 150);
      const show = setTimeout(() => setRevealed(celebration.id), reducedMotion() ? 0 : 1900);
      return () => {
        clearTimeout(play);
        clearTimeout(show);
      };
    }
    setRevealed(celebration.id);
  }, [celebration?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const ack = (all = false) => {
    for (const c of all ? state.celebrations : celebration ? [celebration] : []) run({ type: "ack_celebration", id: c.id });
  };

  // ------------------------------------------------------------ visitas
  const visit = (id: string) => {
    const n = NEIGHBORS.find((x) => x.id === id)!;
    setEditing(false);
    setVisiting(id);
    setVisitRoom(n.rooms[0]!);
    run({ type: "visit_virtual", ownerId: id });
    if (!desktop) setTab(null);
  };

  const today = madridDateKey(now);
  const claimable = useMemo(() => activeMissions(state, today, now).filter((m) => m.assignment.completedAt && !m.assignment.claimedAt).length, [state, today, now]);
  const completedMissions = useMemo(() => activeMissions(state, today, now).filter((m) => m.assignment.completedAt).length, [state, today, now]);
  const prevCompleted = useRef(completedMissions);
  useEffect(() => {
    if (completedMissions > prevCompleted.current) sfx("mission");
    prevCompleted.current = completedMissions;
  }, [completedMissions]);
  const levelDef = LEVELS[state.level]!;
  const placedHere = input.placements.length;
  const stageLabel = `${neighbor ? `${neighbor.libraryName}, de ${neighbor.alias}` : state.name}: ${input.room.name} con ${placedHere} objetos${placedHere ? `: ${input.placements.slice(0, 12).map((p) => findItem(p.itemId)?.name).join(", ")}` : ""}.`;

  const panel = activeTab && (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-slate-50 p-4 pb-8">
      {activeTab === "shop" && <ShopPanel state={state} now={now} notify={notify} />}
      {activeTab === "inventory" && (
        <InventoryPanel state={state} placements={editor.placements} notify={notify} onPlace={(uid) => {
          if (roomLocked || !hasFeature(state.level, "editor")) return notify("Esa sala aún no está desbloqueada.", "error");
          setVisiting(null);
          setOverview(false);
          setEditing(true);
          editor.startPlace(uid, room.id, true);
          sfx("pickup");
          if (!desktop) setTab(null);
        }} />
      )}
      {activeTab === "missions" && <MissionsPanel state={state} now={now} notify={notify} />}
      {activeTab === "achievements" && <AchievementsPanel state={state} notify={notify} onOpenShowcase={() => setShowcaseOpen(true)} />}
      {activeTab === "progress" && <ProgressPanel state={state} now={now} notify={notify} />}
      {activeTab === "visit" && <VisitPanel state={state} now={now} onVisit={visit} notify={notify} />}
      {activeTab === "settings" && <SettingsPanel key={`${state.name}|${state.catName}`} state={state} notify={notify} />}
      {activeTab === "dev" && GAME_DEV_TOOLS && (
        <DevPanel state={state} now={now} notify={notify} showAllRooms={showAllRooms} setShowAllRooms={setShowAllRooms} previewCat={previewCat} setPreviewCat={setPreviewCat} />
      )}
    </div>
  );

  const nav = (
    <nav aria-label="Secciones de Mi Biblioteca" className={`flex shrink-0 gap-0.5 overflow-x-auto bg-white px-1.5 ring-1 ring-slate-200 ${desktop ? "py-1.5" : "pt-1 pb-[max(0.35rem,env(safe-area-inset-bottom))]"}`}>
      {TABS.map((t) => (
        <button key={t.id} type="button" aria-pressed={activeTab === t.id}
          onClick={() => { sfx("tab"); setTab(activeTab === t.id && !desktop ? null : t.id); }}
          className={`relative flex min-w-12 flex-1 flex-col items-center gap-0.5 rounded-xl px-1.5 py-1.5 text-[10px] font-semibold transition-colors ${activeTab === t.id ? "bg-emerald-50 text-emerald-700" : "text-slate-500 hover:bg-slate-100"}`}>
          {t.icon}
          {t.label}
          {t.id === "missions" && claimable > 0 && <span className="absolute top-0.5 right-2 grid size-4 place-items-center rounded-full bg-amber-400 text-[9px] font-bold text-amber-950">{claimable}</span>}
        </button>
      ))}
    </nav>
  );

  return (
    <main className={`app-viewport flex w-full overflow-hidden bg-[#2b211b] text-slate-900 ${desktop ? "flex-row" : "flex-col"}`}>
      {/* Escenario */}
      <div className="relative min-h-0 min-w-0 flex-1 bg-[radial-gradient(ellipse_at_center,#4a3426_0%,#2b211b_70%)]">
        <GameStage key={visiting ?? "own"} ref={stageRef} input={input} overview={overviewInputs} overlay={overlay} onTap={onTap} onHover={onHover} onCatNap={onCatNap}
          onOpenRoom={(r) => {
            const spec = getRoom(r);
            if (spec.level > state.level) return notify(`${spec.name} se desbloquea en el nivel ${spec.level}.`);
            setRoomId(r);
            setOverview(false);
            sfx("tab");
          }}
          label={overviewInputs ? `${state.name}: vista general con ${overviewInputs.length} salas. Toca una sala para entrar.` : stageLabel} />

        {/* Barra superior */}
        <header className="pointer-events-none absolute inset-x-0 top-0 flex items-start gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <Link href="/" aria-label="Volver al mapa" className="pointer-events-auto grid size-10 shrink-0 place-items-center rounded-2xl bg-white/90 text-slate-700 shadow-lg ring-1 ring-black/10 backdrop-blur hover:bg-white">
            <ArrowLeft className="size-5" aria-hidden />
          </Link>
          <div className="pointer-events-auto min-w-0 rounded-2xl bg-white/90 px-3 py-1.5 shadow-lg ring-1 ring-black/10 backdrop-blur">
            <p className="truncate text-sm font-bold">{state.name}</p>
            <p className="truncate text-[11px] font-semibold text-amber-800">Nivel {state.level} · {levelDef.title}</p>
          </div>
          <div className="flex-1" />
          <div className="pointer-events-auto flex items-center gap-1 rounded-2xl bg-white/90 px-2.5 py-2 shadow-lg ring-1 ring-black/10 backdrop-blur">
            <span className="inline-flex items-center gap-0.5 text-sm font-bold tabular-nums text-orange-600" title="Racha actual">
              <Flame className={`size-4 ${state.streak.reportedToday ? "fill-orange-400" : ""}`} aria-hidden />{state.streak.current}
            </span>
            <span className="mx-1 h-4 w-px bg-slate-200" aria-hidden />
            <Coins value={state.balance} className="text-sm" />
          </div>
          <button type="button" onClick={toggleMusic} aria-pressed={music.enabled && audible} aria-label={music.enabled && audible ? "Silenciar música" : "Poner música ambiente"}
            className={`pointer-events-auto grid size-10 shrink-0 place-items-center rounded-2xl shadow-lg ring-1 ring-black/10 backdrop-blur ${music.enabled && audible ? "bg-emerald-500 text-white" : "bg-white/90 text-slate-600"}`}>
            <Music className="size-5" aria-hidden />
          </button>
        </header>

        {/* Salas */}
        <div className="pointer-events-none absolute inset-x-0 top-[calc(max(0.75rem,env(safe-area-inset-top))+3.25rem)] flex justify-center px-3">
          {neighbor ? (
            <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-2 rounded-2xl bg-sky-50/95 px-3 py-2 text-sm shadow-lg ring-1 ring-sky-200 backdrop-blur">
              <span className="font-semibold text-sky-900">De visita en {neighbor.libraryName} <span className="font-normal text-sky-700">({neighbor.alias})</span></span>
              {neighbor.rooms.length > 1 && neighbor.rooms.map((r) => (
                <button key={r} type="button" aria-pressed={visitRoom === r} onClick={() => { setVisitRoom(r); run({ type: "visit_virtual", ownerId: neighbor.id, room: r }); }}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${visitRoom === r ? "bg-sky-600 text-white ring-sky-600" : "bg-white text-sky-800 ring-sky-200"}`}>
                  {getRoom(r).name}
                </button>
              ))}
              <button type="button" aria-pressed={!!state.likes[neighbor.id]} onClick={() => run({ type: "like", ownerId: neighbor.id, liked: !state.likes[neighbor.id] })}
                className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-rose-600 ring-1 ring-rose-200">
                <Heart className={`size-3.5 ${state.likes[neighbor.id] ? "fill-rose-500" : ""}`} aria-hidden />{state.likes[neighbor.id] ? "Te gusta" : "Me gusta"}
              </button>
              <button type="button" onClick={() => setVisiting(null)} className="rounded-full bg-sky-600 px-2.5 py-0.5 text-xs font-semibold text-white">Volver a la mía</button>
            </div>
          ) : rooms.length > 1 && (
            <div className="pointer-events-auto flex gap-1 overflow-x-auto rounded-2xl bg-white/90 p-1 shadow-lg ring-1 ring-black/10 backdrop-blur">
              {canOverview && (
                <button type="button" aria-pressed={overview} onClick={() => { setOverview(true); sfx("tab"); }} title="Vista general de toda la biblioteca"
                  className={`inline-flex shrink-0 items-center gap-1 rounded-xl px-2.5 py-1 text-xs font-semibold ${overview ? "bg-amber-500 text-amber-950" : "text-slate-600 hover:bg-slate-100"}`}>
                  <Building2 className="size-3.5" aria-hidden />Todo
                </button>
              )}
              {rooms.map((r) => (
                <button key={r.id} type="button" aria-pressed={!overviewInputs && room.id === r.id} onClick={() => { setRoomId(r.id); setOverview(false); editor.cancel(); sfx("tab"); }}
                  className={`inline-flex shrink-0 items-center gap-1 rounded-xl px-2.5 py-1 text-xs font-semibold ${!overviewInputs && room.id === r.id ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
                  {r.level > state.level && <Lock className="size-3" aria-hidden />}
                  {r.floor ? "1.ª planta · " : ""}{r.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Avisos */}
        <div aria-live="polite" className="pointer-events-none absolute inset-x-0 top-28 z-20 flex flex-col items-center gap-1.5 px-4">
          {toasts.map((t) => (
            <p key={t.id} className={`anim-dialog max-w-sm rounded-2xl px-3.5 py-2 text-center text-sm font-semibold shadow-lg ${t.kind === "error" ? "bg-rose-600 text-white" : "bg-slate-900/90 text-white"}`}>{t.text}</p>
          ))}
        </div>

        {/* Solar vacío y salas bloqueadas */}
        {state.level === 0 && !neighbor && (
          <div className="absolute inset-x-4 bottom-4 mx-auto max-w-sm rounded-3xl bg-white/95 p-4 text-center shadow-xl ring-1 ring-black/10">
            <p className="text-base font-bold">Un solar vacío… por ahora</p>
            <p className="mt-1 text-sm text-slate-600">Haz tu primer reporte válido en una biblioteca real y aquí se construirá tu primera sala.</p>
            <Link href="/" className="mt-3 inline-flex rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white">Ir al mapa a reportar</Link>
          </div>
        )}
        {overviewInputs && (
          <p className="pointer-events-none absolute right-16 bottom-4 left-44 mx-auto max-w-xs rounded-2xl bg-slate-900/85 px-3 py-2 text-center text-xs font-semibold text-white max-sm:hidden">
            Pellizca o usa +/− para acercar y toca una sala para entrar.
          </p>
        )}
        {roomLocked && !neighbor && !overviewInputs && (
          <p className="absolute inset-x-4 bottom-20 mx-auto max-w-sm rounded-2xl bg-slate-900/90 p-3 text-center text-sm font-semibold text-white">
            <Lock className="mr-1 inline size-4" aria-hidden />Vista previa: {room.name} se desbloquea en el nivel {room.level}.
          </p>
        )}

        {/* Acceso al editor y siesta accesible */}
        {!editing && (canEdit || canOverview) && (
          <div className="absolute bottom-3 left-3 flex flex-col items-start gap-2">
            {canOverview && (
              <Button variant={overviewInputs ? "gold" : "secondary"} className="shadow-lg" aria-pressed={!!overviewInputs}
                onClick={() => { setOverview(!overviewInputs); sfx("tab"); }}>
                <Building2 className="size-4" aria-hidden />{overviewInputs ? "Volver a la sala" : "Vista general"}
              </Button>
            )}
            {canEdit && !overviewInputs && (
              <Button onClick={() => { setEditing(true); setOverview(false); setTab(desktop ? tab : null); sfx("tab"); }} className="shadow-lg">
                <Pencil className="size-4" aria-hidden />Decorar
              </Button>
            )}
            {hasFeature(state.level, "cat") && !state.catNapSeen && reducedMotion() && (
              <Button variant="secondary" onClick={() => onCatNap()}>Ver la siesta de {state.catName}</Button>
            )}
          </div>
        )}

        {editing && <EditorBar state={state} editor={editor} room={room} onDone={() => { editor.flush(); editor.cancel(); setEditing(false); }}
          onInventory={() => setTab("inventory")} onStyles={() => setStylesOpen(true)} onExpand={() => setExpandOpen(true)} />}
      </div>

      {/* Panel lateral (escritorio) u hoja inferior (móvil) */}
      {desktop ? (
        <aside className="flex w-[420px] shrink-0 flex-col border-l border-black/20 bg-slate-50">
          {nav}
          {panel}
        </aside>
      ) : (
        <>
          {panel && <div className="flex h-[56dvh] min-h-0 shrink-0 flex-col rounded-t-3xl bg-slate-50 shadow-[0_-8px_30px_rgba(0,0,0,0.35)]">
            <div className="flex items-center justify-between px-4 pt-3">
              <h2 className="text-base font-bold">{TABS.find((t) => t.id === activeTab)?.label}</h2>
              <button type="button" onClick={() => setTab(null)} aria-label="Cerrar panel" className="grid size-8 place-items-center rounded-full text-slate-500 hover:bg-slate-200"><X className="size-4" aria-hidden /></button>
            </div>
            {panel}
          </div>}
          {nav}
        </>
      )}

      {showcaseOpen && <ShowcaseViewer state={state} notify={notify} onClose={() => setShowcaseOpen(false)} />}
      {expandOpen && <ExpansionDialog state={state} room={room} notify={notify} onClose={() => setExpandOpen(false)} onBought={() => stageRef.current?.burst()} />}
      {stylesOpen && <StylesDialog state={state} roomId={room.id} styles={{ ...DEFAULT_STYLE, ...editor.styles[room.id] }} onPick={(kind, id) => editor.setStyle(room.id, kind, id)} onClose={() => setStylesOpen(false)} />}
      {celebration && revealed === celebration.id && <CelebrationCard c={celebration} state={state} more={state.celebrations.length - 1} onAck={() => ack()} onSkipAll={() => ack(true)} onGoRoom={(r) => { setRoomId(r); setVisiting(null); ack(); }} />}
    </main>
  );
}

// ---------------------------------------------------------------- barra del editor

function EditorBar({ state, editor, room, onDone, onInventory, onStyles, onExpand }: {
  state: GameState;
  editor: ReturnType<typeof useEditor>;
  room: RoomDef;
  onDone: () => void;
  onInventory: () => void;
  onStyles: () => void;
  onExpand: () => void;
}) {
  const g = editor.ghost;
  const group = editor.ghosts.length;
  const sel = editor.selected;
  const selectedItem = sel.length === 1 ? itemLookup(state)(sel[0]!) : undefined;
  const owned = sel.length === 1 ? state.inventory.find((o) => o.uid === sel[0]) : undefined;
  const price = nextExpansionPrice(room.id, room.bought);
  return (
    <div className="absolute inset-x-3 bottom-3 mx-auto max-w-xl rounded-3xl bg-white/95 p-3 shadow-2xl ring-1 ring-black/10 backdrop-blur" role="toolbar" aria-label="Editor de la biblioteca">
      {g ? (
        <>
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-semibold">{group > 1 ? `Grupo de ${group} objetos` : findItem(g.itemId)?.name}</p>
            {editor.series && editor.remaining > 0 && (
              <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">Quedan {editor.remaining}</span>
            )}
          </div>
          <p className={`text-xs ${g.valid ? "text-emerald-700" : "text-rose-600"}`}>
            {g.valid ? "Toca otra casilla para moverlo; toca de nuevo o pulsa Colocar para dejarlo." : g.reason}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button variant="secondary" onClick={() => { editor.rotateGhost(); sfx("rotate"); }}><RotateCw className="size-4" aria-hidden />Girar</Button>
            <Button onClick={editor.placeGhost} disabled={!g.valid}><Check className="size-4" aria-hidden />Colocar</Button>
            <Button variant="ghost" onClick={editor.cancel}>{editor.series ? "Salir" : "Cancelar"}</Button>
          </div>
        </>
      ) : sel.length > 1 ? (
        <>
          <p className="text-sm font-semibold">{sel.length} objetos seleccionados</p>
          <p className="text-xs text-slate-500">{editor.multi ? "Toca más muebles para añadirlos o quitarlos del grupo." : "Se mueven y giran juntos, como una mesa con sus sillas."}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button variant="secondary" onClick={() => { editor.setMulti(false); editor.startMove(sel[0]!); sfx("pickup"); }}><Move className="size-4" aria-hidden />Mover grupo</Button>
            <Button variant="secondary" onClick={() => { editor.setMulti(false); editor.rotateSelected(); sfx("rotate"); }}><RotateCw className="size-4" aria-hidden />Girar grupo</Button>
            <Button variant="secondary" onClick={() => { editor.storeSelected(); sfx("store"); }}><Archive className="size-4" aria-hidden />Guardar todo</Button>
            <Button variant="ghost" onClick={() => { editor.setMulti(false); editor.setSelected(null); }}>Listo</Button>
          </div>
        </>
      ) : selectedItem && !editor.multi ? (
        <>
          <p className="text-sm font-semibold">{selectedItem.name}</p>
          <p className="text-xs text-slate-500">{owned?.resellable ? "Comprado: se puede vender desde el inventario." : "Regalo: no se vende."}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button variant="secondary" onClick={() => { editor.startMove(sel[0]!); sfx("pickup"); }}><Move className="size-4" aria-hidden />Mover</Button>
            <Button variant="secondary" onClick={() => { editor.rotateSelected(); sfx("rotate"); }}><RotateCw className="size-4" aria-hidden />Girar</Button>
            <Button variant="secondary" onClick={() => { editor.storeSelected(); sfx("store"); }}><Archive className="size-4" aria-hidden />Guardar</Button>
            <Button variant="secondary" onClick={() => editor.setMulti(true)}><Layers className="size-4" aria-hidden />Agrupar</Button>
            <Button variant="ghost" onClick={() => editor.setSelected(null)}>Listo</Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm font-semibold">{editor.multi ? "Selección múltiple" : "Modo decoración"}</p>
          <p className="text-xs text-slate-500">
            {editor.multi
              ? "Toca varios muebles para moverlos juntos (por ejemplo, una mesa y sus cuatro sillas)."
              : "Toca un mueble para moverlo, girarlo o guardarlo. Teclado: flechas, R gira, M mueve, Supr guarda, Intro coloca, Esc sale."}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {editor.multi ? (
              <Button variant="secondary" onClick={() => { editor.setMulti(false); editor.setSelected(null); }}>Salir de la selección</Button>
            ) : (
              <>
                <Button variant="secondary" onClick={onInventory}><Package className="size-4" aria-hidden />Inventario</Button>
                <Button variant="secondary" onClick={() => editor.setMulti(true)}><Layers className="size-4" aria-hidden />Seleccionar varios</Button>
                {hasFeature(state.level, "styles") && <Button variant="secondary" onClick={onStyles}><Paintbrush className="size-4" aria-hidden />Acabados</Button>}
                <Button variant="secondary" onClick={onExpand} title={price === null ? "Tamaño máximo" : `Ampliar por ${price} monedas`}>
                  <Maximize2 className="size-4" aria-hidden />{price === null ? "Sala al máximo" : "Ampliar sala"}
                </Button>
                <Button onClick={onDone}><Check className="size-4" aria-hidden />Terminar</Button>
              </>
            )}
            <span className="text-[11px] text-slate-500">{editor.saving ? "Guardando…" : "Cambios guardados"}</span>
          </div>
        </>
      )}
    </div>
  );
}

/** Compra opcional de una ampliación (nunca necesaria para lo que desbloquean los niveles). */
function ExpansionDialog({ state, room, notify, onClose, onBought }: {
  state: GameState;
  room: RoomDef;
  notify: (m: string, k?: "ok" | "error") => void;
  onClose: () => void;
  onBought: () => void;
}) {
  const price = nextExpansionPrice(room.id, room.bought);
  const max = roomMax(room.id);
  const next = price === null ? null : roomAt(room.id, state.level, room.bought + 1);
  const total = getRoom(room.id).expansions.length;
  return (
    <Modal title="Ampliar la sala" onClose={onClose}>
      <h2 className="text-lg font-bold">Ampliar · {room.name}</h2>
      <p className="mt-1 text-sm text-slate-600">
        Ahora mide <strong>{room.w} × {room.h}</strong> casillas. Las salas también crecen solas al subir de nivel; en el nivel 15 alcanzan su tamaño máximo con todas las ampliaciones: <strong>{max.w} × {max.h}</strong>.
      </p>
      <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
        Ampliaciones compradas:
        {Array.from({ length: total }, (_, i) => <span key={i} className={`size-2.5 rounded-full ${i < room.bought ? "bg-emerald-500" : "bg-slate-200"}`} />)}
      </div>
      {next && price !== null ? (
        <div className="mt-4 rounded-2xl bg-amber-50 p-3 ring-1 ring-amber-200">
          <p className="text-sm font-semibold text-amber-950">{room.w} × {room.h} → {next.w} × {next.h} casillas</p>
          <p className="mt-0.5 text-xs text-amber-900">Tus muebles se quedan donde están. Precio: <Coins value={price} /> (tienes <Coins value={state.balance} />).</p>
          <Button variant="gold" className="mt-3 w-full" disabled={state.balance < price} onClick={() => {
            const r = run({ type: "buy_expansion", room: room.id, requestId: `exp-${room.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
            report(r, notify);
            if (r.ok) {
              onBought();
              onClose();
            }
          }}>
            {state.balance < price ? `Te faltan ${price - state.balance} monedas` : "Comprar ampliación"}
          </Button>
        </div>
      ) : (
        <p className="mt-4 rounded-2xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-900 ring-1 ring-emerald-200">Ya compraste todas las ampliaciones de esta sala.</p>
      )}
      <Button variant="ghost" className="mt-3 w-full" onClick={onClose}>Cerrar</Button>
    </Modal>
  );
}

function StylesDialog({ state, roomId, styles, onPick, onClose }: {
  state: GameState;
  roomId: string;
  styles: { floor: string; wall: string; window: string };
  onPick: (kind: "floor" | "wall" | "window", id: string) => void;
  onClose: () => void;
}) {
  const kinds = [["floor", "Suelo"], ["wall", "Paredes"], ["window", "Ventanas"]] as const;
  return (
    <Modal title="Acabados de la sala" onClose={onClose} wide>
      <h2 className="text-lg font-bold">Acabados · {getRoom(roomId).name}</h2>
      {kinds.map(([kind, label]) => {
        const available = new Set(availableStyles(state, kind));
        return (
          <div key={kind} className="mt-4">
            <p className="text-xs font-bold tracking-wider text-slate-500 uppercase">{label}</p>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {STYLES.filter((s) => s.kind === kind).map((s) => {
                const ok = available.has(s.id);
                return (
                  <button key={s.id} type="button" disabled={!ok} aria-pressed={styles[kind] === s.id} onClick={() => onPick(kind, s.id)}
                    className={`flex items-center gap-2 rounded-xl p-2 text-left text-xs font-semibold ring-1 disabled:opacity-45 ${styles[kind] === s.id ? "bg-emerald-50 ring-2 ring-emerald-500" : "bg-white ring-slate-200"}`}>
                    <span className="flex size-7 shrink-0 overflow-hidden rounded-md ring-1 ring-black/10" aria-hidden>
                      {s.colors.slice(0, 2).map((c) => <span key={c} className="h-full flex-1" style={{ background: c }} />)}
                    </span>
                    <span>{s.name}{!ok && <span className="block font-normal text-slate-500">{s.gift ? "Regalo de nivel" : `Nivel ${s.minLevel}`}</span>}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      <Button className="mt-5 w-full" onClick={onClose}>Hecho</Button>
    </Modal>
  );
}

// ---------------------------------------------------------------- celebraciones

function CelebrationCard({ c, state, more, onAck, onSkipAll, onGoRoom }: {
  c: Celebration;
  state: GameState;
  more: number;
  onAck: () => void;
  onSkipAll: () => void;
  onGoRoom: (room: string) => void;
}) {
  let body: ReactNode;
  if (c.type === "level") {
    const def = LEVELS[c.level]!;
    body = (
      <>
        <p className="text-xs font-bold tracking-widest text-amber-700 uppercase">¡Nivel {c.level}!</p>
        <h2 className="mt-1 text-2xl font-bold">{def.title}</h2>
        <p className="mt-1 text-sm text-slate-600">{def.summary}</p>
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-sm font-bold text-amber-900">+<Coins value={def.coins} /></p>
        {def.gifts.length > 0 && (
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {def.gifts.map((g) => {
              const item = findItem(g.item)!;
              return (
                <div key={g.item} className="w-20 rounded-xl bg-amber-50 p-1.5 ring-1 ring-amber-200">
                  <Thumb item={item} className="h-12" />
                  <p className="mt-1 line-clamp-2 text-[10px] leading-tight font-semibold">{(g.qty ?? 1) > 1 ? `${g.qty} × ` : ""}{item.name}</p>
                </div>
              );
            })}
          </div>
        )}
      </>
    );
  } else if (c.type === "achievement") {
    const a = getAchievement(c.achievementId);
    body = (
      <>
        <div className="flex justify-center"><AchievementIcon icon={a.icon} className="size-14 text-3xl" /></div>
        <p className="mt-2 text-xs font-bold tracking-widest text-amber-700 uppercase">{a.secret ? "Logro secreto" : "Logro desbloqueado"}</p>
        <h2 className="mt-1 text-xl font-bold">{a.name}</h2>
        <p className="mt-1 text-sm text-slate-600">{a.description}</p>
        <p className="mt-3 text-sm font-bold text-amber-900">+{a.coins} monedas{a.rewardLabel ? ` · ${a.rewardLabel}` : ""}</p>
      </>
    );
  } else if (c.type === "streak") {
    body = (
      <>
        <p className="text-5xl" aria-hidden>🔥</p>
        <h2 className="mt-2 text-xl font-bold">¡Racha de {c.days} días!</h2>
        <p className="mt-1 text-sm text-slate-600">+{c.coins} monedas{c.days === 30 ? " y el Calendario dorado" : c.days === 100 ? " y el Trofeo de los cien días" : ""}.</p>
      </>
    );
  } else if (c.type === "protector") {
    body = (
      <>
        <p className="text-5xl" aria-hidden>🛡️</p>
        <h2 className="mt-2 text-xl font-bold">Protector de racha</h2>
        <p className="mt-1 text-sm text-slate-600">Semana completa de lunes a domingo. Si un día no reportas, se gastará solo para salvar tu racha. Tienes {state.streak.protectors}.</p>
      </>
    );
  } else if (c.type === "expansion") {
    const r = getRoom(c.room);
    body = (
      <>
        <p className="text-5xl" aria-hidden>📐</p>
        <h2 className="mt-2 text-xl font-bold">{r.name} crece</h2>
        <p className="mt-1 text-sm text-slate-600">
          {c.auto ? "Ampliación automática por subir de nivel" : "Ampliación comprada"}: ahora mide {c.w} × {c.h} casillas. Tus muebles siguen en su sitio.
        </p>
        <Button variant="secondary" className="mt-3" onClick={() => onGoRoom(r.id)}>Ver la sala</Button>
      </>
    );
  } else if (c.type === "relocated") {
    body = (
      <>
        <p className="text-5xl" aria-hidden>📦</p>
        <h2 className="mt-2 text-xl font-bold">Hemos guardado {c.count === 1 ? "un objeto" : `${c.count} objetos`}</h2>
        <p className="mt-1 text-sm text-slate-600">Una sala es ahora más pequeña o está bloqueada, así que lo que no cabía está a salvo en tu inventario.</p>
      </>
    );
  } else {
    const r = getRoom(c.room);
    body = (
      <>
        <p className="text-5xl" aria-hidden>🏛️</p>
        <h2 className="mt-2 text-xl font-bold">Nueva sala: {r.name}</h2>
        <p className="mt-1 text-sm text-slate-600">{r.floor ? "En la planta alta. " : ""}Ya puedes decorarla.</p>
        <Button variant="secondary" className="mt-3" onClick={() => onGoRoom(r.id)}>Ir a la sala</Button>
      </>
    );
  }
  return (
    <div className="pointer-events-none fixed inset-0 z-[2500] flex items-end justify-center p-4 sm:items-center">
      <div role="dialog" aria-modal="false" aria-live="assertive" className="anim-dialog pointer-events-auto w-full max-w-sm rounded-3xl bg-white p-5 text-center shadow-2xl ring-2 ring-amber-300">
        {body}
        <div className="mt-4 flex gap-2">
          {more > 0 && <Button variant="ghost" className="flex-1" onClick={onSkipAll}>Saltar todo ({more + 1})</Button>}
          <Button variant="gold" className="flex-1" onClick={onAck}>{more > 0 ? "Siguiente" : "¡Genial!"}</Button>
        </div>
      </div>
    </div>
  );
}
