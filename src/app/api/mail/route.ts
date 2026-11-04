import { route } from "@/lib/server/api";

/** Connected accounts, routine settings and the organised messages. */
export const GET = route(({ c }) => c.mail.overview());
