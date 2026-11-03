import { route } from "@/lib/server/api";

export const GET = route(({ c, params }) => c.pulls.detail(params.provider, params.owner, params.repo, Number(params.number)));
