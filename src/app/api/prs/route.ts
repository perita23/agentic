import { route } from "@/lib/server/api";

export const GET = route(({ c }) => c.pulls.inbox());
