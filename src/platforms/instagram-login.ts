import { type Config, redirectUri } from "../config.js";
import { loadTokens, saveTokens, expiresAtFrom } from "../tokens.js";
import { request, form } from "../http.js";
import { randomState, waitForCode } from "../auth/oauth.js";

/**
 * "Instagram API with Instagram Login": signs in to the Instagram professional
 * account directly, so it doesn't need the account linked to a Facebook Page.
 */

const SCOPES = ["instagram_business_basic", "instagram_business_content_publish"];
const GRAPH = "https://graph.instagram.com";
const DAY = 86_400_000;

export const igGraphUrl = (cfg: Config, path: string) =>
  `${GRAPH}/${cfg.meta?.graphVersion ?? "v23.0"}/${path.replace(/^\//, "")}`;

export async function igGraph<T = any>(cfg: Config, method: "GET" | "POST", path: string, params: Record<string, any>, token: string): Promise<T> {
  const flat: Record<string, string> = { access_token: token };
  for (const [k, v] of Object.entries(params)) if (v !== undefined) flat[k] = typeof v === "object" ? JSON.stringify(v) : String(v);
  const body = new URLSearchParams(flat);
  if (method === "GET") return request<T>("instagram", `${igGraphUrl(cfg, path)}?${body}`);
  return request<T>("instagram", igGraphUrl(cfg, path), { method, body });
}

export async function authorize(cfg: Config): Promise<string> {
  const ig = cfg.instagram;
  if (!ig) throw new Error("instagram.appId / instagram.appSecret are not configured.");
  const port = cfg.redirectPort ?? 8787;
  const state = `${port}-${randomState()}`;
  const redirect = ig.redirectUri ?? cfg.meta?.redirectUri ?? redirectUri(cfg);
  const url = `https://www.instagram.com/oauth/authorize?${form({
    client_id: ig.appId,
    redirect_uri: redirect,
    response_type: "code",
    scope: SCOPES.join(","),
    state,
  })}`;
  // Instagram sometimes appends "#_" to the code.
  const code = (await waitForCode(url, port, state)).replace(/#_$/, "");

  const short = await request("instagram", "https://api.instagram.com/oauth/access_token", {
    method: "POST",
    body: form({ client_id: ig.appId, client_secret: ig.appSecret, grant_type: "authorization_code", redirect_uri: redirect, code }),
  });
  // Exchange the 1-hour token for a 60-day one.
  const long = await request(
    "instagram",
    `${GRAPH}/access_token?${form({ grant_type: "ig_exchange_token", client_secret: ig.appSecret, access_token: short.access_token })}`,
  );
  const me = await igGraph(cfg, "GET", "me", { fields: "user_id,username" }, long.access_token);
  saveTokens("instagram", {
    accessToken: long.access_token,
    expiresAt: expiresAtFrom(long.expires_in),
    issuedAt: Date.now(),
    userId: String(me.user_id ?? short.user_id),
    username: me.username,
  });
  return `Instagram connected: @${me.username}`;
}

/** Returns a valid token, refreshing it when it's within a week of expiring (Instagram allows refresh after 24h). */
export async function igLoginSession(cfg: Config): Promise<{ igUserId: string; token: string; username?: string } | undefined> {
  const t = loadTokens().instagram;
  if (!t) return undefined;
  if (t.expiresAt && t.expiresAt < Date.now()) throw new Error("Instagram login expired. Run: social-publish-mcp auth instagram");
  let token = t.accessToken;
  if (t.expiresAt && t.expiresAt - Date.now() < 7 * DAY && Date.now() - (t.issuedAt ?? 0) > DAY) {
    const r = await request("instagram", `${GRAPH}/refresh_access_token?${form({ grant_type: "ig_refresh_token", access_token: token })}`);
    token = r.access_token;
    saveTokens("instagram", { ...t, accessToken: token, expiresAt: expiresAtFrom(r.expires_in), issuedAt: Date.now() });
  }
  return { igUserId: t.userId, token, username: t.username };
}
