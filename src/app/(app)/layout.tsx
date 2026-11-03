import { AppShell } from "@/components/app/shell";

/** Every authenticated page lives under this group and gets the app shell. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
