import { type Config, redirectUri } from "../config.js";
import { loadTokens, saveTokens, type MetaTokens } from "../tokens.js";
import { request, form } from "../http.js";
import { randomState, waitForCode } from "../auth/oauth.js";

/** Shared Facebook Login + Graph API plumbing for the Facebook and Instagram adapters. */

const SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "business_management",
  "instagram_basic",
  "instagram_content_publish",
];

export const graphVersion = (cfg: Config) => cfg.meta?.graphVersion ?? "v23.0";
export const graphUrl = (cfg: Config, path: string) => `https://graph.facebook.com/${graphVersion(cfg)}/${path.replace(/^\//, "")}`;
export const graphVideoUrl = (cfg: Config, path: string) =>
  `https://graph-video.facebook.com/${graphVersion(cfg)}/${path.replace(/^\//, "")}`;

export async function graph<T = any>(cfg: Config, method: "GET" | "POST" | "DELETE", path: string, params: Record<string, any>, token: string): Promise<T> {
  const flat: Record<string, string> = { access_token: token };
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    flat[k] = typeof v === "object" ? JSON.stringify(v) : String(v);
  }
  const body = new URLSearchParams(flat);
  if (method === "GET") return request<T>("meta", `${graphUrl(cfg, path)}?${body}`);
  return request<T>("meta", graphUrl(cfg, path), { method, body });
}

export async function authorize(cfg: Config): Promise<string> {
  const m = cfg.meta;
  if (!m) throw new Error("meta.appId / meta.appSecret are not configured.");
  const port = cfg.redirectPort ?? 8787;
  // The port prefix tells an HTTPS relay page which localhost port to forward to.
  const state = `${port}-${randomState()}`;
  const redirect = m.redirectUri ?? redirectUri(cfg);
  const url = `https://www.facebook.com/${graphVersion(cfg)}/dialog/oauth?${form({
    client_id: m.appId,
    redirect_uri: redirect,
    state,
    ...(m.loginConfigId ? { config_id: m.loginConfigId, override_default_response_type: true } : { scope: SCOPES.join(",") }),
    response_type: "code",
  })}`;
  const code = await waitForCode(url, port, state);

  const short = await request("meta", `${graphUrl(cfg, "oauth/access_token")}?${form({
    client_id: m.appId,
    client_secret: m.appSecret,
    redirect_uri: redirect,
    code,
  })}`);
  // Long-lived user token -> Page tokens that don't expire.
  const long = await request("meta", `${graphUrl(cfg, "oauth/access_token")}?${form({
    grant_type: "fb_exchange_token",
    client_id: m.appId,
    client_secret: m.appSecret,
    fb_exchange_token: short.access_token,
  })}`);
  const userToken: string = long.access_token;

  const pages = await graph(cfg, "GET", "me/accounts", { fields: "id,name,access_token,instagram_business_account{id,username}", limit: 100 }, userToken);
  const list: any[] = pages.data ?? [];
  if (!list.length) throw new Error("No Facebook Pages were shared with this app. Re-run and select your Page in the consent dialog.");
  const page = m.pageId ? list.find((p) => p.id === m.pageId) : list[0];
  if (!page) throw new Error(`Page ${m.pageId} not found. Available: ${list.map((p) => `${p.name} (${p.id})`).join(", ")}`);

  const tokens: MetaTokens = {
    userToken,
    pageId: page.id,
    pageName: page.name,
    pageToken: page.access_token,
    igUserId: page.instagram_business_account?.id,
    igUsername: page.instagram_business_account?.username,
  };
  saveTokens("meta", tokens);

  const lines = [`Facebook Page connected: ${page.name} (${page.id})`];
  lines.push(
    tokens.igUserId
      ? `Instagram connected: @${tokens.igUsername} (${tokens.igUserId})`
      : "No Instagram professional account is linked to this Page; Instagram posting is unavailable.",
  );
  if (list.length > 1 && !m.pageId) {
    lines.push(`Other Pages available (set meta.pageId to choose): ${list.slice(1).map((p) => `${p.name} (${p.id})`).join(", ")}`);
  }
  return lines.join("\n");
}

export function metaTokens(): MetaTokens {
  const t = loadTokens().meta;
  if (!t) throw new Error("Facebook/Instagram are not authorized. Run: social-publish-mcp auth meta");
  return t;
}
