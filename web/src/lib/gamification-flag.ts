/**
 * «Mi Biblioteca» está activa por defecto. Interruptor de apagado: `NEXT_PUBLIC_GAMIFICATION=0`
 * (en Vercel, variable de entorno + nuevo despliegue). Apagada, la ruta /mi-biblioteca ni se compila
 * (ver `pageExtensions` en next.config.ts) y el código del juego no entra en el bundle.
 */
export const GAMIFICATION_ENABLED = process.env.NEXT_PUBLIC_GAMIFICATION !== "0";

/** Modo desarrollador: además del flag, solo con `next dev` (nunca en un build de producción). */
export const GAME_DEV_TOOLS = GAMIFICATION_ENABLED && process.env.NODE_ENV === "development";
