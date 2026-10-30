import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("server lists tools and handles dry runs without credentials", async () => {
  const home = mkdtempSync(join(tmpdir(), "spm-"));
  const transport = new StdioClientTransport({ command: "node", args: ["dist/index.js"], env: { ...process.env, SOCIAL_MCP_HOME: home } });
  const client = new Client({ name: "test", version: "0" });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ["get_post_status", "list_accounts", "post_facebook", "post_instagram", "post_x", "publish", "upload_youtube"]);

    const accounts = JSON.parse((await client.callTool({ name: "list_accounts", arguments: {} })).content[0].text);
    assert.equal(accounts.accounts.length, 4);
    assert.ok(accounts.accounts.every((a) => a.configured === false));

    const res = await client.callTool({
      name: "publish",
      arguments: { platforms: ["x", "facebook", "instagram", "youtube"], text: "Hello from MCP", media: ["https://example.com/a.jpg"], x: { via: "buffer" }, youtube: { title: "t", file: "~/v.mp4" }, dry_run: true },
    });
    const out = JSON.parse(res.content[0].text);
    assert.equal(out.results.length, 4, JSON.stringify(out.errors));
    assert.ok(out.results.every((r) => r.status === "dry_run"));
    assert.equal(out.results.find((r) => r.platform === "x").details.route, "buffer");

    const noRoute = await client.callTool({ name: "post_x", arguments: { text: "hi", dry_run: true } });
    assert.equal(noRoute.isError, true);
    assert.match(noRoute.content[0].text, /no publishing route/);

    const bad = await client.callTool({ name: "post_x", arguments: { text: "a".repeat(300), via: "api", dry_run: true } });
    assert.equal(bad.isError, true);
  } finally {
    await client.close();
  }
});
