import fs from "node:fs";
import { route } from "@/lib/server/api";
import { findUpload } from "@/lib/server/uploads";
import { HttpError } from "@/lib/server/util";

export const GET = route(({ c, params }) => {
  const f = findUpload(c.config.dataDir, params.id);
  if (!f) throw new HttpError(404, "Imagen no encontrada");
  return new Response(new Uint8Array(fs.readFileSync(f.path)), {
    headers: { "content-type": f.mime, "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox", "cache-control": "private, max-age=3600" },
  });
});
