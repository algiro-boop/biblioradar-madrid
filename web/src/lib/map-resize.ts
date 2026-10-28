/** Mantiene Leaflet alineado con su elemento, incluso sin un window.resize (Split View). */
export function observeMapSize(map: {
  getContainer(): HTMLElement;
  invalidateSize(options: { pan: boolean; debounceMoveend: boolean }): unknown;
}): () => void {
  if (typeof window === "undefined") return () => {};
  const container = map.getContainer();
  let frame = 0;
  let width = -1;
  let height = -1;
  let force = false;
  let disposed = false;
  const schedule = (refresh = false) => {
    force ||= refresh;
    if (frame || disposed) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      if (disposed) return;
      if (container.clientWidth <= 0 || container.clientHeight <= 0) {
        width = 0; height = 0;
        return;
      }
      const changed = width !== container.clientWidth || height !== container.clientHeight;
      width = container.clientWidth;
      height = container.clientHeight;
      if (changed || force) map.invalidateSize({ pan: false, debounceMoveend: true });
      force = false;
    });
  };
  const resized = () => schedule();
  const restored = () => schedule(true);
  const visible = () => { if (document.visibilityState === "visible") restored(); };
  const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resized) : null;
  observer?.observe(container);
  window.addEventListener("resize", resized);
  window.addEventListener("orientationchange", restored);
  window.addEventListener("pageshow", restored);
  window.visualViewport?.addEventListener("resize", restored);
  document.addEventListener("visibilitychange", visible);
  schedule(true);
  return () => {
    disposed = true;
    observer?.disconnect();
    if (frame) window.cancelAnimationFrame(frame);
    window.removeEventListener("resize", resized);
    window.removeEventListener("orientationchange", restored);
    window.removeEventListener("pageshow", restored);
    window.visualViewport?.removeEventListener("resize", restored);
    document.removeEventListener("visibilitychange", visible);
  };
}
