import { Analytics } from "@vercel/analytics/react";
import type { Metadata, Viewport } from "next";
import { PwaMetrics } from "@/components/PwaMetrics";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { ICON_VERSION } from "@/lib/brand";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
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
    // La clase `dark` la pone el script antes de hidratar; de ahí suppressHydrationWarning.
    <html lang="es" suppressHydrationWarning>
      <head>
        {/* En línea y bloqueante a propósito: debe ejecutarse antes del primer pintado. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="font-sans antialiased">
        {children}
        <ServiceWorkerRegister />
        <Analytics />
        <PwaMetrics />
      </body>
    </html>
  );
}
