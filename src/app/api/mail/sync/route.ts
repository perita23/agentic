import { route } from "@/lib/server/api";

export const POST = route(({ c }) => c.mail.sync());
