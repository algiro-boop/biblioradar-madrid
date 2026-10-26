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
- `src/lib/location.ts` y `LocationHelpModal`: flujo de permisos para “Reportar” y “Cerca de mí”. Cada pulsación vuelve a pedir la ubicación, también después de un “No”. Si ya hay una posición de menos de 60 s se reutiliza; si no, se llama a `getCurrentPosition` con `maximumAge: 60000`, para no forzar en el ordenador un re-escaneo Wi-Fi que acaba en `TIMEOUT`. Solo el reintento tras un bloqueo usa `maximumAge: 0`. Si la alta precisión falla con `TIMEOUT` o `POSITION_UNAVAILABLE`, se repite automáticamente con `enableHighAccuracy: false` y `timeout: 15000`; si vuelve a fallar, se muestra un aviso con “Reintentar” (nunca la ayuda de permisos). Si aún no hay permiso, al enviar un reporte se explica por qué se pide la ubicación. Solo con `PERMISSION_DENIED` (código 1) se abre una ayuda con:
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

## Métricas de instalación y acceso PWA

El manifest conserva `id: "/"` y `display: "standalone"`; su arranque es `/app`, sin parámetros UTM. La ruta `src/app/app/page.tsx` reexporta la página principal, compartiendo su layout y contenido sin redirigir a `/`. En la tabla **Pages** de Vercel Analytics, `/` y `/app` se registran como rutas distintas con las visitas de página habituales, sin depender de eventos personalizados ni del desglose UTM. Abrir `/app` manualmente también contará en esa ruta; es atribución por ruta, no una prueba de instalación. Los iconos instalados previamente pueden conservar su antigua URL de arranque hasta actualizarse o reinstalarse. El componente cliente global `PwaMetrics` activa una única instancia por documento, protegida para SSR y remontajes de React StrictMode. No modifica el flujo del botón de instalación.

Se integra con **Vercel Analytics**, ya presente, mediante `track()`:

| Evento de analítica | Cuándo se emite |
| --- | --- |
| `pwa_installed` | Evento nativo `appinstalled` de un navegador compatible. Aceptar el prompt no lo dispara en nuestro código. |
| `pwa_first_open` | Primera apertura standalone observada en este almacenamiento local. |
| `app_open` | Cada carga del documento, tanto desde navegador como PWA; también al pasar por primera vez a modo app. `mode`, `os`, `evidence` y `confirmed_standalone` permiten segmentar. |

No se envían identificadores persistentes ni User-Agent como propiedades de Vercel Analytics. La recepción de eventos personalizados depende de la configuración/plan del proyecto y de bloqueadores del usuario; el endpoint propio funciona independientemente.

### Detección y significado de las cifras

`launchContext()` combina `matchMedia('(display-mode: standalone)')`, `navigator.standalone === true` de iOS y la ruta `/app` (además de `source=pwa` para iconos antiguos). Las dos primeras son evidencia de ejecución como app (`confirmed_standalone: true`). Si solo coincide la ruta de arranque o el query param antiguo, se registra atribución `start_url`, con `confirmed_standalone: false`: ese enlace también puede abrirse o compartirse en un navegador normal. No se usa el modo fullscreen como prueba de instalación, porque una pestaña normal también puede entrar en pantalla completa.

- **Instalaciones confirmadas observadas:** eventos `install` procedentes de `appinstalled`. iOS no proporciona este evento; no puede contabilizarse una instalación que nunca se abre.
- **Primeras aperturas:** eventos `standalone_open` con `first_open: true`. Filtra además `confirmed_standalone: true` si quieres solo modo app confirmado; las atribuciones por URL quedan separadas.
- **Accesos app frente a navegador:** contar `standalone_open` y `browser_open` respectivamente, separando la evidencia de URL si hace falta. Son cargas del documento, no un contador de cada toque físico en el icono. Restaurar una app en segundo plano sin cargar el documento no crea otro acceso. Una recarga sí crea un acceso, pero no otra primera apertura.
- **Clientes distintos:** contar `client_id` distintos en los logs. Es un UUID aleatorio de este almacenamiento, separado del identificador usado para reportar aforo. No identifica personas, no une dispositivos y no usa fingerprinting. Safari y la PWA de iOS pueden tener almacenes independientes; borrar datos o usar modo privado puede producir una nueva primera apertura.

Referencias: [detección de PWA](https://web.dev/learn/pwa/detection) y [compatibilidad de appinstalled](https://developer.mozilla.org/en-US/docs/Web/API/Window/appinstalled_event).

### Endpoint y logs

`POST /api/metrics/install` acepta JSON tipado. Emite un log JSON con `metric: "biblioradar_pwa"`, `event_id`, `client_id`, `type` (`install`, `standalone_open`, `browser_open`), `os` (`iOS`, `Android`, `Desktop`), evidencia, `first_open`, fecha declarada `occurred_at`, fecha de recepción del servidor `timestamp` y el User-Agent de la petición limitado a 512 caracteres. iPadOS con UA de Mac se identifica como iOS mediante `maxTouchPoints` del cliente.

No requiere migraciones, credenciales ni servicios adicionales: se encuentra en los logs de ejecución de `/api/metrics/install` del alojamiento (Vercel), o en stdout con `npm start`. No existe un GET público que exponga métricas. Para conservar un histórico fuera de la retención del alojamiento, conecta su exportación de logs a un almacén persistente. El endpoint valida el esquema, limita el cuerpo a 2 KiB incluso sin Content-Length, rechaza peticiones cross-site explícitas y devuelve `Cache-Control: no-store`. Los campos del cliente son telemetría declarada, no una prueba antifraude. El service worker no cachea peticiones POST.

Ejemplo de log:

```json
{"metric":"biblioradar_pwa","type":"standalone_open","os":"iOS","first_open":true,"evidence":"ios_standalone","confirmed_standalone":true,"event_id":"<uuid-cliente>:first-open","client_id":"<uuid-cliente>","occurred_at":"2026-10-26T10:00:00.000Z","timestamp":"2026-10-26T10:00:01.000Z","user_agent":"..."}
```

Para agregaciones correctas, deduplica por `event_id` antes de contar filas: la entrega al endpoint es **al menos una vez**, no exactamente una vez. Una respuesta perdida puede causar un reintento de un evento ya registrado; los logs son append-only y no tienen una restricción UNIQUE de base de datos. No sumes `install` y `first_open` para calcular instalaciones: son dos señales del mismo embudo.

### Persistencia y fallos

`biblioradar_install_tracked=1` evita repetir la primera apertura. Se guarda al encolar el evento, no al instalar: la cola persistente conserva el envío pendiente incluso tras una recarga. La cola `biblioradar_metrics_pending_v1` está limitada a 100 eventos y conserva hasta 50 instalaciones/primeras aperturas y 50 accesos normales. Una desconexión prolongada puede descartar eventos antiguos para no crecer indefinidamente.

El cliente usa `fetch` asíncrono con `keepalive` y timeout de 5 s. Solo retira pendientes tras una respuesta satisfactoria. Reintenta al recuperar red, volver a primer plano, cargar otro documento y cada minuto mientras esté visible. No bloquea el render ni pide permisos. Cuando existe Web Locks, serializa cambios de almacenamiento entre pestañas; sin esa API, la deduplicación entre pestañas simultáneas es de mejor esfuerzo. Si localStorage está bloqueado, funciona en memoria y la bandera/cola solo duran durante ese documento. Bloqueadores, cierres abruptos o almacenamiento eliminado pueden impedir la entrega; no se promete una cifra absoluta de instalaciones del sistema operativo.

### Verificación

```sh
npm test
npm run typecheck
npm run build
```

Los tests incluyen manifest, Android, Safari iOS/iPadOS, fallback por URL, primera apertura frente a recarga, aislamiento de instalación/apertura, reintentos con el mismo ID, recuperación de pendientes, almacenamiento bloqueado, cambio de modo, SSR y validación del endpoint. Para comprobar un dispositivo real: instala desde la web, abre el icono y consulta los logs; verifica evidencia `ios_standalone` o `display_mode`, una sola primera apertura y accesos posteriores. En una pestaña normal sin query param debe aparecer `browser_open`. Estas pruebas reales requieren iOS/Android; las pruebas automatizadas simulan sus señales.
