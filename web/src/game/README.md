# Mi Biblioteca: gamificación

Implementación completa de `GAMIFICACION_BIBLIORADAR.md`: 15 niveles, biblioteca virtual pixel art con 4 salas, editor libre, 164 artículos dibujados por código, personajes y gato animados, tienda diaria con reservas, monedas con libro contable, 45 misiones diarias y 30 semanales, 40 logros (5 secretos), rachas con protectores, modo vacaciones y música ambiente generativa. Rankings: no (fase 2).

## Interruptor y aislamiento

El juego está activo por defecto. `NEXT_PUBLIC_GAMIFICATION=0` (en Vercel: variable de entorno y nuevo despliegue) lo apaga por completo:

| Barrera | Efecto con `=0` |
| --- | --- |
| `GAMIFICATION_ENABLED` (`lib/gamification-flag.ts`) | No hay botón ni enganches en la app. |
| `pageExtensions` en `next.config.ts` | La ruta `app/mi-biblioteca/page.game.tsx` no se compila: 404 nativo y **0 chunks del juego** en `.next/static`. |
| `process.env.NEXT_PUBLIC_GAMIFICATION !== "0"` literal en `AppShell` y `useReport` | Código muerto eliminado en el build. |
| Misiones comunitarias: `NEXT_PUBLIC_GAME_COMMUNITY=1` | Apagadas por defecto hasta que haya datos reales de la comunidad (su progreso global solo existe simulado). |
| Modo desarrollador: flag **y** `NODE_ENV === "development"` | Nunca existe en un `next build`, ni siquiera con el flag. |
| Estado en `localStorage` (`biblioradar:game:v1`) | El juego no lee ni escribe en Supabase. |

Aviso: en local, un **reporte real** sigue yendo a la base de datos de `.env.local`, igual que antes. Para probar el juego usa «Simular 1 reporte» del panel Dev.

## Estructura

- `engine/`: motor puro y determinista. `dispatch(state, command, { now })` es la única autoridad de reglas (precios, saldo, nivel, colocación). Es transaccional e idempotente (cada abono tiene una clave única `origen:id`). No usa APIs del navegador, así que puede ejecutarse en servidor tal cual.
- `data/`: catálogo, niveles y salas, misiones, logros y bibliotecas vecinas ficticias.
- `render/`: canvas isométrico a resolución nativa, escalado sin suavizado. Simulación de estudiantes, bibliotecaria y gato, cinemáticas y partículas. Se pausa en segundo plano y respeta `prefers-reduced-motion`.
- `store.ts`: «servidor» local (localStorage + `useSyncExternalStore`). `bridge.ts`: enlace con la app (reporte válido, consulta de ficha).
- `audio.ts`: lo-fi, jazz y lluvia compuestos con WebAudio (sin archivos ni licencias). Nunca suena sin un gesto del usuario.
- Pruebas: `src/__tests__/game-engine.test.ts` (37 casos de la §14).

## Interpretaciones de la especificación (a confirmar)

1. **Especial de nivel 1 garantizado frente a 60/30/10.** Solo si en un día ningún hueco sale raro (≈6 % de los días), el primero se fuerza a raro de nivel 1. Las proporciones medidas siguen siendo ≈60/30/10.
2. **Misiones comunitarias.** El progreso del resto de la comunidad está simulado (determinista por semana). Para cobrarlas hace falta aportar al menos un reporte válido.
3. **Visitas y «me gusta».** Hay 8 bibliotecas públicas ficticias. Publicar la tuya es solo un ajuste local.
4. **Siesta del gato (A36).** Cuenta al presenciarla con la página visible. Con movimiento reducido hay un botón equivalente.
5. **Objetos concedidos en Dev.** Son regalos: no se pueden vender.

## Riesgos y requisitos para producción (no implementados a propósito)

1. **Identidad.** La app no tiene cuentas (solo un hash anónimo de dispositivo). Haría falta, por ejemplo, autenticación anónima de Supabase con posibilidad de vincular cuenta. Si no, el progreso se pierde al borrar datos o cambiar de móvil.
2. **Autoridad en servidor.** `localStorage` es manipulable. En producción, `dispatch` debe correr en una ruta de servidor o Edge Function con tablas `game_state` y `coin_ledger` (clave única) y bloqueo optimista por versión.
3. **Validez de reportes.** `report_valid` debería dispararse desde el servidor (trigger tras `submit_report` y su moderación), no desde el cliente. `report_invalidated` ya está soportado.
4. **Comunidad real.** Las metas comunitarias necesitan estadísticas agregadas reales (media de 4 semanas) y una instantánea semanal en BD.
5. **Privacidad y moderación.** Alias y nombres de biblioteca públicos requieren filtro de contenido. Nunca se debe exponer la ubicación ni los reportes del usuario.
6. **Rendimiento.** El canvas va a unos 30 fps y se pausa oculto. Conviene medirlo en móviles de gama baja antes de publicar.

## Probarlo

```bash
cd web && npm run dev -- --port 3100
```

Abre <http://localhost:3100/mi-biblioteca> o el botón «Mi Biblioteca · Pruebas» del mapa. La pestaña **Dev** permite:

- Cambiar de nivel (0–15).
- Sumar o quitar monedas.
- Simular reportes y días seguidos.
- Mover el reloj del juego (horas, días, semanas o una fecha concreta).
- Ver la tienda de los próximos 7 días.
- Completar y reasignar misiones, y añadir progreso comunitario.
- Desbloquear logros.
- Ver el gato antes del nivel 3.
- Conceder cualquier artículo.
- Ver todas las salas.
- Reembolsar reservas (retirada administrativa).
- Reiniciar todo el progreso.
