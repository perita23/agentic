// Bridge for the small Touch ID lock window (local file, no remote content).
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("agenticLock", {
  retry: () => ipcRenderer.send("agentic-lock:retry"),
  quit: () => ipcRenderer.send("agentic-lock:quit"),
  onState: (cb) => ipcRenderer.on("agentic-lock:state", (_e, state) => cb(String(state))),
});
