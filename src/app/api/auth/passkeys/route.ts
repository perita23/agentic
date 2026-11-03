import { route } from "@/lib/server/api";
import { readAuth } from "@/lib/server/auth";
import { publicPasskey } from "@/lib/server/passkeys";

export const GET = route(({ c }) => {
  const st = readAuth(c.config.dataDir);
  return { passkeys: st.passkeys.map(publicPasskey), requirePasskey: st.requirePasskey };
});
