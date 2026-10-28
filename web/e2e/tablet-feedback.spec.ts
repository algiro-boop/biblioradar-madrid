import { expect, test, type Page } from "@playwright/test";

const ID = "00000000-0000-4000-8000-000000000001";
const NOW = () => new Date().toISOString();
async function fixtures(page: Page) {
  await page.route("https://e2e.supabase.co/rest/v1/libraries**", (route) => route.fulfill({ json: [{
    id: ID, source: "test", source_id: "test", name: "Biblioteca de prueba", institution: "ayuntamiento",
    address: "Madrid", district: "Centro", lat: 40.4168, lng: -3.7038, is_active: true,
    historical_popularity: { model: "csv-v1" },
    opening_hours: { timezone: "Europe/Madrid", requires_review: false, weekly: {}, raw_text: "Lunes a viernes 8:30–21:00" },
    occupancy_status: { library_id: ID, final_occupancy_pct: 40, bayesian_occupancy: 40, predicted_base_pct: 40,
      status_label: "free", is_open_now: true, confidence_score: 0, active_reports_count: 0,
      primary_source: "Estimación bayesiana · CSV", updated_at: NOW(),
      base_valid_until: new Date(Date.now() + 30 * 60_000).toISOString() },
  }] }));
  await page.route("https://tile.openstreetmap.org/**", (route) => route.fulfill({ contentType: "image/svg+xml", body:
    '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e2e8f0"/><path d="M0 128H256M128 0V256" stroke="#fff" stroke-width="12"/></svg>' }));
}

async function fullMap(page: Page) {
  const map = page.getByRole("region", { name: "Mapa de bibliotecas" });
  await expect(map).toBeVisible();
  await expect(map.locator(".leaflet-container")).toBeVisible();
  await expect(map.locator(".leaflet-tile-loaded").first()).toBeVisible();
  await expect.poll(async () => map.locator(".leaflet-container").evaluate((el) => {
    const r = el.getBoundingClientRect();
    const tiles = [...el.querySelectorAll("img.leaflet-tile-loaded")].map((t) => t.getBoundingClientRect());
    return r.width > 250 && r.height > 300 && tiles.length > 0
      && Math.min(...tiles.map((t) => t.left)) <= r.left + 1
      && Math.max(...tiles.map((t) => t.right)) >= r.right - 1
      && Math.min(...tiles.map((t) => t.top)) <= r.top + 1
      && Math.max(...tiles.map((t) => t.bottom)) >= r.bottom - 1;
  })).toBe(true);
  const viewport = page.viewportSize()!;
  await expect.poll(() => page.locator("main").evaluate((el) => Math.round(el.getBoundingClientRect().height))).toBe(viewport.height);
  expect(await page.locator("html").evaluate((el) => el.scrollWidth)).toBeLessThanOrEqual(viewport.width);
}

for (const size of [{ width: 768, height: 1024 }, { width: 1024, height: 768 }]) {
  test.describe(`${size.width}x${size.height}`, () => {
    test.use({ viewport: size });
    test.beforeEach(async ({ page }) => { await fixtures(page); });
    test("mapa completo, cambio de vista y marcador táctil", async ({ page }, testInfo) => {
      await page.goto("/");
      await fullMap(page);
      if (size.width < 1024) {
        await page.getByRole("tab", { name: "Lista", exact: true }).tap();
        await expect(page.getByRole("list", { name: "Bibliotecas" })).toBeVisible();
        await page.getByRole("tab", { name: "Mapa", exact: true }).tap();
        await fullMap(page);
      }
      const marker = page.getByRole("region", { name: "Mapa de bibliotecas" }).getByRole("button", { name: /Biblioteca de prueba:/ });
      await marker.tap();
      const drawer = page.getByRole("dialog", { name: "Biblioteca de prueba", exact: true });
      await expect(drawer).toBeVisible();
      if (size.width >= 1024) {
        // Regresión: el drawer lateral tapaba el marcador al usar el ancho del mapa como breakpoint.
        await expect.poll(async () => {
          const pin = await marker.boundingBox(); const panel = await drawer.boundingBox();
          return !!pin && !!panel && pin.x + pin.width / 2 < panel.x - 8;
        }).toBe(true);
      }
      await page.getByRole("button", { name: "Cerrar detalle" }).tap();
      await page.screenshot({ path: testInfo.outputPath(`mapa-${size.width}x${size.height}.png`) });
    });
    test("rotación, Split View y vuelta a pantalla completa", async ({ page }) => {
      await page.goto("/");
      await fullMap(page);
      const marker = page.getByRole("region", { name: "Mapa de bibliotecas" }).getByRole("button", { name: /Biblioteca de prueba:/ });
      await marker.tap();
      const drawer = page.getByRole("dialog", { name: "Biblioteca de prueba", exact: true });
      await expect(drawer).toBeVisible();
      for (const viewport of [{ width: size.height, height: size.width }, { width: 512, height: 768 }, size]) {
        await page.setViewportSize(viewport);
        await fullMap(page);
        if (viewport.width >= 1024) {
          await expect.poll(async () => {
            const pin = await marker.boundingBox(); const panel = await drawer.boundingBox();
            return !!pin && !!panel && pin.x + pin.width / 2 < panel.x - 8;
          }).toBe(true);
        }
      }
    });
    test("apertura standalone de iPad redirige a /app y conserva el mapa", async ({ page }) => {
      await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { value: true, configurable: true }));
      await page.goto("/");
      await expect(page).toHaveURL(/\/app$/);
      await fullMap(page);
    });
    test("modal oscuro accesible, envío privado y confirmación", async ({ page }) => {
      let payload: Record<string, unknown> | undefined;
      await page.route("https://e2e.supabase.co/rest/v1/rpc/submit_feedback", async (route) => {
        payload = route.request().postDataJSON();
        await route.fulfill({ json: ID });
      });
      await page.emulateMedia({ colorScheme: "dark" });
      await page.goto("/app");
      const opener = page.getByRole("button", { name: "¿Falta una biblio o hay un error?" });
      await opener.tap();
      const dialog = page.getByRole("dialog", { name: "Sugerencias y errores" });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel("Tipo de mensaje").selectOption("error_horario");
      await dialog.getByLabel("Biblioteca (opcional)").selectOption(ID);
      await dialog.getByLabel("Mensaje", { exact: true }).fill("El horario de los sábados ha cambiado.");
      await dialog.getByLabel("Email o usuario de contacto (opcional)").fill("prueba@example.org");
      await dialog.getByRole("button", { name: "Enviar mensaje" }).tap();
      await expect(dialog.getByRole("status")).toContainText("Hemos recibido tu mensaje");
      expect(payload).toMatchObject({ p_category: "error_horario", p_library_id: ID, p_contact_info: "prueba@example.org" });
      expect(payload?.p_device_hash).toMatch(/^[a-f0-9]{64}$/);
      await dialog.getByRole("button", { name: "Cerrar", exact: true }).tap();
      await expect(dialog).not.toBeVisible();
      await expect(opener).toBeFocused();
      await opener.click();
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
    });
    test("un rechazo antispam conserva el formulario y no confirma el envío", async ({ page }) => {
      await page.route("https://e2e.supabase.co/rest/v1/rpc/submit_feedback", (route) => route.fulfill({ status: 400,
        json: { code: "P0001", message: "Máximo 3 sugerencias por hora", details: '{"retry_after_seconds":120}' } }));
      await page.goto("/");
      await page.getByRole("button", { name: "¿Falta una biblio o hay un error?" }).tap();
      const dialog = page.getByRole("dialog", { name: "Sugerencias y errores" });
      await dialog.getByLabel("Mensaje", { exact: true }).fill("Falta una biblioteca de mi distrito.");
      await dialog.getByRole("button", { name: "Enviar mensaje" }).tap();
      await expect(dialog.getByRole("alert")).toContainText("2 min");
      await expect(dialog.getByLabel("Mensaje", { exact: true })).toHaveValue("Falta una biblioteca de mi distrito.");
    });
  });
}
