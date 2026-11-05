// Bridge for the island window only: it can show/hide itself, ask for the screen metrics and open a page in the
// main window. No Node APIs are exposed.
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("agenticIsland", {
  metrics: () => ipcRenderer.invoke("island:metrics"),
  show: () => ipcRenderer.send("island:show"),
  hide: () => ipcRenderer.send("island:hide"),
  interactive: (on) => ipcRenderer.send("island:interactive", !!on),
  open: (path) => ipcRenderer.send("island:open", String(path)),
  mainVisible: () => ipcRenderer.invoke("island:main-visible"),
  onMainVisible: (cb) => {
    const h = (_e, v) => cb(!!v);
    ipcRenderer.on("island:main-visible", h);
    return () => ipcRenderer.removeListener("island:main-visible", h);
  },
});
