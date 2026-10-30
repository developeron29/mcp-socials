import { test } from "node:test";
import assert from "node:assert/strict";
import * as x from "../dist/platforms/x.js";
import * as facebook from "../dist/platforms/facebook.js";
import * as instagram from "../dist/platforms/instagram.js";
import * as youtube from "../dist/platforms/youtube.js";

test("x: URLs count as 23 and long posts are rejected", () => {
  assert.equal(x.weightedLength("hi https://example.com/a/very/long/path/that/is/long"), 26);
  assert.deepEqual(x.validate({ text: "hello" }), []);
  assert.match(x.validate({ text: "a".repeat(281) })[0], /281\/280/);
  assert.match(x.validate({ text: "ok", media: ["a.mp4", "b.jpg"] }).join(), /only media item/);
});

test("facebook: link and media can't be combined", () => {
  assert.deepEqual(facebook.validate({ message: "hi" }), []);
  assert.ok(facebook.validate({ link: "https://a.com", media: ["a.jpg"] }).length);
  assert.ok(facebook.validate({}).length);
});

test("instagram: type inference and carousel bounds", () => {
  assert.equal(instagram.resolveType({ media: ["a.mp4"] }), "reel");
  assert.equal(instagram.resolveType({ media: ["a.jpg"] }), "image");
  assert.equal(instagram.resolveType({ media: ["a.jpg", "b.jpg"] }), "carousel");
  assert.ok(instagram.validate({ media: ["a.gif"] }).length);
  assert.ok(instagram.validate({ media: Array(11).fill("a.jpg") }).length);
});

test("youtube: shorts tag, scheduling forces private, title limits", () => {
  const m = youtube.buildMetadata({ file: "v.mp4", title: "Hello", shorts: true, publish_at: "2099-01-01T00:00:00Z" });
  assert.equal(m.snippet.title, "Hello #Shorts");
  assert.equal(m.status.privacyStatus, "private");
  assert.deepEqual(youtube.validate({ file: "v.mp4", title: "ok" }), []);
  assert.ok(youtube.validate({ file: "v.mp4", title: "x".repeat(101) }).length);
  assert.ok(youtube.validate({ file: "v.mp4", title: "a<b" }).length);
  assert.ok(youtube.validate({ file: "https://a.com/v.mp4", title: "ok" }).length);
});

test("x: route picks the X API when authorized, else Buffer", () => {
  const both = { x: { clientId: "c" }, buffer: { apiKey: "k" } };
  assert.equal(x.resolveRoute(both, undefined, true), "api");
  assert.equal(x.resolveRoute(both, undefined, false), "buffer");
  assert.equal(x.resolveRoute({ buffer: { apiKey: "k" } }, undefined, false), "buffer");
  assert.equal(x.resolveRoute({ ...both, xRoute: "buffer" }, undefined, true), "buffer");
  assert.equal(x.resolveRoute(both, "api", false), "api");
  assert.throws(() => x.resolveRoute({}, undefined, false), /no publishing route/);
  assert.ok(x.validate({ text: "hi", reply_to: "1" }, "buffer").length);
});
