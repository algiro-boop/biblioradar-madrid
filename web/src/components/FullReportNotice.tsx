import { fullReportNotice, reportMemoryNotice } from "@/lib/report-priority";
import type { OccupancyStatus } from "@/lib/types";

export function FullReportNotice({ status, now }: { status: OccupancyStatus | null; now: number }) {
  const notice = fullReportNotice(status, now);
  const memory = reportMemoryNotice(status, now);
  if (!notice && !memory) return null;
  return <span className={`block text-xs font-semibold ${notice ? "text-red-700" : "text-slate-600"}`}>{notice ?? memory}</span>;
}
