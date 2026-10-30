import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export const randomState = () => randomBytes(16).toString("hex");

export function openBrowser(url: string): void {
  // Set SOCIAL_MCP_NO_BROWSER=1 to only print the URL (headless machines, scripted demos).
  if (process.env.SOCIAL_MCP_NO_BROWSER) return;
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    // The URL is printed too, so the user can open it by hand.
  }
}

/**
 * Opens the consent page and waits for the provider to redirect back to
 * http://localhost:<port>/callback. Resolves with the authorization code.
 */
export function waitForCode(authorizeUrl: string, port: number, state: string, timeoutMs = 5 * 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      const finish = (msg: string, err?: Error) => {
        res.writeHead(err ? 400 : 200, { "content-type": "text/html" });
        res.end(`<html><body style="font-family:system-ui;padding:2rem"><h2>${msg}</h2>You can close this tab.</body></html>`);
        clearTimeout(timer);
        server.close();
        err ? reject(err) : resolve(code!);
      };
      if (error) return finish("Authorization failed", new Error(`${error}: ${url.searchParams.get("error_description") ?? ""}`));
      if (url.searchParams.get("state") !== state) return finish("State mismatch", new Error("OAuth state mismatch; try again."));
      if (!code) return finish("No code returned", new Error("No authorization code in callback."));
      finish("Signed in");
    });
    const timer = setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for the browser sign-in."));
    }, timeoutMs);
    server.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    server.listen(port, "localhost", () => {
      console.error(`\nOpen this URL to sign in (it should open automatically):\n\n  ${authorizeUrl}\n`);
      openBrowser(authorizeUrl);
    });
  });
}
