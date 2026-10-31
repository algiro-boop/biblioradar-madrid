/**
 * «Servidor» local del entorno de pruebas: guarda el estado en localStorage y ejecuta cada
 * comando con el motor (`dispatch`), que es la única autoridad. En producción este módulo se
 * sustituiría por una ruta de servidor con identidad de usuario y base de datos (ver README).
 */

import { useSyncExternalStore } from "react";
import { dispatch, gameNow, initialState, migrateState, type Command, type CommandResult, type GameState } from "./engine";

const KEY = "biblioradar:game:v1";
const listeners = new Set<() => void>();
let state: GameState | null = null;

function newUserId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `prueba-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function read(): GameState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GameState;
    return parsed?.version === 1 ? migrateState(parsed) : null;
  } catch {
    return null;
  }
}

function write(next: GameState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Sin almacenamiento (modo privado): se juega en memoria durante la sesión.
  }
}

function emit() {
  for (const l of listeners) l();
}

export function getGameState(): GameState {
  if (!state) {
    state = read() ?? initialState(newUserId(), Date.now());
    write(state);
  }
  return state;
}

/** Hora del juego: la real más el desplazamiento del modo desarrollador. */
export function currentGameNow(): number {
  return gameNow(getGameState(), Date.now());
}

export function run(cmd: Command): CommandResult {
  const prev = getGameState();
  const { state: next, result } = dispatch(prev, cmd, { now: gameNow(prev, Date.now()) });
  if (next !== prev) {
    state = next;
    write(next);
    emit();
  }
  return result;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Otra pestaña cambió el progreso: se recarga para no pisarlo.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    state = read() ?? state;
    emit();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useGameState(): GameState {
  return useSyncExternalStore(subscribe, getGameState, getGameState);
}
