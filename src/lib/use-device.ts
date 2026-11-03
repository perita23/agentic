"use client";

import { useApi } from "@/lib/api";

/** "MacBook Pro de Hugo", or a neutral fallback while loading / if unknown. */
export function useDeviceName(fallback = "tu dispositivo") {
  const { data } = useApi<{ name: string }>("/api/device", { revalidateOnFocus: false });
  return data?.name || fallback;
}
