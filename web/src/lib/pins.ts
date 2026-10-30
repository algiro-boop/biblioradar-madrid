import { pinDelayBucket } from "./motion";
import { formatPinText, LEVEL_STYLES, LEVEL_TEXT } from "./occupancy";
import type { OccupancyLevel } from "./types";

export type PinState = {
  level: OccupancyLevel;
  pct: number | null;
  name: string;
  selected: boolean;
  /** Alguien confirmó la ocupación hace poco: halo de radar. */
  live: boolean;
  /** El porcentaje acaba de cambiar en tiempo real: rebote breve. */
  changed: boolean;
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Clase del contenedor de Leaflet: la entrada escalonada solo depende de la biblioteca. */
export function pinClassName(id: string): string {
  return `biblio-pin pin-enter pin-d${pinDelayBucket(id)}`;
}

/** HTML del pin: píldora con el porcentaje (o "?"/"Cerrada") y punta del mismo color. */
export function pinHtml({ level, pct, name, selected, live, changed }: PinState): string {
  const s = LEVEL_STYLES[level];
  const muted = !selected && (level === "closed" || level === "unknown");
  const label =
    level === "closed" ? `${name}: cerrada` : pct === null ? `${name}: sin datos` : `${name}: ${pct}%, ${LEVEL_TEXT[level]}`;
  const scale = selected
    ? "pin-selected"
    : muted
      ? "scale-90 opacity-80 hover:scale-100 hover:opacity-100"
      : "hover:scale-110";
  const halo = live && level !== "closed"
    ? `<span class="pin-live pointer-events-none absolute top-4 left-1/2 -mt-5 -ml-5 size-10 rounded-full ${s.bg}" aria-hidden="true"></span>`
    : "";
  return `
    <div class="relative ${changed ? "pin-pop" : ""}" role="img" aria-label="${escapeHtml(label)}${live ? ", confirmada hace poco" : ""}">
      ${halo}
      <div class="relative flex flex-col items-center transition-[scale,opacity] duration-200 ${scale}">
        <div class="relative z-10 flex h-8 min-w-11 items-center justify-center rounded-full px-2 text-[13px] leading-none font-bold tabular-nums shadow-md shadow-slate-900/20 ring-2 ${selected ? "ring-slate-900" : "ring-white"} ${s.bg} ${s.text}">${level === "closed" ? "Cerrada" : formatPinText(pct)}</div>
        <div class="-mt-1.5 size-3 rotate-45 rounded-[2px] shadow-md ${s.bg}"></div>
      </div>
    </div>`;
}
