import type { LocationPlatform } from "./location";

/** Evento de Chrome/Edge/Android para instalar la PWA en 1 clic (no está en los tipos del DOM). */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type InstallTab = "ios" | "android";

/** Pestaña de la guía que se abre primero según el dispositivo. */
export function defaultInstallTab(platform: LocationPlatform): InstallTab {
  return platform === "ios-safari" || platform === "ios-chrome" ? "ios" : "android";
}

/** Ya se ejecuta como app instalada (pantalla de inicio): el botón "Instalar" sobra. */
export function isStandalone(win: Pick<Window, "matchMedia"> & { navigator: { standalone?: boolean } }): boolean {
  return (
    win.navigator.standalone === true ||
    win.matchMedia("(display-mode: standalone)").matches ||
    win.matchMedia("(display-mode: fullscreen)").matches
  );
}

type Listener = () => void;

/**
 * Guarda `beforeinstallprompt` aunque llegue antes de montar el botón.
 * `snapshot` cambia de referencia en cada cambio para `useSyncExternalStore`.
 */
export function createInstallStore(target: Pick<Window, "addEventListener"> | null) {
  let deferred: BeforeInstallPromptEvent | null = null;
  let snapshot = { canPrompt: false, installed: false };
  const listeners = new Set<Listener>();
  const set = (next: Partial<typeof snapshot>) => {
    snapshot = { ...snapshot, ...next };
    listeners.forEach((l) => l());
  };

  target?.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault(); // Sin la mini-barra de Chrome: se ofrece desde nuestro botón.
    deferred = event as BeforeInstallPromptEvent;
    set({ canPrompt: true });
  });
  target?.addEventListener("appinstalled", () => {
    deferred = null;
    set({ canPrompt: false, installed: true });
  });

  return {
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    /** El evento solo se puede usar una vez: después hay que esperar a que Chrome lo vuelva a emitir. */
    async prompt(): Promise<"accepted" | "dismissed" | "unavailable"> {
      const event = deferred;
      if (!event) return "unavailable";
      deferred = null;
      set({ canPrompt: false });
      await event.prompt();
      const { outcome } = await event.userChoice;
      if (outcome === "accepted") set({ installed: true });
      return outcome;
    },
  };
}

export const installStore = createInstallStore(typeof window === "undefined" ? null : window);
