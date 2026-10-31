import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PromoLoader } from "@/components/game/PromoLoader";
import { GAME_DEV_TOOLS } from "@/lib/gamification-flag";

export const metadata: Metadata = {
  title: "Anuncio (desarrollo) · BiblioRadar Madrid",
  robots: { index: false, follow: false },
};

/** Estudio para grabar el anuncio: solo con `next dev` y el flag del juego. */
export default function PromoPage() {
  if (!GAME_DEV_TOOLS) notFound();
  return <PromoLoader />;
}
