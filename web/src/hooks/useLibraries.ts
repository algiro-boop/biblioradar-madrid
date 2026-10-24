"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clearOccupancy, mergeOccupancy } from "@/lib/occupancy";
import {
  fetchLibraries,
  fetchOccupancy,
  subscribeToOccupancy,
  SupabaseConfigError,
} from "@/lib/supabase";
import type { LibraryWithOccupancy, OccupancyChange, RealtimeConnection } from "@/lib/types";

/** Al volver a la pestaña tras este tiempo se recarga todo: el móvil pudo cortar el WebSocket. */
const RESYNC_ON_FOCUS_MS = 60_000;

export interface LibrariesState {
  libraries: LibraryWithOccupancy[];
  loading: boolean;
  error: string | null;
  configError: boolean;
  connection: RealtimeConnection;
  reload: () => void;
  refreshLibrary: (libraryId: string) => Promise<void>;
}

export function useLibraries(): LibrariesState {
  const [libraries, setLibraries] = useState<LibraryWithOccupancy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configError, setConfigError] = useState(false);
  const [connection, setConnection] = useState<RealtimeConnection>("connecting");

  const loadedRef = useRef(false);
  const lastLoadRef = useRef(0);
  // Cambios llegados antes de terminar la carga inicial; se aplican sobre el resultado.
  const pendingRef = useRef<OccupancyChange[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const knownIdsRef = useRef<Set<string>>(new Set());

  const applyChange = useCallback((list: LibraryWithOccupancy[], change: OccupancyChange) => {
    return change.type === "DELETE"
      ? clearOccupancy(list, change.libraryId)
      : mergeOccupancy(list, change.status);
  }, []);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (!loadedRef.current) setLoading(true);
    try {
      const rows = await fetchLibraries(controller.signal);
      if (controller.signal.aborted) return;
      const pending = pendingRef.current;
      pendingRef.current = [];
      knownIdsRef.current = new Set(rows.map((r) => r.id));
      setLibraries(pending.reduce(applyChange, rows));
      setError(null);
      loadedRef.current = true;
      lastLoadRef.current = Date.now();
    } catch (err) {
      if (controller.signal.aborted) return;
      if (err instanceof SupabaseConfigError) {
        setConfigError(true);
        setError(err.message);
      } else {
        setError(
          loadedRef.current
            ? "No se pudo actualizar. Mostrando los últimos datos recibidos."
            : "No se pudieron cargar las bibliotecas. Comprueba tu conexión.",
        );
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [applyChange]);

  useEffect(() => {
    let subscription: { unsubscribe: () => void } | null = null;
    try {
      subscription = subscribeToOccupancy({
        onChange: (change) => {
          if (!loadedRef.current) {
            pendingRef.current.push(change);
            return;
          }
          // Estado de una biblioteca aún no cargada (alta nueva): recargar el catálogo.
          if (change.type !== "DELETE" && !knownIdsRef.current.has(change.status.library_id)) {
            void load();
            return;
          }
          setLibraries((prev) => applyChange(prev, change));
        },
        onConnection: setConnection,
        onResync: () => void load(),
      });
    } catch (err) {
      if (err instanceof SupabaseConfigError) {
        setConfigError(true);
        setError(err.message);
        setLoading(false);
        setConnection("offline");
        return;
      }
      throw err;
    }
    void load();

    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastLoadRef.current > RESYNC_ON_FOCUS_MS) {
        void load();
      }
    };
    const onOnline = () => void load();
    const onOffline = () => setConnection("offline");
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      subscription?.unsubscribe();
      abortRef.current?.abort();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [load, applyChange]);

  const refreshLibrary = useCallback(async (libraryId: string) => {
    try {
      const status = await fetchOccupancy(libraryId);
      if (status) setLibraries((prev) => mergeOccupancy(prev, status));
    } catch {
      // Realtime acabará entregando el cambio; no es un error para el usuario.
    }
  }, []);

  return {
    libraries,
    loading,
    error,
    configError,
    connection,
    reload: () => void load(),
    refreshLibrary,
  };
}
