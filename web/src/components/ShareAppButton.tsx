"use client";

import { Check, Link2, MessageCircle, Share2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNativeShare } from "@/hooks/useNativeShare";
import { APP_SHARE_TEXT, shareOrCopy, SITE_URL, whatsappUrl } from "@/lib/share";

const ITEM =
  "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:bg-slate-100 focus-visible:outline-none";

/** "Compartir app": WhatsApp directo, hoja nativa en móvil y copiar enlace. */
export function ShareAppButton() {
  const native = useNativeShare();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<"copied" | "failed" | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const shareNative = async () => {
    setOpen(false);
    await shareOrCopy(APP_SHARE_TEXT, navigator, true);
  };

  const copyLink = async () => {
    const outcome = await shareOrCopy(SITE_URL, navigator, false);
    setCopied(outcome === "copied" ? "copied" : "failed");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setCopied(null);
      if (outcome === "copied") setOpen(false);
    }, 1400);
  };

  return (
    // En móvil el menú se ancla a la cabecera (no al botón) para que no se salga por la izquierda.
    <div ref={rootRef} className="lg:relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Compartir app"
        title="Compartir app"
        className={`grid size-8 place-items-center rounded-full ring-1 ring-inset transition focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:outline-none ${
          open ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50 hover:text-slate-900"
        }`}
      >
        <Share2 className="size-4" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Compartir BiblioRadar"
          className="anim-menu absolute top-full right-0 z-20 mt-2 w-64 rounded-2xl bg-white p-1.5 shadow-xl ring-1 ring-slate-900/10"
        >
          <p className="px-2.5 pt-1.5 pb-1 text-xs font-medium text-slate-500">Recomienda BiblioRadar a tus amigos</p>
          <a
            role="menuitem"
            href={whatsappUrl(APP_SHARE_TEXT)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className={ITEM}
          >
            <MessageCircle className="size-4 text-emerald-600" aria-hidden />
            Enviar por WhatsApp
          </a>
          {native && (
            <button role="menuitem" type="button" onClick={() => void shareNative()} className={ITEM}>
              <Share2 className="size-4 text-slate-500" aria-hidden />
              Más opciones…
            </button>
          )}
          <button role="menuitem" type="button" onClick={() => void copyLink()} className={ITEM}>
            {copied === "copied" ? (
              <Check className="size-4 text-emerald-600" aria-hidden />
            ) : (
              <Link2 className="size-4 text-slate-500" aria-hidden />
            )}
            <span aria-live="polite">
              {copied === "copied" ? "¡Copiado!" : copied === "failed" ? "No se pudo copiar" : "Copiar enlace"}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
