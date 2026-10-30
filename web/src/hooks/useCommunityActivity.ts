"use client";
import { useEffect, useState } from "react";
import { parseCommunityReports, type CommunityReport } from "@/lib/community";
import { getSupabase } from "@/lib/supabase";

/** Occupancy Realtime changes invalidate activity; polling recovers missed/offline events. */
export function useCommunityActivity(refreshKey: string) {
  const [available, setAvailable] = useState(false);
  const [reports, setReports] = useState<CommunityReport[]>([]);
  useEffect(() => {
    let cancelled = false;
    let pending = false;
    const controller = new AbortController();
    async function refresh() {
      if (pending || document.visibilityState === "hidden") return;
      pending = true;
      try {
        const { data, error } = await getSupabase().rpc("get_recent_reports", { limit_count: 5 }).abortSignal(controller.signal);
        if (!cancelled && !error) { setReports(parseCommunityReports(data)); setAvailable(true); }
      } catch { /* Retain the last snapshot on temporary network/configuration failures. */ }
      finally { pending = false; }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60_000);
    const resume = () => void refresh();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    return () => {
      cancelled = true; controller.abort(); window.clearInterval(timer);
      document.removeEventListener("visibilitychange", resume); window.removeEventListener("online", resume);
    };
  }, [refreshKey]);
  return { reports, available };
}
