import { z } from "zod";
import { AVATAR_IDS } from "../avatars";
import type { JsonStore } from "./store";
import { deleteUpload, findUpload } from "./uploads";
import { HttpError, nowIso, parse, UUID_RE } from "./util";

const avatarSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("preset"), id: z.string().refine((s) => AVATAR_IDS.includes(s), "Avatar no válido") }),
    z.object({ kind: z.literal("photo"), id: z.string().regex(UUID_RE, "Foto no válida") }),
  ])
  .nullable();

export const profileSchema = z.object({
  name: z.string().trim().max(60).default(""),
  avatar: avatarSchema.default(null),
  createdAt: z.string().default(""),
});
export type Profile = z.infer<typeof profileSchema>;

/** Who is using this app: a name and a picture (a predefined avatar or a photo). It is stored only on this device. */
export class ProfileService {
  constructor(
    private store: JsonStore,
    private dataDir: string,
  ) {}

  get(): Profile {
    const r = profileSchema.safeParse(this.store.read<unknown>("profile", {}));
    return r.success ? r.data : { name: "", avatar: null, createdAt: "" };
  }

  set(body: unknown): Profile {
    const cur = this.get();
    const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    const next = parse(profileSchema, { name: "name" in input ? input.name : cur.name, avatar: "avatar" in input ? input.avatar : cur.avatar, createdAt: cur.createdAt || nowIso() });
    if (next.avatar?.kind === "photo" && !findUpload(this.dataDir, next.avatar.id)) throw new HttpError(400, "Esa foto ya no existe: vuelve a subirla");
    // The old photo is not kept once it is replaced or removed.
    if (cur.avatar?.kind === "photo" && !(next.avatar?.kind === "photo" && next.avatar.id === cur.avatar.id)) deleteUpload(this.dataDir, cur.avatar.id);
    this.store.write("profile", next);
    return next;
  }
}
