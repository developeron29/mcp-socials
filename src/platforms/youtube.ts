import { Readable } from "node:stream";
import { type Config, redirectUri } from "../config.js";
import { loadTokens, saveTokens, isFresh, expiresAtFrom, type OAuthTokens } from "../tokens.js";
import { request, form, ApiError } from "../http.js";
import { pkcePair, randomState, waitForCode } from "../auth/oauth.js";
import { describe, fileSize, fileStream, isUrl, loadBytes } from "../media.js";
import { assertValid, type AccountStatus, type PublishResult } from "./types.js";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/youtube/v3";
const UPLOAD = "https://www.googleapis.com/upload/youtube/v3";
const SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"];

export interface YouTubeUpload {
  file: string;
  title: string;
  description?: string;
  tags?: string[];
  privacy?: "public" | "unlisted" | "private";
  /** ISO 8601. YouTube requires privacy=private for scheduled videos; it flips to public at this time. */
  publish_at?: string;
  /** Adds #Shorts. YouTube decides Shorts by shape (vertical/square, up to 3 min), not by a flag. */
  shorts?: boolean;
  category_id?: string;
  made_for_kids?: boolean;
  /** Disclose realistic altered or synthetic content (YouTube's "altered content" setting). */
  contains_synthetic_media?: boolean;
  thumbnail?: string;
  dry_run?: boolean;
}

export async function authorize(cfg: Config): Promise<string> {
  const yt = cfg.youtube;
  if (!yt) throw new Error("youtube.clientId / youtube.clientSecret are not configured.");
  const { verifier, challenge } = pkcePair();
  const state = randomState();
  const redirect = redirectUri(cfg);
  const url = `${AUTH_URL}?${form({
    client_id: yt.clientId,
    redirect_uri: redirect,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  })}`;
  const code = await waitForCode(url, cfg.redirectPort ?? 8787, state);
  const tok = await request("youtube", TOKEN_URL, {
    method: "POST",
    body: form({
      code,
      client_id: yt.clientId,
      client_secret: yt.clientSecret,
      redirect_uri: redirect,
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
  });
  const tokens: OAuthTokens = {
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token,
    expiresAt: expiresAtFrom(tok.expires_in),
  };
  const channel = await channelTitle(tokens.accessToken);
  saveTokens("youtube", { ...tokens, channelTitle: channel });
  return `YouTube connected: ${channel ?? "channel"}`;
}

async function channelTitle(token: string): Promise<string | undefined> {
  const res = await request("youtube", `${API}/channels?part=snippet&mine=true`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return res.items?.[0]?.snippet?.title;
}

async function accessToken(cfg: Config): Promise<string> {
  const t = loadTokens().youtube;
  if (!t) throw new Error("YouTube is not authorized. Run: social-publish-mcp auth youtube");
  if (isFresh(t)) return t.accessToken;
  if (!t.refreshToken || !cfg.youtube) throw new Error("YouTube token expired. Run: social-publish-mcp auth youtube");
  const tok = await request("youtube", TOKEN_URL, {
    method: "POST",
    body: form({
      client_id: cfg.youtube.clientId,
      client_secret: cfg.youtube.clientSecret,
      refresh_token: t.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  saveTokens("youtube", {
    ...t,
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token ?? t.refreshToken,
    expiresAt: expiresAtFrom(tok.expires_in),
  });
  return tok.access_token;
}

export async function status(cfg: Config): Promise<AccountStatus> {
  const base: AccountStatus = { platform: "youtube", configured: !!cfg.youtube, authorized: false };
  if (!cfg.youtube) return { ...base, hint: "Add youtube.clientId/clientSecret to config.json" };
  if (!loadTokens().youtube) return { ...base, hint: "Run: social-publish-mcp auth youtube" };
  try {
    return { ...base, authorized: true, account: await channelTitle(await accessToken(cfg)) };
  } catch (e) {
    return { ...base, error: (e as Error).message };
  }
}

export function buildMetadata(u: YouTubeUpload) {
  let title = u.title;
  let description = u.description ?? "";
  if (u.shorts && !/#shorts/i.test(title + description)) {
    if (title.length + 8 <= 100) title = `${title} #Shorts`;
    else description = `${description}\n\n#Shorts`.trim();
  }
  const privacyStatus = u.publish_at ? "private" : (u.privacy ?? "private");
  return {
    snippet: { title, description, tags: u.tags, categoryId: u.category_id ?? "22" },
    status: {
      privacyStatus,
      publishAt: u.publish_at ? new Date(u.publish_at).toISOString() : undefined,
      selfDeclaredMadeForKids: u.made_for_kids ?? false,
      containsSyntheticMedia: u.contains_synthetic_media,
    },
  };
}

export function validate(u: YouTubeUpload): string[] {
  const p: string[] = [];
  const meta = buildMetadata(u);
  if (!u.title.trim()) p.push("title is required");
  if (meta.snippet.title.length > 100) p.push(`title is ${meta.snippet.title.length} chars; max 100`);
  if (/[<>]/.test(meta.snippet.title + meta.snippet.description)) p.push("title/description cannot contain < or >");
  if (Buffer.byteLength(meta.snippet.description) > 5000) p.push("description is over 5000 bytes");
  const tagChars = (u.tags ?? []).join(",").length;
  if (tagChars > 500) p.push(`tags total ${tagChars} chars; max 500`);
  if (isUrl(u.file)) p.push("file must be a local path (YouTube needs the bytes uploaded)");
  else if (describe(u.file).kind !== "video") p.push(`file "${u.file}" does not look like a video`);
  if (u.publish_at) {
    const t = Date.parse(u.publish_at);
    if (Number.isNaN(t)) p.push(`publish_at "${u.publish_at}" is not a valid date`);
    else if (t < Date.now()) p.push("publish_at is in the past");
    if (u.privacy && u.privacy !== "private") p.push("publish_at needs privacy=private (it turns public at that time)");
  }
  return p;
}

export async function upload(cfg: Config, u: YouTubeUpload): Promise<PublishResult> {
  assertValid("youtube", validate(u));
  const meta = buildMetadata(u);
  if (u.dry_run) return { platform: "youtube", status: "dry_run", details: { metadata: meta, file: u.file } };

  const token = await accessToken(cfg);
  const size = await fileSize(u.file);
  const mime = describe(u.file).mime;

  // 1. Start a resumable session.
  const init = await fetch(`${UPLOAD}/videos?uploadType=resumable&part=snippet,status`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=UTF-8",
      "x-upload-content-type": mime,
      "x-upload-content-length": String(size),
    },
    body: JSON.stringify(meta),
  });
  if (!init.ok) {
    const body = await init.json().catch(() => undefined);
    throw new ApiError("youtube", init.status, body?.error?.message ?? init.statusText, body);
  }
  const session = init.headers.get("location");
  if (!session) throw new Error("YouTube did not return an upload session URL");

  // 2. Stream the file in one PUT.
  const video = await request("youtube", session, {
    method: "PUT",
    headers: { "content-type": mime, "content-length": String(size) },
    body: Readable.toWeb(fileStream(u.file)) as ReadableStream,
    // Node requires this for streamed request bodies.
    duplex: "half",
  } as RequestInit);

  const details: Record<string, unknown> = { privacy: video.status?.privacyStatus, uploadStatus: video.status?.uploadStatus };

  // 3. Optional custom thumbnail (needs a verified channel).
  if (u.thumbnail) {
    try {
      const img = await loadBytes(u.thumbnail);
      await request("youtube", `${UPLOAD}/thumbnails/set?videoId=${video.id}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": img.mime },
        body: new Uint8Array(img.data),
      });
      details.thumbnail = "set";
    } catch (e) {
      details.thumbnail = `failed: ${(e as Error).message}`;
    }
  }

  if (u.privacy && u.privacy !== "private" && video.status?.privacyStatus === "private") {
    details.note =
      "YouTube kept this video private. Uploads from Google Cloud projects that haven't passed the YouTube API audit are locked to private.";
  }

  return {
    platform: "youtube",
    status: u.publish_at ? "scheduled" : "processing",
    id: video.id,
    url: `https://youtu.be/${video.id}`,
    details,
  };
}

export async function videoStatus(cfg: Config, id: string) {
  const token = await accessToken(cfg);
  const res = await request("youtube", `${API}/videos?part=status,processingDetails&id=${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const v = res.items?.[0];
  if (!v) throw new Error(`No YouTube video ${id} on this channel`);
  return { id, url: `https://youtu.be/${id}`, status: v.status, processing: v.processingDetails };
}
