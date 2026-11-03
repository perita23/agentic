import { route } from "@/lib/server/api";

export const POST = route(({ c, params }) => c.integrations.test(params.provider));
