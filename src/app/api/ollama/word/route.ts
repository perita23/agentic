import { route } from "@/lib/server/api";

/** One word just typed: the word bien escrita (or itself). */
export const POST = route(async ({ c, body }) => c.ollama.word(await body()));
