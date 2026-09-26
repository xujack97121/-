const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, WebContentsView, ipcMain, net, safeStorage, screen, shell, session, dialog } = require("electron");
const { COMMENT_DOM_CAPTURE_SCRIPT, COMMENT_REPLY_EXPAND_SCRIPT } = require("./capture/comment-dom-capture.cjs");
const {
  discardPendingResponsesForRun,
  isActiveCaptureRun,
  normalizeCaptureTarget,
  selectUniqueRowsWithinTarget,
  selectCommentMetricUpdates,
} = require("./capture/capture-lifecycle.cjs");
const { normalizeCapture, normalizeDomComments } = require("./capture/normalizer.cjs");
const { AccountRegistry } = require("./accounts/account-registry.cjs");
const { resolveAppIconPath, setDockIconSafely } = require("./platform/app-icon.cjs");
const { AiService } = require("./ai/ai-service.cjs");
const { AppUpdates, requestReleaseRedirect } = require("./platform/app-updates.cjs");
const { expandedDataDashboardBounds, fitWindowBounds } = require("./platform/data-dashboard-window.cjs");
const { isAllowedRendererNavigation, resolveRendererDevUrl } = require("./platform/renderer-url.cjs");
const { platformHome, isPlatformPage, douyinVideoId, douyinVideoUrl, douyinResponseScope } = require("./platform/content-platforms.cjs");
const { normalizeDouyinCapture, isDouyinCapturePage, DOUYIN_PAGE_STATE_SCRIPT, DOUYIN_COMMENT_SCROLL_SCRIPT } = require("./capture/douyin-capture.cjs");

const PROJECT_ROOT = path.join(__dirname, "..");
const HOME_URL = "https://www.xiaohongshu.com/";
const APP_ICON_PATH = resolveAppIconPath({
  isPackaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  projectRoot: PROJECT_ROOT,
});
const MAX_BODY_BYTES = 15 * 1024 * 1024;

app.setName("小红书多账号采集工作台");

let mainWindow;
let accountRegistry;
let aiService;
let appUpdates;
let mainRendererUrl = "";
let activeAccountId = "";
let browserBounds = { x: 0, y: 0, width: 1, height: 1 };
let closingWindow = false;
let dataDashboardOpen = false;
let dataDashboardRestoreBounds;
const accountContexts = new Map();
const hardenedSessions = new WeakSet();

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) app.quit();

function isXhsPage(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:" && (url.hostname === "xiaohongshu.com" || url.hostname.endsWith(".xiaohongshu.com"));
  } catch {
    return false;
  }
}

function isCollectableApi(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:"
      && (url.hostname === "xiaohongshu.com" || url.hostname.endsWith(".xiaohongshu.com"))
      && url.pathname.includes("/api/");
  } catch {
    return false;
  }
}

function isNoteId(value) {
  return /^[a-f\d]{24}$/i.test(String(value || ""));
}

function noteIdFromUrl(rawUrl) {
  try { return new URL(rawUrl).pathname.match(/\/(?:explore|discovery\/item)\/([a-f\d]{24})/i)?.[1] || ""; }
  catch { return ""; }
}

function commentIdentity(comment, fallbackNoteId = "") {
  if (comment?.platform === "douyin" && comment.id) return ["douyin", comment.noteId || fallbackNoteId, comment.id].join("\u0000");
  return [comment?.noteId || fallbackNoteId, comment?.authorId || comment?.nickname, comment?.content]
    .map((value) => String(value || "").trim())
    .join("\u0000");
}

function makeCaptureState() {
  return {
    active: false,
    runId: "",
    kind: "notes",
    target: 100,
    seen: new Set(),
    seenComments: new Set(),
    commentMetrics: new Map(),
    domCommentFingerprints: new Set(),
    stalls: 0,
    noteId: "",
    pendingStartRunId: "",
    scrollTimer: undefined,
    startTimer: undefined,
    scrollBusy: false,
  };
}

function requireContext(accountId) {
  const id = String(accountId || "").toLowerCase();
  const context = accountContexts.get(id);
  if (!context || context.disposed) throw new Error("账号页面不存在或正在重建");
  return context;
}

function captureCount(context) {
  return context.capture.kind === "comments" ? context.capture.seenComments.size : context.capture.seen.size;
}

function hasNoteNavigationToken(rawUrl, expectedNoteId) {
  try {
    const url = new URL(rawUrl);
    return isXhsPage(url.href)
      && noteIdFromUrl(url.href) === String(expectedNoteId || "")
      && Boolean(url.searchParams.get("xsec_token"));
  } catch {
    return false;
  }
}

async function findLiveNoteUrl(context, id) {
  const liveUrl = await context.view.webContents.executeJavaScript(`(() => {
    const id = ${JSON.stringify(id)};
    const links = Array.from(document.querySelectorAll('a[href]'));
    const match = links.find((anchor) => {
      try {
        const url = new URL(anchor.href, location.href);
        return url.hostname.endsWith('xiaohongshu.com') && url.pathname.includes(id) && url.searchParams.has('xsec_token');
      } catch { return false; }
    });
    return match ? match.href : '';
  })()`);
  return liveUrl && isXhsPage(liveUrl) ? liveUrl : "";
}

async function waitForLiveNoteUrl(context, id, attempts = 20) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (context.disposed) return "";
    const url = await findLiveNoteUrl(context, id);
    if (url) return url;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  return "";
}

async function resolveLiveNoteUrl(context, note) {
  if (context.platform === "douyin") {
    const url = douyinVideoUrl(note?.link);
    if (!url) throw new Error("请输入完整的抖音视频链接（https://www.douyin.com/video/视频ID）");
    return url;
  }
  const id = String(note?.id || "");
  if (!isNoteId(id)) throw new Error("笔记 ID 无效");

  const liveUrl = await findLiveNoteUrl(context, id);
  if (liveUrl) return liveUrl;
  if (hasNoteNavigationToken(note?.link, id)) return note.link;

  const title = String(note?.title || "").trim();
  if (title) {
    sendStatus(context, "loading", "旧链接缺少导航参数，正在通过标题重新定位笔记…");
    const searchUrl = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(title)}`;
    await context.view.webContents.loadURL(searchUrl);
    const recoveredUrl = await waitForLiveNoteUrl(context, id);
    if (recoveredUrl) return recoveredUrl;
  }

  throw new Error("旧链接缺少导航参数且未能重新定位，请重新采集对应关键词");
}

async function operateOnLoadedNote(context, actions) {
  const config = {
    like: Boolean(actions?.like),
    collect: Boolean(actions?.collect),
    comment: String(actions?.comment || "").trim().slice(0, 2000),
  };
  return context.view.webContents.executeJavaScript(`(async () => {
    const config = ${JSON.stringify(config)};
    const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    const visible = (element) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const firstVisible = (selectors) => {
      for (const selector of selectors) {
        const match = Array.from(document.querySelectorAll(selector)).find(visible);
        if (match) return match;
      }
      return null;
    };
    const isActive = (element) => {
      if (!element) return false;
      const inspected = [element, ...element.querySelectorAll('*')].slice(0, 40);
      return inspected.some((node) => {
        const className = typeof node.className === 'string' ? node.className : node.getAttribute?.('class') || '';
        const ariaPressed = node.getAttribute?.('aria-pressed');
        const state = node.getAttribute?.('data-state') || '';
        const fill = node.getAttribute?.('fill') || '';
        const color = getComputedStyle(node).color || '';
        return ariaPressed === 'true'
          || /(^|[-_ ])(active|selected|liked|collected)([-_ ]|$)/i.test(className)
          || /^(active|checked|on)$/i.test(state)
          || /#ff2442|rgb\\(255,\\s*36,\\s*66\\)/i.test(fill + color);
      });
    };
    const runToggle = async (enabled, selectors, label) => {
      if (!enabled) return { status: 'skipped', message: '未启用' };
      const element = firstVisible(selectors);
      if (!element) return { status: 'missing', message: '页面中未找到' + label + '控件' };
      if (isActive(element)) return { status: 'already', message: '原本已' + label };
      element.scrollIntoView({ block: 'center', behavior: 'auto' });
      element.click();
      await wait(950);
      return isActive(element)
        ? { status: 'done', message: label + '成功' }
        : { status: 'unconfirmed', message: '已触发' + label + '，页面状态未能确认' };
    };
    const runComment = async (text) => {
      if (!text) return { status: 'skipped', message: '未启用' };
      const editor = firstVisible([
        '#content-textarea',
        '.note-detail-mask textarea[placeholder*="说"]',
        '.note-detail-mask [contenteditable="true"]',
        '#noteContainer textarea[placeholder*="说"]',
        '#noteContainer [contenteditable="true"]',
        'textarea[placeholder*="说点什么"]',
        '[contenteditable="true"][data-placeholder*="说"]'
      ]);
      if (!editor) return { status: 'missing', message: '页面中未找到评论输入框' };
      editor.scrollIntoView({ block: 'center', behavior: 'auto' });
      editor.focus();
      if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
        const prototype = editor instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
        if (setter) setter.call(editor, text);
        else editor.value = text;
      } else {
        const selection = getSelection();
        const range = document.createRange();
        range.selectNodeContents(editor);
        selection.removeAllRanges();
        selection.addRange(range);
        document.execCommand('insertText', false, text);
      }
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      editor.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(350);
      const container = editor.closest('.comment-input, .input-container, .bottom-container, form') || editor.parentElement?.parentElement || document;
      let submit = firstVisible([
        '.note-detail-mask button.submit',
        '.note-detail-mask button[class*="submit"]',
        '#noteContainer button.submit',
        '#noteContainer button[class*="submit"]'
      ]);
      if (!submit) submit = Array.from(container.querySelectorAll('button,[role="button"]')).find((element) => visible(element) && /^发送$/.test((element.textContent || '').trim()));
      if (!submit) return { status: 'missing', message: '评论已填入，但未找到发送按钮' };
      if (submit.disabled || submit.getAttribute('aria-disabled') === 'true') return { status: 'unconfirmed', message: '发送按钮当前不可用，请检查登录或评论限制' };
      submit.click();
      const commentIsVisible = () => Array.from(document.querySelectorAll([
        '#noteContainer .comment-item',
        '.note-detail-mask .comment-item',
        '[class*="comment-item"]',
        '[class*="comment-list"] [class*="content"]'
      ].join(','))).some((element) => element !== editor && visible(element) && (element.textContent || '').trim().includes(text));
      const successNoticeIsVisible = () => Array.from(document.querySelectorAll('[role="alert"],[class*="toast"],[class*="message"]'))
        .some((element) => visible(element) && /(评论|发布|发送).*(成功|完成)|成功.*(评论|发布|发送)/.test((element.textContent || '').trim()));
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await wait(400);
        const remaining = editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement ? editor.value : editor.textContent;
        if (!String(remaining || '').trim() || commentIsVisible() || successNoticeIsVisible()) {
          return { status: 'done', message: '评论已发送并完成页面确认' };
        }
      }
      return { status: 'unconfirmed', message: '已点击发送，页面状态未能确认' };
    };

    await wait(700);
    const like = await runToggle(config.like, [
      '#noteContainer .like-wrapper',
      '.note-detail-mask .like-wrapper',
      '.engage-bar .like-wrapper',
      '[class*="engage-bar"] [class*="like-wrapper"]'
    ], '点赞');
    const collect = await runToggle(config.collect, [
      '#noteContainer .collect-wrapper',
      '.note-detail-mask .collect-wrapper',
      '.engage-bar .collect-wrapper',
      '[class*="engage-bar"] [class*="collect-wrapper"]'
    ], '收藏');
    const comment = await runComment(config.comment);
    return { like, collect, comment, pageUrl: location.href, title: document.title };
  })()`, true);
}

async function operateNote(context, task) {
  if (context.platform === "douyin") throw new Error("抖音账号目前仅支持公开视频评论采集，不支持自动化操作");
  if (context.operation.active) throw new Error("该账号已有笔记操作正在进行");
  const requestedActions = task?.actions || {};
  if (!requestedActions.like && !requestedActions.collect && !String(requestedActions.comment || "").trim()) {
    throw new Error("至少启用一项笔记操作");
  }
  context.operation = { active: true, runId: randomUUID(), startedAt: Date.now() };
  context.view.webContents.setBackgroundThrottling(false);
  stopAutoScroll(context);
  try {
    const url = await resolveLiveNoteUrl(context, task?.note);
    sendStatus(context, "operating", "正在打开目标笔记并执行所选操作…", { active: true, url, operationRunId: context.operation.runId });
    await context.view.webContents.loadURL(url);
    const actions = await operateOnLoadedNote(context, requestedActions);
    const outcomes = [["like", actions.like], ["collect", actions.collect], ["comment", actions.comment]]
      .filter(([, value]) => value && typeof value === "object" && value.status);
    const confirmed = outcomes.every(([action, outcome]) => ["done", "already", "skipped"].includes(outcome.status)
      || (action === "comment" && outcome.status === "unconfirmed" && /^已点击发送/.test(outcome.message || "")));
    sendStatus(context, confirmed ? "completed" : "warning", confirmed ? "当前笔记操作已完成" : "当前笔记有操作需要页面确认", { active: false, url, actions });
    return { ok: true, accountId: context.id, url: actions.pageUrl || url, actions };
  } finally {
    context.operation = { active: false, runId: "", startedAt: 0 };
    if (!context.disposed && !context.view.webContents.isDestroyed()) context.view.webContents.setBackgroundThrottling(true);
    if (!context.disposed) {
      publishAccountStatus(context);
      publishAccountsChanged();
    }
  }
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function publicAccount(context) {
  const metadata = accountRegistry.get(context.id);
  return {
    id: metadata.id,
    accountId: metadata.id,
    name: metadata.name,
    platform: context.platform,
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
    lastActiveAt: metadata.lastActiveAt,
    active: context.id === activeAccountId,
    url: context.navigation.url,
    loading: context.navigation.loading,
    title: context.navigation.title,
    loginState: context.identity.state,
    profileName: context.identity.name,
    profileUrl: context.identity.profileUrl,
    capture: {
      active: context.capture.active,
      runId: context.capture.runId,
      kind: context.capture.kind,
      noteId: context.capture.noteId,
      collected: captureCount(context),
      target: context.capture.target,
    },
    operationActive: context.operation.active,
    crashed: context.crashed,
  };
}

function listPublicAccounts() {
  return accountRegistry.list().map((metadata) => {
    const context = accountContexts.get(metadata.id);
    return context && !context.disposed ? publicAccount(context) : {
      ...metadata,
      accountId: metadata.id,
      active: metadata.id === activeAccountId,
      url: platformHome(metadata.platform),
      loading: true,
      title: "",
      loginState: "unknown",
      profileName: "",
      profileUrl: "",
      capture: { active: false, runId: "", kind: "notes", collected: 0, target: 100 },
      operationActive: false,
      crashed: false,
    };
  });
}

function publishAccountsChanged() {
  sendToRenderer("accounts:changed", { accounts: listPublicAccounts(), activeAccountId });
}

function publishAccountStatus(context) {
  if (!context.disposed) sendToRenderer("account:status", publicAccount(context));
}

function sendStatus(context, phase, message, extra = {}) {
  sendToRenderer("collector:status", {
    accountId: context.id,
    platform: context.platform,
    phase,
    message,
    active: context.capture.active || context.operation.active,
    runId: context.capture.runId || context.operation.runId || "",
    kind: context.capture.kind,
    noteId: context.capture.noteId,
    ...extra,
  });
  publishAccountStatus(context);
}

function stopAutoScroll(context, reason = "已停止") {
  const state = context.capture;
  const stoppedRunId = state.runId;
  if (state.scrollTimer) clearInterval(state.scrollTimer);
  if (state.startTimer) clearTimeout(state.startTimer);
  state.scrollTimer = undefined;
  state.startTimer = undefined;
  state.scrollBusy = false;
  const wasActive = state.active;
  const collected = captureCount(context);
  const target = state.target;
  discardPendingResponsesForRun(context.pendingResponses, stoppedRunId);
  state.active = false;
  state.runId = "";
  state.pendingStartRunId = "";
  if (!context.operation.active && !context.disposed && !context.view.webContents.isDestroyed()) {
    context.view.webContents.setBackgroundThrottling(true);
  }
  if (wasActive) sendStatus(context, "stopped", reason, { collected, target, runId: stoppedRunId });
  return { wasActive, runId: stoppedRunId, collected, target };
}

async function scrollOneStep(context, runId) {
  const state = context.capture;
  if (!state.active || state.runId !== runId || state.scrollBusy || context.disposed || context.view.webContents.isDestroyed()) return;
  state.scrollBusy = true;
  try {
    if (context.platform === "douyin") {
      if (!isDouyinCapturePage(context.view.webContents.getURL(), state.noteId)) {
        stopAutoScroll(context, "已离开目标视频，评论采集已停止");
        return;
      }
      const page = await context.view.webContents.executeJavaScript(DOUYIN_PAGE_STATE_SCRIPT);
      if (!isActiveCaptureRun(context.capture, runId)) return;
      if (page?.blocked) { stopAutoScroll(context, page.blocked); return; }
      const result = await context.view.webContents.executeJavaScript(DOUYIN_COMMENT_SCROLL_SCRIPT);
      if (!isActiveCaptureRun(context.capture, runId)) return;
      state.stalls = result?.waiting || result?.atBottom && !result?.moved && !result?.expanded ? state.stalls + 1 : 0;
      if (result?.waiting && state.stalls === 1) sendStatus(context, "collecting", "请在左侧打开视频评论区；正在监听该视频正常加载的评论", { collected: captureCount(context), target: state.target });
      if (state.stalls >= 24) stopAutoScroll(context, result?.waiting
        ? `未检测到可滚动的评论区，已保留 ${captureCount(context)} 条；请打开评论区后重新采集`
        : `评论区暂未加载更多内容，已保留 ${captureCount(context)} 条，可重新采集`);
      return;
    }
    let expandedReplies = 0;
    if (state.kind === "comments") {
      expandedReplies = await context.view.webContents.executeJavaScript(COMMENT_REPLY_EXPAND_SCRIPT);
    }
    const result = await context.view.webContents.executeJavaScript(`(() => {
      const candidates = [document.scrollingElement, ...document.querySelectorAll('*')]
        .filter((el) => el && el.scrollHeight > el.clientHeight + 120 && getComputedStyle(el).overflowY !== 'hidden')
        .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
      const scroller = candidates[0] || document.scrollingElement;
      if (!scroller) return { moved: false, atBottom: true };
      const before = scroller.scrollTop;
      scroller.scrollBy({ top: Math.max(420, scroller.clientHeight * 0.82), behavior: 'smooth' });
      const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      return { moved: scroller.scrollTop > before, atBottom: scroller.scrollTop >= max - 8, before, max };
    })()`);
    if (state.active && state.runId === runId && state.kind === "comments") await harvestVisibleComments(context, runId);
    if (!state.active || state.runId !== runId) return;
    state.stalls = !expandedReplies && result?.atBottom && !result?.moved ? state.stalls + 1 : 0;
    if (state.stalls >= 6) stopAutoScroll(context, `页面已到底，共采集 ${captureCount(context)} 条`);
  } catch (error) {
    if (state.active && state.runId === runId) sendStatus(context, "warning", `页面滚动暂时不可用：${error.message}`);
  } finally {
    state.scrollBusy = false;
  }
}

function startAutoScroll(context, runId) {
  const state = context.capture;
  if (!state.active || state.runId !== runId || context.disposed) return;
  if (state.scrollTimer) clearInterval(state.scrollTimer);
  state.stalls = 0;
  context.view.webContents.setBackgroundThrottling(false);
  scrollOneStep(context, runId);
  state.scrollTimer = setInterval(() => scrollOneStep(context, runId), context.platform === "douyin" ? 2500 : 1400);
  const message = state.kind === "comments"
    ? "真实页面已加载，正在读取已显示评论、展开回复并监听分页响应"
    : "真实页面已加载，正在监听页面响应并滚动采集";
  sendStatus(context, "collecting", context.platform === "douyin" ? "请在左侧打开评论区，正在监听目标视频的公开评论" : message, { collected: captureCount(context), target: state.target });
}

async function startTask(context, task) {
  if (context.operation.active) throw new Error("该账号正在执行笔记操作，请稍后再采集");
  const kind = ["notes", "author", "comments"].includes(task?.kind) ? task.kind : "notes";
  const target = normalizeCaptureTarget(task?.target, kind === "comments" ? 500 : 100);
  if (!isPlatformPage(task?.url, context.platform)) throw new Error("链接平台与当前账号不匹配");
  const url = context.platform === "douyin" ? douyinVideoUrl(task?.url) : task.url;
  if (context.platform === "douyin" && (kind !== "comments" || !url)) throw new Error("抖音账号仅支持完整公开视频链接的评论采集");
  stopAutoScroll(context);
  const runId = randomUUID();
  context.capture = { ...makeCaptureState(), active: true, runId, kind, target, noteId: context.platform === "douyin" ? douyinVideoId(url) : noteIdFromUrl(url), pendingStartRunId: runId };
  sendStatus(context, "loading", `正在打开真实${context.platform === "douyin" ? "抖音视频" : "小红书"}页面…`, { collected: 0, target });
  try {
    await context.view.webContents.loadURL(url);
  } catch (error) {
    stopAutoScroll(context, "页面加载失败，采集已停止");
    throw error;
  }
  return { ok: true, accountId: context.id, runId, kind, target };
}

function publishCapturePayload(context, payload, runId) {
  const state = context.capture;
  if (!isActiveCaptureRun(state, runId)) return 0;
  const commentsMode = state.kind === "comments";
  if (context.platform === "douyin") {
    if (!isDouyinCapturePage(context.view.webContents.getURL(), state.noteId)) return 0;
    payload = {
      ...payload,
      notes: (payload.notes || []).filter((row) => row.platform === "douyin" && row.id === state.noteId),
      comments: (payload.comments || []).filter((row) => row.platform === "douyin" && row.noteId === state.noteId),
    };
    if (payload.notes.length) sendToRenderer("collector:capture", { ...payload, comments: [] });
  }
  const seenKeys = commentsMode ? state.seenComments : state.seen;
  const selected = selectUniqueRowsWithinTarget({
    rows: commentsMode ? payload.comments : payload.notes,
    seenKeys,
    target: state.target,
    keyOf: commentsMode ? (row) => commentIdentity(row, state.noteId) : (row) => row?.id,
  });
  for (const key of selected.keys) seenKeys.add(key);
  const publishedRows = commentsMode ? selectCommentMetricUpdates({
    rows: payload.comments, seenKeys, metrics: state.commentMetrics,
    keyOf: (row) => commentIdentity(row, state.noteId),
  }) : selected.rows;
  if (!publishedRows.length) return 0;
  if (commentsMode) {
    for (const row of selected.rows) {
      if (row?.id) state.seen.add(row.id);
    }
  }

  const boundedPayload = {
    ...payload,
    notes: commentsMode ? [] : selected.rows,
    comments: commentsMode ? publishedRows : [],
  };
  sendToRenderer("collector:capture", boundedPayload);
  sendStatus(context, "collecting", `已采集 ${selected.collected} / ${selected.target}`, {
    collected: selected.collected,
    target: selected.target,
  });
  if (selected.reachedTarget) stopAutoScroll(context, `已达到目标，共采集 ${selected.collected} 条`);
  return selected.rows.length;
}

async function readResponseBody(context, requestId, meta) {
  try {
    if (context.disposed || context.view.webContents.isDestroyed() || !isActiveCaptureRun(context.capture, meta?.runId)) return;
    const result = await context.view.webContents.debugger.sendCommand("Network.getResponseBody", { requestId });
    if (!isActiveCaptureRun(context.capture, meta?.runId)) return;
    const body = result.base64Encoded ? Buffer.from(result.body, "base64").toString("utf8") : result.body;
    if (!body || Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) return;
    const json = JSON.parse(body);
    const normalized = context.platform === "douyin"
      ? normalizeDouyinCapture(meta.url, json, meta.noteId, context.capture.seen)
      : normalizeCapture(meta.url, json);
    if (normalized.blocked) { stopAutoScroll(context, normalized.blocked); return; }
    if (meta.noteId && normalized.comments.length) {
      normalized.comments = normalized.comments.map((comment) => comment.noteId ? comment : { ...comment, noteId: meta.noteId });
    }
    normalized.notes = normalized.notes.map((note) => ({ ...note, accountId: context.id }));
    normalized.comments = normalized.comments.map((comment) => ({ ...comment, accountId: context.id }));
    if (!normalized.notes.length && !normalized.comments.length) return;
    const payload = {
      ...normalized,
      accountId: context.id,
      platform: context.platform,
      runId: meta.runId,
      kind: meta.kind,
      url: context.platform === "douyin" ? `https://www.douyin.com/video/${meta.noteId}` : meta.url,
      pageUrl: context.platform === "douyin" ? `https://www.douyin.com/video/${meta.noteId}` : meta.pageUrl,
      capturedAt: Date.now(),
      source: "network-response",
    };
    publishCapturePayload(context, payload, meta.runId);
  } catch {
    // Cached or redirected responses can lose their body before it is read.
  }
}

async function harvestVisibleComments(context, runId) {
  if (context.platform === "douyin") return 0;
  const state = context.capture;
  if (!state.active || state.runId !== runId || state.kind !== "comments" || context.disposed || context.view.webContents.isDestroyed()) return 0;
  const pageUrl = context.view.webContents.getURL();
  const rawComments = await context.view.webContents.executeJavaScript(COMMENT_DOM_CAPTURE_SCRIPT);
  const comments = normalizeDomComments(pageUrl, rawComments)
    .map((comment) => ({ ...(comment.noteId ? comment : { ...comment, noteId: state.noteId }), accountId: context.id }))
    .filter((comment) => {
      const fingerprint = [commentIdentity(comment, state.noteId), comment.time, comment.region, comment.likes, comment.replyCount].join("\u0000");
      if (state.domCommentFingerprints.has(fingerprint)) return false;
      state.domCommentFingerprints.add(fingerprint);
      return true;
    });
  if (!comments.length) return 0;
  const payload = { notes: [], comments, accountId: context.id, runId, kind: state.kind, url: pageUrl, pageUrl, capturedAt: Date.now(), source: "rendered-page" };
  return publishCapturePayload(context, payload, runId);
}

async function attachNetworkCapture(context) {
  if (context.disposed || context.attachPromise) return context.attachPromise;
  const contents = context.view.webContents;
  context.attachPromise = (async () => {
  if (!contents.debugger.isAttached()) contents.debugger.attach("1.3");
  await contents.debugger.sendCommand("Network.enable", { maxTotalBufferSize: 50 * 1024 * 1024, maxResourceBufferSize: MAX_BODY_BYTES });
  if (!context.debuggerMessageListener) {
    context.debuggerMessageListener = (_event, method, params) => {
    if (method === "Network.responseReceived") {
      const state = context.capture;
      if (!state.active || !state.runId) return;
      if (context.platform === "douyin") {
        if (!douyinResponseScope(params.response?.url, state.noteId, state.seen)
          || !isDouyinCapturePage(contents.getURL(), state.noteId)) return;
        if ([401, 403, 429].includes(params.response?.status)) {
          stopAutoScroll(context, "抖音限制了当前访问，请在左侧检查登录或验证后稍后重试");
          return;
        }
      } else if (!isCollectableApi(params.response?.url)) return;
      context.pendingResponses.set(params.requestId, {
        url: params.response.url,
        mimeType: params.response.mimeType || "",
        pageUrl: contents.getURL(),
        runId: state.runId,
        kind: state.kind,
        noteId: state.noteId,
      });
    }
    if (method === "Network.loadingFinished") {
      const meta = context.pendingResponses.get(params.requestId);
      if (!meta) return;
      context.pendingResponses.delete(params.requestId);
      readResponseBody(context, params.requestId, meta);
    }
    if (method === "Network.loadingFailed") context.pendingResponses.delete(params.requestId);
    };
    contents.debugger.on("message", context.debuggerMessageListener);
  }
  })().finally(() => { context.attachPromise = null; });
  return context.attachPromise;
}

function scheduleDebuggerRecovery(context) {
  if (context.disposed || context.debuggerRecoveryTimer) return;
  context.debuggerRecoveryTimer = setTimeout(() => {
    context.debuggerRecoveryTimer = undefined;
    attachNetworkCapture(context).catch((error) => sendStatus(context, "error", `网络监听恢复失败：${error.message}`));
  }, 1000);
}

function openSafeExternal(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === "https:" || url.protocol === "http:") shell.openExternal(url.href).catch(() => {});
  } catch { /* deny malformed and custom-protocol URLs */ }
}

function wireBrowserEvents(context) {
  const contents = context.view.webContents;
  const publishNavigation = (url = contents.getURL()) => {
    context.navigation = { url, loading: contents.isLoading(), title: contents.getTitle() || context.navigation.title };
    sendToRenderer("browser:navigation", { accountId: context.id, ...context.navigation });
    publishAccountStatus(context);
  };
  contents.on("did-start-loading", () => publishNavigation());
  contents.on("did-stop-loading", () => publishNavigation());
  const didNavigate = (_event, url, isMainFrame = true) => {
    if (!isMainFrame) return;
    if (context.platform === "douyin" && context.capture.active && !isDouyinCapturePage(url, context.capture.noteId))
      stopAutoScroll(context, "已离开目标视频，评论采集已停止");
    publishNavigation(url);
  };
  contents.on("did-navigate", (_event, url) => didNavigate(_event, url));
  contents.on("did-navigate-in-page", didNavigate);
  contents.on("did-finish-load", () => {
    publishNavigation();
    const runId = context.capture.pendingStartRunId;
    if (runId && context.capture.active && context.capture.runId === runId) {
      context.capture.pendingStartRunId = "";
      if (context.capture.startTimer) clearTimeout(context.capture.startTimer);
      context.capture.startTimer = setTimeout(() => startAutoScroll(context, runId), 700);
    }
    setTimeout(() => probeAccountIdentity(context).catch(() => {}), 800);
  });
  contents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
    if (isMainFrame) sendStatus(context, "error", `页面加载失败：${description} (${code})`, { url });
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (isPlatformPage(url, context.platform)) contents.loadURL(url);
    else openSafeExternal(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    if (!isPlatformPage(url, context.platform)) { event.preventDefault(); openSafeExternal(url); }
  });
  contents.on("will-redirect", (event, url, _isInPlace, isMainFrame) => {
    // Embedded redirects do not navigate the account's top-level page.
    if ((event.isMainFrame ?? isMainFrame) === false) return;
    const destination = event.url ?? url;
    if (!isPlatformPage(destination, context.platform)) {
      event.preventDefault();
      if (context.capture.active) {
        let site = "未知站点";
        try { site = new URL(destination).hostname || "非网页地址"; } catch { /* do not display URL tokens */ }
        stopAutoScroll(context, `页面尝试跳转至平台外（${site}），已阻止并停止采集`);
      }
    }
  });
  contents.debugger.on("detach", () => {
    context.pendingResponses.clear();
    if (!context.disposed) {
      sendStatus(context, "warning", "网络监听已断开，正在自动恢复…");
      scheduleDebuggerRecovery(context);
    }
  });
  contents.on("render-process-gone", (_event, details) => {
    if (context.disposed || closingWindow) return;
    context.crashed = true;
    stopAutoScroll(context, "账号页面已停止");
    sendStatus(context, "error", `账号页面异常退出：${details.reason}`);
    recoverAccountContext(context).catch(() => {});
  });
}

async function probeAccountIdentity(context) {
  if (context.disposed || context.view.webContents.isDestroyed()) return null;
  if (!isPlatformPage(context.view.webContents.getURL(), context.platform)) return publicAccount(context);
  if (context.platform === "douyin") {
    const identity = await context.view.webContents.executeJavaScript(DOUYIN_PAGE_STATE_SCRIPT).catch(() => null);
    if (context.disposed) return null;
    context.identity = { state: identity?.loginState || "unknown", name: "", profileUrl: "", checkedAt: Date.now() };
    publishAccountStatus(context);
    publishAccountsChanged();
    return publicAccount(context);
  }
  let domIdentity = { state: "unknown", name: "", profileUrl: "" };
  try {
    domIdentity = await context.view.webContents.executeJavaScript(`(() => {
    const visible = (element) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const exactLogin = Array.from(document.querySelectorAll('button,[role="button"],a,span'))
      .some((element) => visible(element) && (element.textContent || '').trim() === '登录');
    const candidates = Array.from(document.querySelectorAll('a[href*="/user/profile/"]'))
      .filter((link) => visible(link) && !/[?&]xsec_source=(?:pc_search|pc_comment|pc_feed)/.test(link.href || ''))
      .filter((link) => /user|avatar|profile|sidebar|side-bar|nav/i.test(String(link.className || '') + ' ' + String(link.parentElement?.className || '') + ' ' + String(link.parentElement?.parentElement?.className || '')));
    const profile = candidates[0] || null;
    if (profile) {
      const name = (profile.getAttribute('aria-label') || profile.querySelector('img')?.alt || profile.textContent || '').replace(/\s+/g, ' ').trim();
      return { state: 'logged-in', name: name.slice(0, 40), profileUrl: profile.href || '' };
    }
    return { state: exactLogin ? 'logged-out' : 'unknown', name: '', profileUrl: '' };
  })()`);
  } catch { /* a navigation can replace the document while the probe is running */ }
  const loginCookies = await context.session.cookies.get({ url: HOME_URL, name: "web_session" }).catch(() => []);
  const hasWebSession = loginCookies.some((cookie) => Boolean(cookie.value) && (!cookie.expirationDate || cookie.expirationDate * 1000 > Date.now()));
  if (context.disposed) return null;
  context.identity = {
    state: domIdentity?.state === "logged-in" || hasWebSession ? "logged-in" : (domIdentity?.state === "logged-out" ? "logged-out" : "unknown"),
    name: String(domIdentity?.name || "").slice(0, 40),
    profileUrl: isXhsPage(domIdentity?.profileUrl) ? domIdentity.profileUrl : "",
    checkedAt: Date.now(),
  };
  publishAccountStatus(context);
  publishAccountsChanged();
  return publicAccount(context);
}

function hardenAccountSession(accountSession) {
  if (hardenedSessions.has(accountSession)) return;
  hardenedSessions.add(accountSession);
  accountSession.setPermissionCheckHandler(() => false);
  accountSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  accountSession.on("will-download", (event) => event.preventDefault());
}

function createAccountContext(metadata, initialUrl = platformHome(metadata.platform)) {
  const existing = accountContexts.get(metadata.id);
  if (existing && !existing.disposed) return existing;

  const accountSession = session.fromPartition(metadata.partition, { cache: true });
  hardenAccountSession(accountSession);
  const view = new WebContentsView({
    webPreferences: {
      session: accountSession,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: true,
      allowRunningInsecureContent: false,
    },
  });
  const context = {
    id: metadata.id,
    platform: metadata.platform || "xhs",
    session: accountSession,
    view,
    capture: makeCaptureState(),
    operation: { active: false, runId: "", startedAt: 0 },
    pendingResponses: new Map(),
    navigation: { url: isPlatformPage(initialUrl, metadata.platform) ? initialUrl : platformHome(metadata.platform), loading: true, title: "" },
    identity: { state: "unknown", name: "", profileUrl: "", checkedAt: 0 },
    debuggerMessageListener: null,
    debuggerRecoveryTimer: undefined,
    cookieChangedListener: null,
    cookieProbeTimer: undefined,
    attachPromise: null,
    disposed: false,
    recovering: false,
    crashed: false,
  };
  accountContexts.set(context.id, context);

  mainWindow.contentView.addChildView(view);
  view.setBounds(browserBounds);
  view.setVisible(false);
  const chromeUserAgent = view.webContents.getUserAgent().replace(/\sElectron\/[^\s]+/, "");
  view.webContents.setUserAgent(chromeUserAgent);
  view.webContents.setAudioMuted(true);
  context.cookieChangedListener = (_event, cookie) => {
    const cookieDomain = String(cookie?.domain || "").replace(/^\./, "").toLowerCase();
    const relevant = context.platform === "douyin"
      ? ["sessionid", "sessionid_ss"].includes(cookie?.name) && (cookieDomain === "douyin.com" || cookieDomain.endsWith(".douyin.com"))
      : cookie?.name === "web_session" && (cookieDomain === "xiaohongshu.com" || cookieDomain.endsWith(".xiaohongshu.com"));
    if (!relevant) return;
    if (context.cookieProbeTimer) clearTimeout(context.cookieProbeTimer);
    context.cookieProbeTimer = setTimeout(() => {
      context.cookieProbeTimer = undefined;
      probeAccountIdentity(context).catch(() => {});
    }, 250);
  };
  accountSession.cookies.on("changed", context.cookieChangedListener);
  wireBrowserEvents(context);
  attachNetworkCapture(context).catch((error) => sendStatus(context, "error", `网络监听启动失败：${error.message}`));
  view.webContents.loadURL(context.navigation.url).catch((error) => sendStatus(context, "error", `账号页面加载失败：${error.message}`));
  return context;
}

async function disposeAccountContext(context, { clearData = false } = {}) {
  if (!context || context.disposed) return;
  context.disposed = true;
  if (context.capture.scrollTimer) clearInterval(context.capture.scrollTimer);
  if (context.capture.startTimer) clearTimeout(context.capture.startTimer);
  if (context.debuggerRecoveryTimer) clearTimeout(context.debuggerRecoveryTimer);
  if (context.cookieProbeTimer) clearTimeout(context.cookieProbeTimer);
  if (context.cookieChangedListener) context.session.cookies.removeListener("changed", context.cookieChangedListener);
  context.capture.active = false;
  context.pendingResponses.clear();

  const contents = context.view.webContents;
  if (!contents.isDestroyed()) {
    if (context.debuggerMessageListener) contents.debugger.removeListener("message", context.debuggerMessageListener);
    if (contents.debugger.isAttached()) {
      try { contents.debugger.detach(); } catch { /* already detached */ }
    }
  }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.contentView.removeChildView(context.view);
  if (!contents.isDestroyed()) contents.close();
  if (accountContexts.get(context.id) === context) accountContexts.delete(context.id);

  if (clearData) {
    await Promise.allSettled([
      context.session.clearData(),
      context.session.clearAuthCache(),
    ]);
    await context.session.closeAllConnections().catch(() => {});
  }
}

async function recoverAccountContext(context) {
  if (context.recovering || context.disposed || closingWindow) return;
  context.recovering = true;
  const wasActive = activeAccountId === context.id;
  const lastUrl = isPlatformPage(context.navigation.url, context.platform) ? context.navigation.url : platformHome(context.platform);
  let metadata;
  try { metadata = accountRegistry.get(context.id); } catch { return; }
  await disposeAccountContext(context);
  if (closingWindow || !mainWindow || mainWindow.isDestroyed()) return;
  const replacement = createAccountContext(metadata, lastUrl);
  if (wasActive) await activateAccount(replacement.id, false);
  publishAccountsChanged();
}

async function activateAccount(accountId, persist = true) {
  const context = requireContext(accountId);
  if (persist) await accountRegistry.setActive(context.id);
  activeAccountId = context.id;
  for (const candidate of accountContexts.values()) candidate.view.setVisible(candidate.id === context.id);
  mainWindow.contentView.addChildView(context.view);
  context.view.setBounds(browserBounds);
  context.view.setVisible(true);
  sendToRenderer("browser:navigation", { accountId: context.id, ...context.navigation });
  publishAccountsChanged();
  publishAccountStatus(context);
  return publicAccount(context);
}

function sanitizeBounds(bounds) {
  const content = mainWindow?.getContentBounds() || { width: 1, height: 1 };
  const x = Math.min(content.width - 1, Math.max(0, Math.round(Number(bounds?.x) || 0)));
  const y = Math.min(content.height - 1, Math.max(0, Math.round(Number(bounds?.y) || 0)));
  const width = Math.min(content.width - x, Math.max(1, Math.round(Number(bounds?.width) || 1)));
  const height = Math.min(content.height - y, Math.max(1, Math.round(Number(bounds?.height) || 1)));
  return { x, y, width, height };
}

function assertMainRenderer(event) {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) throw new Error("无效请求");
  if (!isAllowedRendererNavigation(event.sender.getURL(), [mainRendererUrl])) throw new Error("无效请求来源");
}

function setDataDashboardOpen(open) {
  const nextOpen = Boolean(open);
  if (!mainWindow || mainWindow.isDestroyed() || nextOpen === dataDashboardOpen) return;
  dataDashboardOpen = nextOpen;
  if (mainWindow.isMaximized() || mainWindow.isFullScreen()) {
    if (!nextOpen) dataDashboardRestoreBounds = undefined;
    return;
  }
  if (nextOpen) {
    dataDashboardRestoreBounds = mainWindow.getBounds();
    const workArea = screen.getDisplayMatching(dataDashboardRestoreBounds).workArea;
    mainWindow.setBounds(expandedDataDashboardBounds(dataDashboardRestoreBounds, workArea), true);
    return;
  }
  if (!dataDashboardRestoreBounds) return;
  const restoreBounds = dataDashboardRestoreBounds;
  dataDashboardRestoreBounds = undefined;
  const workArea = screen.getDisplayMatching(restoreBounds).workArea;
  mainWindow.setBounds(fitWindowBounds(restoreBounds, workArea), true);
}

function requireAiService() {
  if (!aiService) throw new Error("AI 服务尚未初始化");
  return aiService;
}

function assertIdleForUpdate() {
  if (aiService?.jobs.size || [...accountContexts.values()].some((context) => context.capture.active || context.capture.pendingStartRunId || context.operation.active)) {
    throw new Error("请先停止采集、自动化任务和 AI 分析，再安装更新。");
  }
}

async function createWindow() {
  closingWindow = false;
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 860,
    minWidth: 980,
    minHeight: 620,
    backgroundColor: "#fff6e9",
    icon: APP_ICON_PATH,
    title: "小红书多账号采集工作台",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  accountRegistry = new AccountRegistry({ filePath: path.join(app.getPath("userData"), "multi-accounts.json") });
  if (process.platform !== "darwin") mainWindow.setMenu(null);
  if (!aiService) {
    aiService = new AiService({
      filePath: path.join(app.getPath("userData"), "ai-settings.json"),
      safeStorage,
      fetchImpl: (url, options) => net.fetch(url, options),
    });
  }
  if (!appUpdates) {
    appUpdates = new AppUpdates({
      version: app.getVersion(),
      isPackaged: app.isPackaged,
      updater: app.isPackaged && process.platform === "win32" ? require("electron-updater").autoUpdater : undefined,
      settingsPath: path.join(app.getPath("userData"), "update-settings.json"),
      fetchImpl: (url, options) => net.fetch(url, options),
      openRelease: (url) => shell.openExternal(url),
      releaseRedirectImpl: () => requestReleaseRedirect(net),
      onState: (state) => sendToRenderer("updates:state", state),
      beforeInstall: async () => {
        assertIdleForUpdate();
        const result = await dialog.showMessageBox(mainWindow, {
          type: "question",
          title: "安装更新",
          message: "退出软件并安装已下载的新版本？",
          detail: "账号和本地采集数据将保留，安装完成后重新打开软件。",
          buttons: ["安装并重启", "暂不安装"],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        });
        if (result.response !== 0) return false;
        await accountRegistry.writeQueue;
        assertIdleForUpdate();
        session.defaultSession.flushStorageData();
        for (const context of accountContexts.values()) context.session.flushStorageData();
        return true;
      },
    });
    await appUpdates.initialize();
  }
  await accountRegistry.load();
  await accountRegistry.ensureDefault();
  for (const metadata of accountRegistry.list()) createAccountContext(accountRegistry.get(metadata.id));
  activeAccountId = accountRegistry.activeAccountId || accountRegistry.list()[0]?.id || "";
  await activateAccount(activeAccountId, false);

  const rendererFilePath = path.join(PROJECT_ROOT, "dist", "index.html");
  const rendererDevUrl = resolveRendererDevUrl(process.env.ELECTRON_RENDERER_URL, { isPackaged: app.isPackaged });
  mainRendererUrl = rendererDevUrl || pathToFileURL(rendererFilePath).href;
  const rendererId = mainWindow.webContents.id;
  const cancelRendererAi = () => aiService?.cancelForSender(rendererId);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openSafeExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    cancelRendererAi();
    if (!isAllowedRendererNavigation(url, [mainRendererUrl])) {
      event.preventDefault();
      openSafeExternal(url);
    }
  });
  mainWindow.webContents.on("did-start-navigation", (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) cancelRendererAi();
  });
  mainWindow.webContents.on("render-process-gone", cancelRendererAi);
  mainWindow.webContents.once("destroyed", () => aiService?.cancelForSender(rendererId));
  mainWindow.webContents.on("did-finish-load", publishAccountsChanged);
  if (rendererDevUrl) mainWindow.loadURL(rendererDevUrl);
  else mainWindow.loadFile(rendererFilePath);

  mainWindow.on("closed", () => {
    closingWindow = true;
    for (const context of Array.from(accountContexts.values())) disposeAccountContext(context).catch(() => {});
    accountContexts.clear();
    activeAccountId = "";
    mainRendererUrl = "";
    dataDashboardOpen = false;
    dataDashboardRestoreBounds = undefined;
    mainWindow = undefined;
  });
}

ipcMain.handle("accounts:list", (event) => {
  assertMainRenderer(event);
  return { accounts: listPublicAccounts(), activeAccountId };
});
ipcMain.handle("accounts:add", async (event, payload) => {
  assertMainRenderer(event);
  const metadata = await accountRegistry.add(payload?.name, payload?.platform || "xhs");
  const context = createAccountContext(metadata);
  await activateAccount(context.id);
  return publicAccount(context);
});
ipcMain.handle("accounts:switch", async (event, payload) => {
  assertMainRenderer(event);
  return activateAccount(payload?.accountId);
});
ipcMain.handle("accounts:rename", async (event, payload) => {
  assertMainRenderer(event);
  const metadata = await accountRegistry.rename(payload?.accountId, payload?.name);
  const context = requireContext(metadata.id);
  publishAccountsChanged();
  publishAccountStatus(context);
  return publicAccount(context);
});
ipcMain.handle("accounts:remove", async (event, payload) => {
  assertMainRenderer(event);
  const context = requireContext(payload?.accountId);
  const removed = await accountRegistry.remove(context.id);
  await disposeAccountContext(context, { clearData: payload?.clearData !== false });
  activeAccountId = accountRegistry.activeAccountId;
  await activateAccount(activeAccountId, false);
  return { ok: true, removedAccountId: removed.id, accounts: listPublicAccounts(), activeAccountId };
});
ipcMain.handle("accounts:status", (event, payload) => {
  assertMainRenderer(event);
  return publicAccount(requireContext(payload?.accountId));
});
ipcMain.handle("accounts:refresh-status", async (event, payload) => {
  assertMainRenderer(event);
  return probeAccountIdentity(requireContext(payload?.accountId));
});

ipcMain.handle("ai:get-settings", (event) => {
  assertMainRenderer(event);
  return requireAiService().getSettings();
});
ipcMain.handle("ai:save-settings", (event, payload) => {
  assertMainRenderer(event);
  return requireAiService().saveSettings(payload);
});
ipcMain.handle("ai:test-connection", (event) => {
  assertMainRenderer(event);
  return requireAiService().testConnection();
});
ipcMain.handle("ai:list-models", (event) => {
  assertMainRenderer(event);
  return requireAiService().listModels();
});
ipcMain.handle("ai:analyze", (event, payload) => {
  assertMainRenderer(event);
  const sender = event.sender;
  return requireAiService().analyze(payload, {
    senderId: sender.id,
    onProgress: (progress) => {
      if (!sender.isDestroyed()) sender.send("ai:progress", progress);
    },
  });
});
ipcMain.handle("ai:cancel", (event, payload) => {
  assertMainRenderer(event);
  return requireAiService().cancel(payload?.requestId, event.sender.id);
});

for (const [channel, action] of [
  ["updates:get-state", () => appUpdates.getState()],
  ["updates:check", () => appUpdates.check()],
  ["updates:download", () => appUpdates.download()],
  ["updates:install", () => appUpdates.install()],
  ["updates:set-preferences", (payload) => appUpdates.setPreferences(payload)],
  ["updates:open-release", () => appUpdates.openDownloadPage()],
]) {
  ipcMain.handle(channel, (event, payload) => {
    assertMainRenderer(event);
    if (!appUpdates) throw new Error("更新服务尚未初始化");
    return action(payload);
  });
}

ipcMain.handle("browser:navigate", async (event, payload) => {
  assertMainRenderer(event);
  const context = requireContext(payload?.accountId);
  if (!isPlatformPage(payload?.url, context.platform)) throw new Error("链接平台与当前账号不匹配");
  if (context.operation.active) throw new Error("该账号正在执行笔记操作");
  stopAutoScroll(context);
  await context.view.webContents.loadURL(payload.url);
  return { ok: true, accountId: context.id, url: payload.url };
});
ipcMain.handle("browser:open-note", async (event, payload) => {
  assertMainRenderer(event);
  const context = requireContext(payload?.accountId);
  if (context.operation.active) throw new Error("该账号正在执行笔记操作");
  stopAutoScroll(context);
  const url = await resolveLiveNoteUrl(context, payload?.note);
  await context.view.webContents.loadURL(url);
  return { ok: true, accountId: context.id, url };
});
ipcMain.handle("browser:operate-note", async (event, payload) => {
  assertMainRenderer(event);
  return operateNote(requireContext(payload?.accountId), payload?.task);
});
ipcMain.handle("browser:start-task", async (event, payload) => {
  assertMainRenderer(event);
  return startTask(requireContext(payload?.accountId), payload?.task);
});
ipcMain.handle("browser:stop-task", (event, payload) => {
  assertMainRenderer(event);
  const context = requireContext(payload?.accountId);
  stopAutoScroll(context, "用户已停止采集");
  return { ok: true, accountId: context.id };
});
ipcMain.handle("browser:reload", (event, payload) => {
  assertMainRenderer(event);
  const context = requireContext(payload?.accountId);
  if (context.operation.active) throw new Error("该账号正在执行笔记操作");
  stopAutoScroll(context);
  context.view.webContents.reload();
  return { ok: true, accountId: context.id };
});
ipcMain.handle("browser:home", async (event, payload) => {
  assertMainRenderer(event);
  const context = requireContext(payload?.accountId);
  if (context.operation.active) throw new Error("该账号正在执行笔记操作");
  stopAutoScroll(context);
  const url = platformHome(context.platform);
  await context.view.webContents.loadURL(url);
  return { ok: true, accountId: context.id, url };
});
ipcMain.handle("browser:set-muted", (event, payload) => {
  assertMainRenderer(event);
  const context = requireContext(payload?.accountId);
  context.view.webContents.setAudioMuted(Boolean(payload?.muted));
  return { ok: true, accountId: context.id };
});
ipcMain.on("browser:set-bounds", (event, bounds) => {
  try { assertMainRenderer(event); } catch { return; }
  browserBounds = sanitizeBounds(bounds);
  for (const context of accountContexts.values()) context.view.setBounds(browserBounds);
});
ipcMain.on("window:set-data-dashboard-open", (event, open) => {
  try { assertMainRenderer(event); } catch { return; }
  setDataDashboardOpen(open);
});

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

if (singleInstanceLock) app.whenReady().then(() => {
  if (process.platform === "darwin") {
    setDockIconSafely({ dock: app.dock, iconPath: APP_ICON_PATH });
  }
  return createWindow();
}).catch((error) => {
  console.error(error);
  app.quit();
});
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow().catch(() => app.quit()); });
app.on("before-quit", () => { aiService?.cancelAll(); appUpdates?.dispose(); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
