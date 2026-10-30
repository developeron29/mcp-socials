import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface XConfig {
  clientId: string;
  /** Only for "confidential" X apps. Public (native) apps use PKCE alone. */
  clientSecret?: string;
}

export interface MetaConfig {
  appId: string;
  appSecret: string;
  /** Pick one Page when the account manages several. Defaults to the first. */
  pageId?: string;
  graphVersion?: string;
  /**
   * Facebook Login for Business configuration ID. Business-type apps grant
   * permissions from this configuration; `scope` is used only when it's absent.
   */
  loginConfigId?: string;
  /**
   * HTTPS page that relays the OAuth response to the localhost listener.
   * Needed because Meta rejects http:// redirect URIs; see site/public/oauth/callback.html.
   */
  redirectUri?: string;
}

/** Instagram API with Instagram Login (no Facebook Page link needed). */
export interface InstagramConfig {
  /** "Instagram app ID" from the app's Instagram API use case, not the Meta App ID. */
  appId: string;
  appSecret: string;
  redirectUri?: string;
}

export interface YouTubeConfig {
  clientId: string;
  clientSecret: string;
}

export interface S3MediaConfig {
  bucket: string;
  region?: string;
  /** e.g. https://<account>.r2.cloudflarestorage.com for Cloudflare R2 */
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Public base URL that serves the bucket, e.g. https://media.example.com */
  publicBaseUrl: string;
  /** Delete uploaded files after a successful publish. Default true. */
  deleteAfterPublish?: boolean;
}

export interface BufferConfig {
  /** From https://publish.buffer.com/settings/api */
  apiKey: string;
  apiUrl?: string;
  organizationId?: string;
  /** Pin a specific Buffer X channel. Defaults to the first twitter channel found. */
  xChannelId?: string;
}

/**
 * How X posts are sent. "auto" uses the X API when it's authorized, otherwise Buffer.
 */
export type XRoute = "auto" | "api" | "buffer";

export interface Config {
  x?: XConfig;
  xRoute?: XRoute;
  buffer?: BufferConfig;
  meta?: MetaConfig;
  instagram?: InstagramConfig;
  youtube?: YouTubeConfig;
  media?: { s3?: S3MediaConfig };
  /** Port for the local OAuth callback. Default 8787. */
  redirectPort?: number;
}

export const CONFIG_DIR = process.env.SOCIAL_MCP_HOME ?? join(homedir(), ".config", "social-publish-mcp");
export const CONFIG_PATH = join(CONFIG_DIR, "config.json");
export const TOKENS_PATH = join(CONFIG_DIR, "tokens.json");

export function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
}

const env = (name: string): string | undefined => process.env[name] || undefined;

/** config.json first, then environment variables override individual fields. */
export function loadConfig(): Config {
  let file: Config = {};
  if (existsSync(CONFIG_PATH)) {
    file = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Config;
  }

  const cfg: Config = { ...file };

  const xId = env("X_CLIENT_ID") ?? file.x?.clientId;
  if (xId) cfg.x = { clientId: xId, clientSecret: env("X_CLIENT_SECRET") ?? file.x?.clientSecret };

  const bufferKey = env("BUFFER_API_KEY") ?? file.buffer?.apiKey;
  if (bufferKey) {
    cfg.buffer = {
      apiKey: bufferKey,
      apiUrl: env("BUFFER_API_URL") ?? file.buffer?.apiUrl,
      organizationId: env("BUFFER_ORGANIZATION_ID") ?? file.buffer?.organizationId,
      xChannelId: env("BUFFER_X_CHANNEL_ID") ?? file.buffer?.xChannelId,
    };
  }
  const route = env("X_ROUTE") ?? file.xRoute;
  if (route) cfg.xRoute = route as XRoute;

  const metaId = env("META_APP_ID") ?? file.meta?.appId;
  const metaSecret = env("META_APP_SECRET") ?? file.meta?.appSecret;
  if (metaId && metaSecret) {
    cfg.meta = {
      appId: metaId,
      appSecret: metaSecret,
      pageId: env("META_PAGE_ID") ?? file.meta?.pageId,
      graphVersion: env("META_GRAPH_VERSION") ?? file.meta?.graphVersion,
      loginConfigId: env("META_LOGIN_CONFIG_ID") ?? file.meta?.loginConfigId,
      redirectUri: env("META_REDIRECT_URI") ?? file.meta?.redirectUri,
    };
  }

  const igId = env("INSTAGRAM_APP_ID") ?? file.instagram?.appId;
  const igSecret = env("INSTAGRAM_APP_SECRET") ?? file.instagram?.appSecret;
  if (igId && igSecret) {
    cfg.instagram = { appId: igId, appSecret: igSecret, redirectUri: env("INSTAGRAM_REDIRECT_URI") ?? file.instagram?.redirectUri };
  }

  const ytId = env("YOUTUBE_CLIENT_ID") ?? file.youtube?.clientId;
  const ytSecret = env("YOUTUBE_CLIENT_SECRET") ?? file.youtube?.clientSecret;
  if (ytId && ytSecret) cfg.youtube = { clientId: ytId, clientSecret: ytSecret };

  const bucket = env("S3_BUCKET") ?? file.media?.s3?.bucket;
  if (bucket) {
    const s3 = file.media?.s3;
    const accessKeyId = env("S3_ACCESS_KEY_ID") ?? s3?.accessKeyId;
    const secretAccessKey = env("S3_SECRET_ACCESS_KEY") ?? s3?.secretAccessKey;
    const publicBaseUrl = env("S3_PUBLIC_BASE_URL") ?? s3?.publicBaseUrl;
    if (accessKeyId && secretAccessKey && publicBaseUrl) {
      cfg.media = {
        s3: {
          bucket,
          region: env("S3_REGION") ?? s3?.region,
          endpoint: env("S3_ENDPOINT") ?? s3?.endpoint,
          accessKeyId,
          secretAccessKey,
          publicBaseUrl,
          deleteAfterPublish: s3?.deleteAfterPublish,
        },
      };
    }
  }

  const port = env("SOCIAL_MCP_REDIRECT_PORT");
  if (port) cfg.redirectPort = Number(port);

  return cfg;
}

export function redirectUri(cfg: Config): string {
  return `http://localhost:${cfg.redirectPort ?? 8787}/callback`;
}
