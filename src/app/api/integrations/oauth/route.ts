import { route } from "@/lib/server/api";
import { slackManifestUrl } from "@/lib/server/integrations/oauth";

/** OAuth apps configured (never their secrets), the redirect URL to register and Slack's one-click app link. */
export const GET = route(({ c, req }) => ({
  apps: c.oauth.appsStatus(),
  callbackUrl: c.oauth.redirectUri(`http://${req.headers.get("host")}`),
  slackManifestUrl: slackManifestUrl(),
}));
