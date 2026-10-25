# BiblioRadar Madrid · Web (Fase 3)

PWA mobile-first en Next.js (App Router) + Tailwind CSS 4 + React-Leaflet. Consume directamente el Supabase de las Fases 1 y 2 con la clave pública `anon`, sin modificar el esquema.

## Puesta en marcha

```sh
cp .env.example .env.local   # rellena NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY
npm install
npm run dev
```

| Script | Qué hace |
| --- | --- |
| `npm run dev` | Servidor de desarrollo |
| `npm run build` / `npm start` | Build de producción y servidor |
| `npm run typecheck` | `tsc --noEmit` en modo estricto |
| `npm test` | Tests de Vitest (`src/__tests__`) |
| `npm run icons` | Regenera los PNG de la PWA desde `public/icon.svg` |

Geolocalización y Web Crypto solo funcionan en contexto seguro: `localhost` o HTTPS. Para probar en el móvil usa un túnel HTTPS o el despliegue, no la IP de la red local.

## Estructura

- `src/lib/types.ts`: contrato exacto de `libraries`, `occupancy_status`, Realtime y RPC.
- `src/lib/occupancy.ts`: validación de filas y payloads, etiquetas, colores y caducidad. `final_occupancy_pct = null` se muestra como `?` / "Sin datos recientes", nunca como 0 %.
- `src/lib/estimate.ts`: estimación horaria del navegador, idéntica a la de Python (curva, exámenes, fin de semana, puntos por centro con SHA-256, horario revisado y texto de fin de semana), siempre en `Europe/Madrid` con CET/CEST. `AppShell` la aplica cuando `base_valid_until` ya pasó y no hay reportes de los últimos 90 min. Así, a las 09:00 en punto se muestra la ocupación de apertura aunque el último snapshot sea anterior, sin avisos de “dato desactualizado”. `useNow` hace ticks alineados al reloj (:00 y :30 s) y al volver a la pestaña. La paridad se comprueba con `src/__tests__/fixtures/estimate-vectors.json`, generado por `uv run python tests/estimate_vectors.py`: un test de Python falla si el fichero no coincide con el motor. El navegador no conoce el horario de Google ni la lluvia: tras caducar la base, la estimación usa solo el horario del catálogo, hasta la siguiente ejecución del cron.
- `src/lib/device.ts`: UUID local persistido en `localStorage` → SHA-256 hex (`^[0-9a-f]{64}$`) y registro local de reportes de los últimos 30 min.
- `src/lib/geo.ts`: Haversine con R = 6 371 000 m (idéntico al trigger SQL), < 250 m para reportar y < 150 m para el banner.
- `src/lib/reports.ts`: los cinco niveles de reporte (20 casi vacía, 40 bastante sitio, 75 pocos sitios, 90 casi llena, 100 completa) y el mapeo de errores `P0001` (límite) y `22023` (distancia / datos inválidos).
- `src/lib/location.ts` y `LocationHelpModal`: flujo de permisos para “Reportar” y “Cerca de mí”. Cada pulsación vuelve a llamar a `getCurrentPosition` con `maximumAge: 0`, también después de un “No”. Si aún no hay permiso, al enviar un reporte se explica por qué se pide la ubicación. Si el navegador responde `PERMISSION_DENIED`, se abre una ayuda con:
  - el motivo;
  - el paso para desbloquearla en el navegador detectado (iOS Safari, Chrome iOS, Chrome Android u ordenador);
  - el botón “Ya lo he activado, volver a intentar”, que reintenta sin recargar y completa el reporte o el filtro pendiente.
- `src/lib/supabase.ts`: `select('*, occupancy_status(*)')`, suscripción `postgres_changes` a `occupancy_status` y RPC `submit_report`.
- `src/hooks/`: estado de bibliotecas con Realtime (resincroniza tras reconexión, al volver a la pestaña y al recuperar red), geolocalización y flujo de reporte.
- `src/components/`: `AppShell`, `Header` (buscador, pills, toggle Mapa/Lista), `MapView`, `LibraryList`, `LibraryDrawer`, `ReportButtons` y `ProximityBanner`.
- `public/sw.js`: service worker que cachea solo el shell propio; nunca Supabase ni teselas.

## Mapa

CARTO Positron exige ya una API key: sin clave devuelve teselas con "API KEY REQUIRED". Por defecto se usan las teselas estándar de OpenStreetMap, aclaradas con un filtro CSS. Para Positron u otro proveedor, define `NEXT_PUBLIC_MAP_TILE_URL` (y `NEXT_PUBLIC_MAP_TILE_ATTRIBUTION`). El servidor público de OSM está pensado para tráfico moderado. Con tráfico real conviene un proveedor con clave.

## Límites conocidos

- Realtime no reenvía eventos perdidos durante una desconexión. Por eso se recarga el catálogo completo al reconectar.
- El registro local de reportes solo sirve como aviso inmediato. El límite real de 30 min y la distancia los aplica PostgreSQL.
- La posición la declara el navegador, que puede falsearla (ver README raíz).
