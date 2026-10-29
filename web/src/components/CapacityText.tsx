import { capacityText } from "@/lib/capacity";
import type { LibraryWithOccupancy } from "@/lib/types";

export function CapacityText({ library, className = "" }: {
  library: Pick<LibraryWithOccupancy, "total_capacity" | "occupancy">;
  className?: string;
}) {
  const text = capacityText(library.total_capacity, library.occupancy);
  if (text === null) return null;
  return <span className={className} title="Capacidad oficial. Las plazas libres son una estimación, no un recuento en tiempo real.">{text}</span>;
}
