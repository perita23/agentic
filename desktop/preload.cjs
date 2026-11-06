// Minimal, sandbox-safe bridge: the web UI can only ask the native app to
// check for updates, read its version and manage the app lock. No Node APIs are exposed.
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("agenticDesktop", {
  isDesktop: true,
  version: () => ipcRenderer.invoke("agentic:version"),
  checkForUpdates: () => ipcRenderer.invoke("agentic:check-for-updates"),
  openPrivacySettings: () => ipcRenderer.invoke("agentic:open-privacy"),
  copyText: (text) => ipcRenderer.invoke("agentic:copy", String(text)),
  // Dictation: a native helper listens and sends back text and levels (see lib/voice.cjs).
  voice: {
    available: () => ipcRenderer.invoke("voice:available"),
    start: (lang) => ipcRenderer.invoke("voice:start", String(lang)),
    stop: () => ipcRenderer.send("voice:stop"),
    cancel: () => ipcRenderer.send("voice:cancel"),
    onEvent: (cb) => {
      const h = (_e, o) => cb(o);
      ipcRenderer.on("voice:event", h);
      return () => ipcRenderer.removeListener("voice:event", h);
    },
  },
  lock: {
    info: () => ipcRenderer.invoke("agentic:lock-info"),
    setTouchId: (on) => ipcRenderer.invoke("agentic:set-touch-id", !!on),
    changePassword: (current, next) => ipcRenderer.invoke("agentic:change-password", String(current), String(next)),
  },
});

// Tell the web UI it runs inside the macOS window so it can leave room for the
// traffic lights and make its top bars draggable (see globals.css).
const mark = () => {
  document.documentElement.dataset.desktop = process.platform === "darwin" ? "mac" : "other";
};
if (document.documentElement) mark();
else document.addEventListener("DOMContentLoaded", mark, { once: true });
// Whether the window is really on screen: the island at the top of the screen only shows when it is not.
const reportVisibility = () => ipcRenderer.send("agentic:visibility", document.visibilityState === "visible");
document.addEventListener("visibilitychange", reportVisibility);
document.addEventListener("DOMContentLoaded", reportVisibility, { once: true });
ipcRenderer.on("agentic:fullscreen", (_e, on) => {
  if (on) document.documentElement.dataset.fullscreen = "true";
  else delete document.documentElement.dataset.fullscreen;
});
