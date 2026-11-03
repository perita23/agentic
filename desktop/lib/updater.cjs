// In-app updater for the macOS app that works without an Apple Developer ID.
//
// Squirrel.Mac (electron-updater) refuses to update ad-hoc signed apps, so we:
//   1. read latest-mac.yml from the newest GitHub Release of this repository,
//   2. pick the zip for this CPU architecture,
//   3. download it over https and verify its SHA-512 against the manifest,
//   4. unpack it with `ditto` and swap the .app bundle after we quit.
// Builds are published to a public releases repository (no credentials needed).
// Until it exists, the source repository is used; being private, that goes through
// the GitHub REST API with the token configured in Agentic (Integraciones → GitHub).
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile, spawn } = require("node:child_process");
const yaml = require("js-yaml");

const OWNER = "perita23";
const REPO = "agentic";
const PUBLIC_REPO = "agentic-releases";
// Tried in order; the token is only ever sent to the private source repository.
const SOURCES = [
  { repo: PUBLIC_REPO, auth: false },
  { repo: REPO, auth: true },
];
const MANIFEST = "latest-mac.yml";

/** Compare dotted versions ("0.10.0" > "0.9.3"); pre-release tags sort before releases. */
function compareVersions(a, b) {
  const parse = (v) => {
    const [main, pre] = String(v).replace(/^v/, "").split("-", 2);
    return { nums: main.split(".").map((n) => parseInt(n, 10) || 0), pre: pre ?? null };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d) return Math.sign(d);
  }
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  return x.pre < y.pre ? -1 : 1;
}

/** Parse electron-builder's latest-mac.yml and choose the zip for `arch`. */
function pickAsset(manifestText, arch) {
  const m = yaml.load(manifestText, { schema: yaml.FAILSAFE_SCHEMA });
  if (!m || typeof m !== "object" || !Array.isArray(m.files)) throw new Error("Manifiesto de actualización no válido");
  const zips = m.files.filter((f) => f && typeof f.url === "string" && f.url.endsWith(".zip") && typeof f.sha512 === "string");
  const isArm = (u) => /arm64/i.test(u);
  const file = arch === "arm64" ? zips.find((f) => isArm(f.url)) : zips.find((f) => !isArm(f.url));
  if (!file) throw new Error(`La versión ${m.version} no incluye un zip para ${arch}`);
  if (!/^[\w.@+-]+\.zip$/.test(file.url)) throw new Error("Nombre de fichero de actualización no válido");
  return { version: String(m.version), file: file.url, sha512: file.sha512, size: Number(file.size) || null };
}

/** Constant-time check of a file's SHA-512 (base64, as in latest-mac.yml). */
function verifySha512(filePath, expectedBase64) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha512");
    fs.createReadStream(filePath)
      .on("data", (d) => h.update(d))
      .on("error", reject)
      .on("end", () => {
        const got = h.digest();
        const want = Buffer.from(expectedBase64, "base64");
        resolve(got.length === want.length && crypto.timingSafeEqual(got, want));
      });
  });
}

/** GitHub token configured in Agentic (needed only for private repositories). */
function githubToken(dataDir) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(dataDir, "integrations.json"), "utf8"));
    const t = cfg?.github?.token;
    return typeof t === "string" && t ? t : null;
  } catch {
    return null;
  }
}

async function fetchChecked(url, init = {}) {
  const u = new URL(url);
  // Only GitHub hosts that serve release assets; never follow anything else.
  if (u.protocol !== "https:" || !/(^|\.)github\.com$|(^|\.)githubusercontent\.com$/.test(u.hostname)) throw new Error(`Origen de actualización no permitido: ${u.hostname}`);
  const res = await fetch(u, { ...init, redirect: "manual" });
  if (res.status >= 300 && res.status < 400 && res.headers.get("location")) return fetchChecked(new URL(res.headers.get("location"), u).toString(), { headers: { "user-agent": "agentic-desktop" } });
  if (!res.ok) throw Object.assign(new Error(`GitHub respondió ${res.status}`), { status: res.status });
  return res;
}

/** Locate the latest release's manifest and asset URLs (public releases repo first). */
async function latestRelease(dataDir) {
  let lastError;
  for (const source of SOURCES) {
    try {
      return await releaseFrom(source, dataDir);
    } catch (e) {
      lastError = e;
      // Fall through only when the repository or its release (or manifest) is missing.
      if (e.status !== 404 && !e.missingAsset) throw e;
    }
  }
  throw lastError;
}

async function releaseFrom({ repo, auth }, dataDir) {
  const token = auth ? githubToken(dataDir) : null;
  const headers = { "user-agent": "agentic-desktop", accept: "application/vnd.github+json", ...(token ? { authorization: `Bearer ${token}` } : {}) };
  const res = await fetchChecked(`https://api.github.com/repos/${OWNER}/${repo}/releases/latest`, { headers });
  const rel = await res.json();
  if (!(rel.assets || []).some((a) => a.name === MANIFEST)) throw Object.assign(new Error(`La release ${rel.tag_name} de ${repo} no contiene ${MANIFEST}`), { missingAsset: true });
  const assets = new Map((rel.assets || []).map((a) => [a.name, a]));
  const download = async (name) => {
    const a = assets.get(name);
    if (!a) throw new Error(`La release ${rel.tag_name} no contiene ${name}`);
    // The API asset URL works for private repos with the token; it redirects to GitHub's CDN.
    return fetchChecked(a.url, { headers: { ...headers, accept: "application/octet-stream" } });
  };
  return { tag: rel.tag_name, repo, download };
}

/** Check for an update; resolves null when up to date. */
async function checkForUpdate({ currentVersion, arch, dataDir }) {
  const rel = await latestRelease(dataDir);
  const manifest = await (await rel.download(MANIFEST)).text();
  const asset = pickAsset(manifest, arch);
  if (compareVersions(asset.version, currentVersion) <= 0) return null;
  return { ...asset, tag: rel.tag, repo: rel.repo, download: () => rel.download(asset.file) };
}

/** Stream the zip to a temp dir, reporting progress, then verify its hash. */
async function downloadUpdate(update, onProgress) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentic-update-"));
  const file = path.join(dir, update.file);
  const res = await update.download();
  const total = Number(res.headers.get("content-length")) || update.size || 0;
  let done = 0;
  const out = fs.createWriteStream(file, { mode: 0o600 });
  for await (const chunk of res.body) {
    done += chunk.length;
    if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
    if (total) onProgress?.(done / total);
  }
  await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
  if (!(await verifySha512(file, update.sha512))) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw new Error("La descarga no coincide con el hash publicado; se ha descartado.");
  }
  return { dir, file };
}

const run = (cmd, args) => new Promise((resolve, reject) => execFile(cmd, args, { timeout: 120_000 }, (e, so, se) => (e ? reject(new Error(se || e.message)) : resolve(so))));

/**
 * Unpack the verified zip and schedule the swap: a detached helper waits for
 * this process to exit, replaces the bundle, clears quarantine and relaunches.
 */
async function installAndRelaunch({ dir, file }, appBundlePath, pid) {
  const unpacked = path.join(dir, "unpacked");
  await run("/usr/bin/ditto", ["-x", "-k", file, unpacked]);
  const app = fs.readdirSync(unpacked).find((n) => n.endsWith(".app"));
  if (!app) throw new Error("La actualización no contiene una app");
  const newApp = path.join(unpacked, app);
  // Refuse anything that is not a well-formed, (at least ad-hoc) signed bundle.
  await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", newApp]);
  const script = path.join(dir, "swap.sh");
  fs.writeFileSync(
    script,
    [
      "#!/bin/sh",
      'while kill -0 "$1" 2>/dev/null; do sleep 0.2; done',
      'rm -rf "$3.old" && mv "$3" "$3.old" && /usr/bin/ditto "$2" "$3" && rm -rf "$3.old"',
      '[ -d "$3" ] || mv "$3.old" "$3"', // roll back if the copy failed
      '/usr/bin/xattr -dr com.apple.quarantine "$3" 2>/dev/null',
      '/usr/bin/open "$3"',
      'rm -rf "$4"',
    ].join("\n"),
    { mode: 0o700 },
  );
  // Paths are passed as arguments, never interpolated into the script.
  spawn("/bin/sh", [script, String(pid), newApp, appBundlePath, dir], { detached: true, stdio: "ignore" }).unref();
}

module.exports = { compareVersions, pickAsset, verifySha512, checkForUpdate, downloadUpdate, installAndRelaunch, OWNER, REPO, PUBLIC_REPO };
