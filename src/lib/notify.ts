"use client";

import { useSyncExternalStore } from "react";

const KEY = "agentic.notifications";
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export function notificationsSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notificationsEnabled(): boolean {
  if (!notificationsSupported()) return false;
  try {
    return localStorage.getItem(KEY) === "1" && Notification.permission === "granted";
  } catch {
    return false;
  }
}

export async function setNotificationsEnabled(on: boolean): Promise<boolean> {
  if (!notificationsSupported()) return false;
  if (on && Notification.permission !== "granted") {
    const p = await Notification.requestPermission();
    if (p !== "granted") return false;
  }
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {}
  listeners.forEach((fn) => fn());
  return on;
}

/** SSR-safe hook: `{ supported, enabled }`, re-rendering when the preference changes. */
export function useNotificationPref() {
  const supported = useSyncExternalStore(subscribe, notificationsSupported, () => true);
  const enabled = useSyncExternalStore(subscribe, notificationsEnabled, () => false);
  return { supported, enabled };
}
