import { publicRoute } from "@/lib/server/api";
import { readAuth } from "@/lib/server/auth";

/** Public: what the login page can offer. */
export const GET = publicRoute(({ c, req }) => {
  const st = readAuth(c.config.dataDir);
  const host = (req.headers.get("host") ?? "").split(":")[0];
  return { passkeys: st.passkeys.length > 0, requirePasskey: st.requirePasskey, localhost: host === "localhost" };
});
