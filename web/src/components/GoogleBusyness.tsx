"use client";

import { ChartNoAxesColumnIncreasing, ChevronDown, ExternalLink, LoaderCircle } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { googleMapsPlaceUrl, mountGoogleBusyness, type GoogleBusynessPhase, type GoogleLibrary } from "@/lib/google-busyness";
import { loadGooglePlaces } from "@/lib/google-places-loader";

function GoogleBusynessContent({ library, apiKey }: { library: GoogleLibrary; apiKey: string }) {
  const { id, name, address, google_place_id } = library;
  const hostRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<GoogleBusynessPhase>("loading");
  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | undefined;
    void loadGooglePlaces(apiKey).then(() => {
      if (!cancelled && hostRef.current) dispose = mountGoogleBusyness(hostRef.current, { id, name, address, google_place_id }, setPhase);
    }).catch(() => { if (!cancelled) setPhase("error"); });
    return () => { cancelled = true; dispose?.(); };
  }, [apiKey, id, name, address, google_place_id]);
  return <div className="mt-3 space-y-3 rounded-2xl bg-white p-3 ring-1 ring-slate-200">
    <div aria-live="polite" className="text-xs leading-relaxed text-slate-600">
      {phase === "loading" && <p className="flex items-center gap-2"><LoaderCircle aria-hidden className="size-4 animate-spin" />Consultando Google…</p>}
      {phase === "choose" && <p>Selecciona la ficha que corresponde a esta biblioteca para consultar su afluencia.</p>}
      {phase === "unavailable" && <p>Google no muestra horas punta para esta biblioteca en este momento.</p>}
      {phase === "empty" && <p>No hemos encontrado la ficha de esta biblioteca en Google.</p>}
      {phase === "error" && <p>No se ha podido cargar la afluencia. Puedes consultar la ficha en Google Maps.</p>}
    </div>
    <div ref={hostRef} className="max-h-[min(55dvh,28rem)] min-w-0 overflow-y-auto overscroll-contain" />
    <p className="text-[11px] leading-relaxed text-slate-500">Información de Google. La actividad en directo solo aparece cuando está disponible; no indica el número de puestos libres.</p>
    <a href={googleMapsPlaceUrl(library)} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs font-medium text-sky-700 underline underline-offset-2">Abrir ficha en Google Maps <ExternalLink aria-hidden className="size-3" /></a>
  </div>;
}

export function GoogleBusyness({ library }: { library: GoogleLibrary }) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim();
  const [requested, setRequested] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const style = "flex min-h-11 w-full items-center gap-2 rounded-2xl bg-slate-50 px-3.5 py-3 text-left text-sm font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-sky-600";
  return <section aria-label="Afluencia de Google">
    {apiKey ? <button type="button" aria-expanded={expanded} aria-controls={panelId}
      onClick={() => { setRequested(true); setExpanded((value) => !value); }} className={style}>
      <ChartNoAxesColumnIncreasing aria-hidden className="size-4 shrink-0 text-sky-600" />
      <span className="flex-1">Ver afluencia de Google</span>
      <ChevronDown aria-hidden className={`size-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
    </button> : <>
      <a href={googleMapsPlaceUrl(library)} target="_blank" rel="noopener noreferrer" className={style}>
        <ChartNoAxesColumnIncreasing aria-hidden className="size-4 shrink-0 text-sky-600" />
        <span className="flex-1">Ver afluencia de Google</span><ExternalLink aria-hidden className="size-4" />
      </a>
      <p className="mt-1.5 px-1 text-[11px] text-slate-500">Se abre Google Maps. Las horas punta y la actividad en directo dependen de los datos disponibles.</p>
    </>}
    {requested && <div id={panelId} hidden={!expanded}>
      <GoogleBusynessContent library={library} apiKey={apiKey!} />
    </div>}
  </section>;
}
