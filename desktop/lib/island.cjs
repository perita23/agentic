// The "island": a transparent, always-on-top, click-through window glued to the top centre of the screen (around
// the notch). It is not an Apple API, just a borderless window that the web page (/island) draws a pill in.
"use strict";

const path = require("node:path");
const { execFile } = require("node:child_process");

const WIDTH = 460;
const HEIGHT = 150;
// Electron does not report the notch. Notch Macs have a menu bar of ~37pt (others ~24pt), so a tall one means a notch.
const NOTCH_BAR_MIN = 32;
const NOTCH_WIDTH = 200;

// What native notch apps (boring.notch and friends) read from AppKit: the areas of the top edge left and right of
// the notch (macOS 12+). Their heights are the notch's height, and the screen width minus both is the notch's width.
// Both are 0 on a Mac without a notch. Run through JavaScript for Automation, which ships with macOS.
const NOTCH_SCRIPT = `
ObjC.import("AppKit");
const s = $.NSScreen.screens.objectAtIndex(0);
const l = s.auxiliaryTopLeftArea, r = s.auxiliaryTopRightArea;
JSON.stringify({ width: s.frame.size.width, left: l.size.width, right: r.size.width, height: l.size.height });
`;

/** The notch from the output of NOTCH_SCRIPT; null when there is none (or the output is not usable). */
function parseNotch(out) {
  try {
    const o = JSON.parse(String(out).trim());
    const width = o.width - o.left - o.right;
    if (!(o.left > 0 && o.right > 0 && width > 60 && width < 400 && o.height > 10 && o.height < 80)) return null;
    return { notchWidth: Math.round(width), notchHeight: Math.round(o.height) };
  } catch {
    return null;
  }
}

/** Reads the real notch of the main screen (macOS only). Resolves to null when there is none or it cannot be read. */
function readNotch() {
  if (process.platform !== "darwin") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      execFile("/usr/bin/osascript", ["-l", "JavaScript", "-e", NOTCH_SCRIPT], { timeout: 4000 }, (err, stdout) => resolve(err ? null : parseNotch(stdout)));
    } catch {
      resolve(null);
    }
  });
}

/** Only an in-app path: letters, digits, "/", "_" and "-". */
const SAFE_PATH = /^\/[A-Za-z0-9/_-]*$/;

function createIsland({ BrowserWindow, screen, ipcMain, getOrigin, openMain }) {
  let win = null;
  let wanted = false;

  // The real notch when AppKit tells us (see readNotch); otherwise a guess from the height of the menu bar.
  let real = null;
  const notchReady = readNotch().then((n) => {
    real = n;
    place();
  });

  const metrics = () => {
    const d = screen.getPrimaryDisplay();
    const bar = Math.max(0, d.workArea.y - d.bounds.y);
    if (real) return { notch: true, notchWidth: real.notchWidth, barHeight: real.notchHeight };
    const guess = process.platform === "darwin" && bar >= NOTCH_BAR_MIN;
    return { notch: guess, notchWidth: NOTCH_WIDTH, barHeight: guess ? 32 : bar || 26 };
  };

  const place = () => {
    if (!win || win.isDestroyed()) return;
    const b = screen.getPrimaryDisplay().bounds;
    const want = { x: Math.round(b.x + (b.width - WIDTH) / 2), y: b.y, width: WIDTH, height: HEIGHT };
    win.setBounds(want);
    // If macOS still pushed it down (below the menu bar), ask for the same amount higher.
    const got = win.getBounds();
    if (got.y !== want.y) win.setBounds({ ...want, y: want.y - (got.y - want.y) });
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
      // Without this macOS pushes any window below the menu bar (it "constrains" its frame to the usable area).
      // Native notch apps override constrainFrameRect for the same reason; Electron does it with this flag.
      enableLargerThanScreen: true,
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

  ipcMain.handle("island:metrics", async (e) => {
    if (!mine(e)) return null;
    await notchReady;
    return metrics();
  });
  ipcMain.on("island:show", (e) => {
    if (!mine(e)) return;
    wanted = true;
    place();
    win.showInactive();
    place(); // macOS may nudge a window when it appears: put it back on the very top edge
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

module.exports = { createIsland, SAFE_PATH, parseNotch };
