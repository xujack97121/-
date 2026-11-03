export const CREATOR_FOLLOWER_PRESETS = [
  { id: "all", label: "不限", minFollowers: null, maxFollowers: null },
  { id: "under-1k", label: "1千以下", minFollowers: 0, maxFollowers: 999 },
  { id: "1k-10k", label: "1千至1万", minFollowers: 1000, maxFollowers: 9999 },
  { id: "10k-50k", label: "1万至5万", minFollowers: 10000, maxFollowers: 49999 },
  { id: "50k-100k", label: "5万至10万", minFollowers: 50000, maxFollowers: 99999 },
  { id: "100k-500k", label: "10万至50万", minFollowers: 100000, maxFollowers: 499999 },
  { id: "500k-plus", label: "50万以上", minFollowers: 500000, maxFollowers: null },
  { id: "custom", label: "自定义", minFollowers: null, maxFollowers: null },
];

export const EMPTY_CREATOR_SNAPSHOT = {
  accountId: "", runId: "", revision: 0, phase: "idle", active: false,
  keyword: "", creators: [], scanned: 0, message: "", stage: "",
  candidates: 0, checked: 0, rejected: 0, insufficient: 0, relevanceVersion: 2, needsRecheck: false,
};

export const DEFAULT_CREATOR_STATE = {
  keyword: "", preset: "all", minFollowers: "", maxFollowers: "", limit: 30,
  snapshot: EMPTY_CREATOR_SNAPSHOT,
};

const text = (value, maximum) => typeof value === "string"
  ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, maximum) : "";
const count = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const input = (value) => typeof value === "string" || typeof value === "number" ? String(value).slice(0, 20) : "";
const PHASES = new Set(["idle", "searching", "completed", "stopped", "paused", "error"]);
const USER_ID = /^[a-f\d]{24}$/i;
const cleanKeyword = (value) => typeof value === "string"
  ? value.normalize("NFKC").replace(/[\u200b-\u200d\ufeff]/g, "").trim().slice(0, 80) : "";
const strings = (values, maximum = 24) => [...new Set((Array.isArray(values) ? values : []).slice(0, maximum)
  .map((value) => text(value, 200).trim()).filter(Boolean))];

export function normalizeCreatorRelevance(raw, userId, keyword) {
  if (raw?.version !== 2 || raw.status !== "matched" || raw.matched !== true
    || raw.userId !== userId || !cleanKeyword(keyword) || cleanKeyword(raw.keyword) !== cleanKeyword(keyword)) return null;
  const totalNotes = count(raw.totalNotes);
  const matchedNotes = count(raw.matchedNotes);
  if (totalNotes === null || totalNotes < 2 || totalNotes > 8 || matchedNotes === null || matchedNotes < 2 || matchedNotes > totalNotes) return null;
  const evidence = (Array.isArray(raw.evidence) ? raw.evidence : []).slice(0, 20).flatMap((entry) => {
    if (!["profile", "tag", "note"].includes(entry?.kind)) return [];
    const excerpt = text(entry.text, 1200).trim();
    const terms = strings(entry.terms).filter((term) => excerpt.normalize("NFKC").toLowerCase().includes(term.normalize("NFKC").toLowerCase()));
    if (!excerpt || !terms.length || entry.kind === "note" && (typeof entry.noteId !== "string" || !USER_ID.test(entry.noteId))) return [];
    return [{ kind: entry.kind, text: excerpt, terms, ...(entry.kind === "note" ? { noteId: entry.noteId.toLowerCase() } : {}) }];
  }).sort((left, right) => ({ profile: 0, note: 1, tag: 2 })[left.kind] - ({ profile: 0, note: 1, tag: 2 })[right.kind]);
  if (new Set(evidence.filter((entry) => entry.kind === "note").map((entry) => entry.noteId)).size < 2) return null;
  return {
    version: 2, userId, keyword: cleanKeyword(keyword), status: "matched", matched: true,
    label: text(raw.label, 100).trim() || "领域匹配", reasons: strings(raw.reasons, 8),
    tags: strings(raw.tags, 20), matchedNotes, totalNotes,
    matchedTerms: strings(evidence.flatMap((entry) => entry.terms)), evidence,
  };
}

function publicAvatar(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return "";
    return ["xhscdn.com", "xhscdn.net", "xiaohongshu.com"].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
      ? url.href : "";
  } catch { return ""; }
}

function publicProfile(value, userId) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !["xiaohongshu.com", "www.xiaohongshu.com"].includes(url.hostname)
      || url.username || url.password || url.port || url.hash
      || url.pathname.replace(/\/$/, "").toLowerCase() !== `/user/profile/${userId}`) return "";
    const profile = new URL(`/user/profile/${userId}`, "https://www.xiaohongshu.com");
    for (const key of ["xsec_token", "xsec_source"]) {
      const parameter = url.searchParams.get(key);
      if (parameter && parameter.length <= 2000) profile.searchParams.set(key, parameter);
    }
    return profile.href;
  } catch { return ""; }
}

export function normalizeCreator(raw, keyword = raw?.relevance?.keyword) {
  const userId = text(raw?.userId, 100).toLowerCase();
  if (!USER_ID.test(userId)) return null;
  const profileUrl = publicProfile(raw?.profileUrl, userId);
  if (!profileUrl) return null;
  const followers = count(raw.followers);
  return {
    userId, profileUrl, nickname: text(raw.nickname, 100).trim() || "小红书用户",
    avatarUrl: publicAvatar(raw.avatarUrl), description: text(raw.description, 1000),
    redId: text(raw.redId, 100), location: text(raw.location, 100),
    followers, followerLabel: followers === null ? "" : text(raw.followerLabel, 40),
    likes: count(raw.likes), noteCount: count(raw.noteCount),
    relevance: normalizeCreatorRelevance(raw.relevance, userId, keyword),
  };
}

export function normalizeCreatorSnapshot(raw = {}) {
  if (!raw || typeof raw !== "object") raw = {};
  const creators = new Map();
  for (const row of (Array.isArray(raw.creators) ? raw.creators : []).slice(0, 100)) {
    const creator = normalizeCreator(row, raw.keyword);
    if (creator?.relevance) creators.set(creator.userId, creator);
  }
  const phase = PHASES.has(raw.phase) ? raw.phase : "idle";
  return {
    accountId: text(raw.accountId, 160), runId: text(raw.runId, 160),
    revision: count(raw.revision) ?? 0, phase, active: phase === "searching",
    keyword: text(raw.keyword, 160), creators: [...creators.values()],
    scanned: count(raw.scanned) ?? 0, message: text(raw.message, 1000),
    stage: ["collecting", "checking", "done"].includes(raw.stage) ? raw.stage : phase === "searching" ? "collecting" : "",
    candidates: count(raw.candidates) ?? count(raw.scanned) ?? 0, checked: count(raw.checked) ?? 0,
    rejected: count(raw.rejected) ?? 0, insufficient: count(raw.insufficient) ?? 0,
    relevanceVersion: 2, needsRecheck: raw.needsRecheck === true,
  };
}

export function normalizeCreatorState(raw = {}) {
  if (!raw || typeof raw !== "object") raw = {};
  return {
    keyword: text(raw.keyword, 160),
    preset: CREATOR_FOLLOWER_PRESETS.some((preset) => preset.id === raw.preset) ? raw.preset : "all",
    minFollowers: input(raw.minFollowers), maxFollowers: input(raw.maxFollowers),
    limit: raw.limit === undefined ? 30 : input(raw.limit),
    snapshot: normalizeCreatorSnapshot(raw.snapshot),
  };
}

export function restoreCreatorState(raw) {
  const state = normalizeCreatorState(raw);
  const saved = raw?.snapshot;
  const previousCreators = Array.isArray(saved?.creators) ? saved.creators : [];
  const legacy = saved && saved.relevanceVersion !== 2 && (saved.runId || previousCreators.length || saved.phase && saved.phase !== "idle");
  if (legacy || previousCreators.length > state.snapshot.creators.length) {
    state.snapshot = { ...EMPTY_CREATOR_SNAPSHOT, accountId: state.snapshot.accountId, keyword: state.snapshot.keyword,
      needsRecheck: true, message: "历史结果尚未通过领域核验，请重新查找" };
    return state;
  }
  if (state.snapshot.phase === "searching") {
    state.snapshot = { ...state.snapshot, phase: "stopped", active: false, message: "上次查找已中断，可重新查找" };
  }
  return state;
}

export function validateCreatorSearch(raw = {}) {
  const state = normalizeCreatorState(raw);
  const keyword = state.keyword.normalize("NFKC").replace(/[\u200b-\u200d\ufeff]/g, "").trim();
  if (!keyword || keyword.length > 80 || /[\u0000-\u001f\u007f]/.test(keyword)) {
    return { ok: false, field: "keyword", message: "请输入 1 至 80 字的行业或领域关键词" };
  }
  const preset = CREATOR_FOLLOWER_PRESETS.find((option) => option.id === state.preset);
  let { minFollowers, maxFollowers } = preset;
  if (preset.id === "custom") {
    for (const field of ["minFollowers", "maxFollowers"]) {
      const value = state[field].trim();
      if (value && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))) {
        return { ok: false, field, message: `${field === "minFollowers" ? "最低" : "最高"}粉丝量须为非负整数` };
      }
    }
    minFollowers = state.minFollowers.trim() === "" ? null : Number(state.minFollowers);
    maxFollowers = state.maxFollowers.trim() === "" ? null : Number(state.maxFollowers);
    if (minFollowers !== null && maxFollowers !== null && minFollowers > maxFollowers) {
      return { ok: false, field: "maxFollowers", message: "最高粉丝量不能小于最低粉丝量" };
    }
  }
  const limit = Number(state.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return { ok: false, field: "limit", message: "搜索达人数须为 1 至 100 人" };
  }
  return { ok: true, query: { keyword, minFollowers, maxFollowers, limit } };
}

export function mergeCreatorSnapshot(current, raw, { accountId, allowNewRun = false } = {}) {
  if (!raw || raw.accountId !== accountId) return current;
  const next = normalizeCreatorSnapshot(raw);
  if (current.needsRecheck && !next.runId && next.phase === "idle") return current;
  if (!next.runId && current.runId) {
    if (allowNewRun && next.phase === "idle" && current.phase === "searching") {
      return { ...current, phase: "stopped", active: false, message: "上次查找已中断，可重新查找" };
    }
    return current;
  }
  if (current.runId && next.runId !== current.runId && !allowNewRun) return current;
  if (next.runId === current.runId && next.revision < current.revision) return current;
  return next;
}

export function creatorCountLabel(value, publicLabel = "") {
  if (count(value) === null) return "未公开";
  if (publicLabel.trim()) return publicLabel.trim();
  return value.toLocaleString("zh-CN");
}
