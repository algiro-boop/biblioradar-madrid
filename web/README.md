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
- `src/lib/device.ts`: UUID local persistido en `localStorage` → SHA-256 hex (`^[0-9a-f]{64}$`) y registro local de reportes de los últimos 30 min.
- `src/lib/geo.ts`: Haversine con R = 6 371 000 m (idéntico al trigger SQL), < 250 m para reportar y < 150 m para el banner.
- `src/lib/reports.ts`: mapeo de errores `P0001` (límite) y `22023` (distancia / datos inválidos).
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
