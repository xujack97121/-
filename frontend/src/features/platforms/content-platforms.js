export const platformOf = (value) => value?.platform === "douyin" ? "douyin" : "xhs";
export const platformLabel = (value) => platformOf(value) === "douyin" ? "抖音" : "小红书";
export const platformHome = (platform) => platform === "douyin" ? "https://www.douyin.com/" : "https://www.xiaohongshu.com/";

export function douyinVideoId(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.port
      || !["douyin.com", "www.douyin.com"].includes(url.hostname)) return "";
    const id = url.pathname.match(/^\/video\/(\d{17,20})\/?$/)?.[1];
    const modalId = url.searchParams.get("modal_id");
    if (id && modalId && id !== modalId) return "";
    return id || (/^\/(?:user\/[^/]+\/?)?$/.test(url.pathname) && /^\d{17,20}$/.test(modalId || "") ? modalId : "");
  } catch { return ""; }
}
