/**
 * Estado y comandos del juego. El motor es puro y determinista (sin APIs del navegador) para que
 * el mismo código pueda ejecutarse en servidor cuando haya identidad de usuario y base de datos.
 */

export type ItemSource = "purchase" | "level_reward" | "achievement" | "streak" | "dev";

export interface OwnedItem {
  uid: string;
  itemId: string;
  source: ItemSource;
  /** Monedas pagadas (0 en regalos). La reventa devuelve floor(paid / 2). */
  paid: number;
  resellable: boolean;
  acquiredAt: number;
  soldAt?: number;
}

export interface Placement {
  uid: string;
  room: string;
  x: number;
  y: number;
  /** 0–3: orientación (asientos) o giro de la huella; en pared, 0 = pared derecha, 1 = izquierda. */
  rot: number;
}

export interface RoomStyle {
  floor: string;
  wall: string;
  window: string;
}

export interface LedgerEntry {
  /** `source:sourceId`, único: el mismo evento nunca acredita dos veces. */
  key: string;
  source: string;
  sourceId: string;
  delta: number;
  at: number;
  balance: number;
  label: string;
}

export interface ReportRecord {
  id: string;
  libraryId: string;
  at: number;
  date: string;
  ordinal: number;
  coins: number;
  invalidated?: boolean;
  simulated?: boolean;
}

export interface MissionAssignment {
  /** `${periodKey}:${missionId}` */
  id: string;
  missionId: string;
  period: "daily" | "weekly";
  periodKey: string;
  assignedAt: number;
  target: number;
  /** Comunitarias: biblioteca elegida e instantánea del objetivo, inmutables durante la semana. */
  library?: { id: string; name: string };
  /** Mejor progreso observado (las de editor solo se miden al guardar). */
  progress?: number;
  completedAt?: number;
  claimedAt?: number;
  fallback?: boolean;
}

export interface Reservation {
  id: string;
  itemId: string;
  price: number;
  deposit: number;
  createdAt: number;
  expiresAt: number;
  state: "active" | "completed" | "expired" | "cancelled" | "refunded";
  closedAt?: number;
}

export interface VacationPeriod {
  id: string;
  start: string;
  plannedEnd: string;
  /** Fin efectivo (cierre manual, primer reporte o agotamiento). */
  end?: string;
  createdAt: number;
  closedReason?: "manual" | "report" | "limit";
}

export interface LayoutSaveRecord {
  at: number;
  date: string;
  /** Hechos verificados en el guardado (para misiones de decoración). */
  facts: SaveFacts;
}

export interface SaveFacts {
  changed: boolean;
  newlyPlaced: string[];
  movedOrPlaced: string[];
  decorChanged: boolean;
  floorChanged: boolean;
  /** Pares asiento-mesa / pc-asiento donde alguna pieza cambió en este guardado. */
  seatTableChanged: boolean;
  pcSeatChanged: boolean;
  floorStylesChanged?: boolean;
}

export interface CommunityInstance {
  missionId: string;
  weekKey: string;
  target: number;
  library?: { id: string; name: string };
  /** Progreso simulado del resto de la comunidad (entorno de pruebas). */
  simulatedBase: number;
  devBonus: number;
}

export type Celebration =
  | { id: string; type: "level"; level: number }
  | { id: string; type: "achievement"; achievementId: string }
  | { id: string; type: "streak"; days: number; coins: number }
  | { id: string; type: "protector" }
  | { id: string; type: "room"; room: string }
  | { id: string; type: "expansion"; room: string; w: number; h: number; auto: boolean }
  /** Aviso: objetos que ya no cabían (sala más pequeña o bloqueada) y han vuelto al inventario. */
  | { id: string; type: "relocated"; count: number };

export interface StreakInfo {
  current: number;
  best: number;
  protectors: number;
  protectorsEarned: number;
  consumedDates: string[];
  frozenDates: string[];
  perfectWeeks: string[];
  reportedToday: boolean;
}

export interface MusicSettings {
  enabled: boolean;
  track: "lofi" | "jazz" | "rain";
  volume: number;
}

export interface GameSettings {
  music: MusicSettings;
  sfx: boolean;
  /** Volumen de los efectos (0–1), independiente de la música. */
  sfxVolume: number;
  publish: boolean;
  alias: string;
}

export interface GameState {
  version: 1;
  /** Revisión de la estructura guardada (ver `migrateState`). */
  schema?: number;
  userId: string;
  createdAt: number;
  seq: number;
  name: string;
  nameCustomized: boolean;
  validReportCount: number;
  level: number;
  reports: ReportRecord[];
  ledger: LedgerEntry[];
  balance: number;
  inventory: OwnedItem[];
  placements: Placement[];
  roomStyles: Record<string, RoomStyle>;
  styleGifts: string[];
  rotations: Record<string, { ids: string[]; seedVersion: number }>;
  reservations: Reservation[];
  missions: MissionAssignment[];
  community: Record<string, CommunityInstance>;
  achievements: Record<string, { unlockedAt: number }>;
  showcase: string[];
  frame: string;
  frames: string[];
  badges: string[];
  vacations: VacationPeriod[];
  streak: StreakInfo;
  realViews: { libraryId: string; at: number; date: string }[];
  virtualVisits: { ownerId: string; room?: string; at: number; date: string }[];
  likes: Record<string, boolean>;
  /** Primer «me gusta» de cada biblioteca (deshacer y repetir no vuelve a contar). */
  likeLog: { ownerId: string; date: string }[];
  layoutSaves: LayoutSaveRecord[];
  showcaseChanges: string[];
  musicSaves: string[];
  nameSaves: string[];
  levelUps: { level: number; at: number; date: string }[];
  placedEver: string[];
  catNapSeen: boolean;
  catName: string;
  processedRequests: string[];
  settings: GameSettings;
  /** Ampliaciones compradas por sala. */
  expansions: Record<string, number>;
  celebrations: Celebration[];
  /** Solo entorno de pruebas: desplazamiento del reloj del juego. */
  devClockOffset: number;
}

export type Command =
  | { type: "tick" }
  | { type: "report_valid"; reportId: string; libraryId: string; at?: number; simulated?: boolean }
  | { type: "report_invalidated"; reportId: string }
  | { type: "view_library"; libraryId: string }
  | { type: "visit_virtual"; ownerId: string; room?: string }
  | { type: "like"; ownerId: string; liked: boolean }
  | { type: "purchase"; itemId: string; qty: number; requestId: string }
  | { type: "sell"; uid: string }
  | { type: "reserve"; itemId: string }
  | { type: "complete_reservation"; id: string }
  | { type: "cancel_reservation"; id: string }
  | { type: "save_layout"; placements: Placement[]; styles: Record<string, RoomStyle> }
  | { type: "set_name"; name: string }
  | { type: "set_cat_name"; name: string }
  | { type: "set_showcase"; ids: string[]; frame?: string }
  | { type: "claim_mission"; id: string }
  | { type: "set_settings"; music?: Partial<MusicSettings>; sfx?: boolean; sfxVolume?: number; publish?: boolean; alias?: string }
  | { type: "buy_expansion"; room: string; requestId: string }
  | { type: "cat_nap_seen" }
  | { type: "vacation_start" }
  | { type: "vacation_end" }
  | { type: "ack_celebration"; id: string }
  // Modo desarrollador (solo entorno de pruebas)
  | { type: "dev_set_level"; level: number }
  | { type: "dev_coins"; delta: number }
  | { type: "dev_clock"; offsetMs: number }
  | { type: "dev_report_days"; days: number; perDay?: number }
  | { type: "dev_complete_mission"; id: string }
  | { type: "dev_reset_missions"; period: "daily" | "weekly" }
  | { type: "dev_unlock_achievement"; id: string }
  | { type: "dev_grant_item"; itemId: string }
  | { type: "dev_community"; missionId: string; amount: number }
  | { type: "dev_admin_refund"; id: string }
  | { type: "dev_reset" };

export type CommandResult = { ok: true; message?: string } | { ok: false; error: string };

export interface Ctx {
  /** Reloj del servidor (en pruebas, con el desplazamiento del modo desarrollador). */
  now: number;
}
