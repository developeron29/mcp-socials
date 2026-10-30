import type { BufferConfig, Config } from "../config.js";
import { request, sleep } from "../http.js";
import { describe, ensurePublicUrl, type PublicMedia } from "../media.js";

/**
 * Minimal client for Buffer's GraphQL API, used as a publishing route for X.
 * Posts go out with mode=shareNow, so they don't occupy Buffer's scheduled-post queue.
 */

const DEFAULT_API = "https://api.buffer.com";

export interface BufferPost {
  id: string;
  status: string;
  externalLink?: string | null;
  error?: { message: string } | null;
}

export async function gql<T = any>(b: BufferConfig, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await request("buffer", b.apiUrl ?? DEFAULT_API, {
    method: "POST",
    headers: { authorization: `Bearer ${b.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (res.errors?.length) throw new Error(`[buffer] ${res.errors.map((e: any) => e.message).join("; ")}`);
  return res.data as T;
}

function requireBuffer(cfg: Config): BufferConfig {
  if (!cfg.buffer) throw new Error("Buffer is not configured. Add buffer.apiKey (from https://publish.buffer.com/settings/api).");
  return cfg.buffer;
}

/** Finds the channel for a service, preferring an explicit id from config. */
export async function findChannel(cfg: Config, service: "twitter"): Promise<{ id: string; name: string }> {
  const b = requireBuffer(cfg);
  const data = await gql(b, `query { account { organizations { id } } }`);
  const orgIds: string[] = b.organizationId ? [b.organizationId] : data.account.organizations.map((o: any) => o.id);
  for (const organizationId of orgIds) {
    const { channels } = await gql(
      b,
      `query($input: ChannelsInput!) { channels(input: $input) { id name service isDisconnected isLocked } }`,
      { input: { organizationId } },
    );
    const match = (channels as any[]).find((c) => (b.xChannelId ? c.id === b.xChannelId : c.service === service));
    if (match) {
      if (match.isDisconnected || match.isLocked) throw new Error(`Buffer channel ${match.name} is ${match.isDisconnected ? "disconnected" : "locked"}`);
      return { id: match.id, name: match.name };
    }
  }
  throw new Error(`No ${service === "twitter" ? "X/Twitter" : service} channel is connected in Buffer.`);
}

const CREATE_POST = `
mutation($input: CreatePostInput!) {
  createPost(input: $input) {
    __typename
    ... on PostActionSuccess { post { id status externalLink error { message } } }
    ... on MutationError { message }
  }
}`;

const GET_POST = `query($input: PostInput!) { post(input: $input) { id status externalLink error { message } } }`;

export interface BufferXPost {
  text: string;
  thread?: string[];
  media?: string[];
}

function asset(url: string, ref: string) {
  return describe(ref).kind === "video" ? { video: { url } } : { image: { url } };
}

export async function shareNowToX(cfg: Config, p: BufferXPost): Promise<{ post: BufferPost; channel: string }> {
  const b = requireBuffer(cfg);
  const channel = await findChannel(cfg, "twitter");

  // Buffer fetches media from public URLs, same as Instagram.
  const hosted: PublicMedia[] = [];
  const assets = [];
  for (const ref of p.media ?? []) {
    const h = await ensurePublicUrl(ref, cfg);
    hosted.push(h);
    assets.push(asset(h.url, ref));
  }

  const input: Record<string, unknown> = {
    channelId: channel.id,
    mode: "shareNow",
    schedulingType: "automatic",
    text: p.text,
    assets,
    source: "social-publish-mcp",
  };
  if (p.thread?.length) {
    // Buffer wants the whole thread in metadata, with the first item matching the outer text.
    input.metadata = { twitter: { thread: [{ text: p.text, assets }, ...p.thread.map((text) => ({ text, assets: [] }))] } };
  }

  const { createPost } = await gql(b, CREATE_POST, { input });
  if (createPost.__typename !== "PostActionSuccess") {
    throw new Error(`[buffer] ${createPost.__typename}: ${createPost.message}`);
  }

  // shareNow returns while the post is still sending; wait briefly for the live link.
  let post: BufferPost = createPost.post;
  for (let i = 0; i < 10 && (post.status === "sending" || post.status === "scheduled") && !post.externalLink; i++) {
    await sleep(2000);
    post = (await gql(b, GET_POST, { input: { id: post.id } })).post;
  }
  if (post.status === "error") throw new Error(`[buffer] X rejected the post: ${post.error?.message ?? "unknown error"}`);

  // Keep hosted media until Buffer has fetched it.
  if (post.status === "sent") await Promise.all(hosted.map((h) => h.cleanup()));
  return { post, channel: channel.name };
}
