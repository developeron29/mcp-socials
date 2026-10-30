import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import type { Config } from "./config.js";

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
  ".webm": "video/webm",
};

export type MediaKind = "image" | "video" | "gif";

export interface MediaInfo {
  /** Original reference: a local path or an http(s) URL. */
  ref: string;
  isUrl: boolean;
  mime: string;
  kind: MediaKind;
}

export const isUrl = (s: string) => /^https?:\/\//i.test(s);

export function expandPath(p: string): string {
  return resolve(p.startsWith("~/") ? homedir() + p.slice(1) : p);
}

export function mimeOf(ref: string): string {
  const path = isUrl(ref) ? new URL(ref).pathname : ref;
  return MIME[extname(path).toLowerCase()] ?? "application/octet-stream";
}

export function describe(ref: string): MediaInfo {
  const mime = mimeOf(ref);
  const kind: MediaKind = mime === "image/gif" ? "gif" : mime.startsWith("video/") ? "video" : "image";
  return { ref, isUrl: isUrl(ref), mime, kind };
}

/** Bytes for upload-style APIs (X, YouTube thumbnails, Facebook multipart). */
export async function loadBytes(ref: string): Promise<{ data: Buffer; mime: string; name: string }> {
  if (isUrl(ref)) {
    const res = await fetch(ref);
    if (!res.ok) throw new Error(`Could not download ${ref}: ${res.status}`);
    const mime = res.headers.get("content-type")?.split(";")[0] || mimeOf(ref);
    return { data: Buffer.from(await res.arrayBuffer()), mime, name: basename(new URL(ref).pathname) || "media" };
  }
  const path = expandPath(ref);
  return { data: await readFile(path), mime: mimeOf(path), name: basename(path) };
}

export async function fileSize(ref: string): Promise<number> {
  return (await stat(expandPath(ref))).size;
}

export function fileStream(ref: string) {
  return createReadStream(expandPath(ref));
}

export interface PublicMedia {
  url: string;
  /** Removes the temporary copy, if one was made. Safe to call more than once. */
  cleanup: () => Promise<void>;
}

/**
 * Instagram (and Facebook video by URL) fetch media from a public URL.
 * URLs pass through; local files are uploaded to the configured S3-compatible bucket.
 */
export async function ensurePublicUrl(ref: string, cfg: Config): Promise<PublicMedia> {
  if (isUrl(ref)) return { url: ref, cleanup: async () => {} };

  const s3 = cfg.media?.s3;
  if (!s3) {
    throw new Error(
      `"${ref}" is a local file, but Instagram needs a public URL. Pass an https:// URL, ` +
        `or configure media.s3 (e.g. a Cloudflare R2 bucket) so local files can be uploaded automatically.`,
    );
  }

  const { S3Client, PutObjectCommand, DeleteObjectCommand } = await import("@aws-sdk/client-s3");
  const client = new S3Client({
    region: s3.region ?? "auto",
    endpoint: s3.endpoint,
    credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
  });
  const path = expandPath(ref);
  const key = `social-publish-mcp/${randomUUID()}-${basename(path).replace(/[^\w.-]/g, "_")}`;
  await client.send(
    new PutObjectCommand({
      Bucket: s3.bucket,
      Key: key,
      Body: createReadStream(path),
      ContentLength: (await stat(path)).size,
      ContentType: mimeOf(path),
    }),
  );

  let done = false;
  return {
    url: `${s3.publicBaseUrl.replace(/\/$/, "")}/${key}`,
    cleanup: async () => {
      if (done || s3.deleteAfterPublish === false) return;
      done = true;
      await client.send(new DeleteObjectCommand({ Bucket: s3.bucket, Key: key })).catch(() => {});
    },
  };
}
