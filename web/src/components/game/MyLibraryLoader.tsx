"use client";

import dynamic from "next/dynamic";

// El juego usa canvas, WebAudio y localStorage: solo en el cliente y en un bundle aparte.
const LibraryGame = dynamic(() => import("./LibraryGame"), {
  ssr: false,
  loading: () => (
    <main className="app-viewport grid place-items-center bg-[#2a1f1a] text-sm text-amber-100/80">Abriendo tu biblioteca…</main>
  ),
});

export function MyLibraryLoader() {
  return <LibraryGame />;
}
