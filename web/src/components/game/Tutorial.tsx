"use client";

import {
  ChevronLeft, ChevronRight, Coins as CoinsIcon, Flame, ListChecks, MapPin, Package, Sparkles, Store, Sunrise, Trophy, Users, X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { MAX_LEVEL } from "@/game/data/levels";
import { REPORT_COINS, REPORT_COINS_AFTER } from "@/game/engine";
import { RESERVATION_HOURS } from "@/game/engine/shop";
import { MAX_PROTECTORS } from "@/game/engine/streak";
import { Button } from "./ui";

/** Pestañas que un paso puede señalar en la barra inferior. */
export type TutorialTab = "missions" | "shop" | "inventory" | "achievements" | "progress" | "visit" | "settings";

export interface TutorialStep {
  icon: ReactNode;
  title: string;
  body: string;
  tabs?: TutorialTab[];
}

const coins = [...REPORT_COINS, REPORT_COINS_AFTER];
const list = (n: number[]) => `${n.slice(0, -1).join(", ")} y ${n[n.length - 1]}`;

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    icon: <Sparkles className="size-5" aria-hidden />,
    title: "Bienvenido a Mi Biblioteca",
    body: "Una biblioteca pixel art que crece con tus reportes reales en BiblioRadar. Te lo enseñamos en un minuto.",
  },
  {
    icon: <MapPin className="size-5" aria-hidden />,
    title: "Reporta y construye",
    body: `Cada reporte válido de ocupación en una biblioteca de Madrid cuenta. El primero levanta tu sala; con más subes de nivel (hasta el ${MAX_LEVEL}) y llegan regalos, salas nuevas y una segunda planta.`,
  },
  {
    icon: <CoinsIcon className="size-5" aria-hidden />,
    title: "Monedas",
    body: `Ganas monedas con cada reporte (${coins[0]} el primero del día, luego ${list(coins.slice(1))}), con misiones, con logros y al subir de nivel. Tu saldo está arriba a la derecha.`,
  },
  {
    icon: <Flame className="size-5" aria-hidden />,
    title: "Racha",
    body: `Reporta al menos una vez al día para mantener la llama. Cada semana completa te da un protector (hasta ${MAX_PROTECTORS}) que la salva si un día no puedes. También la verás en el mapa.`,
  },
  {
    icon: <ListChecks className="size-5" aria-hidden />,
    title: "Misiones",
    body: "Retos diarios y semanales con premio. Cuando completes uno, verás un número en la pestaña: entra y cóbralo.",
    tabs: ["missions"],
  },
  {
    icon: <Store className="size-5" aria-hidden />,
    title: "Tienda",
    body: `Muebles siempre disponibles y 3 especiales que cambian cada día a medianoche; puedes reservarlos ${RESERVATION_HOURS} h pagando una señal del 10 %. También vende suelos y paredes.`,
    tabs: ["shop"],
  },
  {
    icon: <Package className="size-5" aria-hidden />,
    title: "Inventario y decorar",
    body: "Lo que compras se guarda en el inventario. Pulsa «Decorar» para colocar, mover y girar muebles. Si algo te sobra, véndelo por la mitad de lo que pagaste.",
    tabs: ["inventory"],
  },
  {
    icon: <Trophy className="size-5" aria-hidden />,
    title: "Logros y progreso",
    body: "Los logros (algunos secretos) dan monedas. En Progreso ves tu nivel, la racha, el modo vacaciones y cada movimiento de monedas.",
    tabs: ["achievements", "progress"],
  },
  {
    icon: <Users className="size-5" aria-hidden />,
    title: "Visitar y ajustes",
    body: "En Visitar tienes bibliotecas de inspiración para coger ideas y darles «me gusta». En Ajustes cambias el nombre y la música, y puedes repetir este tutorial.",
    tabs: ["visit", "settings"],
  },
  {
    icon: <Sunrise className="size-5" aria-hidden />,
    title: "Al ritmo de Madrid",
    body: "La luz de tu biblioteca sigue la hora real de Madrid: amanece, atardece y anochece a la vez que la ciudad. ¡A construir!",
  },
];

const KEY = "biblioradar:game:tutorial:v1";
// Si el navegador no deja guardar (modo privado estricto), al menos no se repite en esta visita.
let seenThisVisit = false;

/** ¿Ya se enseñó el tutorial en este navegador? */
export function tutorialSeen(): boolean {
  if (seenThisVisit) return true;
  try {
    return localStorage.getItem(KEY) === "done";
  } catch {
    return false;
  }
}

/** Se marca al enseñarlo: aunque se cierre a medias, no vuelve a salir solo (se repite desde Ajustes). */
export function markTutorialSeen() {
  seenThisVisit = true;
  try {
    localStorage.setItem(KEY, "done");
  } catch {
    // Sin almacenamiento basta con la marca de esta visita.
  }
}

/** Paseo breve por el juego: una tarjeta por paso que señala la pestaña de la que habla. */
export function Tutorial({ onFocus, onClose }: { onFocus: (tabs: TutorialTab[]) => void; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const current = TUTORIAL_STEPS[step]!;
  const last = step === TUTORIAL_STEPS.length - 1;

  useEffect(() => markTutorialSeen(), []);
  useEffect(() => onFocus(current.tabs ?? []), [current, onFocus]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setStep((s) => Math.min(s + 1, TUTORIAL_STEPS.length - 1));
      if (e.key === "ArrowLeft") setStep((s) => Math.max(s - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div role="dialog" aria-labelledby="tutorial-title" aria-describedby="tutorial-body"
      className="anim-dialog absolute inset-x-3 bottom-3 z-30 mx-auto max-w-md rounded-3xl bg-white p-4 text-slate-900 shadow-2xl ring-1 ring-black/10">
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-amber-100 text-amber-700 ring-1 ring-amber-200">{current.icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold tracking-wide text-amber-700 uppercase">Paso {step + 1} de {TUTORIAL_STEPS.length}</p>
          <h2 id="tutorial-title" className="truncate text-base font-bold">{current.title}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Saltar el tutorial" title="Saltar"
          className="grid size-8 shrink-0 place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700">
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <p id="tutorial-body" aria-live="polite" className="mt-2 min-h-[4.5rem] text-sm leading-relaxed text-slate-600">{current.body}</p>
      <div className="mt-3 flex items-center gap-2">
        <div className="flex flex-1 gap-1" aria-hidden>
          {TUTORIAL_STEPS.map((_, i) => (
            <span key={i} className={`h-1.5 rounded-full transition-all ${i === step ? "w-4 bg-amber-500" : i < step ? "w-1.5 bg-amber-300" : "w-1.5 bg-slate-200"}`} />
          ))}
        </div>
        {step > 0 && (
          <Button variant="ghost" onClick={() => setStep(step - 1)} aria-label="Paso anterior">
            <ChevronLeft className="size-4" aria-hidden />
          </Button>
        )}
        <Button variant={last ? "gold" : "primary"} onClick={() => (last ? onClose() : setStep(step + 1))}>
          {last ? "¡Empezar!" : "Siguiente"}
          {!last && <ChevronRight className="size-4" aria-hidden />}
        </Button>
      </div>
    </div>
  );
}
