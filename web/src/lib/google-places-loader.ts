/** Official Maps JS API, loaded once and only after an explicit user request. */
type MapsRuntime = { maps?: { importLibrary?: (name: string) => Promise<unknown> } };
type MapsWindow = Window & { google?: MapsRuntime; __biblioradarPlacesReady?: () => void };
let loading: Promise<void> | null = null;

export function loadGooglePlaces(apiKey: string): Promise<void> {
  if (typeof window === "undefined" || !apiKey.trim()) return Promise.reject(new Error("Google Places is not configured"));
  if (loading) return loading;
  const target = window as MapsWindow;
  const script = document.createElement("script");
  loading = new Promise<void>((resolve, reject) => {
    let done = false;
    const timer = window.setTimeout(() => finish(new Error("Google Places timed out")), 15_000);
    function finish(error?: Error) {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      delete target.__biblioradarPlacesReady;
      script.onerror = null;
      if (error) { script.remove(); reject(error); }
      else resolve();
    }
    async function ready() {
      try {
        const maps = target.google?.maps;
        if (!maps?.importLibrary) throw new Error("Google Places unavailable");
        await maps.importLibrary("places");
        if (!customElements.get("gmp-place-details")) throw new Error("Places UI Kit unavailable");
        finish();
      } catch { finish(new Error("Google Places unavailable")); }
    }
    if (target.google?.maps?.importLibrary) { void ready(); return; }
    target.__biblioradarPlacesReady = () => void ready();
    const params = new URLSearchParams({ key: apiKey, v: "weekly", loading: "async", libraries: "places",
      language: "es", region: "ES", auth_referrer_policy: "origin", callback: "__biblioradarPlacesReady" });
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    script.async = true;
    script.nonce = document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce ?? "";
    script.onerror = () => finish(new Error("Google Places could not load"));
    document.head.append(script);
  }).catch((error: unknown) => { loading = null; throw error; });
  return loading;
}
