"use client";

import dynamic from "next/dynamic";

const PromoStudio = dynamic(() => import("./PromoStudio"), { ssr: false });

export function PromoLoader() {
  return <PromoStudio />;
}
