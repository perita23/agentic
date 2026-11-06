import { route } from "@/lib/server/api";

export const POST = route(async ({ c, body }) => c.ollama.correct(await body()));
