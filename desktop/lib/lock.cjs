// App lock for the macOS app: a password chosen on first launch (stored as a
// scrypt hash, never in clear) and, once enabled in Settings, Touch ID.
// Kept dependency-free; file ~/.agentic/desktop-lock.json (0600).
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const FILE = "desktop-lock.json";
const MIN_LENGTH = 8;
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function file(dataDir) {
  return path.join(dataDir, FILE);
}

/** @returns {{ hash?: string, salt?: string, touchId?: boolean }} */
function readLock(dataDir) {
  try {
    return JSON.parse(fs.readFileSync(file(dataDir), "utf8"));
  } catch {
    return {};
  }
}

function writeLock(dataDir, data) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const f = file(dataDir);
  const tmp = `${f}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, f);
}

function hash(password, salt) {
  return crypto.scryptSync(String(password).normalize("NFC"), Buffer.from(salt, "base64"), 32, SCRYPT).toString("base64");
}

function hasPassword(dataDir) {
  const l = readLock(dataDir);
  return !!(l.hash && l.salt);
}

function validateNew(password) {
  const p = String(password ?? "");
  if (p.length < MIN_LENGTH) throw new Error(`La contraseña debe tener al menos ${MIN_LENGTH} caracteres.`);
  if (p.length > 1024) throw new Error("La contraseña es demasiado larga.");
}

/** First launch: choose the password. Refuses to overwrite an existing one. */
function createPassword(dataDir, password) {
  if (hasPassword(dataDir)) throw new Error("Ya hay una contraseña.");
  validateNew(password);
  const salt = crypto.randomBytes(16).toString("base64");
  writeLock(dataDir, { ...readLock(dataDir), salt, hash: hash(password, salt), touchId: false });
}

function verifyPassword(dataDir, password) {
  const l = readLock(dataDir);
  if (!l.hash || !l.salt || typeof password !== "string" || password.length > 1024) return false;
  const got = Buffer.from(hash(password, l.salt), "base64");
  const want = Buffer.from(l.hash, "base64");
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

function changePassword(dataDir, current, next) {
  if (!verifyPassword(dataDir, current)) throw new Error("La contraseña actual no es correcta.");
  validateNew(next);
  const salt = crypto.randomBytes(16).toString("base64");
  writeLock(dataDir, { ...readLock(dataDir), salt, hash: hash(next, salt) });
}

function touchIdEnabled(dataDir) {
  return readLock(dataDir).touchId === true;
}

function setTouchId(dataDir, on) {
  if (!hasPassword(dataDir)) throw new Error("Crea primero una contraseña.");
  writeLock(dataDir, { ...readLock(dataDir), touchId: !!on });
}

/** Slows down guessing: after 5 failures, wait 2^n seconds (max 5 min) before the next try. */
function createLimiter() {
  let failures = 0;
  let until = 0;
  return {
    check() {
      const wait = until - Date.now();
      if (wait > 0) throw new Error(`Demasiados intentos. Espera ${Math.ceil(wait / 1000)} s.`);
    },
    fail() {
      failures++;
      if (failures >= 5) until = Date.now() + Math.min(2 ** (failures - 4), 300) * 1000;
    },
    reset() {
      failures = 0;
      until = 0;
    },
  };
}

module.exports = { readLock, hasPassword, createPassword, verifyPassword, changePassword, touchIdEnabled, setTouchId, createLimiter, MIN_LENGTH };
