import { route } from "@/lib/server/api";
import { EFFORTS, JOB_INFO, MODELS, PRESETS, TOOLS } from "@/lib/server/orchestrator";

/** The orchestrator graph (how Claude works as a team), its building blocks and ready-made starting points. */
const view = (c: Parameters<Parameters<typeof route>[0]>[0]["c"]) => ({ graph: c.orchestrator.get(), models: MODELS, tools: TOOLS, jobs: JOB_INFO, efforts: EFFORTS, presets: PRESETS, load: c.orchestrator.load() });
export const GET = route(({ c }) => view(c));
export const PUT = route(async ({ c, body }) => {
  c.orchestrator.set(await body());
  return view(c);
});
