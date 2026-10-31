import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MyLibraryLoader } from "@/components/game/MyLibraryLoader";
import { GAMIFICATION_ENABLED } from "@/lib/gamification-flag";

export const metadata: Metadata = {
  title: "Mi Biblioteca (pruebas) · BiblioRadar Madrid",
  robots: { index: false, follow: false },
  // Sin barra de traducción de Chrome: en móviles en otro idioma desplazaba la página y tapaba la barra superior.
  other: { google: "notranslate" },
};

/** Solo existe en el entorno de pruebas: sin el flag, 404 como cualquier ruta inexistente. */
export default function MyLibraryPage() {
  if (!GAMIFICATION_ENABLED) notFound();
  return <MyLibraryLoader />;
}
