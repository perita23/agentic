// The "island": a transparent, always-on-top, click-through window glued to the top centre of the screen (around
// the notch). It is not an Apple API, just a borderless window that the web page (/island) draws a pill in.
"use strict";

const path = require("node:path");

const WIDTH = 460;
const HEIGHT = 150;
// Electron does not report the notch. Notch Macs have a menu bar of ~37pt (others ~24pt), so a tall one means a notch.
const NOTCH_BAR_MIN = 32;
const NOTCH_WIDTH = 200;

/** Only an in-app path: letters, digits, "/", "_" and "-". */
const SAFE_PATH = /^\/[A-Za-z0-9/_-]*$/;

function createIsland({ BrowserWindow, screen, ipcMain, getOrigin, openMain }) {
  let win = null;
  let wanted = false;

  const metrics = () => {
    const d = screen.getPrimaryDisplay();
    const bar = Math.max(0, d.workArea.y - d.bounds.y);
    const notch = process.platform === "darwin" && bar >= NOTCH_BAR_MIN;
    return { notch, notchWidth: NOTCH_WIDTH, barHeight: bar || 26 };
  };

  const place = () => {
    if (!win || win.isDestroyed()) return;
    const b = screen.getPrimaryDisplay().bounds;
    win.setBounds({ x: Math.round(b.x + (b.width - WIDTH) / 2), y: b.y, width: WIDTH, height: HEIGHT });
  };

  const mine = (e) => !!win && !win.isDestroyed() && e.sender === win.webContents;

  function create() {
    if (win && !win.isDestroyed()) return;
    win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      x: 0,
      y: 0,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      // A non-activating panel on macOS: clicking it never steals focus from what you are doing.
      ...(process.platform === "darwin" ? { type: "panel" } : {}),
      webPreferences: {
        preload: path.join(__dirname, "..", "island-preload.cjs"),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        backgroundThrottling: false, // it keeps watching the runs while hidden
        devTools: false,
      },
    });
    win.setAlwaysOnTop(true, "screen-saver");
    // Also above full-screen apps and in every Space (without turning the app into an accessory: no Dock changes).
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    win.setIgnoreMouseEvents(true, { forward: true });
    place();
    const origin = getOrigin();
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (e) => e.preventDefault());
    win.loadURL(`${origin}/island`);
    win.on("closed", () => {
      win = null;
    });
  }

  ipcMain.handle("island:metrics", (e) => (mine(e) ? metrics() : null));
  ipcMain.on("island:show", (e) => {
    if (!mine(e)) return;
    wanted = true;
    place();
    win.showInactive();
  });
  ipcMain.on("island:hide", (e) => {
    if (!mine(e)) return;
    wanted = false;
    win.setIgnoreMouseEvents(true, { forward: true });
    win.hide();
  });
  // Click-through everywhere except over the pill itself.
  ipcMain.on("island:interactive", (e, on) => {
    if (mine(e)) win.setIgnoreMouseEvents(!on, { forward: true });
  });
  ipcMain.on("island:open", (e, p) => {
    if (mine(e) && typeof p === "string" && SAFE_PATH.test(p) && p.length < 200) openMain(p);
  });
  screen.on("display-metrics-changed", place);
  screen.on("display-added", place);
  screen.on("display-removed", place);

  return { create, isVisible: () => wanted, destroy: () => win && !win.isDestroyed() && win.destroy() };
}

module.exports = { createIsland, SAFE_PATH };
