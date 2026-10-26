/** Contrato común del cliente y endpoint. No contiene código que acceda al DOM al importar. */
export type MetricsOS = "iOS" | "Android" | "Desktop";
export type LaunchEvidence = "display_mode" | "ios_standalone" | "start_url" | "browser";
export type MetricsEventType = "install" | "standalone_open" | "browser_open";

export interface PwaMetric {
  event_id: string;
  client_id: string;
  type: MetricsEventType;
  os: MetricsOS;
  evidence: LaunchEvidence;
  confirmed_standalone: boolean;
  first_open: boolean;
  occurred_at: string;
}

export function metricsOS(userAgent: string, maxTouchPoints = 0): MetricsOS {
  if (/iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1)) return "iOS";
  return /Android/i.test(userAgent) ? "Android" : "Desktop";
}

export function launchContext(win: {
  matchMedia: (query: string) => { matches: boolean };
  navigator: { standalone?: boolean };
  location: { search: string; pathname?: string };
}): { evidence: LaunchEvidence; standalone: boolean; confirmed: boolean } {
  if (win.navigator.standalone === true) return { evidence: "ios_standalone", standalone: true, confirmed: true };
  if (win.matchMedia("(display-mode: standalone)").matches) return { evidence: "display_mode", standalone: true, confirmed: true };
  if (win.location.pathname === "/app" || win.location.pathname === "/app/" || new URLSearchParams(win.location.search).get("source") === "pwa") return { evidence: "start_url", standalone: true, confirmed: false };
  return { evidence: "browser", standalone: false, confirmed: false };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isPwaMetric(value: unknown): value is PwaMetric {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.client_id === "string" && UUID.test(v.client_id)
    && typeof v.event_id === "string" && (UUID.test(v.event_id) || v.event_id === `${v.client_id}:first-open`)
    && ["install", "standalone_open", "browser_open"].includes(String(v.type))
    && ["iOS", "Android", "Desktop"].includes(String(v.os))
    && ["display_mode", "ios_standalone", "start_url", "browser"].includes(String(v.evidence))
    && typeof v.confirmed_standalone === "boolean" && typeof v.first_open === "boolean"
    && typeof v.occurred_at === "string" && v.occurred_at.length <= 35 && Number.isFinite(Date.parse(v.occurred_at))
    && (!v.first_open || v.type === "standalone_open")
    && (v.type !== "browser_open" || (v.evidence === "browser" && !v.confirmed_standalone))
    && (v.type !== "standalone_open" || v.evidence !== "browser")
    && (v.confirmed_standalone === (v.evidence === "ios_standalone" || v.evidence === "display_mode"));
}
