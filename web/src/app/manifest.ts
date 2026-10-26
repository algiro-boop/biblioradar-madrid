import type { MetadataRoute } from "next";
import { ICON_VERSION } from "@/lib/brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "BiblioRadar Madrid",
    short_name: "BiblioRadar",
    description: "Ocupación en tiempo real de las bibliotecas y salas de estudio públicas de Madrid.",
    lang: "es",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f1f5f9",
    theme_color: "#0f172a",
    categories: ["education", "navigation", "utilities"],
    icons: [
      { src: `/icon-192.png?v=${ICON_VERSION}`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `/icon-512.png?v=${ICON_VERSION}`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `/icon-maskable-512.png?v=${ICON_VERSION}`, sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: `/icon.svg?v=${ICON_VERSION}`, sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
