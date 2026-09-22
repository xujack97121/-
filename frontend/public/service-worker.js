const XHS_ORIGIN = "https://www.xiaohongshu.com/";
const MAX_NOTES = 5000;
const MAX_COMMENTS = 10000;

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

const asText = (value) => value == null ? "" : String(value);

function parseMetric(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  const text = asText(value).trim().toLowerCase().replaceAll(",", "");
  const number = Number.parseFloat(text);
  if (!Number.isFinite(number)) return 0;
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
  const text = asText(value).trim().toLowerCase().replaceAll(",", "");
  if (!/^\d+(?:\.\d+)?(?:万|w|k)?\+?$/.test(text)) return null;
  return parseMetric(text);
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

function walk(root, visit) {
  const seen = new WeakSet();
  const queue = [root];
  let inspected = 0;
  while (queue.length && inspected < 45000) {
    const node = queue.shift();
    if (!node || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node); inspected += 1; visit(node);
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
      const candidate = new URL(explicit, XHS_ORIGIN);
      if ((candidate.hostname === "xiaohongshu.com" || candidate.hostname.endsWith(".xiaohongshu.com")) && candidate.pathname.includes(id)) return candidate.href;
    } catch { /* fall back to a canonical note URL */ }
  }

  const source = noteSource(sourceUrl);
  const token = asText(node.xsec_token || node.xsecToken || card.xsec_token || card.xsecToken).trim();
  const link = new URL(`explore/${id}`, XHS_ORIGIN);
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
    likes: parseMetric(interaction.liked_count || interaction.likedCount || interaction.likes || card.liked_count),
    type: rawType.includes("video") ? "视频" : "笔记",
    time: formatTime(card.time || card.create_time || card.createTime || card.publish_time || card.publishTime
      || node.time || node.create_time || node.createTime || node.publish_time || node.publishTime) || noteTimeFromId(id),
    source: source.label,
  };
}

function commentFromNode(node, sourceUrl) {
  if (!sourceUrl.includes("comment")) return null;
  const content = asText(node.content || node.text).trim();
  const user = node.user || node.author;
  const id = asText(node.id || node.comment_id || node.commentId);
  if (!id || !content || !user || typeof user !== "object") return null;
  const noteId = asText(node.note_id || node.noteId || new URL(sourceUrl).searchParams.get("note_id"));
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

async function processCapture(url, json) {
  const foundNotes = [];
  const foundComments = [];
  walk(json, (node) => {
    const note = noteFromNode(node, url);
    if (note) foundNotes.push(note);
    const comment = commentFromNode(node, url);
    if (comment) foundComments.push(comment);
  });

  const stored = await chrome.storage.local.get(["collectorNotes", "collectorComments", "captureStats"]);
  const merge = (oldRows, newRows, max) => {
    const rows = new Map((oldRows || []).map((row) => [row.id, row]));
    for (const row of newRows) {
      const existing = rows.get(row.id);
      rows.set(row.id, { ...existing, ...row, likes: row.likes ?? existing?.likes ?? null, replyCount: row.replyCount ?? existing?.replyCount ?? null });
    }
    return [...rows.values()].slice(-max);
  };
  const mergeNotes = (oldRows, newRows, max) => {
    const rows = new Map((oldRows || []).map((note) => {
      const time = note.time || noteTimeFromId(note.id);
      return [note.id, time && time !== note.time ? { ...note, time } : note];
    }));
    for (const note of newRows) {
      const existing = rows.get(note.id);
      rows.set(note.id, existing ? { ...existing, ...note, time: note.time || existing.time || "" } : note);
    }
    return Array.from(rows.values()).slice(-max);
  };
  const nextNotes = mergeNotes(stored.collectorNotes, foundNotes, MAX_NOTES);
  const nextComments = merge(stored.collectorComments, foundComments, MAX_COMMENTS);
  const previousStats = stored.captureStats || {};
  await chrome.storage.local.set({
    collectorNotes: nextNotes,
    collectorComments: nextComments,
    captureStats: {
      captures: Number(previousStats.captures || 0) + 1,
      lastUrl: url,
      updatedAt: Date.now(),
      lastNotesAdded: Math.max(0, nextNotes.length - (stored.collectorNotes?.length || 0)),
      lastCommentsAdded: Math.max(0, nextComments.length - (stored.collectorComments?.length || 0)),
    },
  });
  return { notes: foundNotes.length, comments: foundComments.length };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "XHS_CAPTURE" || !sender.tab?.url?.startsWith(XHS_ORIGIN)) return false;
  let endpoint;
  try { endpoint = new URL(message.url); } catch { return false; }
  if (!["www.xiaohongshu.com", "edith.xiaohongshu.com"].includes(endpoint.hostname) || !endpoint.pathname.includes("/api/")) return false;
  processCapture(endpoint.href, message.json).then(sendResponse).catch((error) => sendResponse({ error: error.message }));
  return true;
});
