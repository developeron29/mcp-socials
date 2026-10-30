export type PlatformName = "x" | "facebook" | "instagram" | "youtube";

export interface PublishResult {
  platform: PlatformName;
  status: "published" | "scheduled" | "processing" | "dry_run";
  id?: string;
  url?: string;
  /** Anything else worth reporting back, e.g. the request a dry run would send. */
  details?: unknown;
}

export interface AccountStatus {
  platform: PlatformName;
  configured: boolean;
  authorized: boolean;
  account?: string;
  /** For X: whether posts go through the X API or Buffer. */
  route?: "api" | "buffer";
  error?: string;
  hint?: string;
}

/** Throws ValidationError with every problem found, so the caller can fix them in one go. */
export class ValidationError extends Error {
  constructor(
    public platform: PlatformName,
    public problems: string[],
  ) {
    super(`[${platform}] invalid post:\n- ${problems.join("\n- ")}`);
  }
}

export function assertValid(platform: PlatformName, problems: string[]): void {
  if (problems.length) throw new ValidationError(platform, problems);
}

export function parseSchedule(platform: PlatformName, iso: string | undefined, minMinutes: number, maxDays: number): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new ValidationError(platform, [`schedule_at "${iso}" is not a valid ISO 8601 date`]);
  const ahead = t - Date.now();
  if (ahead < minMinutes * 60_000 || ahead > maxDays * 86_400_000) {
    throw new ValidationError(platform, [`schedule_at must be between ${minMinutes} minutes and ${maxDays} days from now`]);
  }
  return Math.floor(t / 1000);
}
