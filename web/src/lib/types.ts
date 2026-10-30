// Contrato Supabase: esquema original y campos aditivos del motor CSV/Beta.

export type InstitutionType = "ayuntamiento" | "comunidad" | "ucm" | "otra";

export type OccupancyLabel = "free" | "moderate" | "high" | "full";

/** Nivel visual: etiquetas SQL, desconocido o cerrado según is_open_now. */
export type OccupancyLevel = OccupancyLabel | "unknown" | "closed";

/** Niveles que ofrece el formulario (`submit_report` acepta además 30, el nivel heredado). */
export type ReportValue = 20 | 40 | 75 | 90 | 100;

export type OpeningHours = {
  timezone: "Europe/Madrid" | string;
  raw_text: string;
  normalized_text: string;
  weekly: Record<string, unknown> | null;
  requires_review: boolean;
  date_overrides?: Record<string, unknown>;
  sunday_note?: string;
};

// `type` (no `interface`): supabase-js exige que Row sea asignable a Record<string, unknown>.
export type Library = {
  id: string;
  source: string;
  source_id: string;
  source_url: string | null;
  name: string;
  institution: InstitutionType;
  address: string;
  district: string;
  lat: number;
  lng: number;
  google_place_id: string | null;
  is_active?: boolean;
  historical_popularity?: { model?: string };
  opening_hours: OpeningHours;
  total_seats: number | null;
  /** Capacidad extraída de fuentes oficiales auditadas; nunca inferida de total_seats. */
  total_capacity: number | null;
  created_at: string;
  updated_at: string;
};

export type OccupancyStatus = {
  library_id: string;
  prior_occupancy?: number | null;
  bayesian_occupancy?: number | null;
  /** Último aviso de sala completa respaldado por los reportes recientes. */
  full_reported_at?: string | null;
  /** Proyección de observaciones anteriores sobre la curva, distinta del posterior reciente. */
  report_memory_pct?: number | null;
  report_memory_at?: string | null;
  report_memory_count?: number;
  confidence_score?: number | null;
  is_open_now?: boolean | null;
  google_live_pct: number | null;
  google_hist_pct: number | null;
  predicted_base_pct: number | null;
  crowd_pct: number | null;
  /** NULL = sin datos. CSV cerrado lleva 0 e is_open_now=false. */
  final_occupancy_pct: number | null;
  /** Columna generada en SQL a partir de `final_occupancy_pct`. */
  status_label: OccupancyLabel | null;
  base_source: string;
  base_observed_at: string | null;
  base_valid_until: string | null;
  primary_source: string;
  active_reports_count: number;
  updated_at: string;
};

export type LibraryWithOccupancy = Library & {
  /** Relación 1:1. Puede faltar si la fila de estado aún no existe o no es legible. */
  occupancy: OccupancyStatus | null;
  /** Solo frontend: `occupancy` es la estimación horaria calculada en el navegador (base caducada). */
  estimatedLocally?: boolean;
};

/** Fila tal como la devuelve `select('*, occupancy_status(*)')`. PostgREST puede devolver objeto o array. */
export type LibraryRowWithEmbed = Library & {
  occupancy_status: OccupancyStatus | OccupancyStatus[] | null;
};

/** Payload crudo de `postgres_changes` sobre `public.occupancy_status`. */
export interface OccupancyRealtimePayload {
  schema: "public";
  table: "occupancy_status";
  commit_timestamp: string;
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: Partial<OccupancyStatus>;
  old: Partial<OccupancyStatus>;
  errors: string[] | null;
}

/** Cambio ya validado y normalizado que consume el estado de React. */
export type OccupancyChange =
  | { type: "INSERT" | "UPDATE"; status: OccupancyStatus }
  | { type: "DELETE"; libraryId: string };

export type RealtimeConnection = "connecting" | "live" | "reconnecting" | "offline";

export interface UserPosition {
  lat: number;
  lng: number;
  /** Radio de precisión en metros que informa el navegador. */
  accuracy: number;
  timestamp: number;
}

export type ReportErrorKind =
  | "rate_limit"
  | "too_far"
  | "invalid"
  | "network"
  | "geo_denied"
  | "geo_unavailable"
  | "insecure_context"
  | "unknown";

export interface ReportError {
  retryAfterSeconds?: number;
  kind: ReportErrorKind;
  message: string;
}

/** Tipado mínimo para el cliente de Supabase (solo lo que el frontend usa). */
export interface Database {
  public: {
    Tables: {
      libraries: {
        Row: Library;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      occupancy_status: {
        Row: OccupancyStatus;
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "occupancy_status_library_id_fkey";
            columns: ["library_id"];
            isOneToOne: true;
            referencedRelation: "libraries";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      submit_feedback: {
        Args: {
          p_category: string;
          p_message: string;
          p_device_hash: string;
          p_library_id?: string | null;
          p_contact_info?: string | null;
        };
        Returns: string;
      };
      submit_report: {
        Args: {
          p_library_id: string;
          p_reported_value: number;
          p_device_hash: string;
          p_user_lat: number;
          p_user_lng: number;
        };
        Returns: string;
      };
    };
    Enums: {
      institution_type: InstitutionType;
      occupancy_label: OccupancyLabel;
    };
    CompositeTypes: Record<string, never>;
  };
}
