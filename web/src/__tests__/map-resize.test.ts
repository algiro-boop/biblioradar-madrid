import { afterEach, expect, it, vi } from "vitest";
import { observeMapSize } from "@/lib/map-resize";

afterEach(() => vi.unstubAllGlobals());
it("observa cambios reales del contenedor, agrupa raf y se limpia al desmontar", () => {
  let tick: FrameRequestCallback | null = null;
  const win = new EventTarget();
  Object.assign(win, { requestAnimationFrame: vi.fn((fn: FrameRequestCallback) => { tick = fn; return 1; }), cancelAnimationFrame: vi.fn(), visualViewport: new EventTarget() });
  const doc = new EventTarget();
  Object.assign(doc, { visibilityState: "visible" });
  let notify: () => void = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("ResizeObserver", class {
    constructor(fn: () => void) { notify = fn; }
    observe = vi.fn();
    disconnect = disconnect;
  });
  const container = { clientWidth: 768, clientHeight: 1024 };
  const map = { getContainer: () => container as HTMLElement, invalidateSize: vi.fn() };
  const flush = () => { const fn = tick; tick = null; fn?.(0); };
  const dispose = observeMapSize(map);
  flush();
  expect(map.invalidateSize).toHaveBeenCalledTimes(1);
  container.clientWidth = 1024; container.clientHeight = 768;
  notify(); notify(); flush();
  expect(map.invalidateSize).toHaveBeenCalledTimes(2);
  expect(map.invalidateSize).toHaveBeenLastCalledWith({ pan: false, debounceMoveend: true });
  notify(); flush(); // Sin cambio no escribe, evitando bucles de ResizeObserver.
  expect(map.invalidateSize).toHaveBeenCalledTimes(2);
  container.clientWidth = 0; notify(); flush();
  expect(map.invalidateSize).toHaveBeenCalledTimes(2);
  container.clientWidth = 1024; notify(); flush();
  expect(map.invalidateSize).toHaveBeenCalledTimes(3);
  win.dispatchEvent(new Event("pageshow")); flush();
  expect(map.invalidateSize).toHaveBeenCalledTimes(4);
  dispose();
  expect(disconnect).toHaveBeenCalledOnce();
  win.dispatchEvent(new Event("resize")); flush();
  expect(map.invalidateSize).toHaveBeenCalledTimes(4);
});
