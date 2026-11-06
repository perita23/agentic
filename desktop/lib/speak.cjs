// Reading aloud in the Mac app with the voices of macOS itself, through its `say` command. Electron's own speech
// synthesis only lists some of the installed voices; `say` has all of them, including the natural "Enhanced"/"Premium"
// ones (System Settings → Accessibility → Spoken Content → System Voice → Manage Voices). Everything runs on the device.
"use strict";

const { execFile, spawn } = require("node:child_process");
const fs = require("node:fs");

// Novelty and robot voices nobody wants to read an answer with.
const NOVELTY = new Set(["Albert", "Bad News", "Bahh", "Bells", "Boing", "Bubbles", "Cellos", "Good News", "Hysterical", "Jester", "Organ", "Superstar", "Trinoids", "Whisper", "Wobble", "Zarvox", "Grandma", "Grandpa", "Rocko", "Shelley", "Sandy", "Reed", "Eddy", "Flo", "Fred", "Junior", "Kathy", "Ralph", "Agnes", "Princess"]);
const LINE = /^(.+?)\s{2,}([a-z]{2,3}[_-][A-Za-z0-9]+)\s+#/;
const QUALITY = /\((Premium|Enhanced|Mejorada|Améliorée|Erweitert|Migliorata|Aprimorada)\)/i;

/** `say -v '?'` → [{ name, lang: "es-ES", quality: "premium" | "enhanced" | "standard" }]. */
function parseVoices(out) {
  const voices = [];
  for (const line of String(out).split("\n")) {
    const m = LINE.exec(line.trim());
    if (!m) continue;
    const name = m[1].trim();
    if (NOVELTY.has(name.replace(/\s*\(.*\)$/, ""))) continue;
    const q = QUALITY.exec(name);
    const quality = !q ? "standard" : /premium/i.test(q[1]) ? "premium" : "enhanced";
    voices.push({ name, lang: m[2].replace("_", "-"), quality });
  }
  return voices;
}

function createSpeak({ ipcMain, fromApp, sayPath = "/usr/bin/say" }) {
  let child = null;
  let voices = null;

  const exists = () => fs.existsSync(sayPath) && (process.platform === "darwin" || sayPath !== "/usr/bin/say");
  const loadVoices = () =>
    new Promise((resolve) => {
      if (voices) return resolve(voices);
      execFile(sayPath, ["-v", "?"], { timeout: 8000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
        voices = err ? [] : parseVoices(stdout);
        resolve(voices);
      });
    });

  const kill = () => {
    if (child) {
      try {
        child.kill("SIGKILL");
      } catch {}
      child = null;
    }
  };

  ipcMain.handle("speak:available", (e) => fromApp(e) && exists());
  ipcMain.handle("speak:voices", async (e) => (fromApp(e) && exists() ? loadVoices() : []));

  // Resolves when it has finished talking, or has been stopped.
  ipcMain.handle("speak:say", async (e, text, voice, rate) => {
    if (!fromApp(e) || !exists()) return false;
    if (typeof text !== "string" || !text.trim() || text.length > 1500) return false;
    const list = await loadVoices();
    const args = [];
    if (typeof voice === "string" && list.some((v) => v.name === voice)) args.push("-v", voice);
    const r = typeof rate === "number" && rate >= 0.5 && rate <= 2 ? rate : 1;
    args.push("-r", String(Math.round(175 * r)));
    kill();
    return new Promise((resolve) => {
      const c = spawn(sayPath, args, { stdio: ["pipe", "ignore", "ignore"] });
      child = c;
      const end = (ok) => {
        if (child === c) child = null;
        resolve(ok);
      };
      c.on("error", () => end(false));
      c.on("exit", (code, signal) => end(code === 0 && !signal));
      c.stdin.on("error", () => {});
      c.stdin.end(text); // through stdin: nothing in the text can be taken for an option
    });
  });
  ipcMain.on("speak:stop", (e) => {
    if (fromApp(e)) kill();
  });

  return { stop: kill };
}

module.exports = { createSpeak, parseVoices };
