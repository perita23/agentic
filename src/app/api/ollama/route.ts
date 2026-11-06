import { route } from "@/lib/server/api";

/** The local model (Ollama): its settings, and (unless `?probe=0`) whether it is reachable with which models. */
export const GET = route(({ c, req }) => (new URL(req.url).searchParams.get("probe") === "0" ? { settings: c.ollama.get() } : c.ollama.status()));
export const PUT = route(async ({ c, body }) => {
  c.ollama.set(await body());
  return c.ollama.status();
});
