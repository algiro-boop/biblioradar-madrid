import { Analytics } from "@vercel/analytics/react";
import type { Metadata, Viewport } from "next";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { ICON_VERSION } from "@/lib/brand";
import "./globals.css";

export const metadata: Metadata = {
  title: "BiblioRadar Madrid · Ocupación de bibliotecas en tiempo real",
  description:
    "Consulta en tiempo real cuánto sitio queda en las bibliotecas y salas de estudio públicas de Madrid y ayuda a otros estudiantes reportando la ocupación.",
  applicationName: "BiblioRadar Madrid",
  appleWebApp: { capable: true, title: "BiblioRadar", statusBarStyle: "default" },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: `/icon.svg?v=${ICON_VERSION}`, type: "image/svg+xml" },
      { url: `/favicon.ico?v=${ICON_VERSION}`, sizes: "16x16 32x32 48x48" },
    ],
    apple: [{ url: `/apple-touch-icon.png?v=${ICON_VERSION}`, sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0f172a",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body className="font-sans antialiased">
        {children}
        <ServiceWorkerRegister />
        <Analytics />
      </body>
    </html>
  );
}
