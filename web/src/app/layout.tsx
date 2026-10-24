import type { Metadata, Viewport } from "next";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import "./globals.css";

export const metadata: Metadata = {
  title: "BiblioRadar Madrid · Ocupación de bibliotecas en tiempo real",
  description:
    "Consulta en tiempo real cuánto sitio queda en las bibliotecas y salas de estudio públicas de Madrid y ayuda a otros estudiantes reportando la ocupación.",
  applicationName: "BiblioRadar Madrid",
  appleWebApp: { capable: true, title: "BiblioRadar", statusBarStyle: "default" },
  formatDetection: { telephone: false },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
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
      </body>
    </html>
  );
}
