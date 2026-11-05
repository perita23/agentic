// Agentic Console for macOS: a thin native shell around the exact same web UI.
// - Unlocks with Touch ID (native), then opens a server-side session.
// - Runs the bundled Next.js standalone server with Electron's own Node.
// - Hardened window: context isolation, sandbox, no Node in the renderer,
//   external links open in the default browser, minimal permissions.
"use strict";

const { app, BrowserWindow, clipboard, dialog, ipcMain, safeStorage, shell, session, systemPreferences, utilityProcess, Menu, screen } = require("electron");
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { createDesktopSession } = require("./lib/session.cjs");
const { createIsland } = require("./lib/island.cjs");
const { loginShellPath, pickPort, waitForPort } = require("./lib/env.cjs");
const updater = require("./lib/updater.cjs");
const appLock = require("./lib/lock.cjs");
const { buildLockPage } = require("./lib/lock-page.cjs");

const limiter = appLock.createLimiter();

const DATA_DIR = process.env.AGENTIC_HOME || path.join(os.homedir(), ".agentic");
let server = null;
let DATA_KEY = null;
// Public key that update manifests must be signed with (absent: unsigned builds).
const UPDATE_PUBLIC_KEY = (() => {
  try {
    return fs.readFileSync(path.join(__dirname, "update-key.pem"), "utf8");
  } catch {
    return null;
  }
})();
let win = null;
let island = null;
let origin = null;

if (!app.requestSingleInstanceLock()) app.quit();

// Defence in depth for every web contents: no <webview>, no new windows.
app.on("web-contents-created", (_e, contents) => {
  contents.on("will-attach-webview", (ev) => ev.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
});
app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

/**
 * Small lock window shown before anything else:
 *  - first launch: choose an app password (Touch ID is enabled later in Ajustes);
 *  - later: the password, with "Usar Touch ID" as a button when it is enabled (never prompted by itself).
 * Resolves once verified with { touchId, password, close } so the lock stays on
 * screen ("Abriendo…") until the main window is ready.
 */
function unlock() {
  const canTouch = process.platform === "darwin" && systemPreferences.canPromptTouchID();
  const first = !appLock.hasPassword(DATA_DIR);
  const useTouch = () => canTouch && appLock.touchIdEnabled(DATA_DIR);
  return new Promise((resolve) => {
    // Big split screen (form | animated art) covering the work area.
    const area = screen.getPrimaryDisplay().workArea;
    const lock = new BrowserWindow({
      x: area.x,
      y: area.y,
      width: area.width,
      height: area.height,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      title: "Desbloquear Agentic",
      backgroundColor: "#0a0a0a",
      titleBarStyle: "hiddenInset",
      show: false,
      webPreferences: {
        devTools: !app.isPackaged, // no inspector in released builds
        preload: path.join(__dirname, "lock-preload.cjs"),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    const wc = lock.webContents;
    let verified = false;
    let prompting = false;
    const send = (state) => {
      if (!lock.isDestroyed()) wc.send("agentic-lock:state", { canTouch: useTouch(), ...state });
    };
    const done = (via) => {
      verified = true;
      cleanup();
      send({ state: "ok" });
      resolve({
        touchId: via === "touchid",
        password: via === "password",
        close: () => {
          if (!lock.isDestroyed()) lock.destroy();
        },
      });
    };
    async function promptTouch() {
      if (prompting || verified || !useTouch()) return;
      prompting = true;
      send({ state: "touchid" });
      try {
        await systemPreferences.promptTouchID("desbloquear Agentic");
        done("touchid");
      } catch {
        send({ state: "password", message: "No se ha verificado Touch ID. Usa tu contraseña." });
      } finally {
        prompting = false;
      }
    }
    const handlers = {
      "agentic-lock:create": (e, pw, confirm) => {
        if (e.sender !== wc || verified) return;
        if (typeof pw !== "string" || pw !== confirm) return send({ state: "setup", message: "Las contraseñas no coinciden." });
        try {
          appLock.createPassword(DATA_DIR, pw);
          done("password");
        } catch (err) {
          send({ state: "setup", message: err.message });
        }
      },
      "agentic-lock:password": (e, pw) => {
        if (e.sender !== wc || verified) return;
        try {
          limiter.check();
        } catch (err) {
          return send({ state: "password", message: err.message });
        }
        if (appLock.verifyPassword(DATA_DIR, pw)) {
          limiter.reset();
          done("password");
        } else {
          limiter.fail();
          send({ state: "password", message: "Contraseña incorrecta." });
        }
      },
      "agentic-lock:touchid": (e) => {
        if (e.sender === wc) promptTouch();
      },
      "agentic-lock:quit": (e) => {
        if (e.sender === wc) app.exit(0);
      },
    };
    const cleanup = () => {
      for (const [ch, fn] of Object.entries(handlers)) ipcMain.removeListener(ch, fn);
    };
    for (const [ch, fn] of Object.entries(handlers)) ipcMain.on(ch, fn);
    // Closing the lock window before unlocking quits the app.
    lock.on("closed", () => {
      cleanup();
      if (!verified) app.exit(0);
    });
    wc.setWindowOpenHandler(() => ({ action: "deny" }));
    wc.on("will-navigate", (e) => e.preventDefault());
    wc.once("did-finish-load", () => {
      // CI only: unlock with a password that must still match the stored hash
      // (the same as typing it), so the launch test can reach the main window.
      const ciPassword = process.env.CI === "true" ? process.env.AGENTIC_DESKTOP_CI_PASSWORD : undefined;
      if (!first && ciPassword && appLock.verifyPassword(DATA_DIR, ciPassword)) return done("password");
      if (first) send({ state: "setup" });
      // Never prompt Touch ID by itself: the password form shows, with "Usar Touch ID" one click away.
      else send({ state: "password" });
    });
    lock.once("ready-to-show", () => {
      lock.show();
      lock.focus();
    });
    // Never a silent blank window: a failed load stops the app with a message.
    wc.on("did-fail-load", (_e, code, desc, _url, isMainFrame) => {
      if (!isMainFrame) return;
      console.error(`[agentic] lock window failed to load: ${desc} (${code})`);
      dialog.showErrorBox("Agentic no pudo abrir la pantalla de bloqueo", `${desc} (${code})`);
      app.exit(1);
    });
    lock.loadURL(buildLockPage(__dirname));
  });
}

function serverEntry() {
  // Packaged: Resources/app-server/server.js; dev: ../.next/standalone/server.js
  const packaged = path.join(process.resourcesPath || "", "app-server", "server.js");
  if (fs.existsSync(packaged)) return packaged;
  return path.join(__dirname, "..", ".next", "standalone", "server.js");
}

/** Public OAuth client ids shipped with this build (never secrets). */
function builtInOAuth(dir) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, "oauth-apps.json"), "utf8"));
    return Object.fromEntries(Object.entries(raw).filter(([k, v]) => /^AGENTIC_GITHUB_CLIENT_ID$/.test(k) && typeof v === "string" && !process.env[k]));
  } catch {
    return {};
  }
}

/**
 * Key that encrypts credentials at rest. Kept in the macOS Keychain through
 * safeStorage: only this app can read it. Returns null when unavailable (the
 * server then falls back to a local key file).
 */
function dataKey() {
  if (!safeStorage.isEncryptionAvailable()) return null;
  const f = path.join(DATA_DIR, "data-key.keychain");
  try {
    const k = safeStorage.decryptString(fs.readFileSync(f));
    if (/^[0-9a-f]{64}$/.test(k)) return k;
  } catch {}
  const k = crypto.randomBytes(32).toString("hex");
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(f, safeStorage.encryptString(k), { mode: 0o600 });
  return k;
}

async function startServer() {
  const port = await pickPort(Number(process.env.PORT) || 4317);
  const entry = serverEntry();
  console.log(`[agentic] starting server ${entry} on port ${port}`);
  if (!fs.existsSync(entry)) throw new Error(`No se encuentra el servidor de Agentic (${entry}). Ejecuta «npm run desktop:prepare».`);
  // A utility process (not ELECTRON_RUN_AS_NODE, whose fuse is turned off so
  // nobody can run this signed binary as a plain Node interpreter).
  server = utilityProcess.fork(path.join(__dirname, "server-entry.cjs"), [], {
    serviceName: "Agentic Server",
    cwd: path.dirname(entry),
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      AGENTIC_HOME: DATA_DIR,
      PATH: loginShellPath(),
      NEXT_TELEMETRY_DISABLED: "1",
      ...builtInOAuth(path.dirname(entry)),
    },
  });
  DATA_KEY = dataKey();
  server.postMessage({ entry, key: DATA_KEY });
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
  // Granted only to our own local server: notifications (run finished) and
  // writing to the clipboard ("Copiar"). Camera, mic, location… are denied.
  const allowed = new Set(["notifications", "clipboard-sanitized-write"]);
  const ours = (url) => {
    try {
      return !!origin && new URL(url).origin === origin;
    } catch {
      return false;
    }
  };
  ses.setPermissionRequestHandler((wc, permission, cb, details) => cb(allowed.has(permission) && ours(details?.requestingUrl ?? wc.getURL())));
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => allowed.has(permission) && ours(requestingOrigin));
}

// Is the main window really on screen? (visible, not minimized, and the page itself reports it is not covered or in
// another Space.) The island only shows when it is not.
let pageVisible = true;
function updateMainVisible() {
  const on = !!win && !win.isDestroyed() && win.isVisible() && !win.isMinimized() && pageVisible;
  island?.setMainVisible(on);
}

function createWindow(onShown) {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    title: "Agentic",
    backgroundColor: "#0a0a0a",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    // Vertically centred in the 56px top bar; the UI leaves room for them.
    trafficLightPosition: { x: 18, y: 21 },
    show: false,
    webPreferences: {
      devTools: !app.isPackaged, // no inspector in released builds
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: true,
    },
  });
  pageVisible = true;
  for (const ev of ["show", "hide", "minimize", "restore", "closed"]) win.on(ev, updateMainVisible);
  win.webContents.on("did-finish-load", updateMainVisible);
  win.once("ready-to-show", () => {
    win.show();
    onShown?.();
  });
  // The traffic lights disappear in full screen, so the UI can drop their gap.
  win.on("enter-full-screen", () => win.webContents.send("agentic:fullscreen", true));
  win.on("leave-full-screen", () => win.webContents.send("agentic:fullscreen", false));

  const isInternal = (url) => {
    try {
      return new URL(url).origin === origin;
    } catch {
      return false;
    }
  };
  const openExternal = (url) => {
    if (/^https?:\/\//i.test(url) || /^obsidian:\/\/open\?/i.test(url)) shell.openExternal(url);
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
    update = await updater.checkForUpdate({ currentVersion: app.getVersion(), arch: process.arch, dataDir: DATA_DIR, dataKey: DATA_KEY, publicKey: UPDATE_PUBLIC_KEY });
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
    shell.openExternal(`https://github.com/${updater.OWNER}/${update.repo}/releases/tag/${encodeURIComponent(update.tag)}`);
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
    buildMenu();
    harden(session.defaultSession);
    // The server boots while the lock window waits for Touch ID.
    const serverReady = startServer();
    serverReady.catch(() => {});
    const lock = await unlock();
    origin = await serverReady;
    const sid = createDesktopSession(DATA_DIR, { touchId: lock.touchId, password: lock.password });
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
    ipcMain.on("agentic:visibility", (e, v) => {
      if (!win || win.isDestroyed() || e.sender !== win.webContents) return;
      pageVisible = !!v;
      updateMainVisible();
    });
    ipcMain.handle("agentic:version", (e) => (fromApp(e) ? app.getVersion() : null));
    ipcMain.handle("agentic:check-for-updates", (e) => (fromApp(e) ? checkForUpdates(true) : "denied"));
    // App lock settings (Ajustes): Touch ID is only enabled after a successful
    // Touch ID prompt; changing the password needs the current one.
    const lockInfo = () => ({
      touchIdAvailable: process.platform === "darwin" && systemPreferences.canPromptTouchID(),
      touchIdEnabled: appLock.touchIdEnabled(DATA_DIR),
      hasPassword: appLock.hasPassword(DATA_DIR),
    });
    // Fixed deep link to System Settings → Privacy → Full Disk Access.
    ipcMain.handle("agentic:open-privacy", (e) => {
      if (!fromApp(e) || process.platform !== "darwin") return false;
      shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles");
      return true;
    });
    // Fallback for "Copiar" (text only, bounded size).
    ipcMain.handle("agentic:copy", (e, text) => {
      if (!fromApp(e) || typeof text !== "string" || text.length > 100_000) return false;
      clipboard.writeText(text);
      return true;
    });
    ipcMain.handle("agentic:lock-info", (e) => (fromApp(e) ? lockInfo() : null));
    ipcMain.handle("agentic:set-touch-id", async (e, on) => {
      if (!fromApp(e)) return null;
      try {
        if (on) {
          if (!lockInfo().touchIdAvailable) throw new Error("Este Mac no tiene Touch ID disponible.");
          await systemPreferences.promptTouchID("activar el desbloqueo con Touch ID");
        }
        appLock.setTouchId(DATA_DIR, !!on);
        return { ok: true, ...lockInfo() };
      } catch (err) {
        return { ok: false, error: err && err.message ? err.message : "No se ha verificado Touch ID.", ...lockInfo() };
      }
    });
    ipcMain.handle("agentic:change-password", (e, current, next) => {
      if (!fromApp(e)) return null;
      try {
        limiter.check();
        appLock.changePassword(DATA_DIR, String(current ?? ""), String(next ?? ""));
        limiter.reset();
        return { ok: true };
      } catch (err) {
        if (/actual no es correcta/.test(err.message)) limiter.fail();
        return { ok: false, error: err.message };
      }
    });
    createWindow(() => lock.close());
    // The island at the top of the screen (see lib/island.cjs). Closing the window keeps the app alive, so it stays; ⌘Q ends it.
    island = createIsland({
      BrowserWindow,
      screen,
      ipcMain,
      getOrigin: () => origin,
      openMain: (p) => {
        if (!win || win.isDestroyed()) createWindow();
        else win.loadURL(`${origin}${p}`);
        if (win && !win.isDestroyed()) {
          if (win.isMinimized()) win.restore();
          win.show();
          win.focus();
        }
        // A window created just now already loads "/": go to the page once it is ready.
        if (win) win.webContents.once("did-finish-load", () => win && !win.isDestroyed() && win.webContents.getURL() !== `${origin}${p}` && win.loadURL(`${origin}${p}`));
      },
    });
    island.create();
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
  // The island is a window too, so "no windows" is not enough: look at the main one.
  if (origin && (!win || win.isDestroyed())) createWindow();
  if (origin) checkOnEntry();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
  app.isQuitting = true;
  if (server) server.kill();
});
