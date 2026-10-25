"use client";

import { Download, LoaderCircle, Smartphone, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { BRAND_ICON_SRC } from "@/lib/brand";
import { defaultInstallTab, installStore, isStandalone, type InstallTab } from "@/lib/install";
import { detectPlatform, type LocationPlatform } from "@/lib/location";
import {
  AndroidConfirm,
  AndroidMenu,
  AndroidMenuButton,
  IosConfirm,
  IosShareBar,
  IosShareSheet,
} from "./InstallMockups";

const SERVER_SNAPSHOT = { canPrompt: false, installed: false };

type Step = { title: string; detail: string; Mockup: () => React.ReactElement };

const STEPS: Record<InstallTab, Step[]> = {
  ios: [
    {
      title: "Pulsa Compartir",
      detail: "Es el cuadrado con la flecha hacia arriba de la barra de Safari. En iOS 26, si no lo ves, pulsa antes «···».",
      Mockup: IosShareBar,
    },
    {
      title: "Elige «Añadir a pantalla de inicio»",
      detail: "Desliza el menú hacia arriba si no aparece a la vista (en iOS 26 puede estar dentro de «Ver más»).",
      Mockup: IosShareSheet,
    },
    {
      title: "Pulsa «Añadir»",
      detail: "Arriba a la derecha. El icono de BiblioRadar aparecerá en tu pantalla de inicio.",
      Mockup: IosConfirm,
    },
  ],
  android: [
    {
      title: "Abre el menú ⋮",
      detail: "Los tres puntos de arriba a la derecha en Chrome.",
      Mockup: AndroidMenuButton,
    },
    {
      title: "Pulsa «Instalar aplicación»",
      detail: "En algunos móviles aparece como «Añadir a pantalla de inicio».",
      Mockup: AndroidMenu,
    },
    {
      title: "Confirma con «Instalar»",
      detail: "Busca el icono de BiblioRadar en tu pantalla de inicio o en el cajón de aplicaciones.",
      Mockup: AndroidConfirm,
    },
  ],
};

const TABS: ReadonlyArray<{ value: InstallTab; label: string }> = [
  { value: "ios", label: "iPhone (iOS)" },
  { value: "android", label: "Android" },
];

function InstallGuideModal({
  canPrompt,
  onClose,
}: {
  canPrompt: boolean;
  onClose: () => void;
}) {
  const platform = useMemo<LocationPlatform>(() => detectPlatform(navigator.userAgent, navigator.maxTouchPoints), []);
  const [tab, setTab] = useState<InstallTab>(() => defaultInstallTab(platform));
  const [prompting, setPrompting] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const tabRefs = useRef<Record<InstallTab, HTMLButtonElement | null>>({ ios: null, android: null });

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const install = async () => {
    setPrompting(true);
    try {
      if ((await installStore.prompt()) === "accepted") onClose();
    } finally {
      setPrompting(false);
    }
  };

  const onTabKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const next: InstallTab = tab === "ios" ? "android" : "ios";
    setTab(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className="fixed inset-0 z-[1300] flex items-end justify-center bg-slate-950/40 p-3 md:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-title"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92dvh] w-full max-w-md flex-col rounded-3xl bg-white shadow-2xl"
      >
        <div className="flex items-start gap-3 p-5 pb-3">
          <img src={BRAND_ICON_SRC} alt="" width={48} height={48} className="size-12 shrink-0 rounded-xl shadow-md" />
          <div className="min-w-0 flex-1">
            <h2 id="install-title" className="text-base font-bold text-slate-900">
              Instala BiblioRadar
            </h2>
            <p className="mt-0.5 text-sm text-slate-600">
              Tenla a un toque desde la pantalla de inicio, a pantalla completa y como cualquier otra app.
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="-mt-1 -mr-1 rounded-full p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            aria-label="Cerrar"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {canPrompt && (
            <div className="mb-4">
              <button
                type="button"
                onClick={() => void install()}
                disabled={prompting}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-60"
              >
                {prompting ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
                Instalar en 1 clic
              </button>
              <p className="mt-2 text-center text-xs text-slate-500">o sigue estos pasos:</p>
            </div>
          )}

          {platform === "desktop" && (
            <p className="mb-3 flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-600 ring-1 ring-inset ring-slate-200">
              <Smartphone className="mt-0.5 size-4 shrink-0 text-slate-400" />
              Abre {"biblioradar-madrid.vercel.app"} en el navegador de tu móvil y sigue estos pasos.
            </p>
          )}

          <div className="flex rounded-2xl bg-slate-100 p-1" role="tablist" aria-label="Sistema del móvil" onKeyDown={onTabKey}>
            {TABS.map(({ value, label }) => (
              <button
                key={value}
                ref={(el) => {
                  tabRefs.current[value] = el;
                }}
                type="button"
                role="tab"
                id={`install-tab-${value}`}
                aria-selected={tab === value}
                aria-controls="install-steps"
                tabIndex={tab === value ? 0 : -1}
                onClick={() => setTab(value)}
                className={`h-9 flex-1 rounded-xl text-sm font-semibold transition ${
                  tab === value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "ios" && platform === "ios-chrome" && (
            <p className="mt-3 rounded-xl bg-sky-50 p-3 text-xs text-sky-900">
              En Chrome para iPhone, el botón Compartir está arriba, a la derecha de la barra de direcciones. El resto de
              pasos es igual.
            </p>
          )}

          <ol id="install-steps" role="tabpanel" aria-labelledby={`install-tab-${tab}`} className="mt-4 space-y-5">
            {STEPS[tab].map(({ title, detail, Mockup }, i) => (
              <li key={title}>
                <div className="flex items-start gap-3">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-slate-900 text-xs font-bold text-white">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{title}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{detail}</p>
                  </div>
                </div>
                <div className="mt-2.5 pl-10">
                  <Mockup />
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

/** Píldora "📲 Instalar app". Se oculta si la app ya se ejecuta instalada. */
export function InstallAppButton() {
  const { canPrompt, installed } = useSyncExternalStore(installStore.subscribe, installStore.getSnapshot, () => SERVER_SNAPSHOT);
  // null hasta montar: así no parpadea el botón dentro de la app instalada.
  const [standalone, setStandalone] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const query = window.matchMedia("(display-mode: standalone)");
    const update = () => setStandalone(isStandalone(window as Window & { navigator: { standalone?: boolean } }));
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  if (standalone !== false || installed) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label="Instalar app"
        className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2.5 text-xs font-semibold whitespace-nowrap text-emerald-800 ring-1 ring-inset ring-emerald-200 transition hover:bg-emerald-100 focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:outline-none"
      >
        <span aria-hidden>📲</span> Instalar<span className="hidden min-[400px]:inline md:hidden"> app</span>
      </button>
      {open && createPortal(<InstallGuideModal canPrompt={canPrompt} onClose={close} />, document.body)}
    </>
  );
}
