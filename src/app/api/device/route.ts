import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";
import { route } from "@/lib/server/api";

const execFileP = promisify(execFile);
let cached: string | null = null;

/** The computer's name as the user knows it ("MacBook Pro de Hugo"), for labels. */
async function deviceName() {
  if (cached) return cached;
  let name = "";
  if (process.platform === "darwin") {
    try {
      name = (await execFileP("/usr/sbin/scutil", ["--get", "ComputerName"], { timeout: 2000 })).stdout.trim();
    } catch {}
  }
  if (!name) name = os.hostname().replace(/\.local$/, "");
  cached = name.slice(0, 80);
  return cached;
}

export const GET = route(async () => ({ name: await deviceName() }));
