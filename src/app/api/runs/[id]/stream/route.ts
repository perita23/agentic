import { route } from "@/lib/server/api";

export const GET = route(({ c, params, req, url }) => {
  // EventSource resends the last id it saw on reconnect; ?offset= is for the first connect.
  const resume = Number(req.headers.get("last-event-id") ?? url.searchParams.get("offset") ?? 0);
  const stream = c.runs.streamLog(params.id, Number.isFinite(resume) ? resume : 0, req.signal);
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "x-content-type-options": "nosniff",
    },
  });
});
