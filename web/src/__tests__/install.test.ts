import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InstallGuideModal } from "@/components/InstallAppButton";
import { createInstallStore, defaultInstallTab, isInAppBrowser, isStandalone } from "@/lib/install";
import { detectPlatform } from "@/lib/location";
import { APP_SHARE_TEXT, shareOrCopy, SITE_URL } from "@/lib/share";

afterEach(() => vi.unstubAllGlobals());

describe("guía para navegadores integrados", () => {
  it.each([
    "Mozilla/5.0 (iPhone) GSA/350.0 Mobile Safari/604.1",
    "Mozilla/5.0 (Linux; Android 14) GSA/15.1 Chrome/125.0",
    "Mozilla/5.0 (iPhone) Instagram 300.0",
    "Mozilla/5.0 (Android) TikTok 35.0",
    "Mozilla/5.0 (iPad) musical_ly_35.0 BytedanceWebview",
    "Mozilla/5.0 (iPhone) [FBAN/FBIOS;FBAV/450.0]",
    "Mozilla/5.0 (Android) FB_IAB/FB4A",
    "Mozilla/5.0 (Linux; Android 14; wv) Chrome/125.0",
    "Mozilla/5.0 (iPhone) Snapchat/13.0",
    "Mozilla/5.0 (iPhone) Line/14.0",
  ])("detecta %s", (ua) => expect(isInAppBrowser(ua)).toBe(true));

  it.each([
    "Mozilla/5.0 (iPhone) Version/18.0 Mobile Safari/604.1",
    "Mozilla/5.0 (iPhone) CriOS/125.0 Mobile Safari/604.1",
    "Mozilla/5.0 (Linux; Android 14) Chrome/125.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Macintosh) Chrome/125.0 Safari/537.36",
  ])("no confunde un navegador normal: %s", (ua) => expect(isInAppBrowser(ua)).toBe(false));

  it.each(["iPhone", "iPad", "iPod", "Macintosh"])("mantiene la guía de iOS para %s", (device) => {
    expect(defaultInstallTab(detectPlatform(`Mozilla/5.0 (${device}) GSA/350.0`, 5))).toBe("ios");
  });

  function renderGuide(userAgent: string) {
    vi.stubGlobal("navigator", { userAgent, maxTouchPoints: 0 });
    return renderToStaticMarkup(createElement(InstallGuideModal, { canPrompt: true, onClose: () => {} }));
  }

  it.each(["iPhone GSA/350.0", "Android Instagram 300", "Android; wv"])("prioriza el aviso sobre el prompt en %s", (ua) => {
    const html = renderGuide(ua);
    expect(html).toContain("¿Estás usando la app de Google o redes sociales?");
    expect(html).toContain("Abrir en Safari");
    expect(html).toContain("Abrir en Chrome");
    expect(html).toContain("📋 Copiar enlace de la web");
    expect(html).not.toContain("Instalar en 1 clic");
    expect(html.indexOf("¿Estás usando")).toBeLessThan(html.indexOf('role="tablist"'));
  });

  it("muestra el recordatorio también en Safari de iOS", () => {
    const html = renderGuide("iPhone Version/18.0 Safari/604.1");
    expect(html).toContain("¿Estás usando la app de Google o redes sociales?");
    expect(html).toContain("Compartir → Añadir a pantalla de inicio");
  });

  it("conserva el prompt y los pasos de Chrome en Android", () => {
    const html = renderGuide("Android Chrome/125.0 Safari/537.36");
    expect(html).toContain("Instalar en 1 clic");
    expect(html).not.toContain("¿Estás usando");
    expect(html).toContain("📋 Copiar enlace de la web");
  });

  it("copia la URL completa sin abrir la hoja de compartir", async () => {
    const url = `${SITE_URL}/app?library=test#map`;
    const nav = { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) }, share: vi.fn() };
    expect(await shareOrCopy(url, nav as unknown as Navigator, false)).toBe("copied");
    expect(nav.clipboard.writeText).toHaveBeenCalledExactlyOnceWith(url);
    expect(nav.share).not.toHaveBeenCalled();
  });

  it("permite mostrar ayuda si el WebView no ofrece portapapeles o rechaza la copia", async () => {
    expect(await shareOrCopy(SITE_URL, {} as Navigator, false)).toBe("failed");
    const nav = { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } };
    expect(await shareOrCopy(SITE_URL, nav as unknown as Navigator, false)).toBe("failed");
  });
});

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
      `📡 ¿Buscas sitio para estudiar en Madrid? Mira en tiempo real la ocupación de 105 bibliotecas públicas y salas de estudio en BiblioRadar: ${SITE_URL}`,
    );
  });
});
