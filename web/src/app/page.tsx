"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    if (window.location.pathname !== "/") return;
    const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (window.matchMedia("(display-mode: standalone)").matches || iosStandalone) {
      router.replace("/app");
    }
  }, [router]);

  return <AppShell />;
}
