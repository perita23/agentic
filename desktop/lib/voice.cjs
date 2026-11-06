// Dictation in the Mac app. Electron cannot recognise speech by itself (Chromium's needs a Google key), so a small
// helper (native/agentic-listen.swift, built by CI and shipped in Resources) does it with Apple's Speech framework and
// prints JSON lines: {"type":"level","v":0..1} | {"type":"text","text","final"} | {"type":"error","message"} | {"type":"end"}.
"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const LANG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;

function createVoice({ app, ipcMain, fromApp, helperPath = null }) {
  let child = null; // the helper that is listening
  let warm = null; // a helper waiting, with nothing open yet, so that starting is instant
  let killTimer = null;

  const helper = () => {
    if (helperPath) return fs.existsSync(helperPath) ? helperPath : null;
    const p = path.join(process.resourcesPath || "", "agentic-listen");
    return app.isPackaged && fs.existsSync(p) ? p : null;
  };

  const kill = (c) => {
    try {
      c.kill("SIGKILL");
    } catch {}
  };

  const stopChild = () => {
    clearTimeout(killTimer);
    if (child) {
      kill(child);
      child = null;
    }
  };

  /** A helper process, started and waiting for "start <lang>"; what it prints goes to `c.sender` once there is one. */
  const spawnHelper = (bin) => {
    const c = spawn(bin, [], { stdio: ["pipe", "pipe", "ignore"] });
    c.sender = null;
    let buf = "";
    const send = (o) => {
      if (c.sender && !c.sender.isDestroyed()) c.sender.send("voice:event", o);
    };
    c.stdout.setEncoding("utf8");
    c.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        try {
          const o = JSON.parse(line);
          if (o && typeof o.type === "string" && o.type !== "warm") send(o);
        } catch {}
      }
    });
    c.stdin.on("error", () => {});
    c.on("error", (err) => {
      if (warm === c) warm = null;
      send({ type: "error", message: `No se pudo iniciar el dictado: ${err.message}` });
      send({ type: "end" });
    });
    c.on("exit", () => {
      if (warm === c) warm = null;
      if (child === c) {
        child = null;
        setTimeout(ensureWarm, 300); // the next one gets ready while nobody is speaking
      }
      send({ type: "end" });
    });
    return c;
  };

  function ensureWarm() {
    if (warm || child) return;
    const bin = helper();
    if (bin && (process.platform === "darwin" || helperPath)) warm = spawnHelper(bin);
  }

  ipcMain.handle("voice:available", (e) => {
    if (!fromApp(e)) return false;
    const ok = !!helper() && (process.platform === "darwin" || !!helperPath);
    if (ok) ensureWarm();
    return ok;
  });
  ipcMain.on("voice:warm", (e) => {
    if (fromApp(e)) ensureWarm();
  });

  ipcMain.handle("voice:start", (e, lang) => {
    if (!fromApp(e)) return { ok: false, error: "denied" };
    const bin = helper();
    if (!bin) return { ok: false, error: "El dictado no está disponible en esta versión de la app." };
    if (typeof lang !== "string" || !LANG.test(lang)) return { ok: false, error: "Idioma no válido" };
    stopChild();
    const c = warm && warm.exitCode === null ? warm : spawnHelper(bin);
    warm = null;
    c.sender = e.sender;
    child = c;
    c.stdin.write(`start ${lang}\n`);
    // Whatever happens, a dictation never lasts more than two minutes.
    killTimer = setTimeout(stopChild, 120_000);
    return { ok: true };
  });

  ipcMain.on("voice:stop", (e) => {
    if (fromApp(e) && child) child.stdin.write("stop\n");
  });
  ipcMain.on("voice:cancel", (e) => {
    if (!fromApp(e)) return;
    if (child) child.stdin.write("cancel\n");
    setTimeout(stopChild, 500);
  });

  return {
    stop() {
      stopChild();
      if (warm) kill(warm);
      warm = null;
    },
  };
}

module.exports = { createVoice };
