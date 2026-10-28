import { describe, expect, it, vi } from "vitest";
import { createInstallStore, defaultInstallTab, isStandalone } from "@/lib/install";
import { APP_SHARE_TEXT, SITE_URL } from "@/lib/share";

function fakeWindow(standaloneModes: string[] = [], iosStandalone?: boolean) {
  return {
    navigator: { standalone: iosStandalone },
    matchMedia: (q: string) => ({ matches: standaloneModes.some((m) => q.includes(m)) }) as MediaQueryList,
  };
}

describe("instalación de la PWA", () => {
  it("preselecciona la pestaña del dispositivo", () => {
    expect(defaultInstallTab("ios-safari")).toBe("ios");
    expect(defaultInstallTab("ios-chrome")).toBe("ios");
    expect(defaultInstallTab("android-chrome")).toBe("android");
    expect(defaultInstallTab("desktop")).toBe("android");
  });

  it("detecta la app ya instalada (Android/escritorio y iOS)", () => {
    expect(isStandalone(fakeWindow())).toBe(false);
    expect(isStandalone(fakeWindow(["standalone"]))).toBe(true);
    expect(isStandalone(fakeWindow([], true))).toBe(true);
  });

  it("guarda beforeinstallprompt y lo lanza en 1 clic", async () => {
    const target = new EventTarget();
    const store = createInstallStore(target as unknown as Window);
    const onChange = vi.fn();
    store.subscribe(onChange);
    expect(await store.prompt()).toBe("unavailable");

    const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt: vi.fn(() => Promise.resolve()),
      userChoice: Promise.resolve({ outcome: "accepted" as const }),
    });
    target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true); // sin la mini-barra de Chrome
    expect(store.getSnapshot()).toEqual({ canPrompt: true, installed: false });

    expect(await store.prompt()).toBe("accepted");
    expect(event.prompt).toHaveBeenCalledOnce();
    expect(store.getSnapshot()).toEqual({ canPrompt: false, installed: true });
    expect(await store.prompt()).toBe("unavailable"); // el evento no se reutiliza
    expect(onChange).toHaveBeenCalled();
  });

  it("appinstalled oculta el botón", () => {
    const target = new EventTarget();
    const store = createInstallStore(target as unknown as Window);
    const before = store.getSnapshot();
    target.dispatchEvent(new Event("appinstalled"));
    expect(store.getSnapshot()).not.toBe(before);
    expect(store.getSnapshot().installed).toBe(true);
  });
});

describe("compartir la app", () => {
  it("mensaje general con el enlace", () => {
    expect(APP_SHARE_TEXT).toBe(
      `📡 ¿Buscas sitio para estudiar en Madrid? Mira en tiempo real la ocupación de 94 bibliotecas públicas y salas de estudio en BiblioRadar: ${SITE_URL}`,
    );
  });
});
