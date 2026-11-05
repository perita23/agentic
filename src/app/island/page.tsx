import type { Metadata } from "next";
import { IslandView } from "@/components/app/island-view";

export const metadata: Metadata = { title: "Isla" };

/** Rendered only inside the macOS app's island window (transparent, always on top). */
export default function IslandPage() {
  return <IslandView />;
}
