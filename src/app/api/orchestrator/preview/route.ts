import { route } from "@/lib/server/api";

/** What the graph becomes for chats, runs and tasks: the model, the subagents, the instructions and the environment. */
export const GET = route(({ c }) => c.orchestrator.preview());
