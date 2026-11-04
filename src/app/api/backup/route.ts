import { route } from "@/lib/server/api";

/** Download Agentic's data (no credentials), or a saved copy with ?file=. */
export const GET = route(({ c, url }) => {
  const file = url.searchParams.get("file");
  const data = file ? c.backups.read(file) : c.backups.snapshot();
  const name = file ?? `agentic-${new Date().toISOString().slice(0, 10)}.json`;
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
