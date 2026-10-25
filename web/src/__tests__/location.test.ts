import { afterEach, describe, expect, it, vi } from "vitest";
import { GeolocationFailure, geolocationError, getCurrentPosition } from "@/lib/geo";
import { detectPlatform, isPermissionDenied, locateWithHelp, PURPOSE_TEXT, UNLOCK_STEPS } from "@/lib/location";
import type { UserPosition } from "@/lib/types";

const POSITION: UserPosition = { lat: 40.4168, lng: -3.7038, accuracy: 12, timestamp: 1 };
const denied = () => new GeolocationFailure(geolocationError({ code: 1 }));

afterEach(() => vi.unstubAllGlobals());

function stubGeolocation(getCurrent: (ok: PositionCallback, fail: PositionErrorCallback, opts?: PositionOptions) => void) {
  vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: vi.fn(getCurrent) } });
  vi.stubGlobal("window", { isSecureContext: true });
  return (navigator.geolocation.getCurrentPosition as ReturnType<typeof vi.fn>);
}

describe("getCurrentPosition", () => {
  it("pide siempre una posición nueva (maximumAge: 0)", async () => {
    const spy = stubGeolocation((ok) =>
      ok({ coords: { latitude: 40.4, longitude: -3.7, accuracy: 9 }, timestamp: 5 } as GeolocationPosition),
    );
    await expect(getCurrentPosition()).resolves.toMatchObject({ lat: 40.4, lng: -3.7 });
    expect(spy.mock.calls[0]?.[2]).toMatchObject({ maximumAge: 0, enableHighAccuracy: true });
  });

  it("PERMISSION_DENIED se traduce a geo_denied", async () => {
    stubGeolocation((_, fail) => fail({ code: 1 } as GeolocationPositionError));
    const error = await getCurrentPosition().catch((e: unknown) => e);
    expect(isPermissionDenied(error)).toBe(true);
  });
});

describe("locateWithHelp", () => {
  it("cada pulsación vuelve a llamar a getCurrentPosition, también tras un rechazo", async () => {
    const locate = vi.fn<() => Promise<UserPosition>>().mockRejectedValueOnce(denied()).mockResolvedValueOnce(POSITION);
    const onBlocked = vi.fn(() => Promise.reject(denied()));
    await expect(locateWithHelp(locate, "near", onBlocked)).rejects.toThrow(GeolocationFailure);
    await expect(locateWithHelp(locate, "near", onBlocked)).resolves.toEqual(POSITION);
    expect(locate).toHaveBeenCalledTimes(2);
    expect(onBlocked).toHaveBeenCalledTimes(1);
  });

  it("con el permiso bloqueado abre la ayuda y resuelve cuando el reintento funciona", async () => {
    const locate = vi.fn<() => Promise<UserPosition>>().mockRejectedValue(denied());
    let retry: ((p: UserPosition) => void) | null = null;
    const onBlocked = vi.fn(
      (purpose: string) =>
        new Promise<UserPosition>((resolve) => {
          expect(purpose).toBe("report");
          retry = resolve;
        }),
    );
    const pending = locateWithHelp(locate, "report", onBlocked);
    await vi.waitFor(() => expect(retry).not.toBeNull());
    retry!(POSITION); // "Ya lo he activado, volver a intentar" con éxito
    await expect(pending).resolves.toEqual(POSITION);
  });

  it("otros errores (GPS, tiempo agotado) no muestran la ayuda de permisos", async () => {
    const timeout = new GeolocationFailure(geolocationError({ code: 3 }));
    const onBlocked = vi.fn();
    await expect(locateWithHelp(() => Promise.reject(timeout), "report", onBlocked)).rejects.toBe(timeout);
    expect(onBlocked).not.toHaveBeenCalled();
  });
});

describe("instrucciones de desbloqueo", () => {
  it.each([
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1", 0, "ios-safari"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/130.0 Mobile/15E148 Safari/604.1", 0, "ios-chrome"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15", 5, "ios-safari"],
    ["Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36", 5, "android-chrome"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0 Safari/537.36", 0, "desktop"],
  ] as const)("%s → %s", (ua, touch, platform) => {
    expect(detectPlatform(ua, touch)).toBe(platform);
  });

  it("explica el motivo y da un único paso por navegador", () => {
    expect(PURPOSE_TEXT.report).toMatch(/verificar que estás en la sala/);
    expect(PURPOSE_TEXT.near).toMatch(/bibliotecas cercanas/);
    expect(UNLOCK_STEPS["ios-safari"].step).toMatch(/aA.*Ubicación.*Permitir/);
    expect(UNLOCK_STEPS["android-chrome"].step).toMatch(/URL.*Ubicación.*Permitir/);
  });
});
