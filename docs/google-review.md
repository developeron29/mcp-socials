# Google verification and YouTube API audit: MCP Socials

Answers to copy into Google's two review forms, plus a script for the demo video both of them ask for.

| | |
|---|---|
| App name | MCP Socials |
| Google Cloud project | MCP Socials (`mcp-socials`), project number **190896258694** |
| Google account (owner) | developeron29@gmail.com |
| OAuth client | MCP Socials desktop (Desktop app) |
| Homepage | https://mcpsocials.stream/ |
| Privacy policy | https://mcpsocials.stream/privacy/ |
| Terms of service | https://mcpsocials.stream/terms/ |
| Operator | studioarjuna, Kanpur, India · imageapiai@gmail.com |
| Channel used | Whatif virality (connected 25 Oct 2026) |
| Scopes | `https://www.googleapis.com/auth/youtube.upload`, `https://www.googleapis.com/auth/youtube.readonly` |

## Status (25 Oct 2026)

- [x] Domain `mcpsocials.stream` verified in Search Console (DNS TXT record in Cloudflare; keep it)
- [x] Branding verified and published
- [x] Scope justification saved on Data Access (the "How will the scopes be used?" text below)
- [x] MCP server registered in Claude Code as `social`
- [x] Demo video recorded and uploaded as Unlisted: https://youtu.be/yiWsgtbZPaQ (linked on Data Access)
- [n/a] Google OAuth verification: Google's questionnaire says production apps for **personal use only** are not reviewed. This project only serves the operator's own channels (self-hosters make their own project), so it stays unverified; the only effect is the "unverified app" screen at sign-in.
- [ ] YouTube API audit form submitted (needs applicant legal name and postal address)

## Order of steps

1. **Verify the domain** (you): add the TXT record in Cloudflare, then click **Verify** in Search Console for `mcpsocials.stream`. Both reviews check that the homepage and privacy policy are on a domain you own.
2. **Record the demo video** (script below) and upload it to YouTube as **Unlisted**. Use the YouTube Studio website, because uploads through our API are forced private until the audit passes.
3. **Submit Google OAuth verification** at Google Cloud → Google Auth Platform → **Verification Center** → *Prepare for verification*. Answers are in section A.
4. **Submit the YouTube API Services audit** at https://support.google.com/youtube/contact/yt_api_form, picking *"I'd like to request an audit"* (or "quota extension + audit"). Answers are in section B.

The two reviews are separate and run in parallel. Google verification removes the "unverified app" warning; the YouTube audit is what lifts the private-only lock on uploads.

---

## A. Google OAuth verification (Verification Center)

**App homepage:** https://mcpsocials.stream/
**Privacy policy:** https://mcpsocials.stream/privacy/
**Terms of service:** https://mcpsocials.stream/terms/
**Authorized domain:** mcpsocials.stream

**Scope justification: `youtube.upload`**
> MCP Socials is a self-hosted publishing tool. The user writes or chooses a video, title and description, and asks the app to publish it to their own YouTube channel. The app calls `videos.insert` (resumable upload) to upload that file, and optionally `thumbnails.set` for the custom thumbnail the user supplied. It never uploads anything the user did not explicitly select and request. This scope is the narrowest one that allows uploading; we do not request `youtube` or `youtube.force-ssl`, because the app does not edit, delete or manage existing videos, playlists or comments.

**Scope justification: `youtube.readonly`**
> Used for two read-only calls: `channels.list?mine=true` to show the user which channel they connected (so they can confirm uploads go to the right channel), and `videos.list` with `part=status,processingDetails` for videos the app just uploaded, to report whether processing finished. No other channel data is read, stored or shared.

**How the data is used / stored (if asked)**
> The app runs on the user's own computer. OAuth tokens are stored only there, in a file readable by that user alone; there is no server that receives Google user data. The channel title is shown to the user and saved locally alongside the token. No data is transferred to third parties, used for advertising, or used to train AI models. Use of Google user data complies with the Google API Services User Data Policy, including the Limited Use requirements, as stated in our privacy policy.

**Demo video link:** the Unlisted YouTube URL of the recording (section C).

**Additional information for the reviewer**
> MCP Socials is a Model Context Protocol (MCP) server: a local tool that an AI assistant such as Claude calls when the user asks it to publish a post. The demo video shows the full OAuth consent flow with the app name and both scopes, the user asking the assistant to upload a video, and the resulting video in YouTube Studio. The project will be published as open-source software; each person who self-hosts it creates their own Google Cloud project.

---

## B. YouTube API Services audit / quota form

Form: https://support.google.com/youtube/contact/yt_api_form

**Organization / developer name:** studioarjuna
**Contact email:** imageapiai@gmail.com (or developeron29@gmail.com, which owns the project)
**Website:** https://mcpsocials.stream/
**Google Cloud project number(s):** 190896258694
**API client name:** MCP Socials
**Is the API client available to the public?** Not as a hosted service. It is a self-hosted tool, run by its operator for channels they own, and it will be published as open-source code.
**Login / credentials for the reviewer:** none needed. It is a local desktop tool with no web login; the demo video shows it in use.

**Describe how your API client uses YouTube API Services**
> MCP Socials lets a creator publish their own videos to their own YouTube channel from an AI assistant (Claude, through the Model Context Protocol). The creator signs in once with Google OAuth. When they ask the assistant to publish a specific video file, the tool uploads it with `videos.insert` using the title, description, tags, privacy setting, optional scheduled publish time (`status.publishAt`) and "made for kids" / altered-content declarations that the creator provided, and optionally sets a custom thumbnail with `thumbnails.set`. It reads `channels.list?mine=true` to confirm the connected channel and `videos.list` (status, processingDetails) to report upload processing status back to the creator. It does not read, store or display any other YouTube data, and it does not access other users' data.

**Which YouTube API Services features are used:** Data API v3: `videos.insert`, `thumbnails.set`, `channels.list` (mine), `videos.list` (status, processingDetails for the app's own uploads).

**Who are your users?** The operator (studioarjuna) publishing to channels they own and manage: currently the *Whatif virality* channel. Uploads always go to the authenticated user's own channel.

**Do you store YouTube data? For how long?**
> Only the OAuth token and the connected channel's title, stored locally on the operator's computer until the user removes them or revokes access. Video IDs returned from uploads are shown to the user and not retained by the app. No YouTube data is sent to any server we operate.

**How do users revoke access / delete data?**
> At https://myaccount.google.com/permissions, or by deleting the local `~/.config/social-publish-mcp` folder. This is described at https://mcpsocials.stream/privacy/.

**Why do you need the audit?**
> Videos uploaded through our API client are locked to private because the project hasn't been audited. We need to publish videos as public or scheduled-public on the creator's own channel.

**Quota:** the default 10,000 units/day is enough for now. One upload is about 1,600 units, and we expect at most about 3 uploads a day. Request an increase only if you plan to post more than about 5 videos a day.

**Compliance**
> MCP Socials follows the YouTube API Services Terms of Service and Developer Policies: it links to the YouTube Terms of Service and the Google Privacy Policy from its privacy policy, uploads only content the user explicitly selects, discloses altered or synthetic content when the user marks it, and does not scrape, cache or aggregate YouTube data.

**Attachments:** screenshots of (1) the Google consent screen showing "MCP Socials" and both scopes, (2) the assistant conversation where the upload is requested, (3) the uploaded video in YouTube Studio. You can take these from the demo video.

---

## C. Demo video script (about 2–3 minutes)

Record the whole screen with QuickTime (File → New Screen Recording) or Cmd+Shift+5. Keep the browser address bar visible during sign-in, because reviewers check the OAuth client ID and the scopes in the URL. Don't show the contents of `config.json` or any secrets.

1. **Intro (10 s):** open https://mcpsocials.stream/ and scroll to the privacy policy link.
2. **Revoke first** so consent shows fresh: open https://myaccount.google.com/permissions, remove *MCP Socials*.
3. **Consent flow (40 s):** in Terminal, run `cd ~/Desktop/mcp-social && node dist/index.js auth youtube`. In the browser, show:
   - the account picker, choosing the channel's account
   - the consent screen with app name **MCP Socials** and both permissions ("Manage your YouTube videos", "View your YouTube account")
   - the address bar containing `client_id=190896258694-…` and both scopes
   - clicking Continue, then the terminal printing `YouTube connected: Whatif virality`
4. **Use in the assistant (60 s):** in Claude (with the server added, see below), type:
   *"Upload ~/Videos/demo.mp4 to YouTube titled 'MCP Socials demo' with the description 'Uploaded from MCP Socials', privacy private."*
   Show Claude calling `upload_youtube` and returning the youtu.be link.
5. **Result (20 s):** open YouTube Studio → Content and show the new video with that title and description. Also show `get_post_status` reporting processing finished, if you like.
6. **Revoke (10 s, optional):** show the app listed at myaccount.google.com/permissions to demonstrate how users remove access.

To make the tools available in Claude Code before recording:
```bash
claude mcp add social -- node /Users/ayushn/Desktop/mcp-social/dist/index.js
```

Upload the recording to YouTube Studio as **Unlisted** and paste that link into both forms.
