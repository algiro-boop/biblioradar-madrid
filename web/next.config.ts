import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Aislar las pruebas sin interrumpir el servidor de desarrollo del usuario.
  distDir: process.env.BIBLIORADAR_E2E === "1" ? ".next-e2e" : ".next",
  poweredByHeader: false,
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
