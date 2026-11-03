// Minimal, sandbox-safe bridge: the web UI can only ask the native app to
// check for updates, read its version and manage the app lock. No Node APIs are exposed.
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("agenticDesktop", {
  isDesktop: true,
  version: () => ipcRenderer.invoke("agentic:version"),
  checkForUpdates: () => ipcRenderer.invoke("agentic:check-for-updates"),
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
ipcRenderer.on("agentic:fullscreen", (_e, on) => {
  if (on) document.documentElement.dataset.fullscreen = "true";
  else delete document.documentElement.dataset.fullscreen;
});
