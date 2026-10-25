"use client";

import { Check, Copy, MessageCircle, Share2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { shareOrCopy, shareText, whatsappUrl, type ShareOutcome } from "@/lib/share";
import type { LibraryWithOccupancy } from "@/lib/types";

const FEEDBACK_MS = 2000;

/** "Avisar por WhatsApp" + compartir nativo en móvil o copiar el texto en ordenador. */
export function ShareButtons({ library }: { library: Pick<LibraryWithOccupancy, "id" | "name" | "occupancy"> }) {
  const [native, setNative] = useState(false);
  const [feedback, setFeedback] = useState<ShareOutcome | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const text = shareText(library);

  useEffect(() => {
    // La hoja nativa solo en pantallas táctiles: en ordenador es más útil copiar el texto.
    setNative(typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches);
  }, []);

  useEffect(() => {
    setFeedback(null);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [library.id]);

  const onShare = async () => {
    const outcome = await shareOrCopy(text, navigator, native);
    if (outcome === "shared" || outcome === "cancelled") return;
    setFeedback(outcome);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setFeedback(null), FEEDBACK_MS);
  };

  const copied = feedback === "copied";
  const secondaryLabel = native ? "Compartir" : "Copiar texto con enlace";

  return (
    <div>
      <div className="flex gap-2">
        <a
          href={whatsappUrl(text)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl bg-white text-sm font-semibold text-slate-800 ring-1 ring-inset ring-slate-200 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:outline-none"
        >
          <MessageCircle className="size-4 text-emerald-600" aria-hidden />
          Avisar por WhatsApp
        </a>
        <button
          type="button"
          onClick={() => void onShare()}
          aria-label={secondaryLabel}
          title={secondaryLabel}
          className={`grid size-11 shrink-0 place-items-center rounded-2xl ring-1 ring-inset transition-colors focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:outline-none ${
            copied ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50 hover:text-slate-900"
          }`}
        >
          {copied ? <Check className="size-4" /> : native ? <Share2 className="size-4" /> : <Copy className="size-4" />}
        </button>
      </div>
      <p className="text-right text-xs font-medium" role="status" aria-live="polite">
        {copied && <span className="mt-1.5 block text-emerald-700">¡Copiado!</span>}
        {feedback === "failed" && <span className="mt-1.5 block text-red-700">No se pudo copiar. Usa el botón de WhatsApp.</span>}
      </p>
    </div>
  );
}
