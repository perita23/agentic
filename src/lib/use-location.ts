"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

/** window.location fields without SSR/hydration mismatches (server snapshot: null). */
export function useLocation() {
  const hostname = useSyncExternalStore(noop, () => window.location.hostname, () => null);
  const port = useSyncExternalStore(noop, () => window.location.port, () => null);
  return { hostname, port };
}
