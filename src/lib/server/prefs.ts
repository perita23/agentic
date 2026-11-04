import { z } from "zod";
import type { JsonStore } from "./store";
import { parse } from "./util";

/** Dashboard and Ajustes can never be hidden, so the menu can always be restored. */
const LOCKED = new Set(["/", "/settings"]);

export const prefsSchema = z.object({
  hiddenNav: z
    .array(z.string().regex(/^\/[a-z-]*$/, "Ruta no válida").max(40))
    .max(40)
    .default([]),
});
export type Prefs = z.infer<typeof prefsSchema>;

/** Personal UI preferences (stored with the app's data, so they survive updates and are the same in app and browser). */
export class PrefsService {
  constructor(private store: JsonStore) {}

  get(): Prefs {
    const r = prefsSchema.safeParse(this.store.read<unknown>("prefs", {}));
    return r.success ? r.data : { hiddenNav: [] };
  }

  set(body: unknown): Prefs {
    const p = parse(prefsSchema, body);
    const clean: Prefs = { hiddenNav: [...new Set(p.hiddenNav)].filter((h) => !LOCKED.has(h)) };
    this.store.write("prefs", clean);
    return clean;
  }
}
