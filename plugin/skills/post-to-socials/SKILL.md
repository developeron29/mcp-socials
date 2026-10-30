---
name: post-to-socials
description: Publish posts to the user's own Facebook Page, Instagram professional account, YouTube channel and X with the MCP Socials tools (post_facebook, post_instagram, upload_youtube, post_x, publish). Use whenever the user asks to post, publish, share, upload or schedule something on Facebook, Instagram, YouTube or X, or to cross-post one piece of content to several of them.
---

# Posting with MCP Socials

The `socials` MCP server publishes to accounts the user has already connected. Posts are public and can't be deleted through these tools, so follow this order every time.

## 1. Check the accounts

Call `list_accounts` first. Tell the user which account each platform will post as, for example "Facebook → Whatif Virality Page, Instagram → @whatif_virality".

If a platform isn't authorized, don't try to post there. Tell the user to run the sign-in in a terminal:

```
node "<plugin root>/server/index.mjs" auth youtube    # or: meta (Facebook), instagram, x
```

Credentials live in `~/.config/social-publish-mcp/config.json`, and tokens in `tokens.json` next to it. Never print or edit secrets from those files.

## 2. Get the media to a usable place

- **Facebook:** accepts local file paths or public https URLs.
- **Instagram:** needs a **public https URL** for every image or video. A local file only works if `media.s3` (e.g. a Cloudflare R2 bucket) is configured; `list_accounts` shows a hint when it isn't. If there's no URL and no bucket, ask the user where to host the file rather than guessing.
- **YouTube:** needs a **local video file**.
- **Formats:** images JPG or PNG; Instagram rejects GIFs. Reels and Shorts should be vertical. Instagram images work best at 1080×1350 or 1080×1080.

## 3. Dry-run, then confirm

1. Call each posting tool with `dry_run: true`. This validates captions, lengths and media types without posting. Fix any errors it returns.
2. Show the user exactly what will go live: the platform and account, the final caption or title, the media, and the privacy or schedule.
3. Get a clear yes before publishing. Treat a request like "post this" as approval of what the user wrote. Anything you wrote or changed yourself (captions, hashtags, titles) still needs their OK.

## 4. Publish

- `post_facebook`: message, optional link, `media` (several photos make one multi-photo post, or a single video), `schedule_at` (10 minutes to 30 days ahead).
- `post_instagram`: `caption` and `media`. `type` is inferred: one image → image, one video → reel, 2–10 items → carousel; `story` must be set explicitly. Video can take minutes to process. If the result is `processing`, call `get_post_status` with `platform: "instagram"`, the returned id and `publish_if_ready: true` later.
- `upload_youtube`: `file`, `title` (max 100 chars), `description`, `tags`, `privacy` (default private), `publish_at` (scheduling forces private until then), `shorts: true` adds #Shorts, `made_for_kids`, `contains_synthetic_media` (set true for realistic AI-generated video), optional `thumbnail`.
- `post_x`: text up to 280 characters (URLs count as 23), an optional `thread`, and up to 4 images or 1 video.
- `publish`: the same content to several platforms in one call, with per-platform overrides. Each platform succeeds or fails on its own; report both lists.

## 5. Report back

Give the user the link for every post that went live, plus anything that failed and why.

**YouTube visibility:** check the `privacy` returned in `details`. If the user asked for public or unlisted and the result says private, the Google Cloud project hasn't passed the YouTube API audit yet, so YouTube locks API uploads to private. Say so plainly. The user can make the video public by hand in YouTube Studio.

## Things not to do

- Don't post to accounts the user didn't ask for, and don't add hashtags, links or mentions they didn't approve.
- Don't retry a failed post blindly: a partial success plus a retry can double-post. Check what went live first.
- Don't claim a post is live without a URL or id from the tool result.
