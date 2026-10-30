import type { Config } from "../config.js";
import { loadTokens } from "../tokens.js";
import { sleep } from "../http.js";
import { describe, ensurePublicUrl, type PublicMedia } from "../media.js";
import { graph, metaTokens } from "./meta.js";
import { igGraph, igLoginSession } from "./instagram-login.js";
import { assertValid, type AccountStatus, type PublishResult } from "./types.js";

export interface InstagramPost {
  caption?: string;
  /** Local paths (needs media.s3) or public https URLs. */
  media: string[];
  /** Inferred when omitted: several items -> carousel, one video -> reel, one image -> image. */
  type?: "image" | "reel" | "carousel" | "story";
  /** Reel cover image URL. */
  cover_url?: string;
  /** Also show the reel in the main feed grid. Default true. */
  share_to_feed?: boolean;
  /** Seconds to wait for Instagram to process video before returning "processing". Default 300. */
  wait_seconds?: number;
  dry_run?: boolean;
}

/**
 * One Instagram account to publish to. Instagram Login is preferred when it's
 * set up; otherwise the account linked to the Facebook Page is used.
 */
interface Session {
  route: "instagram_login" | "facebook_page";
  igUserId: string;
  call: <T = any>(method: "GET" | "POST", path: string, params: Record<string, any>) => Promise<T>;
}

async function session(cfg: Config): Promise<Session> {
  if (cfg.instagram) {
    const s = await igLoginSession(cfg);
    if (s) return { route: "instagram_login", igUserId: s.igUserId, call: (m, p, params) => igGraph(cfg, m, p, params, s.token) };
  }
  const t = loadTokens().meta;
  if (t?.igUserId) {
    const { igUserId, pageToken } = metaTokens();
    return { route: "facebook_page", igUserId: igUserId!, call: (m, p, params) => graph(cfg, m, p, params, pageToken) };
  }
  throw new Error(
    cfg.instagram
      ? "Instagram is not authorized. Run: social-publish-mcp auth instagram"
      : t
        ? "No Instagram professional account is linked to the connected Facebook Page. Link one, or set up Instagram Login (instagram.appId) and run: social-publish-mcp auth instagram"
        : "Instagram is not set up. Run: social-publish-mcp auth instagram (or auth meta for a Page-linked account)",
  );
}

export async function status(cfg: Config): Promise<AccountStatus> {
  const base: AccountStatus = { platform: "instagram", configured: !!(cfg.instagram || cfg.meta), authorized: false };
  if (!base.configured) return { ...base, hint: "Add instagram.appId/appSecret (or meta.appId/appSecret) to config.json" };
  try {
    const s = await session(cfg);
    const ig = await s.call("GET", s.route === "instagram_login" ? "me" : s.igUserId, { fields: "username" });
    const hint = cfg.media?.s3 ? undefined : "No media.s3 bucket configured: Instagram posts must use public https URLs.";
    return { ...base, authorized: true, account: `@${ig.username} (via ${s.route === "instagram_login" ? "Instagram Login" : "Facebook Page"})`, hint };
  } catch (e) {
    return { ...base, error: (e as Error).message };
  }
}

export function resolveType(p: InstagramPost): NonNullable<InstagramPost["type"]> {
  if (p.type) return p.type;
  if (p.media.length > 1) return "carousel";
  return describe(p.media[0] ?? "").kind === "video" ? "reel" : "image";
}

export function validate(p: InstagramPost): string[] {
  const problems: string[] = [];
  const type = resolveType(p);
  const kinds = p.media.map((m) => describe(m).kind);
  if (!p.media.length) problems.push("Instagram posts need at least one image or video");
  if ((p.caption ?? "").length > 2200) problems.push(`caption is ${p.caption!.length} chars; max 2200`);
  if (((p.caption ?? "").match(/#[\p{L}\p{N}_]+/gu) ?? []).length > 30) problems.push("caption has more than 30 hashtags");
  if (kinds.includes("gif")) problems.push("Instagram does not accept GIFs; convert to MP4");
  if (type === "carousel" && (p.media.length < 2 || p.media.length > 10)) problems.push("a carousel needs 2-10 items");
  if (type === "image" && kinds[0] !== "image") problems.push("type=image needs an image file");
  if (type === "reel" && (p.media.length !== 1 || kinds[0] !== "video")) problems.push("type=reel needs exactly one video");
  if (type === "story" && p.media.length !== 1) problems.push("type=story needs exactly one image or video");
  return problems;
}

async function waitForContainer(s: Session, id: string, maxSeconds: number): Promise<string> {
  const deadline = Date.now() + maxSeconds * 1000;
  for (;;) {
    const c = await s.call("GET", id, { fields: "status_code,status" });
    if (c.status_code === "FINISHED" || c.status_code === "PUBLISHED") return c.status_code;
    if (c.status_code === "ERROR" || c.status_code === "EXPIRED") throw new Error(`Instagram could not process the media: ${c.status ?? c.status_code}`);
    if (Date.now() > deadline) return c.status_code ?? "IN_PROGRESS";
    await sleep(5000);
  }
}

async function finishPublish(s: Session, containerId: string): Promise<PublishResult> {
  const pub = await s.call("POST", `${s.igUserId}/media_publish`, { creation_id: containerId });
  const info = await s.call("GET", pub.id, { fields: "permalink" }).catch(() => ({}) as any);
  return { platform: "instagram", status: "published", id: pub.id, url: info.permalink, details: { route: s.route } };
}

export async function publish(cfg: Config, p: InstagramPost): Promise<PublishResult> {
  assertValid("instagram", validate(p));
  const type = resolveType(p);
  if (p.dry_run) return { platform: "instagram", status: "dry_run", details: { type, caption: p.caption, media: p.media.map(describe) } };

  const s = await session(cfg);
  const igUserId = s.igUserId;

  const hosted: PublicMedia[] = [];
  const host = async (ref: string) => {
    const h = await ensurePublicUrl(ref, cfg);
    hosted.push(h);
    return h.url;
  };
  const mediaField = async (ref: string) =>
    describe(ref).kind === "video" ? { media_type: type === "story" ? "STORIES" : "VIDEO", video_url: await host(ref) } : { image_url: await host(ref) };

  let published = false;
  try {
    let containerId: string;
    if (type === "carousel") {
      const children: string[] = [];
      for (const ref of p.media) {
        const child = await s.call("POST", `${igUserId}/media`, { is_carousel_item: true, ...(await mediaField(ref)) });
        await waitForContainer(s, child.id, p.wait_seconds ?? 300);
        children.push(child.id);
      }
      containerId = (await s.call("POST", `${igUserId}/media`, { media_type: "CAROUSEL", children: children.join(","), caption: p.caption })).id;
    } else if (type === "reel") {
      containerId = (
        await s.call("POST", `${igUserId}/media`,
          { media_type: "REELS", video_url: await host(p.media[0]), caption: p.caption, cover_url: p.cover_url, share_to_feed: p.share_to_feed ?? true },
        )
      ).id;
    } else if (type === "story") {
      const field = await mediaField(p.media[0]);
      containerId = (await s.call("POST", `${igUserId}/media`, { media_type: "STORIES", ...field })).id;
    } else {
      containerId = (await s.call("POST", `${igUserId}/media`, { image_url: await host(p.media[0]), caption: p.caption })).id;
    }

    const state = await waitForContainer(s, containerId, p.wait_seconds ?? 300);
    if (state !== "FINISHED") {
      return {
        platform: "instagram",
        status: "processing",
        id: containerId,
        details: { note: "Still processing. Call get_post_status with platform=instagram and this id to publish it once ready." },
      };
    }
    const result = await finishPublish(s, containerId);
    published = true;
    return result;
  } finally {
    // Keep hosted files while Instagram may still fetch them.
    if (published) await Promise.all(hosted.map((h) => h.cleanup()));
  }
}

/** Checks a container; publishes it when it's ready and `publish_if_ready` is set. */
export async function containerStatus(cfg: Config, containerId: string, publishIfReady: boolean) {
  const s = await session(cfg);
  const c = await s.call("GET", containerId, { fields: "status_code,status" });
  if (c.status_code === "FINISHED" && publishIfReady) return finishPublish(s, containerId);
  return { platform: "instagram", id: containerId, status_code: c.status_code, status: c.status };
}
