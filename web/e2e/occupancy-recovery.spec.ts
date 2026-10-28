import { expect, test } from "@playwright/test";

test("recupera estimaciones caducadas sin recargar cuando Realtime está desconectado", async ({ page }) => {
  const id = "00000000-0000-4000-8000-000000000001";
  const now = Date.now();
  const status = (pct: number, updated: number, valid: number) => ({
    library_id: id, final_occupancy_pct: pct, predicted_base_pct: pct,
    bayesian_occupancy: pct, active_reports_count: 0, is_open_now: true,
    status_label: "free", updated_at: new Date(updated).toISOString(),
    base_valid_until: new Date(valid).toISOString(), primary_source: "Estimación bayesiana · CSV",
  });
  await page.clock.install({ time: now });
  await page.routeWebSocket(/\/realtime\//, (socket) => socket.close());
  await page.route("https://e2e.supabase.co/rest/v1/libraries**", (route) => route.fulfill({ json: [{
    id, name: "Biblioteca de prueba", source: "test", source_id: "recovery", institution: "ayuntamiento",
    address: "Madrid", district: "Centro", lat: 40.4, lng: -3.7, is_active: true,
    historical_popularity: { model: "csv-v1" },
    occupancy_status: status(40, now - 3_600_000, now - 1),
  }] }));
  let snapshots = 0;
  await page.route("https://e2e.supabase.co/rest/v1/occupancy_status**", (route) => {
    snapshots++;
    return route.fulfill({ json: [status(25, now, now + 1_800_000)] });
  });
  await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
  await page.goto("/");
  const marker = page.getByRole("region", { name: "Mapa de bibliotecas" })
    .getByRole("button", { name: /Biblioteca de prueba:/ });
  await expect(marker).toHaveAccessibleName(/sin datos/);
  await page.clock.fastForward(61_000);
  await expect(marker).toHaveAccessibleName(/25%/);
  expect(snapshots).toBeGreaterThan(0);
});
