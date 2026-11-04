import { route } from "@/lib/server/api";
import { saveUpload } from "@/lib/server/uploads";

/** Attach an image to a chat message ({ mime, data: base64 }). */
export const POST = route(
  async ({ c, body }) => Response.json(saveUpload(c.config.dataDir, await body()), { status: 201 }),
  { maxBody: 12 * 1024 * 1024 },
);
