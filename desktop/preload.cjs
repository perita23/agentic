// Minimal, sandbox-safe bridge: the web UI can only ask the native app to
// check for updates and read its version. No Node APIs are exposed.
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("agenticDesktop", {
  isDesktop: true,
  version: () => ipcRenderer.invoke("agentic:version"),
  checkForUpdates: () => ipcRenderer.invoke("agentic:check-for-updates"),
});
