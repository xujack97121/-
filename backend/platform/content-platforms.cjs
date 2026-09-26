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
    const url = new URL(rawUrl);
    const domain = platform === "douyin" ? "douyin.com" : "xiaohongshu.com";
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && (url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  } catch { return false; }
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

module.exports = { accountPlatform, platformHome, isPlatformPage, douyinVideoId, douyinVideoUrl, douyinResponseScope };
