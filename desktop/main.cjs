// Agentic Console for macOS: a thin native shell around the exact same web UI.
// - Unlocks with Touch ID (native), then opens a server-side session.
// - Runs the bundled Next.js standalone server with Electron's own Node.
// - Hardened window: context isolation, sandbox, no Node in the renderer,
//   external links open in the default browser, minimal permissions.
"use strict";

const { app, BrowserWindow, dialog, ipcMain, shell, session, systemPreferences, Menu } = require("electron");
const { fork } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { createDesktopSession } = require("./lib/session.cjs");
const { loginShellPath, pickPort, waitForPort } = require("./lib/env.cjs");
const updater = require("./lib/updater.cjs");

const DATA_DIR = process.env.AGENTIC_HOME || path.join(os.homedir(), ".agentic");
let server = null;
let win = null;
let origin = null;

if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

/** Ask for Touch ID when the Mac has it; returns whether the user was verified. */
async function unlock() {
  if (process.platform !== "darwin" || !systemPreferences.canPromptTouchID()) return false;
  try {
    await systemPreferences.promptTouchID("desbloquear Agentic");
    return true;
  } catch {
    dialog.showErrorBox("Agentic", "No se ha verificado Touch ID. La app se cerrará.");
    app.exit(1);
    return false;
  }
}

function serverEntry() {
  // Packaged: Resources/app-server/server.js; dev: ../.next/standalone/server.js
  const packaged = path.join(process.resourcesPath || "", "app-server", "server.js");
  if (fs.existsSync(packaged)) return packaged;
  return path.join(__dirname, "..", ".next", "standalone", "server.js");
}

async function startServer() {
  const port = await pickPort(Number(process.env.PORT) || 4317);
  const entry = serverEntry();
  console.log(`[agentic] starting server ${entry} on port ${port}`);
  if (!fs.existsSync(entry)) throw new Error(`No se encuentra el servidor de Agentic (${entry}). Ejecuta «npm run desktop:prepare».`);
  server = fork(entry, [], {
    cwd: path.dirname(entry),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1", // run the server with Electron's embedded Node
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      AGENTIC_HOME: DATA_DIR,
      PATH: loginShellPath(),
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  server.on("exit", (code) => {
    console.error(`[agentic] server exited with code ${code}`);
    if (!app.isQuitting) {
      dialog.showErrorBox("Agentic", `El servidor local se ha detenido (código ${code}).`);
      app.quit();
    }
  });
  await waitForPort(port);
  // WebAuthn and the session cookie are bound to "localhost".
  return `http://localhost:${port}`;
}

function harden(ses) {
  // Only notifications (run finished) are ever granted; camera, mic, location… are denied.
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === "notifications"));
  ses.setPermissionCheckHandler((_wc, permission) => permission === "notifications");
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    title: "Agentic",
    backgroundColor: "#0a0a0a",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 14, y: 18 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: true,
    },
  });
  win.once("ready-to-show", () => win.show());

  const isInternal = (url) => {
    try {
      return new URL(url).origin === origin;
    } catch {
      return false;
    }
  };
  const openExternal = (url) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  };
  // Links to GitHub/Jira/Slack… open in the default browser; nothing else can navigate the app away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!isInternal(url)) {
      e.preventDefault();
      openExternal(url);
    }
  });
  win.loadURL(`${origin}/`);
}

// ---------- updates ----------

let updating = false;
let checking = false;
let lastCheck = 0;
let dismissedVersion = null; // "Más tarde" for this version: don't nag again until next launch
const ENTRY_CHECK_INTERVAL = 10 * 60_000; // at most one automatic check per 10 minutes

/** The running .app bundle (…/Agentic.app), only when packaged. */
function appBundlePath() {
  const p = path.resolve(process.execPath, "..", "..", "..");
  return app.isPackaged && p.endsWith(".app") ? p : null;
}

/** Returns "updating" | "available" | "up-to-date" | "error" | "unsupported" | "busy". */
async function checkForUpdates(interactive) {
  if (updating || checking) return "busy";
  checking = true;
  lastCheck = Date.now();
  try {
    return await doCheck(interactive);
  } finally {
    checking = false;
  }
}

/** Automatic check whenever the user enters the app (launch, activate, focus). */
function checkOnEntry() {
  if (Date.now() - lastCheck >= ENTRY_CHECK_INTERVAL) void checkForUpdates(false);
}

async function doCheck(interactive) {
  const bundle = appBundlePath();
  if (!bundle) {
    if (interactive) dialog.showMessageBox({ message: "Las actualizaciones sólo están disponibles en la app instalada." });
    return "unsupported";
  }
  let update;
  try {
    update = await updater.checkForUpdate({ currentVersion: app.getVersion(), arch: process.arch, dataDir: DATA_DIR });
  } catch (e) {
    if (interactive) dialog.showMessageBox({ type: "warning", message: "No se pudo comprobar si hay actualizaciones.", detail: String(e.message || e) });
    return "error";
  }
  if (!update) {
    if (interactive) dialog.showMessageBox({ message: `Agentic está actualizado (v${app.getVersion()}).` });
    return "up-to-date";
  }
  if (!interactive && dismissedVersion === update.version) return "available";
  const { response } = await dialog.showMessageBox({
    type: "info",
    message: `Agentic ${update.version} está disponible`,
    detail: `Tienes la v${app.getVersion()}. Se descargará, se verificará y la app se reiniciará.`,
    buttons: ["Actualizar y reiniciar", "Ver novedades", "Más tarde"],
    defaultId: 0,
    cancelId: 2,
  });
  if (response === 1) {
    shell.openExternal(`https://github.com/${updater.OWNER}/${updater.REPO}/releases/tag/${encodeURIComponent(update.tag)}`);
    return "available";
  }
  if (response !== 0) {
    dismissedVersion = update.version;
    return "available";
  }
  try {
    fs.accessSync(path.dirname(bundle), fs.constants.W_OK);
  } catch {
    dialog.showMessageBox({ type: "warning", message: "No hay permiso para actualizar la app en su carpeta actual.", detail: `Mueve Agentic a /Applications (o a ~/Applications) con tu usuario, o instala la v${update.version} manualmente.` });
    return "error";
  }
  updating = true;
  try {
    const downloaded = await updater.downloadUpdate(update, (p) => win?.setProgressBar(p));
    win?.setProgressBar(-1);
    await updater.installAndRelaunch(downloaded, bundle, process.pid);
    app.isQuitting = true;
    app.quit();
    return "updating";
  } catch (e) {
    win?.setProgressBar(-1);
    updating = false;
    dialog.showMessageBox({ type: "error", message: "La actualización ha fallado.", detail: String(e.message || e) });
    return "error";
  }
}

function buildMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { label: "Buscar actualizaciones…", click: () => checkForUpdates(true) },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "Ver",
      submenu: [{ role: "reload" }, { role: "togglefullscreen" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  try {
    const touchId = await unlock();
    buildMenu();
    harden(session.defaultSession);
    origin = await startServer();
    const sid = createDesktopSession(DATA_DIR, { touchId });
    await session.defaultSession.cookies.set({
      url: origin,
      name: "agentic_session",
      value: sid,
      httpOnly: true,
      sameSite: "strict",
      path: "/",
      expirationDate: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
    });
    // IPC is only answered for frames served by our own local server.
    const fromApp = (e) => {
      try {
        return new URL(e.senderFrame?.url ?? "").origin === origin;
      } catch {
        return false;
      }
    };
    ipcMain.handle("agentic:version", (e) => (fromApp(e) ? app.getVersion() : null));
    ipcMain.handle("agentic:check-for-updates", (e) => (fromApp(e) ? checkForUpdates(true) : "denied"));
    createWindow();
    // Check every time the user enters the app: at launch, and when it is
    // activated or a window regains focus (throttled to every 10 minutes).
    win.webContents.once("did-finish-load", () => checkOnEntry());
    app.on("browser-window-focus", () => checkOnEntry());
  } catch (e) {
    console.error("[agentic] startup failed:", e);
    dialog.showErrorBox("Agentic", e && e.message ? e.message : String(e));
    app.exit(1);
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && origin) createWindow();
  if (origin) checkOnEntry();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
  app.isQuitting = true;
  if (server && !server.killed) server.kill("SIGTERM");
});
