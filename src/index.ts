#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig, CONFIG_PATH } from "./config.js";
import { runAuth } from "./auth/cli.js";
import * as x from "./platforms/x.js";
import * as facebook from "./platforms/facebook.js";
import * as instagram from "./platforms/instagram.js";
import * as youtube from "./platforms/youtube.js";
import type { PlatformName, PublishResult } from "./platforms/types.js";

const VERSION = "0.1.0";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const ok = (data: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
const fail = (e: unknown): ToolResult => ({ content: [{ type: "text", text: (e as Error).message ?? String(e) }], isError: true });

/** Config is re-read on every call, so editing config.json or re-running auth needs no restart. */
const run = (fn: (cfg: ReturnType<typeof loadConfig>) => Promise<unknown>) => async (): Promise<ToolResult> => {
  try {
    return ok(await fn(loadConfig()));
  } catch (e) {
    return fail(e);
  }
};

const media = z.array(z.string()).describe("Local file paths (absolute or ~/...) or public https URLs");
const dryRun = z.boolean().optional().describe("Validate and show what would be sent, without posting");
const publishing = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

const youtubeFields = {
  title: z.string().describe("Video title, max 100 characters"),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  privacy: z.enum(["public", "unlisted", "private"]).optional().describe("Default private"),
  publish_at: z.string().optional().describe("ISO 8601 time to go public; forces privacy=private until then"),
  shorts: z.boolean().optional().describe("Add #Shorts. The video must be vertical/square and up to 3 minutes"),
  category_id: z.string().optional().describe("YouTube category id, default 22 (People & Blogs)"),
  made_for_kids: z.boolean().optional(),
  contains_synthetic_media: z.boolean().optional().describe("Disclose realistic AI-generated or altered content"),
  thumbnail: z.string().optional().describe("Custom thumbnail image (path or URL); needs a verified channel"),
};

function createServer(): McpServer {
  const server = new McpServer({ name: "social-publish-mcp", version: VERSION });

  server.registerTool(
    "list_accounts",
    {
      title: "List connected accounts",
      description: "Shows which platforms (X, Facebook, Instagram, YouTube) are configured and authorized, and the account each will post as.",
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    run(async (cfg) => ({
      config: CONFIG_PATH,
      accounts: await Promise.all([x.status(cfg), facebook.status(cfg), instagram.status(cfg), youtube.status(cfg)]),
    })),
  );

  server.registerTool(
    "post_x",
    {
      title: "Post to X",
      description:
        "Publishes a post (or a thread) to X/Twitter immediately, through the X API when it's set up, otherwise through Buffer (shareNow). " +
        "Max 280 characters per post; URLs count as 23.",
      inputSchema: {
        text: z.string(),
        thread: z.array(z.string()).optional().describe("Extra posts, each replying to the previous one"),
        media: media.optional().describe("Up to 4 images, or 1 video/GIF, attached to the first post"),
        reply_to: z.string().optional().describe("Post id to reply to (X API route only)"),
        via: z.enum(["api", "buffer"]).optional().describe("Force a route; default follows config (auto: X API if authorized, else Buffer)"),
        dry_run: dryRun,
      },
      annotations: publishing,
    },
    (args) => run((cfg) => x.publish(cfg, args))(),
  );

  server.registerTool(
    "post_facebook",
    {
      title: "Post to Facebook Page",
      description: "Publishes or schedules a post on the connected Facebook Page: text, link, one or more photos, or one video.",
      inputSchema: {
        message: z.string().optional(),
        link: z.string().optional(),
        media: media.optional(),
        title: z.string().optional().describe("Video title"),
        schedule_at: z.string().optional().describe("ISO 8601, 10 minutes to 30 days ahead"),
        dry_run: dryRun,
      },
      annotations: publishing,
    },
    (args) => run((cfg) => facebook.publish(cfg, args))(),
  );

  server.registerTool(
    "post_instagram",
    {
      title: "Post to Instagram",
      description:
        "Publishes an image, reel, carousel (2-10 items) or story to the Instagram professional account linked to the Facebook Page. " +
        "Media must be public URLs unless an S3/R2 bucket is configured for local files.",
      inputSchema: {
        caption: z.string().optional(),
        media,
        type: z.enum(["image", "reel", "carousel", "story"]).optional().describe("Inferred from media when omitted"),
        cover_url: z.string().optional().describe("Reel cover image URL"),
        share_to_feed: z.boolean().optional(),
        wait_seconds: z.number().int().min(0).max(900).optional().describe("How long to wait for video processing (default 300)"),
        dry_run: dryRun,
      },
      annotations: publishing,
    },
    (args) => run((cfg) => instagram.publish(cfg, args))(),
  );

  server.registerTool(
    "upload_youtube",
    {
      title: "Upload to YouTube",
      description: "Uploads a local video file to the connected YouTube channel. Default privacy is private.",
      inputSchema: { file: z.string().describe("Local video path"), ...youtubeFields, dry_run: dryRun },
      annotations: publishing,
    },
    (args) => run((cfg) => youtube.upload(cfg, args))(),
  );

  server.registerTool(
    "publish",
    {
      title: "Publish to several platforms",
      description:
        "Posts the same content to several platforms in one call, with optional per-platform overrides. " +
        "Each platform is attempted independently; the result lists successes and failures separately.",
      inputSchema: {
        platforms: z.array(z.enum(["x", "facebook", "instagram", "youtube"])).min(1),
        text: z.string().optional().describe("Default text/caption for every platform"),
        media: media.optional().describe("Default media for every platform (YouTube needs one local video)"),
        x: z
          .object({ text: z.string().optional(), thread: z.array(z.string()).optional(), media: media.optional(), via: z.enum(["api", "buffer"]).optional() })
          .optional(),
        facebook: z.object({ message: z.string().optional(), link: z.string().optional(), media: media.optional(), schedule_at: z.string().optional() }).optional(),
        instagram: z
          .object({ caption: z.string().optional(), media: media.optional(), type: z.enum(["image", "reel", "carousel", "story"]).optional() })
          .optional(),
        youtube: z.object({ file: z.string().optional(), ...youtubeFields, description: z.string().optional() }).partial().optional(),
        dry_run: dryRun,
      },
      annotations: publishing,
    },
    (args) =>
      run(async (cfg) => {
        const jobs: Record<PlatformName, () => Promise<PublishResult>> = {
          x: () => x.publish(cfg, {
              text: args.x?.text ?? args.text ?? "",
              thread: args.x?.thread,
              media: args.x?.media ?? args.media,
              via: args.x?.via,
              dry_run: args.dry_run,
            }),
          facebook: () =>
            facebook.publish(cfg, {
              message: args.facebook?.message ?? args.text,
              link: args.facebook?.link,
              media: args.facebook?.media ?? args.media,
              schedule_at: args.facebook?.schedule_at,
              dry_run: args.dry_run,
            }),
          instagram: () =>
            instagram.publish(cfg, {
              caption: args.instagram?.caption ?? args.text,
              media: args.instagram?.media ?? args.media ?? [],
              type: args.instagram?.type,
              dry_run: args.dry_run,
            }),
          youtube: () => {
            const file = args.youtube?.file ?? args.media?.find((m) => /\.(mp4|mov|m4v|webm)$/i.test(m));
            if (!file) throw new Error("YouTube needs a video: set youtube.file or include a local video in media");
            if (!args.youtube?.title) throw new Error("YouTube needs youtube.title");
            return youtube.upload(cfg, { ...args.youtube, file, title: args.youtube.title, description: args.youtube.description ?? args.text, dry_run: args.dry_run });
          },
        };
        const platforms = [...new Set(args.platforms)];
        const settled = await Promise.allSettled(platforms.map((p) => jobs[p]()));
        return {
          results: settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : [])),
          errors: settled.flatMap((s, i) => (s.status === "rejected" ? [{ platform: platforms[i], error: (s.reason as Error).message }] : [])),
        };
      })(),
  );

  server.registerTool(
    "get_post_status",
    {
      title: "Check processing status",
      description:
        "Checks a YouTube video's processing/privacy state, or an Instagram media container that was still processing. " +
        "For Instagram, set publish_if_ready to publish it once processing has finished.",
      inputSchema: {
        platform: z.enum(["instagram", "youtube"]),
        id: z.string().describe("YouTube video id, or Instagram container id returned with status=processing"),
        publish_if_ready: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    (args) =>
      run((cfg) => (args.platform === "youtube" ? youtube.videoStatus(cfg, args.id) : instagram.containerStatus(cfg, args.id, !!args.publish_if_ready)))(),
  );

  return server;
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "auth") return runAuth(arg);
  if (cmd === "accounts") {
    const cfg = loadConfig();
    console.log(JSON.stringify(await Promise.all([x.status(cfg), facebook.status(cfg), instagram.status(cfg), youtube.status(cfg)]), null, 2));
    return;
  }
  if (cmd === "--version") return console.log(VERSION);
  if (cmd && cmd !== "serve") {
    console.error("Usage: social-publish-mcp [serve | auth <x|meta|youtube> | accounts]");
    process.exit(1);
  }
  await createServer().connect(new StdioServerTransport());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
