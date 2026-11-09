import fs from "node:fs";
import { Readable } from "node:stream";
import { route } from "@/lib/server/api";
import { HttpError } from "@/lib/server/util";

const TYPES: Record<string, string> = { ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8", ".json": "application/json", ".csv": "text/csv; charset=utf-8", ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".zip": "application/zip" };

/** Download a file Claude created in this chat (only ever as an attachment: it is never shown by the browser). */
export const GET = route(async ({ c, params, url }) => {
  const requested = url.searchParams.get("path");
  if (!requested) throw new HttpError(400, "Falta el archivo");
  const f = await c.chats.fileFor(params.id, requested);
  const ext = f.name.slice(f.name.lastIndexOf(".")).toLowerCase();
  const ascii = f.name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return new Response(Readable.toWeb(fs.createReadStream(f.path)) as ReadableStream, {
    headers: {
      "Content-Type": TYPES[ext] ?? "application/octet-stream",
      "Content-Length": String(f.size),
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
