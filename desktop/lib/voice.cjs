// Dictation in the Mac app. Electron cannot recognise speech by itself (Chromium's needs a Google key), so a small
// helper (native/agentic-listen.swift, built by CI and shipped in Resources) does it with Apple's Speech framework and
// prints JSON lines: {"type":"level","v":0..1} | {"type":"text","text","final"} | {"type":"error","message"} | {"type":"end"}.
"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const LANG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;

function createVoice({ app, ipcMain, fromApp }) {
  let child = null;
  let killTimer = null;

  const helper = () => {
    const p = path.join(process.resourcesPath || "", "agentic-listen");
    return app.isPackaged && fs.existsSync(p) ? p : null;
  };

  const stopChild = () => {
    clearTimeout(killTimer);
    if (child) {
      try {
        child.kill("SIGKILL");
      } catch {}
      child = null;
    }
  };

  ipcMain.handle("voice:available", (e) => (fromApp(e) ? !!helper() && process.platform === "darwin" : false));

  ipcMain.handle("voice:start", (e, lang) => {
    if (!fromApp(e)) return { ok: false, error: "denied" };
    const bin = helper();
    if (!bin) return { ok: false, error: "El dictado no está disponible en esta versión de la app." };
    if (typeof lang !== "string" || !LANG.test(lang)) return { ok: false, error: "Idioma no válido" };
    stopChild();
    const sender = e.sender;
    const send = (o) => {
      if (!sender.isDestroyed()) sender.send("voice:event", o);
    };
    const c = spawn(bin, [lang], { stdio: ["pipe", "pipe", "ignore"] });
    child = c;
    let buf = "";
    c.stdout.setEncoding("utf8");
    c.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        try {
          const o = JSON.parse(line);
          if (o && typeof o.type === "string") send(o);
        } catch {}
      }
    });
    c.on("error", (err) => {
      send({ type: "error", message: `No se pudo iniciar el dictado: ${err.message}` });
      send({ type: "end" });
    });
    c.on("exit", () => {
      if (child === c) child = null;
      send({ type: "end" });
    });
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

  return { stop: stopChild };
}

module.exports = { createVoice };
