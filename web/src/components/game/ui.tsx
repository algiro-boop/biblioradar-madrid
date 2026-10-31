"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { CatalogItem, Rarity } from "@/game/data/catalog";
import { itemThumbnail, styleThumbnail } from "@/game/render/scene";

/** Moneda pixel art. */
export function Coin({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 8 8" className={`${className} shrink-0`} shapeRendering="crispEdges" aria-hidden>
      <rect x="2" y="0" width="4" height="8" fill="#b7791f" />
      <rect x="0" y="2" width="8" height="4" fill="#b7791f" />
      <rect x="1" y="1" width="6" height="6" fill="#b7791f" />
      <rect x="2" y="1" width="4" height="6" fill="#f6c453" />
      <rect x="1" y="2" width="6" height="4" fill="#f6c453" />
      <rect x="3" y="2" width="2" height="4" fill="#e0a92e" />
      <rect x="2" y="2" width="1" height="1" fill="#fff4c2" />
    </svg>
  );
}

export function Coins({ value, className = "" }: { value: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 font-bold tabular-nums ${className}`}>
      <Coin />
      {value}
    </span>
  );
}

export const RARITY_STYLE: Record<Rarity, { ring: string; chip: string; label: string }> = {
  P: { ring: "ring-slate-200", chip: "bg-slate-100 text-slate-600", label: "Permanente" },
  R: { ring: "ring-sky-300", chip: "bg-sky-100 text-sky-800", label: "Raro" },
  E: { ring: "ring-violet-300", chip: "bg-violet-100 text-violet-800", label: "Épico" },
  L: { ring: "ring-amber-300", chip: "bg-amber-100 text-amber-800", label: "Legendario" },
  X: { ring: "ring-emerald-300", chip: "bg-emerald-100 text-emerald-800", label: "Exclusivo" },
};

/** Miniatura generada con el mismo sprite que se ve en la sala. */
export function Thumb({ item, className = "h-16" }: { item: CatalogItem; className?: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => setSrc(itemThumbnail(item.id)), [item.id]);
  return (
    // La imagen va absoluta dentro de la caja: en Safari/Chrome de iOS la altura al 100 % dentro de
    // una rejilla no se resolvía y el dibujo se salía sobre el nombre del artículo.
    <div className={`relative grid place-items-center ${className}`}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={item.alt} className="absolute inset-0 size-full object-contain [image-rendering:pixelated]" />
      ) : (
        <span className="text-xs text-slate-400">…</span>
      )}
    </div>
  );
}

/** Miniatura de un acabado de pared o suelo: un rincón pintado con el mismo dibujo que la sala. */
export function StyleThumb({ id, alt, className = "h-16" }: { id: string; alt: string; className?: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => setSrc(styleThumbnail(id)), [id]);
  return (
    <div className={`relative grid place-items-center ${className}`}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} className="absolute inset-0 size-full object-contain [image-rendering:pixelated]" />
      ) : (
        <span className="text-xs text-slate-400">…</span>
      )}
    </div>
  );
}

export function ProgressBar({ value, max, tone = "emerald" }: { value: number; max: number; tone?: "emerald" | "amber" | "sky" }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const color = { emerald: "bg-emerald-500", amber: "bg-amber-500", sky: "bg-sky-500" }[tone];
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <div className={`h-full rounded-full ${color} transition-[width] duration-500`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Button({
  children, onClick, disabled, variant = "primary", className = "", title, type = "button", "aria-pressed": pressed, "aria-label": label,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger" | "ghost" | "gold";
  className?: string;
  title?: string;
  type?: "button" | "submit";
  "aria-pressed"?: boolean;
  "aria-label"?: string;
}) {
  const styles = {
    primary: "bg-emerald-600 text-white hover:bg-emerald-700",
    secondary: "bg-slate-100 text-slate-800 ring-1 ring-slate-200 hover:bg-slate-200",
    danger: "bg-rose-600 text-white hover:bg-rose-700",
    ghost: "text-slate-600 hover:bg-slate-100",
    gold: "bg-amber-400 text-amber-950 hover:bg-amber-300",
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={pressed}
      aria-label={label}
      className={`inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-semibold transition-[background-color,scale,opacity] duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-45 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-bold tracking-wider text-slate-500 uppercase">{title}</h3>
        {aside && <div className="text-xs text-slate-500">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

/** Filtros por categoría en forma de chips desplazables (tienda e inventario). */
export function CategoryChips({ options, value, onChange, counts }: {
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
  counts?: Record<string, number>;
}) {
  return (
    <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="group" aria-label="Filtrar por categoría">
      {options.map((g) => (
        <button key={g} type="button" onClick={() => onChange(g)} aria-pressed={value === g}
          className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition-colors ${value === g ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-100"}`}>
          {g}{counts?.[g] !== undefined && <span className={`ml-1 tabular-nums ${value === g ? "text-white/70" : "text-slate-400"}`}>{counts[g]}</span>}
        </button>
      ))}
    </div>
  );
}

/** Buscador de texto (sin distinguir mayúsculas ni tildes). */
export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder}
      className="w-full rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-slate-200 focus:ring-2 focus:ring-sky-500 focus:outline-none" />
  );
}

export const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl bg-slate-50 p-4 text-center text-sm text-slate-500 ring-1 ring-slate-200">{children}</p>;
}

/** Diálogo modal accesible (Escape cierra). */
export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[3000] grid place-items-end bg-black/45 p-3 backdrop-blur-[2px] sm:place-items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={`anim-dialog max-h-[88dvh] w-full overflow-y-auto rounded-3xl bg-white p-5 text-slate-900 shadow-2xl ring-1 ring-slate-200 ${wide ? "max-w-lg" : "max-w-sm"}`}
      >
        {children}
      </div>
    </div>
  );
}

/** Icono pequeño de logro pixel art (a partir del tipo). */
export function AchievementIcon({ icon, locked = false, className = "size-9" }: { icon: string; locked?: boolean; className?: string }) {
  const glyph: Record<string, string> = {
    flag: "🚩", flame: "🔥", chair: "🪑", gem: "💎", map: "🗺️", users: "🤝", cat: "🐈", disc: "💿", moon: "🌙",
    star: "⭐", trophy: "🏆", shield: "🛡️", book: "📖",
  };
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-xl ${/\btext-/.test(className) ? "" : "text-lg"} ${className} ${locked ? "bg-slate-200 grayscale opacity-40" : "bg-amber-100 ring-2 ring-amber-300"}`}
      aria-hidden
    >
      {locked ? "?" : glyph[icon] ?? "⭐"}
    </span>
  );
}
