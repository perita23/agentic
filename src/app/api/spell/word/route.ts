import { route } from "@/lib/server/api";

/** One word just typed: itself, or its correction when a dictionary finds it wrong (the model only chooses between candidates). */
export const POST = route(async ({ c, body }) => c.spell.word(await body()));
