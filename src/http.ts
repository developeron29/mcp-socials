export class ApiError extends Error {
  constructor(
    public platform: string,
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(`[${platform}] ${status}: ${message}`);
  }
}

/** Pulls a readable message out of the error shapes X, Meta and Google return. */
function extractMessage(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return typeof body === "string" ? body.slice(0, 500) : undefined;
  const b = body as Record<string, any>;
  if (b.error?.message) return b.error.message; // Meta, Google
  if (typeof b.error === "string") return b.error_description ? `${b.error}: ${b.error_description}` : b.error;
  if (b.detail) return b.detail; // X v2
  if (Array.isArray(b.errors) && b.errors[0]) return b.errors[0].message ?? b.errors[0].detail;
  if (b.title) return b.title;
  return undefined;
}

export async function request<T = any>(platform: string, url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    // non-JSON body; keep text
  }
  if (!res.ok) {
    throw new ApiError(platform, res.status, extractMessage(body) ?? res.statusText, body);
  }
  // Meta sometimes returns 200 with an error object.
  if (body && typeof body === "object" && (body as any).error && platform === "meta") {
    throw new ApiError(platform, res.status, extractMessage(body) ?? "unknown error", body);
  }
  return body as T;
}

export function form(params: Record<string, string | number | boolean | undefined>): URLSearchParams {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) out.set(k, String(v));
  return out;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
