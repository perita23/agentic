import fs from "node:fs";
import path from "node:path";
import { route } from "@/lib/server/api";
import { defaultDictDir } from "@/lib/server/spell";

/** Spelling: its settings and which dictionaries are installed. */
const view = (c: Parameters<Parameters<typeof route>[0]>[0]["c"]) => ({
  settings: c.spell.get(),
  dictionaries: { es: fs.existsSync(path.join(defaultDictDir(), "es.dic")), en: fs.existsSync(path.join(defaultDictDir(), "en.dic")) },
});
export const GET = route(({ c }) => view(c));
export const PUT = route(async ({ c, body }) => {
  c.spell.set(await body());
  return view(c);
});
