import { fullReportNotice } from "@/lib/report-priority";
import type { OccupancyStatus } from "@/lib/types";

export function FullReportNotice({ status, now }: { status: OccupancyStatus | null; now: number }) {
  const notice = fullReportNotice(status, now);
  if (!notice) return null;
  return <span className="block text-xs font-semibold text-red-700">{notice}</span>;
}
