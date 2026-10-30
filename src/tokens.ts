import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { TOKENS_PATH, ensureConfigDir } from "./config.js";

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms. Absent means the token does not expire (e.g. Meta Page tokens). */
  expiresAt?: number;
}

export interface MetaTokens {
  userToken: string;
  pageId: string;
  pageName: string;
  pageToken: string;
  igUserId?: string;
  igUsername?: string;
}

export interface InstagramLoginTokens extends OAuthTokens {
  userId: string;
  username?: string;
  /** Epoch ms the current token was issued; Instagram only refreshes tokens older than 24h. */
  issuedAt?: number;
}

export interface TokenStore {
  x?: OAuthTokens & { username?: string };
  youtube?: OAuthTokens & { channelTitle?: string };
  meta?: MetaTokens;
  instagram?: InstagramLoginTokens;
}

export function loadTokens(): TokenStore {
  if (!existsSync(TOKENS_PATH)) return {};
  return JSON.parse(readFileSync(TOKENS_PATH, "utf8")) as TokenStore;
}

export function saveTokens<K extends keyof TokenStore>(key: K, value: TokenStore[K]): void {
  ensureConfigDir();
  const store = loadTokens();
  store[key] = value;
  writeFileSync(TOKENS_PATH, JSON.stringify(store, null, 2), { mode: 0o600 });
  chmodSync(TOKENS_PATH, 0o600);
}

/** True when the token is missing an expiry or has more than a minute left. */
export function isFresh(t: OAuthTokens): boolean {
  return t.expiresAt === undefined || t.expiresAt - Date.now() > 60_000;
}

export function expiresAtFrom(expiresInSeconds?: number): number | undefined {
  return expiresInSeconds ? Date.now() + expiresInSeconds * 1000 : undefined;
}
