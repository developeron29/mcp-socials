# MCP Socials

**Repo:** https://github.com/developeron29/mcp-socials · **Site:** https://mcpsocials.stream

A self-hosted [MCP](https://modelcontextprotocol.io) server that lets Claude (or any MCP client) publish to **X/Twitter, Facebook Pages, Instagram and YouTube** through each platform's official API, using **your own developer apps**.

There's no middleman and no per-post subscription. The only limits are each platform's own API quotas.

X can post either through the **X API** (your own developer app) or through **Buffer** (`shareNow`, so the post goes out immediately and doesn't use Buffer's scheduled-post allowance). By default (`xRoute: "auto"`), the X API is used once it's authorized and Buffer otherwise, so you can start with Buffer and add X API keys later without changing anything else.

## Tools

| Tool | What it does |
|---|---|
| `list_accounts` | Which platforms are configured/authorized and the account each one posts as |
| `post_x` | Post or thread, up to 4 images or 1 video/GIF; replies (X API route). `via: "api" \| "buffer"` forces a route |
| `post_facebook` | Text, link, single/multi-photo or video Page post; optional scheduling |
| `post_instagram` | Image, reel, carousel (2-10) or story |
| `upload_youtube` | Resumable video upload, tags, privacy, scheduled `publish_at`, Shorts, thumbnail, AI-content disclosure |
| `publish` | Same content to several platforms at once with per-platform overrides; one platform failing doesn't stop the others |
| `get_post_status` | YouTube processing state; finish publishing an Instagram video that was still processing |

Every posting tool accepts `dry_run: true`, which validates the post and shows what would be sent without posting.

## Install

### Claude Code plugin (recommended)

The `plugin/` folder is a Claude Code plugin with two parts:

- the MCP server bundled into one file (`plugin/server/index.mjs`, so no `npm install` is needed)
- a `post-to-socials` skill, which has Claude check accounts, dry-run and confirm with you before anything is posted

Install it from GitHub:

```bash
claude plugin marketplace add developeron29/mcp-socials
claude plugin install mcp-socials@mcp-socials
```

Or, inside Claude Code:

```
/plugin marketplace add developeron29/mcp-socials
/plugin install mcp-socials@mcp-socials
```

It installs at user level, so every Claude Code session gets the tools (`mcp__plugin_mcp-socials_socials__*`). Later versions arrive with `claude plugin update mcp-socials@mcp-socials`.

Then [configure](#configure) your apps and sign in once per platform. The sign-in commands run from a clone of this repo:

```bash
git clone https://github.com/developeron29/mcp-socials.git && cd mcp-socials
node plugin/server/index.mjs auth youtube   # or: meta, instagram, x
node plugin/server/index.mjs accounts       # check what's connected
```

Config and tokens live in `~/.config/social-publish-mcp/`, so the plugin and the CLI share them.

### Standalone MCP server

To run it without the plugin, for example in Claude Desktop or another MCP client:

```bash
git clone https://github.com/developeron29/mcp-socials.git && cd mcp-socials
npm install && npm run build
claude mcp add social -- node "$PWD/dist/index.js"
```

Claude Desktop (`claude_desktop_config.json`):

```json
{ "mcpServers": { "social": { "command": "node", "args": ["/absolute/path/to/mcp-socials/plugin/server/index.mjs"] } } }
```

## Configure

Copy `config.example.json` to `~/.config/social-publish-mcp/config.json` and fill in only the platforms you want. Environment variables (see `.env.example`) override the file.

Every developer app below needs this **redirect / callback URI**:

```
http://localhost:8787/callback
```

Then sign in once per platform. Tokens are saved to `~/.config/social-publish-mcp/tokens.json` (mode 600) and refreshed automatically.

```bash
node dist/index.js auth youtube
node dist/index.js auth meta      # Facebook Page + linked Instagram
node dist/index.js auth x
node dist/index.js accounts       # check everything is connected
```

### YouTube (Google Cloud)
1. In [Google Cloud Console](https://console.cloud.google.com/), create a project and enable **YouTube Data API v3**.
2. Set up the **OAuth consent screen** (External). Add yourself as a test user.
3. Create credentials of type **OAuth client ID → Desktop app**. Put the client ID/secret in `youtube`.

> **Important:** until your project passes Google's [YouTube API audit](https://support.google.com/youtube/contact/yt_api_form), every upload is forced to **private**. The default quota is 10,000 units/day, and one upload costs about 1,600, so roughly 6 uploads a day.

### Facebook Page + Instagram (Meta)
1. Your Instagram account must be a **Business or Creator** account linked to a **Facebook Page**.
2. At [developers.facebook.com](https://developers.facebook.com/), create an app (type *Business*). Add **Facebook Login for Business** and **Instagram Graph API**.
3. Meta only accepts HTTPS redirect URIs, so sign-in goes through a small relay page that forwards the response to the localhost listener (`site/public/oauth/callback.html`). Host it yourself or use `https://mcpsocials.stream/oauth/callback`. Add that URL under **Facebook Login for Business → Settings → Valid OAuth Redirect URIs**, click **Save Changes** at the bottom of the page, and set `meta.redirectUri` to the same URL.
   Create a login configuration (Facebook Login for Business → Configurations, *User access token*, with the Page and Instagram permissions) and put its ID in `meta.loginConfigId`.
4. Put the App ID/secret in `meta`. In Development mode the app works for accounts with a role on the app (you). App Review is only needed if other people will use *your* app.

`auth meta` stores a non-expiring Page token and finds the linked Instagram account.

**Instagram without a linked Page (Instagram Login).** If your Instagram account isn't linked to a Facebook Page, use Meta's *Instagram API with Instagram login* instead:
1. In the app's Instagram use case → **API setup with Instagram login**, copy the **Instagram app ID** and secret (these differ from the Meta App ID) into `instagram.appId` / `instagram.appSecret`.
2. Under **Set up Instagram business login**, set the redirect URL to the same HTTPS relay (`https://mcpsocials.stream/oauth/callback`).
3. Add `instagram_business_basic` and `instagram_business_content_publish` under Permissions and features.
4. Until the app has advanced access, add your Instagram account under **App roles → Roles → Instagram Testers** and accept the invite in Instagram (Settings → Website permissions → Apps and websites → Tester invites).
5. Run `node dist/index.js auth instagram`. Tokens last 60 days and refresh automatically when used.

When both are set up, Instagram Login is used. If you manage several Pages, set `meta.pageId`.

**Instagram needs media at a public URL.** Either pass `https://` URLs, or configure `media.s3` with any S3-compatible bucket that has public read access. Cloudflare R2's free tier works well. Local files are then uploaded, published and deleted automatically.

### X / Twitter via Buffer (default route for now)
1. Connect your X account in [Buffer](https://publish.buffer.com/). On the free plan this takes one of your channel slots, so remove a channel you now post to directly if they're all used.
2. Create an API key at [publish.buffer.com/settings/api](https://publish.buffer.com/settings/api) and put it in `buffer.apiKey`.
3. If you have several X channels in Buffer, set `buffer.xChannelId`.

Buffer fetches media from public URLs, so local images/videos need `media.s3` configured (same as Instagram). Replies (`reply_to`) need the X API route.

### X / Twitter via the X API (optional, for later)
1. At [developer.x.com](https://developer.x.com/), create a Project + App.
2. Under **User authentication settings**, enable OAuth 2.0 with type *Native App* (public client, no secret needed) or *Web App* (confidential; also set `clientSecret`). Set permissions to **Read and write**, and the callback to `http://localhost:8787/callback`.
3. Put the OAuth 2.0 **Client ID** in `x.clientId` and run `node dist/index.js auth x`. With `xRoute: "auto"`, X posts switch to the API from then on. Set `xRoute: "buffer"` to keep using Buffer.

> Posting through the X API has a cost and limits that depend on your X API plan. Check X's current pricing.

## Example prompts

- "List my connected social accounts."
- "Dry-run a post to X, Facebook and Instagram with ~/Desktop/launch.jpg and the caption '…'."
- "Upload ~/Videos/short.mp4 to YouTube as a Short titled '…', scheduled for tomorrow 6pm IST."
- "Post this as an X thread: …"

## Development

```bash
npm run build          # compile src/ to dist/
npm run build:plugin   # rebuild the bundled plugin server (plugin/server/index.mjs) and commit it
npm test               # unit tests + an MCP client round-trip with dry runs
npm run inspect        # MCP Inspector UI
node scripts/call-tool.mjs list_accounts '{}'   # call any tool the way Claude does
```

To pick up a rebuilt plugin locally, run `claude plugin update mcp-socials@mcp-socials`.

Each platform is one file in `src/platforms/` exporting `status`, `validate` and `publish`. To add a platform (LinkedIn, Threads, TikTok, Bluesky…), add a file there and register a tool in `src/index.ts`.

## Security

- Secrets live only in `~/.config/social-publish-mcp/` (or env vars), never in the repo.
- The server runs locally over stdio. Nothing is exposed on the network except the temporary localhost listener during `auth`.
- Posting tools are marked non-read-only, so MCP clients ask for confirmation before each post.

## License

MIT
