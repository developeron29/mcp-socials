#!/usr/bin/env node
// Calls one MCP tool on this server, the same way an assistant such as Claude does.
// Usage: node scripts/call-tool.mjs <tool> '<json arguments>'
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";

const [tool, json = "{}"] = process.argv.slice(2);
if (!tool) {
  console.error("Usage: node scripts/call-tool.mjs <tool> '<json arguments>'");
  process.exit(1);
}

const server = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const client = new Client({ name: "call-tool", version: "0" });
await client.connect(new StdioClientTransport({ command: "node", args: [server] }));

const { tools } = await client.listTools();
console.log(`MCP server tools: ${tools.map((t) => t.name).join(", ")}\n`);
console.log(`→ ${tool} ${json}\n`);
const res = await client.callTool({ name: tool, arguments: JSON.parse(json) });
console.log(res.content.map((c) => c.text).join("\n"));
await client.close();
process.exit(res.isError ? 1 : 0);
