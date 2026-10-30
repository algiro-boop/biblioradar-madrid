"use client";
import { useCallback, useEffect, useState } from "react";
import { parseCommunityReports, type CommunityReport } from "@/lib/community";
import { getSupabase } from "@/lib/supabase";

/** Realtime invalidates activity; explicit refresh and polling recover missed/offline events. */
export function useCommunityActivity(refreshKey: string) {
  const [available, setAvailable] = useState(false);
  const [reports, setReports] = useState<CommunityReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let cancelled = false;
    let pending = false;
    let request: AbortController | null = null;
    async function fetchActivity() {
      if (pending || document.visibilityState === "hidden") return;
      pending = true;
      setLoading(true);
      const controller = new AbortController();
      request = controller;
      const deadline = window.setTimeout(() => controller.abort(), 15_000);
      try {
        const { data, error: rpcError } = await getSupabase().rpc("get_recent_reports", { limit_count: 5 }).abortSignal(controller.signal);
        if (cancelled) return;
        if (rpcError) {
          if (rpcError.code === "PGRST202" || rpcError.code === "42883") setAvailable(false);
          throw rpcError;
        }
        const parsed = parseCommunityReports(data);
        if (!Array.isArray(data) || parsed.length !== data.length) throw new Error("Invalid activity response");
        setReports(parsed);
        setAvailable(true);
        setError(null);
      } catch {
        if (!cancelled) setError("No se ha podido cargar la actividad. Vuelve a intentarlo.");
      } finally {
        window.clearTimeout(deadline);
        pending = false;
        if (!cancelled) setLoading(false);
      }
    }
    void fetchActivity();
    const timer = window.setInterval(() => void fetchActivity(), 60_000);
    const resume = () => void fetchActivity();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    return () => {
      cancelled = true;
      request?.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
    };
  }, [refreshKey, version]);
  return { reports, available, loading, error, refresh };
}
