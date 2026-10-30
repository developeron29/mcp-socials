import { type Config, type XRoute, redirectUri } from "../config.js";
import { loadTokens, saveTokens, isFresh, expiresAtFrom, type OAuthTokens } from "../tokens.js";
import { request, form, sleep } from "../http.js";
import { pkcePair, randomState, waitForCode } from "../auth/oauth.js";
import { describe, loadBytes } from "../media.js";
import { assertValid, type AccountStatus, type PublishResult } from "./types.js";
import { findChannel, shareNowToX } from "./buffer.js";

const AUTHORIZE = "https://x.com/i/oauth2/authorize";
const API = "https://api.x.com/2";
const SCOPES = ["tweet.read", "tweet.write", "users.read", "media.write", "offline.access"];
const CHUNK = 4 * 1024 * 1024;

export interface XPost {
  text: string;
  /** Follow-up posts, each a reply to the one before, making a thread. */
  thread?: string[];
  /** Up to 4 images, or 1 video / GIF. Local paths or URLs. Attached to the first post. */
  media?: string[];
  /** Post as a reply to this post id. */
  reply_to?: string;
  /** Force a route for this post. Defaults to config xRoute, then "auto". */
  via?: "api" | "buffer";
  dry_run?: boolean;
}

/**
 * "auto" prefers the X API once it's authorized and falls back to Buffer,
 * so adding X API keys later switches over without other changes.
 */
export function resolveRoute(cfg: Config, via?: XRoute, hasApiTokens = !!loadTokens().x): "api" | "buffer" {
  const want = via ?? cfg.xRoute ?? "auto";
  if (want === "api" || want === "buffer") return want;
  if (cfg.x && hasApiTokens) return "api";
  if (cfg.buffer) return "buffer";
  throw new Error(
    "X has no publishing route. Add buffer.apiKey (with an X channel connected in Buffer), " +
      "or add x.clientId and run: social-publish-mcp auth x",
  );
}

function tokenHeaders(cfg: Config): Record<string, string> {
  const x = cfg.x!;
  const h: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (x.clientSecret) h.authorization = `Basic ${Buffer.from(`${x.clientId}:${x.clientSecret}`).toString("base64")}`;
  return h;
}

export async function authorize(cfg: Config): Promise<string> {
  if (!cfg.x) throw new Error("x.clientId is not configured.");
  const { verifier, challenge } = pkcePair();
  const state = randomState();
  const redirect = redirectUri(cfg);
  const url = `${AUTHORIZE}?${form({
    response_type: "code",
    client_id: cfg.x.clientId,
    redirect_uri: redirect,
    scope: SCOPES.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  })}`;
  const code = await waitForCode(url, cfg.redirectPort ?? 8787, state);
  const tok = await request("x", `${API}/oauth2/token`, {
    method: "POST",
    headers: tokenHeaders(cfg),
    body: form({ grant_type: "authorization_code", code, redirect_uri: redirect, code_verifier: verifier, client_id: cfg.x.clientId }),
  });
  const tokens: OAuthTokens = { accessToken: tok.access_token, refreshToken: tok.refresh_token, expiresAt: expiresAtFrom(tok.expires_in) };
  const me = await request("x", `${API}/users/me`, { headers: { authorization: `Bearer ${tokens.accessToken}` } });
  saveTokens("x", { ...tokens, username: me.data?.username });
  return `X connected: @${me.data?.username}`;
}

async function accessToken(cfg: Config): Promise<string> {
  const t = loadTokens().x;
  if (!t) throw new Error("X is not authorized. Run: social-publish-mcp auth x");
  if (isFresh(t)) return t.accessToken;
  if (!t.refreshToken || !cfg.x) throw new Error("X token expired. Run: social-publish-mcp auth x");
  const tok = await request("x", `${API}/oauth2/token`, {
    method: "POST",
    headers: tokenHeaders(cfg),
    body: form({ grant_type: "refresh_token", refresh_token: t.refreshToken, client_id: cfg.x.clientId }),
  });
  // X rotates refresh tokens: the old one stops working once used.
  saveTokens("x", { ...t, accessToken: tok.access_token, refreshToken: tok.refresh_token ?? t.refreshToken, expiresAt: expiresAtFrom(tok.expires_in) });
  return tok.access_token;
}

export async function status(cfg: Config): Promise<AccountStatus> {
  let route: "api" | "buffer";
  try {
    route = resolveRoute(cfg);
  } catch (e) {
    return { platform: "x", configured: false, authorized: false, hint: (e as Error).message };
  }
  return route === "api" ? apiStatus(cfg) : bufferStatus(cfg);
}

async function bufferStatus(cfg: Config): Promise<AccountStatus> {
  const base: AccountStatus = { platform: "x", configured: !!cfg.buffer, authorized: false, route: "buffer" };
  try {
    const ch = await findChannel(cfg, "twitter");
    return { ...base, authorized: true, account: `@${ch.name} (via Buffer)` };
  } catch (e) {
    return { ...base, error: (e as Error).message, hint: "Connect your X account in Buffer, or set up the X API and run: social-publish-mcp auth x" };
  }
}

async function apiStatus(cfg: Config): Promise<AccountStatus> {
  const base: AccountStatus = { platform: "x", configured: !!cfg.x, authorized: false, route: "api" };
  if (!cfg.x) return { ...base, hint: "Add x.clientId to config.json" };
  if (!loadTokens().x) return { ...base, hint: "Run: social-publish-mcp auth x" };
  try {
    const me = await request("x", `${API}/users/me`, { headers: { authorization: `Bearer ${await accessToken(cfg)}` } });
    return { ...base, authorized: true, account: `@${me.data.username}` };
  } catch (e) {
    return { ...base, error: (e as Error).message };
  }
}

/**
 * X counts every URL as 23 characters and most CJK/emoji as 2.
 * This is a close approximation of twitter-text's weighting.
 */
export function weightedLength(text: string): number {
  const withoutUrls = text.replace(/https?:\/\/\S+/g, "x".repeat(23));
  let n = 0;
  for (const ch of withoutUrls) {
    const cp = ch.codePointAt(0)!;
    const light = cp <= 0x10ff || (cp >= 0x2000 && cp <= 0x200d) || (cp >= 0x2010 && cp <= 0x201f) || (cp >= 0x2032 && cp <= 0x2037);
    n += light ? 1 : 2;
  }
  return n;
}

export function validate(p: XPost, route: "api" | "buffer" = "api"): string[] {
  const problems: string[] = [];
  if (route === "buffer" && p.reply_to) problems.push("reply_to is not supported when posting through Buffer; use via=api");
  [p.text, ...(p.thread ?? [])].forEach((t, i) => {
    const len = weightedLength(t);
    if (!t.trim() && !(i === 0 && p.media?.length)) problems.push(`post ${i + 1} is empty`);
    if (len > 280) problems.push(`post ${i + 1} is ${len}/280 characters (URLs count as 23)`);
  });
  const kinds = (p.media ?? []).map((m) => describe(m).kind);
  const motion = kinds.filter((k) => k !== "image").length;
  if (kinds.length > 4) problems.push("at most 4 media items");
  if (motion && kinds.length > 1) problems.push("a video or GIF must be the only media item");
  return problems;
}

async function uploadMedia(token: string, ref: string): Promise<string> {
  const { data, mime } = await loadBytes(ref);
  const kind = describe(ref).kind;
  const category = kind === "video" ? "tweet_video" : kind === "gif" ? "tweet_gif" : "tweet_image";
  const auth = { authorization: `Bearer ${token}` };

  const init = await request("x", `${API}/media/upload/initialize`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ media_type: mime, total_bytes: data.length, media_category: category }),
  });
  const id: string = init.data.id;

  for (let i = 0, seg = 0; i < data.length; i += CHUNK, seg++) {
    const fd = new FormData();
    fd.set("segment_index", String(seg));
    fd.set("media", new Blob([new Uint8Array(data.subarray(i, i + CHUNK))], { type: mime }));
    await request("x", `${API}/media/upload/${id}/append`, { method: "POST", headers: auth, body: fd });
  }

  let fin = await request("x", `${API}/media/upload/${id}/finalize`, { method: "POST", headers: auth });
  let info = fin.data?.processing_info;
  const deadline = Date.now() + 10 * 60_000;
  while (info && (info.state === "pending" || info.state === "in_progress")) {
    if (Date.now() > deadline) throw new Error("X media processing timed out");
    await sleep((info.check_after_secs ?? 3) * 1000);
    fin = await request("x", `${API}/media/upload?${form({ command: "STATUS", media_id: id })}`, { headers: auth });
    info = fin.data?.processing_info;
  }
  if (info?.state === "failed") throw new Error(`X could not process ${ref}: ${info.error?.message ?? "failed"}`);
  return id;
}

export async function publish(cfg: Config, p: XPost): Promise<PublishResult> {
  const route = resolveRoute(cfg, p.via);
  assertValid("x", validate(p, route));
  if (p.dry_run) {
    return { platform: "x", status: "dry_run", details: { route, posts: [p.text, ...(p.thread ?? [])], media: (p.media ?? []).map(describe), reply_to: p.reply_to } };
  }
  return route === "api" ? publishViaApi(cfg, p) : publishViaBuffer(cfg, p);
}

async function publishViaBuffer(cfg: Config, p: XPost): Promise<PublishResult> {
  const { post, channel } = await shareNowToX(cfg, p);
  return {
    platform: "x",
    status: post.status === "sent" ? "published" : "processing",
    id: post.id,
    url: post.externalLink ?? undefined,
    details: { route: "buffer", channel, bufferStatus: post.status },
  };
}

async function publishViaApi(cfg: Config, p: XPost): Promise<PublishResult> {
  const token = await accessToken(cfg);
  const mediaIds: string[] = [];
  for (const m of p.media ?? []) mediaIds.push(await uploadMedia(token, m));

  const ids: string[] = [];
  let replyTo = p.reply_to;
  for (const [i, text] of [p.text, ...(p.thread ?? [])].entries()) {
    const body: Record<string, unknown> = { text };
    if (i === 0 && mediaIds.length) body.media = { media_ids: mediaIds };
    if (replyTo) body.reply = { in_reply_to_tweet_id: replyTo };
    const res = await request("x", `${API}/tweets`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    ids.push(res.data.id);
    replyTo = res.data.id;
  }

  return {
    platform: "x",
    status: "published",
    id: ids[0],
    url: `https://x.com/i/status/${ids[0]}`,
    details: { route: "api", ...(ids.length > 1 ? { thread: ids.map((id) => `https://x.com/i/status/${id}`) } : {}) },
  };
}
