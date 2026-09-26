const { douyinVideoId, douyinResponseScope } = require("../platform/content-platforms.cjs");

function publicId(value) {
  if (typeof value === "number" && !Number.isSafeInteger(value)) return "";
  return /^\d{1,30}$/.test(String(value || "")) ? String(value) : "";
}

function count(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function maskId(value) {
  const id = String(value || "");
  return id.length > 8 ? `${id.slice(0, 4)}••••${id.slice(-3)}` : "";
}

function timeOf(value) {
  const timestamp = Number(value);
  const date = Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp * 1000) : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function commentRow(raw, noteId, parentId = "") {
  const id = publicId(raw?.cid);
  if (!id || (raw.aweme_id && publicId(raw.aweme_id) !== noteId)) return null;
  const content = String(raw.text || "").trim();
  // Image-only comments are retained, without inventing a textual description.
  if (!content && !Array.isArray(raw.image_list)) return null;
  return {
    id, noteId, platform: "douyin", parentId,
    nickname: String(raw.user?.nickname || "").slice(0, 120),
    authorId: maskId(raw.user?.uid),
    content, time: timeOf(raw.create_time),
    region: String(raw.ip_label || "").replace(/^IP属地[:：]?\s*/, "").slice(0, 50),
    likes: count(raw.digg_count), replyCount: count(raw.reply_comment_total),
  };
}

function normalizeDouyinCapture(url, json, noteId, commentIds = new Set()) {
  const scope = douyinResponseScope(url, noteId, commentIds);
  const result = { notes: [], comments: [], platform: "douyin", blocked: "" };
  if (!scope || !json || typeof json !== "object") return result;
  if (Number(json.status_code || 0) !== 0) {
    result.blocked = "抖音未返回可用评论，请在左侧检查登录、验证或视频访问权限后重新采集";
    return result;
  }
  if (scope === "video") {
    const video = json.aweme_detail;
    if (publicId(video?.aweme_id) !== noteId) return result;
    result.notes.push({
      id: noteId, platform: "douyin", title: String(video.desc || `视频 ${noteId}`).slice(0, 1000),
      author: String(video.author?.nickname || "").slice(0, 120), authorId: maskId(video.author?.uid),
      link: `https://www.douyin.com/video/${noteId}`, type: "视频", source: "公开视频",
      likes: count(video.statistics?.digg_count),
      time: timeOf(video.create_time),
    });
    return result;
  }
  const rootParent = scope === "replies" ? new URL(url).searchParams.get("comment_id") || "" : "";
  const seen = new Set();
  const visit = (items, parentId = "", depth = 0) => {
    if (!Array.isArray(items) || depth > 3) return;
    for (const raw of items.slice(0, 2000)) {
      const row = commentRow(raw, noteId, parentId);
      if (!row) continue;
      if (!seen.has(row.id)) { seen.add(row.id); result.comments.push(row); }
      visit(raw.reply_comment, row.id, depth + 1);
    }
  };
  visit(json.comments, rootParent);
  return result;
}

// These scripts inspect rendered controls only. They never request, sign or replay platform APIs.
const DOUYIN_PAGE_STATE_SCRIPT = `(() => {
  const visible = el => !!el && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0
    && getComputedStyle(el).visibility !== 'hidden';
  const challenges = document.querySelectorAll('[id*="captcha"],[class*="captcha"],[id*="verify"],[class*="verify"]');
  if ([...challenges].some(el => visible(el) && /验证|滑块|安全|验证码/.test(el.textContent || '') || visible(el) && el.querySelector('iframe')))
    return { blocked: '请在左侧完成抖音安全验证，再重新采集' };
  if ([...document.querySelectorAll('[class*="login"],[id*="login"]')].some(el => visible(el)
    && /扫码登录|请输入手机号|登录后.*评论/.test(el.textContent || '')))
    return { blocked: '请在左侧登录抖音后重新采集' };
  const text = document.body?.innerText || '';
  if (/视频已删除|作品已删除|视频不存在|作品不存在|暂时无法观看|作者已设置.*私密|暂无权限/.test(text))
    return { blocked: '该视频当前不可访问，采集已停止' };
  const header = document.getElementById('douyin-header');
  const login = header && [...header.querySelectorAll('button')].some(el => visible(el) && el.textContent.trim() === '登录');
  const profile = header && [...header.querySelectorAll('a[href*="/user/self"]')].some(el => visible(el) && el.querySelector('img'));
  return { blocked: '', loginState: login ? 'logged-out' : profile ? 'logged-in' : 'unknown' };
})()`;

const DOUYIN_COMMENT_SCROLL_SCRIPT = `(() => {
  const visible = el => !!el && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0
    && getComputedStyle(el).visibility !== 'hidden';
  const panels = [...document.querySelectorAll('[data-e2e="comment-list"],[data-e2e="comment-container"],[data-e2e="comment-panel"]')].filter(visible);
  const panel = panels[0];
  if (!panel) return { waiting: true, atBottom: false };
  const expand = [...panel.querySelectorAll('button,[role="button"],[data-e2e]')]
    .find(el => visible(el) && /^展开\\s*\\d*\\s*(?:条)?回复|^展开更多回复$/.test((el.textContent || '').trim()));
  if (expand) { expand.click(); return { expanded: true, atBottom: false }; }
  const candidates = [panel, ...panel.querySelectorAll('*')].filter(el => visible(el)
    && el.scrollHeight > el.clientHeight + 20 && /auto|scroll/.test(getComputedStyle(el).overflowY));
  let ancestor = panel.parentElement;
  for (let level = 0; ancestor && level < 3; level++, ancestor = ancestor.parentElement) {
    if (ancestor !== document.body && ancestor !== document.documentElement && ancestor.scrollHeight > ancestor.clientHeight + 20
      && /auto|scroll/.test(getComputedStyle(ancestor).overflowY)) candidates.push(ancestor);
  }
  const scroller = candidates[0];
  if (!scroller) return { waiting: false, atBottom: true };
  const before = scroller.scrollTop;
  scroller.scrollBy({ top: Math.max(240, scroller.clientHeight * .7), behavior: 'auto' });
  return { moved: scroller.scrollTop > before, atBottom: scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 8 };
})()`;

function isDouyinCapturePage(url, noteId) {
  return douyinVideoId(url) === noteId;
}

module.exports = { normalizeDouyinCapture, isDouyinCapturePage, DOUYIN_PAGE_STATE_SCRIPT, DOUYIN_COMMENT_SCROLL_SCRIPT };
