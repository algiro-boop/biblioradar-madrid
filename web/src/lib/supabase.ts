import {
  createClient,
  type RealtimeChannel,
  type RealtimePostgresChangesPayload,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { isValidDeviceHash } from "./device";
import { parseLibraryRow, parseOccupancyStatus } from "./occupancy";
import { isReportValue, mapReportError } from "./reports";
import type {
  Database,
  LibraryWithOccupancy,
  OccupancyChange,
  OccupancyStatus,
  RealtimeConnection,
  ReportError,
  ReportValue,
} from "./types";

export class SupabaseConfigError extends Error {
  constructor() {
    super(
      "Faltan NEXT_PUBLIC_SUPABASE_URL y/o NEXT_PUBLIC_SUPABASE_ANON_KEY. Copia web/.env.example a web/.env.local.",
    );
    this.name = "SupabaseConfigError";
  }
}

let client: SupabaseClient<Database> | null = null;

export function getSupabase(): SupabaseClient<Database> {
  if (client) return client;
  // Referencias literales: Next.js solo inyecta NEXT_PUBLIC_* escritas así.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new SupabaseConfigError();
  client = createClient<Database>(url, anonKey, {
    // Sin login: no persistir ni refrescar sesiones.
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: { params: { eventsPerSecond: 10 } },
  });
  return client;
}

/** `SELECT *, occupancy_status(*) FROM libraries`, validado y normalizado. */
export async function fetchLibraries(signal?: AbortSignal): Promise<LibraryWithOccupancy[]> {
  let query = getSupabase().from("libraries").select("*, occupancy_status(*)").eq("is_active", true).order("name");
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error) throw new Error(error.message || "No se pudieron cargar las bibliotecas.");
  return ((data ?? []) as unknown[])
    .map(parseLibraryRow)
    .filter((row): row is LibraryWithOccupancy => row !== null);
}

/** Recupera el estado de una sola biblioteca (respaldo si Realtime no está conectado). */
export async function fetchOccupancy(libraryId: string): Promise<OccupancyStatus | null> {
  const { data, error } = await getSupabase()
    .from("occupancy_status")
    .select("*")
    .eq("library_id", libraryId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return parseOccupancyStatus(data);
}

/** Convierte el payload crudo de Realtime en un cambio validado, o null si no es utilizable. */
export function toOccupancyChange(
  payload: Pick<RealtimePostgresChangesPayload<OccupancyStatus>, "eventType" | "new" | "old">,
): OccupancyChange | null {
  if (payload.eventType === "DELETE") {
    const id = (payload.old as Partial<OccupancyStatus>).library_id;
    return typeof id === "string" ? { type: "DELETE", libraryId: id } : null;
  }
  const status = parseOccupancyStatus(payload.new);
  return status ? { type: payload.eventType, status } : null;
}

export interface OccupancySubscription {
  unsubscribe: () => void;
}

/**
 * Escucha INSERT/UPDATE/DELETE de `public.occupancy_status`.
 * `onResync` se llama tras cada reconexión: los eventos perdidos mientras tanto no se reenvían.
 */
export function subscribeToOccupancy(handlers: {
  onChange: (change: OccupancyChange) => void;
  onConnection: (state: RealtimeConnection) => void;
  onResync: () => void;
}): OccupancySubscription {
  const supabase = getSupabase();
  let subscribedOnce = false;
  let disposed = false;
  handlers.onConnection("connecting");
  const channel: RealtimeChannel = supabase
    .channel("public:occupancy_status")
    .on<OccupancyStatus>(
      "postgres_changes",
      { event: "*", schema: "public", table: "occupancy_status" },
      (payload) => {
        const change = toOccupancyChange(payload);
        if (change) handlers.onChange(change);
      },
    )
    .subscribe((status) => {
      if (disposed) return;
      if (status === "SUBSCRIBED") {
        handlers.onConnection("live");
        if (subscribedOnce) handlers.onResync();
        subscribedOnce = true;
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        handlers.onConnection("reconnecting");
      } else if (status === "CLOSED") {
        handlers.onConnection("offline");
      }
    });
  return {
    unsubscribe: () => {
      disposed = true;
      void supabase.removeChannel(channel);
    },
  };
}

export type SubmitReportResult =
  | { ok: true; reportId: string }
  | { ok: false; error: ReportError };

/** Única escritura pública: RPC `submit_report`. El servidor revalida distancia y límite. */
export async function submitReport(input: {
  libraryId: string;
  value: ReportValue;
  deviceHash: string;
  lat: number;
  lng: number;
}): Promise<SubmitReportResult> {
  if (
    !isReportValue(input.value) ||
    !isValidDeviceHash(input.deviceHash) ||
    !Number.isFinite(input.lat) ||
    !Number.isFinite(input.lng)
  ) {
    return { ok: false, error: mapReportError({ code: "22023", message: "Reporte inválido" }) };
  }
  try {
    const { data, error } = await getSupabase().rpc("submit_report", {
      p_library_id: input.libraryId,
      p_reported_value: input.value,
      p_device_hash: input.deviceHash,
      p_user_lat: input.lat,
      p_user_lng: input.lng,
    });
    if (error) return { ok: false, error: mapReportError(error) };
    return { ok: true, reportId: String(data) };
  } catch (err) {
    return {
      ok: false,
      error: mapReportError({ message: err instanceof Error ? err.message : String(err) }),
    };
  }
}
