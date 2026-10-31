"use client";

import {
  Archive, ArrowLeft, Check, Flame, Heart, ListChecks, Lock, Move, Music, Package, Paintbrush, Pencil, RotateCw, Settings,
  Store, TrendingUp, Trophy, Users, Wrench, X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getAchievement } from "@/game/data/achievements";
import { findItem } from "@/game/data/catalog";
import { DEFAULT_STYLE, getRoom, hasFeature, LEVELS, roomAt, ROOMS, roomsForLevel, STYLES, studentsForLevel } from "@/game/data/levels";
import { NEIGHBORS } from "@/game/data/neighbors";
import { gameNow, type Celebration, type GameState } from "@/game/engine";
import { itemLookup } from "@/game/engine/layout";
import { activeMissions, availableStyles } from "@/game/engine/missions";
import type { SceneInput } from "@/game/render/scene";
import type { ScenePlacement } from "@/game/render/sim";
import { sfx } from "@/game/sfx";
import { getGameState, run, useGameState } from "@/game/store";
import { madridDateKey } from "@/game/time";
import { GAME_DEV_TOOLS } from "@/lib/gamification-flag";
import { AchievementsPanel, InventoryPanel } from "./CollectionPanels";
import { DevPanel } from "./DevPanel";
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
  const stageRef = useRef<StageHandle>(null);
  const activeTab = tab ?? (desktop ? "missions" : null);

  const notify = useCallback((text: string, kind: "ok" | "error" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 3800 : 2600);
  }, []);

  const editor = useEditor(state, notify, () => sfx("place"));

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

  const ownInput = useMemo<SceneInput>(() => {
    // Mientras se mueve un mueble, solo se ve su fantasma.
    const moving = editor.ghost && !editor.ghost.fresh ? editor.ghost.uid : null;
    const placements: ScenePlacement[] = editor.placements.filter((p) => p.room === room.id && p.uid !== moving).flatMap((p) => {
      const item = itemOf(p.uid);
      return item ? [{ uid: p.uid, itemId: item.id, room: p.room, x: p.x, y: p.y, rot: p.rot }] : [];
    });
    return {
      room, placements, style: { ...DEFAULT_STYLE, ...editor.styles[room.id] }, level: roomLocked ? Math.max(1, state.level) : state.level,
      trophies: state.showcase.length, students: roomLocked ? 0 : studentsForLevel(state.level),
      librarian: hasFeature(state.level, "librarian") && !roomLocked, cat: catHere, now: minute,
    };
  }, [editor.placements, editor.styles, editor.ghost, room, roomLocked, itemOf, state.level, state.showcase.length, catHere, minute]);

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
  const ghost = editor.ghost && editor.ghost.room === room.id ? editor.ghost : null;
  const overlay = useMemo(
    () => (editing && !visiting ? { editing: true, selected: editor.selected, ghost } : { editing: false, selected: null, ghost: null }),
    [editing, visiting, editor.selected, ghost],
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
          if (tap.hit === editor.selected) editor.startMove(tap.hit);
          else editor.setSelected(tap.hit);
        } else editor.setSelected(null);
        return;
      }
      if (tap.hit === "cat") notify(`${state.catName} ronronea. 🐾`);
      else if (tap.hit) {
        const item = itemOf(tap.hit);
        if (item) notify(`${item.name} · ${item.interaction}`);
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
      } else if (e.key === "Enter" && g) {
        e.preventDefault();
        editor.placeGhost();
      } else if ((e.key === "m" || e.key === "M") && editor.selected) editor.startMove(editor.selected);
      else if ((e.key === "Delete" || e.key === "Backspace") && editor.selected) editor.storeSelected();
      else if (e.key === "Escape") {
        if (g || editor.selected) editor.cancel();
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
    if (!music.enabled) {
      run({ type: "set_settings", music: { enabled: true } });
      setAudible(true);
    } else if (!audible) setAudible(true);
    else run({ type: "set_settings", music: { enabled: false } });
  };

  // ------------------------------------------------------------ celebraciones
  const celebration = state.celebrations[0] ?? null;
  const [revealed, setRevealed] = useState<string | null>(null);
  useEffect(() => {
    if (!celebration) return;
    const def = celebration.type === "level" ? LEVELS[celebration.level] : null;
    if (celebration.type === "level") sfx("level");
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
          setEditing(true);
          editor.startPlace(uid, room.id);
          if (!desktop) setTab(null);
        }} />
      )}
      {activeTab === "missions" && <MissionsPanel state={state} now={now} notify={notify} />}
      {activeTab === "achievements" && <AchievementsPanel state={state} notify={notify} />}
      {activeTab === "progress" && <ProgressPanel state={state} now={now} notify={notify} />}
      {activeTab === "visit" && <VisitPanel state={state} now={now} onVisit={visit} />}
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
          onClick={() => setTab(activeTab === t.id && !desktop ? null : t.id)}
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
        <GameStage key={visiting ?? "own"} ref={stageRef} input={input} overlay={overlay} onTap={onTap} onHover={onHover} onCatNap={onCatNap} label={stageLabel} />

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
              {rooms.map((r) => (
                <button key={r.id} type="button" aria-pressed={room.id === r.id} onClick={() => { setRoomId(r.id); editor.cancel(); }}
                  className={`inline-flex shrink-0 items-center gap-1 rounded-xl px-2.5 py-1 text-xs font-semibold ${room.id === r.id ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
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
        {roomLocked && !neighbor && (
          <p className="absolute inset-x-4 bottom-20 mx-auto max-w-sm rounded-2xl bg-slate-900/90 p-3 text-center text-sm font-semibold text-white">
            <Lock className="mr-1 inline size-4" aria-hidden />Vista previa: {room.name} se desbloquea en el nivel {room.level}.
          </p>
        )}

        {/* Acceso al editor y siesta accesible */}
        {!editing && canEdit && (
          <div className="absolute bottom-3 left-3 flex flex-col gap-2">
            <Button onClick={() => { setEditing(true); setTab(desktop ? tab : null); }} className="shadow-lg">
              <Pencil className="size-4" aria-hidden />Decorar
            </Button>
            {hasFeature(state.level, "cat") && !state.catNapSeen && reducedMotion() && (
              <Button variant="secondary" onClick={() => onCatNap()}>Ver la siesta de {state.catName}</Button>
            )}
          </div>
        )}

        {editing && <EditorBar state={state} editor={editor} roomId={room.id} onDone={() => { editor.flush(); editor.cancel(); setEditing(false); }}
          onInventory={() => setTab("inventory")} onStyles={() => setStylesOpen(true)} />}
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

      {stylesOpen && <StylesDialog state={state} roomId={room.id} styles={{ ...DEFAULT_STYLE, ...editor.styles[room.id] }} onPick={(kind, id) => editor.setStyle(room.id, kind, id)} onClose={() => setStylesOpen(false)} />}
      {celebration && revealed === celebration.id && <CelebrationCard c={celebration} state={state} more={state.celebrations.length - 1} onAck={() => ack()} onSkipAll={() => ack(true)} onGoRoom={(r) => { setRoomId(r); setVisiting(null); ack(); }} />}
    </main>
  );
}

// ---------------------------------------------------------------- barra del editor

function EditorBar({ state, editor, roomId, onDone, onInventory, onStyles }: {
  state: GameState;
  editor: ReturnType<typeof useEditor>;
  roomId: string;
  onDone: () => void;
  onInventory: () => void;
  onStyles: () => void;
}) {
  const g = editor.ghost;
  const selectedItem = editor.selected ? itemLookup(state)(editor.selected) : undefined;
  const owned = editor.selected ? state.inventory.find((o) => o.uid === editor.selected) : undefined;
  return (
    <div className="absolute inset-x-3 bottom-3 mx-auto max-w-xl rounded-3xl bg-white/95 p-3 shadow-2xl ring-1 ring-black/10 backdrop-blur" role="toolbar" aria-label="Editor de la biblioteca">
      {g ? (
        <>
          <p className="text-sm font-semibold">{findItem(g.itemId)?.name}</p>
          <p className={`text-xs ${g.valid ? "text-emerald-700" : "text-rose-600"}`}>
            {g.valid ? "Toca otra casilla para moverlo; toca de nuevo o pulsa Colocar para dejarlo." : g.reason}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button variant="secondary" onClick={editor.rotateGhost}><RotateCw className="size-4" aria-hidden />Girar</Button>
            <Button onClick={editor.placeGhost} disabled={!g.valid}><Check className="size-4" aria-hidden />Colocar</Button>
            <Button variant="ghost" onClick={editor.cancel}>Cancelar</Button>
          </div>
        </>
      ) : selectedItem ? (
        <>
          <p className="text-sm font-semibold">{selectedItem.name}</p>
          <p className="text-xs text-slate-500">{owned?.resellable ? "Comprado: se puede vender desde el inventario." : "Regalo: no se vende."}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button variant="secondary" onClick={() => editor.startMove(editor.selected!)}><Move className="size-4" aria-hidden />Mover</Button>
            <Button variant="secondary" onClick={editor.rotateSelected}><RotateCw className="size-4" aria-hidden />Girar</Button>
            <Button variant="secondary" onClick={editor.storeSelected}><Archive className="size-4" aria-hidden />Guardar</Button>
            <Button variant="ghost" onClick={() => editor.setSelected(null)}>Listo</Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm font-semibold">Modo decoración</p>
          <p className="text-xs text-slate-500">Toca un mueble para moverlo, girarlo o guardarlo. Teclado: flechas, R gira, M mueve, Supr guarda, Intro coloca, Esc sale.</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Button variant="secondary" onClick={onInventory}><Package className="size-4" aria-hidden />Inventario</Button>
            {hasFeature(state.level, "styles") && <Button variant="secondary" onClick={onStyles}><Paintbrush className="size-4" aria-hidden />Acabados</Button>}
            <Button onClick={onDone}><Check className="size-4" aria-hidden />Terminar</Button>
            <span className="text-[11px] text-slate-500">{editor.saving ? "Guardando…" : "Cambios guardados"}</span>
          </div>
        </>
      )}
    </div>
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
