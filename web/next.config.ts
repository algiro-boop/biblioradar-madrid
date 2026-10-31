import { networkInterfaces } from "node:os";
import type { NextConfig } from "next";

// IPs del Mac en la red local: permiten abrir el servidor de desarrollo desde el móvil
// (http://<ip>:3100). Solo afecta a `next dev`; el build de producción lo ignora.
const lanIps = Object.values(networkInterfaces())
  .flat()
  .filter((n) => n && n.family === "IPv4" && !n.internal)
  .map((n) => n!.address);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: lanIps,
  // Aislar las pruebas sin interrumpir el servidor de desarrollo del usuario.
  distDir: process.env.BIBLIORADAR_E2E === "1" ? ".next-e2e" : ".next",
  poweredByHeader: false,
  // «Mi Biblioteca» (app/mi-biblioteca/page.game.tsx): con NEXT_PUBLIC_GAMIFICATION=0 la ruta ni se
  // compila (404 nativo y ningún chunk del juego en el build).
  pageExtensions: process.env.NEXT_PUBLIC_GAMIFICATION !== "0" ? ["game.tsx", "tsx", "ts", "jsx", "js"] : ["tsx", "ts", "jsx", "js"],
  async headers() {
    return [
      {
        // El service worker debe revalidarse siempre para que las nuevas versiones lleguen rápido.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
