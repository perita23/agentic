// Bridge for the small lock window (local file, no remote content).
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("agenticLock", {
  createPassword: (pw, confirm) => ipcRenderer.send("agentic-lock:create", String(pw), String(confirm)),
  submitPassword: (pw) => ipcRenderer.send("agentic-lock:password", String(pw)),
  useTouchId: () => ipcRenderer.send("agentic-lock:touchid"),
  quit: () => ipcRenderer.send("agentic-lock:quit"),
  onState: (cb) =>
    ipcRenderer.on("agentic-lock:state", (_e, s) =>
      cb({ state: String(s?.state ?? ""), message: s?.message ? String(s.message) : "", canTouch: !!s?.canTouch }),
    ),
});
