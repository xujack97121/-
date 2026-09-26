const XHS_WEB_ORIGIN = "https://www.xiaohongshu.com/";
const { platformNavigationUrl } = require("../platform/content-platforms.cjs");

const asText = (value) => value == null ? "" : String(value);

function parseMetric(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  const text = asText(value).trim().toLowerCase().replaceAll(",", "");
  const number = Number.parseFloat(text);
  if (!Number.isFinite(number)) return null;
  if (text.includes("万") || text.endsWith("w")) return Math.round(number * 10000);
  if (text.endsWith("k")) return Math.round(number * 1000);
  return Math.round(number);
}

function maskPublicId(value) {
  const text = asText(value);
  if (text.length <= 7) return text ? `${text.slice(0, 2)}•••` : "";
  return `${text.slice(0, 4)}••••${text.slice(-3)}`;
}

function commentMetric(value) {
  const metric = parseMetric(value);
  return metric !== null && metric >= 0 ? metric : null;
}

function formatTime(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return asText(value);
  const date = new Date(numeric < 1e12 ? numeric * 1000 : numeric);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function noteTimeFromId(value, now = Date.now()) {
  const id = asText(value).trim();
  if (!/^[a-f\d]{24}$/i.test(id)) return "";
  const timestamp = Number.parseInt(id.slice(0, 8), 16) * 1000;
  if (!Number.isFinite(timestamp) || timestamp < Date.UTC(2013, 0, 1) || timestamp > now + 5 * 60 * 1000) return "";
  return formatTime(timestamp);
}

function stableId(value) {
  let hash = 2166136261;
  for (const character of asText(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `dom-comment-${(hash >>> 0).toString(36)}`;
}

function walk(root, visit) {
  const seen = new WeakSet();
  const queue = [root];
  let inspected = 0;
  while (queue.length && inspected < 60000) {
    const node = queue.shift();
    if (!node || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);
    inspected += 1;
    visit(node);
    if (Array.isArray(node)) queue.push(...node);
    else queue.push(...Object.values(node));
  }
}

function noteSource(sourceUrl) {
  if (sourceUrl.includes("user_posted") || sourceUrl.includes("/user/")) return { label: "作者", xsec: "pc_user" };
  if (sourceUrl.includes("search")) return { label: "搜索", xsec: "pc_search" };
  return { label: "首页", xsec: "pc_feed" };
}

function noteLinkFromNode(node, card, sourceUrl, id) {
  const explicit = node.url || node.link || node.note_url || node.noteUrl || card.url || card.link || card.note_url || card.noteUrl;
  if (explicit) {
    try {
      const candidate = new URL(explicit, XHS_WEB_ORIGIN);
      const link = platformNavigationUrl(candidate.href, "xhs");
      if (link && candidate.pathname.includes(id)) return link;
    } catch { /* fall back to a canonical note URL */ }
  }

  const source = noteSource(sourceUrl);
  const token = asText(node.xsec_token || node.xsecToken || card.xsec_token || card.xsecToken).trim();
  const link = new URL(`explore/${id}`, XHS_WEB_ORIGIN);
  if (token) {
    link.searchParams.set("xsec_token", token);
    link.searchParams.set("xsec_source", asText(node.xsec_source || node.xsecSource || card.xsec_source || card.xsecSource).trim() || source.xsec);
    if (source.xsec === "pc_search") link.searchParams.set("source", "web_search_result_notes");
  }
  return link.href;
}

function noteFromNode(node, sourceUrl) {
  const card = node.note_card || node.noteCard || node.note || node;
  if (!card || typeof card !== "object") return null;
  const id = asText(card.note_id || card.noteId || (node.note_card || node.noteCard ? node.id : ""));
  const title = asText(card.display_title || card.displayTitle || card.title || card.desc).trim();
  const user = card.user || card.author || node.user || node.author;
  if (!id || !title || !user || typeof user !== "object") return null;
  const interaction = card.interact_info || card.interactInfo || card.interaction || {};
  const rawType = asText(card.type || node.model_type || node.modelType).toLowerCase();
  const source = noteSource(sourceUrl);
  return {
    id,
    author: asText(user.nickname || user.nick_name || user.name || user.red_id || "未知作者"),
    authorId: maskPublicId(user.user_id || user.userId || user.id || user.red_id),
    title,
    link: noteLinkFromNode(node, card, sourceUrl, id),
    likes: parseMetric(interaction.liked_count ?? interaction.likedCount ?? interaction.likes ?? card.liked_count),
    type: rawType.includes("video") ? "视频" : "笔记",
    time: formatTime(card.time || card.create_time || card.createTime || card.publish_time || card.publishTime
      || node.time || node.create_time || node.createTime || node.publish_time || node.publishTime) || noteTimeFromId(id),
    source: source.label,
  };
}

function commentFromNode(node, sourceUrl) {
  const content = asText(node.content || node.text).trim();
  const user = node.user || node.author;
  const explicitId = asText(node.comment_id || node.commentId);
  const hasCommentShape = Boolean(explicitId)
    || (sourceUrl.includes("comment") && node.id)
    || (node.id && content && (node.create_time || node.createTime || node.ip_location || node.ipLocation
      || Object.hasOwn(node, "sub_comment_count") || Object.hasOwn(node, "subCommentCount")));
  if (!hasCommentShape) return null;
  const id = explicitId || asText(node.id);
  if (!id || !content || !user || typeof user !== "object") return null;
  let noteId = asText(node.note_id || node.noteId);
  if (!noteId) {
    try { noteId = asText(new URL(sourceUrl).searchParams.get("note_id")); } catch { /* keep blank */ }
  }
  return {
    id,
    noteId,
    time: formatTime(node.create_time || node.createTime || node.time),
    likes: commentMetric(node.like_count ?? node.likeCount ?? node.liked_count ?? node.likedCount),
    replyCount: commentMetric(node.sub_comment_count ?? node.subCommentCount ?? node.reply_count ?? node.replyCount),
    nickname: asText(user.nickname || user.nick_name || user.name || "未知用户"),
    content,
    authorId: maskPublicId(user.user_id || user.userId || user.id || user.red_id),
    region: asText(node.ip_location || node.ipLocation || node.region).replace(/^IP属地[:：]?\s*/, ""),
  };
}

function normalizeDomComments(sourceUrl, rows) {
  let noteId = "";
  try { noteId = new URL(sourceUrl).pathname.match(/\/(?:explore|discovery\/item)\/([a-f\d]{24})/i)?.[1] || ""; } catch { /* keep blank */ }
  const comments = (Array.isArray(rows) ? rows : []).map((row) => {
    const content = asText(row?.content).trim();
    const nickname = asText(row?.nickname).trim();
    if (!content || !nickname) return null;
    const authorId = asText(row?.authorId).trim();
    const time = formatTime(row?.time);
    return {
      id: asText(row?.id).trim() || stableId([noteId, authorId, nickname, content, time].join("\u0000")),
      noteId,
      time,
      likes: commentMetric(row?.likes),
      replyCount: commentMetric(row?.replyCount),
      nickname,
      content,
      authorId: maskPublicId(authorId),
      region: asText(row?.region).replace(/^IP属地[:：]?\s*/, "").trim(),
    };
  }).filter(Boolean);
  return Array.from(new Map(comments.map((row) => [row.id, row])).values());
}

function normalizeCapture(sourceUrl, json) {
  const notes = [];
  const comments = [];
  walk(json, (node) => {
    const note = noteFromNode(node, sourceUrl);
    if (note) notes.push(note);
    const comment = commentFromNode(node, sourceUrl);
    if (comment) comments.push(comment);
  });
  return {
    notes: Array.from(new Map(notes.map((row) => [row.id, row])).values()),
    comments: Array.from(new Map(comments.map((row) => [row.id, row])).values()),
  };
}

module.exports = { normalizeCapture, normalizeDomComments, parseMetric, maskPublicId, formatTime, noteTimeFromId };
