import type { Config } from "../config.js";
import { loadTokens } from "../tokens.js";
import { request } from "../http.js";
import { describe, loadBytes } from "../media.js";
import { graph, graphUrl, graphVideoUrl, metaTokens } from "./meta.js";
import { assertValid, parseSchedule, type AccountStatus, type PublishResult } from "./types.js";

export interface FacebookPost {
  message?: string;
  link?: string;
  /** Local paths or URLs. Several images make a multi-photo post; a video must be alone. */
  media?: string[];
  /** Title for a video post. */
  title?: string;
  /** ISO 8601, 10 minutes to 30 days ahead. */
  schedule_at?: string;
  dry_run?: boolean;
}

export async function status(cfg: Config): Promise<AccountStatus> {
  const base: AccountStatus = { platform: "facebook", configured: !!cfg.meta, authorized: false };
  if (!cfg.meta) return { ...base, hint: "Add meta.appId/appSecret to config.json" };
  const t = loadTokens().meta;
  if (!t) return { ...base, hint: "Run: social-publish-mcp auth meta" };
  try {
    const page = await graph(cfg, "GET", t.pageId, { fields: "name" }, t.pageToken);
    return { ...base, authorized: true, account: `${page.name} (${t.pageId})` };
  } catch (e) {
    return { ...base, error: (e as Error).message };
  }
}

export function validate(p: FacebookPost): string[] {
  const problems: string[] = [];
  const media = (p.media ?? []).map(describe);
  if (!p.message && !p.link && !media.length) problems.push("needs a message, link or media");
  if (p.message && p.message.length > 63206) problems.push("message is over 63,206 characters");
  if (media.some((m) => m.kind === "video") && media.length > 1) problems.push("a video post can only contain one video");
  if (p.link && media.length) problems.push("link posts cannot also have media; put the link in the message instead");
  return problems;
}

/** Multipart upload when we have bytes; Meta fetches by url otherwise. */
async function mediaField(ref: string, urlField: string): Promise<{ form?: FormData; url?: Record<string, string> }> {
  const info = describe(ref);
  if (info.isUrl) return { url: { [urlField]: ref } };
  const { data, mime, name } = await loadBytes(ref);
  const fd = new FormData();
  fd.set("source", new Blob([new Uint8Array(data)], { type: mime }), name);
  return { form: fd };
}

async function postForm(url: string, token: string, fields: Record<string, any>, fd?: FormData) {
  const body = fd ?? new FormData();
  body.set("access_token", token);
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) body.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  return request("meta", url, { method: "POST", body });
}

export async function publish(cfg: Config, p: FacebookPost): Promise<PublishResult> {
  assertValid("facebook", validate(p));
  const scheduled = parseSchedule("facebook", p.schedule_at, 10, 30);
  const timing = scheduled ? { published: false, scheduled_publish_time: scheduled } : {};
  const media = (p.media ?? []).map(describe);

  if (p.dry_run) return { platform: "facebook", status: "dry_run", details: { ...p, media, ...timing } };

  const { pageId, pageToken } = metaTokens();
  const status = scheduled ? "scheduled" : "published";

  // Video
  if (media[0]?.kind === "video") {
    const { form: fd, url } = await mediaField(media[0].ref, "file_url");
    const res = await postForm(graphVideoUrl(cfg, `${pageId}/videos`), pageToken, { description: p.message, title: p.title, ...url, ...timing }, fd);
    return { platform: "facebook", status: scheduled ? "scheduled" : "processing", id: res.id, url: `https://www.facebook.com/${pageId}/videos/${res.id}` };
  }

  // Single photo
  if (media.length === 1) {
    const { form: fd, url } = await mediaField(media[0].ref, "url");
    const res = await postForm(graphUrl(cfg, `${pageId}/photos`), pageToken, { caption: p.message, ...url, ...timing }, fd);
    const id = res.post_id ?? res.id;
    return { platform: "facebook", status, id, url: `https://www.facebook.com/${id}` };
  }

  // Multi-photo: upload unpublished photos, then attach them to one feed post.
  const attached: { media_fbid: string }[] = [];
  for (const m of media) {
    const { form: fd, url } = await mediaField(m.ref, "url");
    const res = await postForm(graphUrl(cfg, `${pageId}/photos`), pageToken, { published: false, temporary: !!scheduled || undefined, ...url }, fd);
    attached.push({ media_fbid: res.id });
  }
  const params: Record<string, any> = { message: p.message, link: p.link, ...timing };
  attached.forEach((a, i) => (params[`attached_media[${i}]`] = a));
  const res = await graph(cfg, "POST", `${pageId}/feed`, params, pageToken);
  return { platform: "facebook", status, id: res.id, url: `https://www.facebook.com/${res.id}` };
}
