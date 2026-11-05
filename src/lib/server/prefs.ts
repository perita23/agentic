import { z } from "zod";
import type { JsonStore } from "./store";
import { parse } from "./util";

/** Dashboard and Ajustes can never be hidden, so the menu can always be restored. */
const LOCKED = new Set(["/", "/settings"]);

/** The "island" at the top of the screen (macOS app): what it may show. */
export const islandSchema = z.object({
  enabled: z.boolean().default(true),
  working: z.boolean().default(true),
  alerts: z.boolean().default(true),
});
export type IslandPrefs = z.infer<typeof islandSchema>;

export const prefsSchema = z.object({
  hiddenNav: z
    .array(z.string().regex(/^\/[a-z-]*$/, "Ruta no válida").max(40))
    .max(40)
    .default([]),
  island: islandSchema.default({ enabled: true, working: true, alerts: true }),
});
export type Prefs = z.infer<typeof prefsSchema>;

const DEFAULTS: Prefs = { hiddenNav: [], island: { enabled: true, working: true, alerts: true } };

/** Personal UI preferences (stored with the app's data, so they survive updates and are the same in app and browser). */
export class PrefsService {
  constructor(private store: JsonStore) {}

  get(): Prefs {
    const r = prefsSchema.safeParse(this.store.read<unknown>("prefs", {}));
    return r.success ? r.data : DEFAULTS;
  }

  /** Saves only what the request carries (the menu and the island are changed from different screens). */
  set(body: unknown): Prefs {
    const cur = this.get();
    const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    const p = parse(prefsSchema, { hiddenNav: input.hiddenNav ?? cur.hiddenNav, island: { ...cur.island, ...(input.island && typeof input.island === "object" ? input.island : {}) } });
    const clean: Prefs = { hiddenNav: [...new Set(p.hiddenNav)].filter((h) => !LOCKED.has(h)), island: p.island };
    this.store.write("prefs", clean);
    return clean;
  }
}
