# Sugerencias, cooldown y mapa en iPad

La migración `202610280006_feedback_cooldown.sql` crea `user_feedback` con RLS y sin permisos de lectura ni inserción directa para visitantes. El RPC `submit_feedback` valida categoría, mensaje de 5–1000 caracteres, contacto de hasta 200 caracteres y biblioteca opcional. Serializa la cuota por dispositivo mediante un advisory lock: máximo tres mensajes en una ventana móvil de una hora. El administrador puede leerlos en Table Editor; no se añaden a la publicación Realtime. Ningún mensaje ni contacto se envía a Analytics.

El botón «¿Falta una biblio o hay un error?» abre un diálogo nativo con formulario, modo oscuro, desplazamiento interno, Escape y restauración explícita del foco. Confirma el envío únicamente cuando Supabase devuelve el UUID. Conserva el formulario ante fallos y bloquea envíos duplicados mientras una petición está en curso. No necesita cuenta ni geolocalización.

## Cooldown

La revisión confirmó que `REPORT_COOLDOWN_MS`, localStorage y el trigger ya usaban 30 minutos. Los 90 minutos son la ventana de reportes que utiliza el motor Beta y se conservan como tal.

Había una espera excesiva posible: ante `P0001`, la web anotaba la hora actual y añadía otros 30 minutos completos, aunque al servidor solo le quedase uno. Ahora el trigger devuelve `retry_after_seconds` y el cliente conserva solo ese plazo. Se prueban expresamente un reporte de hace 31 minutos (permitido) y otro de hace 29 minutos (rechazado con unos 60 segundos pendientes).

## Causas y correcciones del mapa

1. La posición del detalle se elegía con CSS `md` a partir de 768 px, pero el código que centra el marcador decidía el modo con el **ancho del mapa**. En un iPad horizontal de 1024 px, descontar los 400 px del panel dejaba un mapa de 624 px: el código lo trataba como móvil y el detalle lateral tapaba el marcador. Ahora el mismo breakpoint de pantalla (1024 px) controla ambos, con panel de 320 px y detalle de 360 px hasta 1280 px; en escritorio amplio siguen siendo 400/420 px. La prueba comprueba que el marcador queda fuera del detalle lateral, también tras rotar.
2. No había `ResizeObserver`. `trackResize` de Leaflet observa la ventana, pero los cambios del contenedor pueden ocurrir sin un evento de ventana. El observador agrupa cambios con `requestAnimationFrame`, ignora tamaños cero, invalida al volver de lista, atiende `visualViewport`, orientación, restauración y visibilidad y limpia todos los listeners al desmontar. Recoloca el seleccionado cuando cambia la geometría.
3. La raíz ya utilizaba `h-dvh`; no se atribuye a un `100vh` inexistente el fallo anterior. Se añade fallback explícito `100vh` → `100dvh`, `min-height:0`, `min-width:0` y altura completa en la cadena flex/mapa. En retrato el mapa ocupa toda la pantalla y la lista se alterna; el detalle de tablet queda limitado al 65% de la altura.
4. Leaflet 1.9.4 ya no usa la antigua opción `tap`: no se añade esa propiedad obsoleta ni un `touch-action` global que anule sus gestos. Se desactiva la emulación de menú por pulsación prolongada (`tapHold`), que la app no utiliza. Los taps reales de los marcadores se prueban en ambos motores.

Referencias del comportamiento de las APIs: [Leaflet, invalidateSize](https://leafletjs.com/reference.html#map-invalidatesize), [WebKit, unidades dinámicas de viewport](https://webkit.org/blog/12445/new-webkit-features-in-safari-15-4/).

## Pruebas y mantenimiento

- Python: `uv run pytest -q`, `uv run ruff check .`, `uv run ruff format --check .`.
- Web: `npm test`, `npm run build -- --webpack` dentro de `web`.
- Navegador: `npx playwright install webkit chromium` y `npm run test:e2e` dentro de `web`.

Las pruebas de navegador usan WebKit y Chromium con interacción táctil a 768×1024 y 1024×768; cubren rotación, Split View de 512 px, cambio lista/mapa, marcador con detalle abierto, entrada standalone a `/app`, modal oscuro, foco, envío y rechazo antispam. APIs y teselas se simulan, sin enviar mensajes a producción. Se ejecuta un servidor separado en el puerto 3100 y `.next-e2e`, conservando el servidor de desarrollo del usuario. La CI web reproduce esa matriz y la CI Python ejecuta las migraciones y `feedback_smoke.sql` sobre PostgreSQL 16.

Estas pruebas usan el motor WebKit con viewport y tacto emulados; no sustituyen una comprobación en un iPad físico con las barras de Safari y su teclado real.

La migración se aplicó en producción el 28 de octubre de 2026 desde Supabase SQL Editor. También se ejecutó allí la prueba transaccional con `ROLLBACK`: cuota de feedback, RLS y cooldown de 30 minutos comprobados sin conservar bibliotecas, mensajes o reportes de prueba. Se verificaron por REST la denegación de lectura e inserción directa anónimas y la disponibilidad del RPC.
