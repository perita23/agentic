// Progressive enhancement for the download page (works without JS too):
//  - put the right Mac build first when the browser can tell the CPU,
//  - show the latest version and date from the GitHub API.
"use strict";

const REPO = "perita23/agentic-releases";
const ARM = `https://github.com/${REPO}/releases/latest/download/Agentic-arm64.dmg`;
const X64 = `https://github.com/${REPO}/releases/latest/download/Agentic-x64.dmg`;

async function detectIntel() {
  // Only Chromium exposes the CPU; Safari/Firefox report "Intel" for every Mac,
  // so Apple Silicon stays the default when unknown.
  try {
    const d = await navigator.userAgentData?.getHighEntropyValues?.([
      "architecture",
      "platform",
    ]);
    return d?.platform === "macOS" && d?.architecture === "x86";
  } catch {
    return false;
  }
}

async function main() {
  const primary = document.getElementById("dl-primary");
  const label = document.getElementById("dl-primary-label");
  const secondary = document.getElementById("dl-secondary");
  if (await detectIntel()) {
    primary.href = X64;
    label.textContent = "Descargar para Mac (Intel)";
    secondary.href = ARM;
    secondary.textContent = "Mac con Apple Silicon";
  }
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/releases/latest`,
      { headers: { accept: "application/vnd.github+json" } },
    );
    if (!res.ok) return;
    const rel = await res.json();
    const date = new Date(rel.published_at).toLocaleDateString("es-ES", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    const meta = document.getElementById("release-meta");
    meta.textContent = `${String(rel.tag_name).replace(/[^\w.-]/g, "")} · ${date} · macOS 13 o superior · se actualiza sola`;
  } catch {
    // offline or rate limited: keep the static text
  }
}

main();
