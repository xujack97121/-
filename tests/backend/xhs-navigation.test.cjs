const assert = require("node:assert/strict");
const { test } = require("node:test");
const { platformNavigationUrl, isPlatformPage, isXhsCapturePage, xhsResponseScope } = require("../../backend/platform/content-platforms.cjs");
const { normalizeCapture } = require("../../backend/capture/normalizer.cjs");
const NOTE = "65a200000000000000000001";
const OTHER = "65a200000000000000000002";
const ORIGIN = "https://www.xiaohongshu.com";

test("search navigation is canonical, idempotent and preserves keyword and navigation tokens", () => {
  for (const scheme of ["http", "https"]) {
    const value = platformNavigationUrl(`${scheme}://www.xiaohongshu.com/search_result?keyword=%E4%B9%99%E5%A5%B3&xsec_token=fixture%2Btoken`);
    const url = new URL(value);
    assert.equal(url.protocol, "https:");
    assert.equal(url.pathname, "/search_result/");
    assert.equal(url.searchParams.get("keyword"), "乙女");
    assert.equal(url.searchParams.get("xsec_token"), "fixture+token");
    assert.equal(platformNavigationUrl(value), value);
  }
  assert.equal(isPlatformPage("http://www.xiaohongshu.com/"), false, "The trusted-page policy must stay HTTPS-only");
  assert.equal(platformNavigationUrl(`http://www.douyin.com/video/7520000000000000001`, "douyin"), "https://www.douyin.com/video/7520000000000000001");
});

test("HTTPS upgrades cannot admit another platform, credentialed URL, unknown protocol or nonstandard port", () => {
  for (const value of [
    "https://www.douyin.com/", "http://www.douyin.com/", "http://xiaohongshu.com.evil.test/",
    "http://user:fixture@www.xiaohongshu.com/", "https://user@www.xiaohongshu.com/",
    "http://www.xiaohongshu.com:444/", "https://www.xiaohongshu.com:80/",
    "file:///xiaohongshu.com", "javascript:location.href='https://www.xiaohongshu.com/'", "not a URL",
  ]) assert.equal(platformNavigationUrl(value, "xhs"), "", value);
  assert.equal(platformNavigationUrl(ORIGIN, "unknown"), "");
  assert.equal(platformNavigationUrl("https://www.xiaohongshu.com:443/"), `${ORIGIN}/`);
});

test("XHS tasks stay on the requested keyword, author or note, never the recommendations or login page", () => {
  const task = { kind: "notes", targetUrl: `${ORIGIN}/search_result/?keyword=fixture` };
  assert.equal(isXhsCapturePage(`${ORIGIN}/search_result?keyword=fixture&source=web`, task), true);
  for (const value of [
    `${ORIGIN}/`, `${ORIGIN}/search_result/?keyword=another`, "https://login.xiaohongshu.com/search_result/?keyword=fixture",
    "http://www.xiaohongshu.com/search_result/?keyword=fixture",
  ]) assert.equal(isXhsCapturePage(value, task), false);
  const author = { kind: "author", targetUrl: `${ORIGIN}/user/profile/${NOTE}` };
  assert.equal(isXhsCapturePage(`${ORIGIN}/user/profile/${NOTE}/?source=web`, author), true);
  assert.equal(isXhsCapturePage(`${ORIGIN}/user/profile/${OTHER}`, author), false);
  const comments = { kind: "comments", targetUrl: `${ORIGIN}/explore/${NOTE}`, noteId: NOTE };
  assert.equal(isXhsCapturePage(`${ORIGIN}/discovery/item/${NOTE}/?xsec_token=fixture`, comments), true);
  assert.equal(isXhsCapturePage(`${ORIGIN}/explore/${OTHER}`, comments), false);
});

test("response scope excludes unrelated feeds, other notes and unknown parent comments", () => {
  const search = { kind: "notes", targetUrl: `${ORIGIN}/search_result/?keyword=fixture` };
  assert.equal(xhsResponseScope(`${ORIGIN}/api/sns/web/v1/search/notes`, search), "notes");
  assert.equal(xhsResponseScope(`${ORIGIN}/api/sns/web/v1/homefeed`, search), "");
  const author = { kind: "author", targetUrl: `${ORIGIN}/user/profile/${NOTE}` };
  assert.equal(xhsResponseScope(`${ORIGIN}/api/sns/web/v1/user_posted?user_id=${NOTE}`, author), "notes");
  assert.equal(xhsResponseScope(`${ORIGIN}/api/sns/web/v1/user_posted?user_id=${OTHER}`, author), "");
  const comments = { kind: "comments", noteId: NOTE };
  assert.equal(xhsResponseScope(`${ORIGIN}/api/sns/web/v2/comment/page?note_id=${NOTE}`, comments), "comments");
  assert.equal(xhsResponseScope(`${ORIGIN}/api/sns/web/v2/comment/page?note_id=${OTHER}`, comments), "");
  const reply = `${ORIGIN}/api/sns/web/v2/comment/sub/page?root_comment_id=fixture-parent`;
  assert.equal(xhsResponseScope(reply, comments), "");
  assert.equal(xhsResponseScope(reply, comments, new Set(["fixture-parent"])), "comments");
});

test("public note links from data responses are upgraded without losing navigation tokens", () => {
  const rawLink = `http://www.xiaohongshu.com/explore/${NOTE}?xsec_token=synthetic%2Btoken`;
  const data = (link) => ({ items: [{ id: NOTE, url: link, note_card: { display_title: "Public fixture", user: { nickname: "Fixture" } } }] });
  const source = `${ORIGIN}/api/sns/web/v1/search/notes`;
  const link = normalizeCapture(source, data(rawLink)).notes[0].link;
  assert.equal(link, rawLink.replace("http:", "https:"));
  for (const invalid of [
    `https://user:synthetic@www.xiaohongshu.com/explore/${NOTE}`,
    `http://www.xiaohongshu.com:444/explore/${NOTE}`,
    `https://www.xiaohongshu.com.evil.test/explore/${NOTE}`,
  ]) assert.equal(normalizeCapture(source, data(invalid)).notes[0].link, `${ORIGIN}/explore/${NOTE}`);
});
