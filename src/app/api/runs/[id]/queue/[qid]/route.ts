import { route } from "@/lib/server/api";

export const DELETE = route(({ c, params }) => ({ queue: c.replies.remove(params.id, params.qid) }));
