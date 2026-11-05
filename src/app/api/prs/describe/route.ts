import { z } from "zod";
import { route } from "@/lib/server/api";
import { branchName } from "@/lib/server/branches";
import { chatDir } from "@/lib/server/chats";
import { describePrPrompt, prFacts, streamClaudeText } from "@/lib/server/pr-describe";
import { HttpError, parse } from "@/lib/server/util";

const schema = z.object({ projectPath: z.string().max(1000), head: branchName, base: branchName });

/** Claude writes the title and description of a PR from its commits and diff, streamed as it is written (SSE). */
export const POST = route(async ({ c, req, body }) => {
  const input = parse(schema, await body());
  if (!c.projects.isKnown(input.projectPath)) throw new HttpError(400, "Elige un proyecto de Agentic");
  if (input.head === input.base) throw new HttpError(400, "La rama de origen y la de destino son la misma");
  const facts = await prFacts(input.projectPath, input.head, input.base);
  if (!facts.commits && !facts.diff) throw new HttpError(400, "No hay cambios entre las dos ramas");
  const prompt = describePrPrompt(input.head, input.base, facts);
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        for await (const text of streamClaudeText({ claudeBin: c.config.claudeBin, cwd: chatDir(c.config.dataDir), prompt, model: "haiku", signal: req.signal })) send("text", { text });
        send("done", {});
      } catch (e) {
        send("error", { message: (e as Error).message || "No se pudo generar la descripción" });
      }
      try {
        controller.close();
      } catch {}
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store, no-transform", "x-content-type-options": "nosniff" } });
});
