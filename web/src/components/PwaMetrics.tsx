"use client";

import { useEffect } from "react";
import { startPwaTracking } from "@/lib/pwa-tracker";

export function PwaMetrics() {
  useEffect(() => { startPwaTracking(); }, []);
  return null;
}
