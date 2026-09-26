const HOMES = { xhs: "https://www.xiaohongshu.com/", douyin: "https://www.douyin.com/" };

function accountPlatform(value = "xhs") {
  if (!Object.hasOwn(HOMES, value)) throw new Error("不支持的采集平台");
  return value;
}

function platformHome(platform) {
  return HOMES[accountPlatform(platform)];
}

function isPlatformPage(rawUrl, platform = "xhs") {
  try {
    accountPlatform(platform);
    const url = new URL(rawUrl);
    const domain = platform === "douyin" ? "douyin.com" : "xiaohongshu.com";
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && (url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  } catch { return false; }
}

function platformNavigationUrl(rawUrl, platform = "xhs") {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === "http:" && !url.port) url.protocol = "https:";
    if (!isPlatformPage(url.href, platform)) return "";
    // The bare search route can redirect to HTTP; prefer the canonical HTTPS route.
    if (platform === "xhs" && url.pathname === "/search_result") url.pathname += "/";
    return url.href;
  } catch { return ""; }
}

function isXhsCapturePage(rawUrl, task) {
  try {
    if (!isPlatformPage(rawUrl, "xhs") || !task?.targetUrl) return false;
    const current = new URL(rawUrl);
    const target = new URL(task.targetUrl);
    const sameHost = current.hostname === target.hostname
      || [current.hostname, target.hostname].every((host) => ["xiaohongshu.com", "www.xiaohongshu.com"].includes(host));
    if (!sameHost) return false;
    if (task.kind === "comments") {
      const id = current.pathname.match(/^\/(?:explore|discovery\/item)\/([a-f\d]{24})\/?$/i)?.[1];
      return Boolean(id && id === task.noteId);
    }
    const pathname = (url) => url.pathname.replace(/\/+$/, "") || "/";
    return pathname(current) === pathname(target)
      && (pathname(target) !== "/search_result" || current.searchParams.get("keyword") === target.searchParams.get("keyword"));
  } catch { return false; }
}

function xhsResponseScope(rawUrl, task, commentIds = new Set()) {
  try {
    if (!isPlatformPage(rawUrl, "xhs")) return "";
    const url = new URL(rawUrl);
    if (!url.pathname.startsWith("/api/")) return "";
    if (task.kind === "notes" && /\/search\/notes\/?$/.test(url.pathname)) return "notes";
    if (task.kind === "author" && /\/user_posted\/?$/.test(url.pathname)) {
      const expected = new URL(task.targetUrl).pathname.match(/\/user\/profile\/([^/]+)/)?.[1];
      const actual = url.searchParams.get("user_id");
      return !actual || actual === expected ? "notes" : "";
    }
    if (task.kind === "comments" && /\/comment\/(?:sub\/)?page\/?$/.test(url.pathname)) {
      const noteId = url.searchParams.get("note_id");
      const rootId = url.searchParams.get("root_comment_id");
      return (noteId === task.noteId || !noteId && rootId && commentIds.has(rootId)) ? "comments" : "";
    }
    return "";
  } catch { return ""; }
}

function douyinVideoId(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!isPlatformPage(rawUrl, "douyin") || !["douyin.com", "www.douyin.com"].includes(url.hostname)) return "";
    const pathId = url.pathname.match(/^\/video\/(\d{17,20})\/?$/)?.[1];
    const modalId = url.searchParams.get("modal_id");
    if (pathId && modalId && pathId !== modalId) return "";
    return pathId || (/^\/(?:user\/[^/]+\/?)?$/.test(url.pathname) && /^\d{17,20}$/.test(modalId || "") ? modalId : "");
  } catch { return ""; }
}

function douyinVideoUrl(rawUrl) {
  const id = douyinVideoId(rawUrl);
  return id ? `https://www.douyin.com/video/${id}` : "";
}

function douyinResponseScope(rawUrl, noteId, commentIds = new Set()) {
  try {
    const url = new URL(rawUrl);
    if (!isPlatformPage(rawUrl, "douyin") || url.hostname !== "www.douyin.com" || !/^\d{17,20}$/.test(noteId)) return "";
    const itemId = url.searchParams.get("aweme_id") || url.searchParams.get("item_id");
    if (itemId && itemId !== noteId) return "";
    if (url.pathname === "/aweme/v1/web/aweme/detail/" && itemId === noteId) return "video";
    if (url.pathname === "/aweme/v1/web/comment/list/" && itemId === noteId) return "comments";
    if (url.pathname === "/aweme/v1/web/comment/list/reply/"
      && (itemId === noteId || commentIds.has(url.searchParams.get("comment_id")))) return "replies";
    return "";
  } catch { return ""; }
}

module.exports = { accountPlatform, platformHome, isPlatformPage, platformNavigationUrl, isXhsCapturePage, xhsResponseScope, douyinVideoId, douyinVideoUrl, douyinResponseScope };
