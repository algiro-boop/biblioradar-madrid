/**
 * La gamificación solo existe en el entorno de pruebas: hace falta `NEXT_PUBLIC_GAMIFICATION=1`
 * en el `.env.local` de esta rama. En Vercel no está definida: la ruta /mi-biblioteca ni se compila
 * (ver `pageExtensions` en next.config.ts) y el código del juego no entra en el bundle.
 */
export const GAMIFICATION_ENABLED = process.env.NEXT_PUBLIC_GAMIFICATION === "1";

/** Modo desarrollador: además del flag, solo con `next dev` (nunca en un build de producción). */
export const GAME_DEV_TOOLS = GAMIFICATION_ENABLED && process.env.NODE_ENV === "development";
