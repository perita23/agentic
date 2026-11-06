import { route } from "@/lib/server/api";

export const POST = route(async ({ c, body }) => c.ollama.improve(await body()));
