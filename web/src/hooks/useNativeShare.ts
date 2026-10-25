"use client";

import { useEffect, useState } from "react";

/** Hoja nativa de compartir solo en pantallas táctiles: en ordenador es más útil copiar. */
export function useNativeShare(): boolean {
  const [native, setNative] = useState(false);
  useEffect(() => {
    setNative(typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches);
  }, []);
  return native;
}
