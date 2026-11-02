const XHS_ORIGIN = "https://www.xiaohongshu.com";
const USER_ID = /^[a-f\d]{24}$/i;
const MAX_FOLLOWERS = Number.MAX_SAFE_INTEGER;

const text = (value, maximum = 500) => typeof value === "string" || typeof value === "number"
  ? String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, maximum) : "";

function validUserId(value) {
  return typeof value === "string" && USER_ID.test(value);
}

function publicProfileUrl(userId, rawUrl = "", token = "", source = "") {
  if (!validUserId(userId)) return "";
  const url = new URL(`/user/profile/${userId.toLowerCase()}`, XHS_ORIGIN);
  if (rawUrl && profileId(rawUrl) === userId.toLowerCase()) {
    const original = new URL(rawUrl);
    if (original.searchParams.getAll("xsec_token").length === 1) token ||= original.searchParams.get("xsec_token") || "";
    if (original.searchParams.getAll("xsec_source").length === 1) source ||= original.searchParams.get("xsec_source") || "";
  }
  if (typeof token === "string" && token && token.length <= 2048 && !/[\u0000-\u0020\u007f]/.test(token)) {
    url.searchParams.set("xsec_token", token);
    url.searchParams.set("xsec_source", typeof source === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(source) ? source : "pc_search");
  }
  return url.href;
}

function profileId(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || !["xiaohongshu.com", "www.xiaohongshu.com"].includes(url.hostname)
      || url.username || url.password || url.port || url.hash) return "";
    return url.pathname.match(/^\/user\/profile\/([a-f\d]{24})\/?$/i)?.[1].toLowerCase() || "";
  } catch { return ""; }
}

function validateCreator(value) {
  const userId = text(value?.userId || value?.user_id || value?.id, 100).toLowerCase();
  if (!validUserId(userId) || profileId(value?.profileUrl) !== userId) throw new Error("达人主页链接无法验证，请重新搜索后打开");
  return { userId, profileUrl: publicProfileUrl(userId, value.profileUrl), nickname: text(value?.nickname, 100) || "小红书用户" };
}

function avatarUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return "";
    if (!["xhscdn.com", "xhscdn.net", "xiaohongshu.com"].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) return "";
    return url.href;
  } catch { return ""; }
}

function parseFollowers(value) {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value !== "string") return null;
  const input = value.trim().toLowerCase().replace(/[,，\s]/g, "")
    .replace(/^粉丝(?:数|量)?[:：]?/, "").replace(/(?:位|个|人)?粉丝$/, "").replace(/人$/, "");
  const match = input.match(/^(?:约|近)?(\d+(?:\.\d+)?)(千|万|亿|k|w|m)?\+?$/);
  if (!match) return null;
  const scale = { 千: 1000, 万: 10000, 亿: 100000000, k: 1000, w: 10000, m: 1000000 };
  const count = Math.round(Number(match[1]) * (scale[match[2]] || 1));
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

function validateSearch(input = {}) {
  const keyword = typeof input.keyword === "string" ? input.keyword.trim().normalize("NFC") : "";
  if (!keyword || Array.from(keyword).length > 80 || /[\u0000-\u001f\u007f]/.test(keyword)) throw new Error("请输入 1 至 80 字的行业或领域关键词");
  const bound = (value, label) => {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value !== "number" && typeof value !== "string" || typeof value === "string" && !/^\d+$/.test(value.trim())) {
      throw new Error(`${label}须为非负整数`);
    }
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0 || number > MAX_FOLLOWERS) throw new Error(`${label}须为非负整数`);
    return number;
  };
  const minFollowers = bound(input.minFollowers, "粉丝数下限");
  const maxFollowers = bound(input.maxFollowers, "粉丝数上限");
  if (minFollowers !== null && maxFollowers !== null && minFollowers > maxFollowers) throw new Error("粉丝数下限不能大于上限");
  if (input.limit !== undefined && typeof input.limit !== "number" && typeof input.limit !== "string") throw new Error("展示人数须为 1 至 100 人");
  const limit = input.limit === undefined ? 30 : Number(input.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("展示人数须为 1 至 100 人");
  return { keyword, minFollowers, maxFollowers, limit };
}

function searchUrl(keyword) {
  const url = new URL("/search_result/", XHS_ORIGIN);
  url.searchParams.set("keyword", keyword);
  url.searchParams.set("type", "51");
  return url.href;
}

function isCreatorSearchPage(rawUrl, keyword) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:" && ["xiaohongshu.com", "www.xiaohongshu.com"].includes(url.hostname)
      && !url.username && !url.password && !url.port && /^\/search_result\/?$/.test(url.pathname)
      && url.searchParams.getAll("keyword").length === 1 && url.searchParams.get("keyword")?.normalize("NFC") === keyword
      && url.searchParams.getAll("type").length === 1 && url.searchParams.get("type") === "51";
  } catch { return false; }
}

function requestKeyword(request) {
  const values = [];
  const add = (object) => {
    for (const key of ["keyword", "search_word", "searchWord"]) {
      const rows = object instanceof URLSearchParams ? object.getAll(key) : Object.hasOwn(object || {}, key) ? [object[key]] : [];
      for (const value of rows) {
        if (typeof value !== "string" || !value.trim()) return false;
        values.push(value.trim().normalize("NFC"));
      }
    }
    return true;
  };
  const url = new URL(request.url);
  if (!add(url.searchParams)) return "";
  if (request.postData) {
    if (typeof request.postData !== "string" || request.postData.length > 65536) return "";
    let body;
    try { body = JSON.parse(request.postData); } catch {
      if (!request.postData.includes("=")) return "";
      body = new URLSearchParams(request.postData);
    }
    if (!body || typeof body !== "object" || Array.isArray(body) || !add(body)) return "";
  } else if (request.hasPostData) return "";
  return values.length && values.every((value) => value === values[0]) ? values[0] : "";
}

function isCreatorSearchRequest(request, keyword) {
  try {
    const url = new URL(request?.url);
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && (url.hostname === "xiaohongshu.com" || url.hostname.endsWith(".xiaohongshu.com"))
      && /^\/api\/sns\/web\/v\d+\/search\/(?:usersearch|users|user)\/?$/.test(url.pathname)
      && ["GET", "POST"].includes(String(request.method || "GET").toUpperCase())
      && requestKeyword(request) === keyword;
  } catch { return false; }
}

function normalizeCreator(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  if (row.model_type && !/user|author|creator/i.test(row.model_type)) return null;
  const user = row.user_info || row.userInfo || row.user || row;
  if (!user || typeof user !== "object" || Array.isArray(user)) return null;
  const userId = text(user.user_id || user.userId || user.id || row.user_id || row.userId, 100).toLowerCase();
  if (!validUserId(userId)) return null;
  const rawProfile = user.profile_url || user.profileUrl || row.profile_url || row.profileUrl;
  if (rawProfile && profileId(rawProfile) !== userId) return null;
  const rawFollowers = row.followers ?? row.fans ?? row.fans_count ?? row.fansCount ?? row.follower_count
    ?? row.followerCount ?? user.followers ?? user.fans ?? user.fans_count ?? user.fansCount
    ?? user.follower_count ?? user.followerCount ?? user.interaction_info?.fans ?? user.interactionInfo?.fans;
  const followers = parseFollowers(rawFollowers);
  const label = text(row.followerLabel || row.follower_label || rawFollowers, 40)
    .replace(/^粉丝(?:数|量)?\s*[:：]?\s*/, "").replace(/\s*(?:位|个|人)?粉丝$/, "").trim();
  const nickname = text(user.nickname || user.nick_name || user.nickName || user.name || row.nickname, 100);
  const verification = user.official_verify_type ?? user.officialVerifyType;
  return {
    userId, nickname: nickname || "小红书用户",
    profileUrl: publicProfileUrl(userId, rawProfile, user.xsec_token || user.xsecToken || row.xsec_token || row.xsecToken,
      user.xsec_source || user.xsecSource || row.xsec_source || row.xsecSource),
    avatarUrl: avatarUrl(user.avatar || user.avatar_url || user.avatarUrl || user.image || user.images || row.avatarUrl),
    followers, followerLabel: followers === null ? "" : parseFollowers(label) === followers ? label : String(followers),
    description: text(user.desc || user.description || user.bio || user.signature || row.description),
    redId: text(user.red_id || user.redId || user.redid || row.redId, 100),
    verified: user.verified === true || row.verified === true || Number.isFinite(Number(verification)) && Number(verification) > 0,
    location: text(user.location || user.ip_location || user.ipLocation || row.location, 100),
  };
}

function extractCreators(json) {
  const data = json?.data;
  if (!data || typeof data !== "object") return [];
  const rows = data.users || data.user_list || data.userList || data.items;
  if (!Array.isArray(rows)) return [];
  const result = new Map();
  for (const row of rows.slice(0, 1000)) {
    const creator = normalizeCreator(row);
    if (!creator) continue;
    const existing = result.get(creator.userId);
    result.set(creator.userId, mergeCreator(existing, creator));
  }
  return [...result.values()];
}

function mergeCreator(previous, incoming) {
  if (!previous) return incoming;
  const merged = { ...previous };
  for (const [key, value] of Object.entries(incoming)) {
    if (key === "profileUrl" && !new URL(value).searchParams.has("xsec_token")
      && new URL(previous.profileUrl).searchParams.has("xsec_token")) continue;
    if (value !== null && value !== "" && !(key === "nickname" && value === "小红书用户") && !(key === "verified" && value === false)) merged[key] = value;
  }
  return merged;
}

function matchesFollowers(creator, settings) {
  if (settings.minFollowers === null && settings.maxFollowers === null) return true;
  return creator.followers !== null && (settings.minFollowers === null || creator.followers >= settings.minFollowers)
    && (settings.maxFollowers === null || creator.followers <= settings.maxFollowers);
}

module.exports = {
  validUserId, publicProfileUrl, profileId, validateCreator, avatarUrl, parseFollowers, validateSearch,
  searchUrl, isCreatorSearchPage, isCreatorSearchRequest, normalizeCreator, extractCreators, mergeCreator, matchesFollowers,
};
