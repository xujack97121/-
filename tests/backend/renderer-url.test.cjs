const assert = require("node:assert/strict");
const { isAllowedRendererNavigation, resolveRendererDevUrl } = require("../../backend/platform/renderer-url.cjs");

assert.equal(resolveRendererDevUrl("http://127.0.0.1:5173"), "http://127.0.0.1:5173/");
assert.equal(resolveRendererDevUrl("http://localhost:5173/app"), "http://localhost:5173/app");
assert.equal(resolveRendererDevUrl("http://[::1]:5173"), "http://[::1]:5173/");
assert.equal(resolveRendererDevUrl("https://example.com/app"), "");
assert.equal(resolveRendererDevUrl("http://user:secret@localhost:5173"), "");
assert.equal(resolveRendererDevUrl("file:///tmp/index.html"), "");
assert.equal(resolveRendererDevUrl("http://127.0.0.1:5173", { isPackaged: true }), "");

const allowed = ["file:///D:/app/dist/index.html", "http://127.0.0.1:5173/"];
assert.equal(isAllowedRendererNavigation("file:///D:/app/dist/index.html#report", allowed), true);
assert.equal(isAllowedRendererNavigation("http://127.0.0.1:5173/#report", allowed), true);
assert.equal(isAllowedRendererNavigation("http://127.0.0.1:5173/other", allowed), false);
assert.equal(isAllowedRendererNavigation("https://example.com/", allowed), false);
assert.equal(isAllowedRendererNavigation("file:///D:/app/dist/other.html", allowed), false);

console.log("renderer development URL validation: passed");
