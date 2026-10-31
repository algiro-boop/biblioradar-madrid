"use client";

import { CheckCircle2, LoaderCircle, MessageSquarePlus, Send, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { getDeviceHash } from "@/lib/device";
import { FEEDBACK_CATEGORIES, feedbackValidation, submitFeedback, type FeedbackCategory } from "@/lib/feedback";
import type { Library } from "@/lib/types";

type Choice = Pick<Library, "id" | "name">;

/** El diálogo nativo aporta foco contenido, Escape y fondo inerte también en Safari. */
export function FeedbackButton({ libraries, compact = false }: { libraries: Choice[]; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<FeedbackCategory>("sugerencia");
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [libraryId, setLibraryId] = useState("");
  const [phase, setPhase] = useState<"idle" | "sending" | "success">("idle");
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) {
      dialog.close();
      openerRef.current?.focus({ preventScroll: true });
    }
  }, [open]);

  function show() {
    if (phase === "success") {
      setMessage(""); setContact(""); setLibraryId(""); setCategory("sugerencia");
      setPhase("idle");
    }
    setError(null);
    setOpen(true);
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current) return;
    const invalid = feedbackValidation({ category, message, contactInfo: contact });
    if (invalid) { setError(invalid); return; }
    busyRef.current = true;
    setPhase("sending");
    setError(null);
    try {
      const result = await submitFeedback({ category, message, contactInfo: contact,
        libraryId: libraryId || null, deviceHash: await getDeviceHash() });
      if (result.ok) setPhase("success");
      else { setError(result.message); setPhase("idle"); }
    } catch {
      setError("No se pudo enviar el mensaje. Abre la app con HTTPS y vuelve a intentarlo.");
      setPhase("idle");
    } finally {
      busyRef.current = false;
    }
  }

  const field = "mt-1 w-full min-w-0 max-w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 focus:border-sky-600 focus:outline-2 focus:outline-sky-600";
  return (
    <>
      <button ref={openerRef} type="button" onClick={show} aria-haspopup="dialog"
        aria-label="¿Falta una biblio o hay un error?"
        className={`${compact ? "" : "mt-2"} flex min-h-9 items-center gap-2 rounded-xl px-2 text-xs font-medium text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-sky-600`}
        title="¿Falta una biblio o hay un error?">
        <MessageSquarePlus className="size-4" aria-hidden />
        {compact ? "Sugerencias" : "¿Falta una biblio o hay un error?"}
      </button>
      <dialog ref={dialogRef} aria-labelledby="feedback-title" aria-describedby="feedback-description"
        onCancel={() => setOpen(false)} onClose={() => { setOpen(false); openerRef.current?.focus({ preventScroll: true }); }}
        onClick={(e) => {
          if (e.target !== e.currentTarget) return;
          const r = e.currentTarget.getBoundingClientRect();
          if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) setOpen(false);
        }}
        className="feedback-dialog rounded-3xl bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-black/50">
        <div className="flex max-h-[inherit] flex-col p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <div className="flex shrink-0 items-start justify-between gap-3">
            <div>
              <h2 id="feedback-title" className="text-lg font-bold">Sugerencias y errores</h2>
              <p id="feedback-description" className="mt-1 text-sm text-slate-600">Ayúdanos a mejorar BiblioRadar.</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar sugerencias"
              className="grid size-11 shrink-0 place-items-center rounded-full hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-sky-600"><X className="size-5" /></button>
          </div>
          {phase === "success" ? (
            <div className="py-8 text-center" role="status">
              <CheckCircle2 className="mx-auto size-10 text-emerald-600" aria-hidden />
              <p className="mt-3 font-semibold">¡Gracias! Hemos recibido tu mensaje.</p>
              <p className="mt-2 text-sm text-slate-600">Lo revisaremos para mejorar la app.</p>
              <button type="button" onClick={() => setOpen(false)} className="mt-5 rounded-full bg-slate-900 px-6 py-3 font-semibold text-white">Cerrar</button>
            </div>
          ) : (
            // suppressHydrationWarning: Chrome para iOS añade __gcruniqueid a los campos antes de hidratar.
            <form suppressHydrationWarning onSubmit={(e) => void send(e)} aria-busy={phase === "sending"} className="mt-4 min-h-0 space-y-3 overflow-y-auto overscroll-contain px-0.5 pb-0.5">
              <fieldset disabled={phase === "sending"} className="min-w-0 space-y-3 disabled:opacity-60">
                <label className="block text-sm font-medium">Tipo de mensaje
                  <select suppressHydrationWarning value={category} onChange={(e) => setCategory(e.target.value as FeedbackCategory)} className={field}>
                    {FEEDBACK_CATEGORIES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label className="block text-sm font-medium">Biblioteca (opcional)
                  <select suppressHydrationWarning value={libraryId} onChange={(e) => setLibraryId(e.target.value)} className={field}>
                    <option value="">Ninguna / no aparece en el catálogo</option>
                    {libraries.map((library) => <option key={library.id} value={library.id}>{library.name}</option>)}
                  </select>
                </label>
                <div>
                  <label htmlFor="feedback-message" className="block text-sm font-medium">Mensaje</label>
                  <textarea suppressHydrationWarning id="feedback-message" required minLength={5} maxLength={1000} rows={4} value={message} onChange={(e) => setMessage(e.target.value)}
                    placeholder="Cuéntanos qué falta o qué podemos corregir…" className={`${field} resize-y`} aria-describedby="feedback-length" />
                </div>
                <p id="feedback-length" className="text-right text-xs text-slate-500">{[...message].length}/1000 caracteres</p>
                <label className="block text-sm font-medium">Email o usuario de contacto (opcional)
                  <input suppressHydrationWarning type="text" maxLength={200} autoComplete="off" value={contact} onChange={(e) => setContact(e.target.value)} className={field} placeholder="Solo si quieres que podamos responderte" />
                </label>
              </fieldset>
              <p className="text-xs text-slate-500">Tu mensaje y contacto no se publican. No necesitas cuenta ni compartir tu ubicación. Máximo 3 envíos por hora.</p>
              {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
              <button type="submit" disabled={phase === "sending"} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 font-semibold text-white disabled:opacity-60">
                {phase === "sending" ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
                {phase === "sending" ? "Enviando…" : "Enviar mensaje"}
              </button>
            </form>
          )}
        </div>
      </dialog>
    </>
  );
}
