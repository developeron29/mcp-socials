import { loadConfig, CONFIG_PATH, redirectUri } from "../config.js";
import * as x from "../platforms/x.js";
import * as meta from "../platforms/meta.js";
import * as youtube from "../platforms/youtube.js";
import * as instagramLogin from "../platforms/instagram-login.js";

const FLOWS: Record<string, (cfg: ReturnType<typeof loadConfig>) => Promise<string>> = {
  x: x.authorize,
  twitter: x.authorize,
  meta: meta.authorize,
  facebook: meta.authorize,
  instagram: instagramLogin.authorize,
  youtube: youtube.authorize,
};

export async function runAuth(platform: string | undefined): Promise<void> {
  const cfg = loadConfig();
  const flow = platform && FLOWS[platform.toLowerCase()];
  if (!flow) {
    console.error(
      `Usage: social-publish-mcp auth <x|meta|instagram|youtube>\n\n` +
        `  x          X / Twitter\n  meta       Facebook Page (+ Instagram account linked to it)\n` +
        `  instagram  Instagram professional account via Instagram Login (no Page link needed)\n  youtube    YouTube channel\n\n` +
        `App credentials are read from ${CONFIG_PATH} (or env vars).\n` +
        `Register this redirect URI in each developer app: ${redirectUri(cfg)}`,
    );
    process.exit(1);
  }
  try {
    console.error(await flow(cfg));
  } catch (e) {
    console.error(`Auth failed: ${(e as Error).message}`);
    process.exit(1);
  }
}
