import fs from "node:fs";
import path from "node:path";
import type { JsonStore } from "./store";

export interface ReleaseNotes {
  version: string;
  date: string | null;
  body: string;
}

/** Sections of a Keep-a-Changelog file: "## [1.2.3] - 2026-11-03" + body. */
export function parseChangelog(md: string): ReleaseNotes[] {
  const out: ReleaseNotes[] = [];
  const re = /^## \[(\d+\.\d+\.\d+[^\]]*)\](?:\s*-\s*(\S+))?\s*$/gm;
  const heads = [...md.matchAll(re)];
  heads.forEach((m, i) => {
    const start = m.index! + m[0].length;
    const end = i + 1 < heads.length ? heads[i + 1].index! : md.length;
    out.push({ version: m[1], date: m[2] ?? null, body: md.slice(start, end).trim() });
  });
  return out;
}

export function compareVersions(a: string, b: string) {
  const p = (v: string) => v.split("-")[0].split(".").map((n) => parseInt(n, 10) || 0);
  const x = p(a);
  const y = p(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

function readChangelog(): string {
  for (const f of [path.join(process.cwd(), "CHANGELOG.md"), path.join(process.cwd(), "..", "CHANGELOG.md")]) {
    try {
      return fs.readFileSync(f, "utf8");
    } catch {}
  }
  return "";
}

const F = "ui-state";
type UiState = { lastSeenVersion?: string };

/**
 * "What's new" after an update: the notes of every version newer than the one
 * last acknowledged (at most 5). With nothing recorded yet, only the current one.
 */
export function whatsNew(store: JsonStore, current: string, md = readChangelog()) {
  const seen = store.read<UiState>(F, {}).lastSeenVersion;
  const all = parseChangelog(md).filter((s) => compareVersions(s.version, current) <= 0);
  const sections = seen ? all.filter((s) => compareVersions(s.version, seen) > 0).slice(0, 5) : all.filter((s) => s.version === current);
  return { current, show: seen !== current && sections.length > 0, sections };
}

export function markSeen(store: JsonStore, version: string) {
  store.update<UiState>(F, {}, (s) => {
    s.lastSeenVersion = version;
  });
}
