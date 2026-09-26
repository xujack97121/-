import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IconChartBar,
  IconCircleCheck,
  IconChevronDown,
  IconDots,
  IconDownload,
  IconExternalLink,
  IconFilter,
  IconHome,
  IconLogin2,
  IconPencil,
  IconPlus,
  IconPlayerPlay,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconMessageCircle,
  IconUpload,
  IconTrash,
  IconUserCircle,
  IconVolume,
  IconX,
} from "@tabler/icons-react";
import { randomizeComment } from "../features/comments/comment-randomizer.js";
import { normalizeNoteTime, noteMatchesTimeRange } from "../features/comments/comment-time-filter.js";
import { CommentsPanel } from "../features/comments/CommentsPanel.jsx";
import { buildCommentCollectionIndex, commentCollectionState, commentNoteId, commentNoteLink, removeCommentCards, updateCommentTaskStatus } from "../features/comments/comment-notes.js";
import { randomizeOperationInterval } from "../features/operations/operation-interval.js";
import { actionResultLabel, isActionComplete, taskTimingLabel } from "../features/operations/operation-status.js";
import { AnalyticsPage } from "../features/analytics/AnalyticsPage.jsx";
import { SettingsDialog } from "../features/settings/SettingsDialog.jsx";
import { useAppUpdates } from "../features/settings/AppUpdates.jsx";
import { DataDashboard } from "../features/dashboard/DataDashboard.jsx";
import { platformOf, platformLabel, platformHome } from "../features/platforms/content-platforms.js";

const demoNotes = [
  { id: "65a2-demo-01", author: "张六千", authorId: "653500d40000", title: "没钱还想创业？互联网是年轻人的第一桶金", link: "https://www.xiaohongshu.com/explore/65a2-demo-01", likes: 2529, type: "视频", time: "2小时前", source: "搜索" },
  { id: "65a2-demo-02", author: "Yolo Studio", authorId: "65f120d30000", title: "1500 元启动资金，一年时间赚了 30 万", link: "https://www.xiaohongshu.com/explore/65a2-demo-02", likes: 1688, type: "笔记", time: "昨天 10:15", source: "作者" },
  { id: "65a2-demo-03", author: "石榴商业", authorId: "64ef20c20000", title: "创业 6 年后，整理了这份项目复盘", link: "https://www.xiaohongshu.com/explore/65a2-demo-03", likes: 467, type: "视频", time: "5天前", source: "搜索" },
  { id: "65a2-demo-04", author: "小红薯研究所", authorId: "66b8a02f0000", title: "从 0 到 1 的内容创业清单", link: "https://www.xiaohongshu.com/explore/65a2-demo-04", likes: 136, type: "笔记", time: "20天前", source: "搜索" },
  { id: "65a2-demo-05", author: "一页计划", authorId: "6681d1130000", title: "普通人如何判断一个副业是否值得做", link: "https://www.xiaohongshu.com/explore/65a2-demo-05", likes: 73, type: "笔记", time: "5个月前", source: "搜索" },
  { id: "65a2-demo-06", author: "工作室日志", authorId: "64bd9a720000", title: "小团队经营的三个真实成本", link: "https://www.xiaohongshu.com/explore/65a2-demo-06", likes: 6129, type: "视频", time: "1年前", source: "作者" },
];

const demoComments = [
  { id: "comment-demo-01", noteId: "65a2-demo-01", time: "2026-07-28 09:14", nickname: "栗子", content: "这个复盘很有帮助，尤其是成本那一段。", authorId: "5f22••••001", region: "山东" },
  { id: "comment-demo-02", noteId: "65a2-demo-01", time: "2026-07-28 10:32", nickname: "山风", content: "请问表格模板在哪里可以看到？", authorId: "60a1••••210", region: "江苏" },
  { id: "comment-demo-03", noteId: "65a2-demo-01", time: "2026-07-29 08:07", nickname: "Mona", content: "先收藏，晚上认真看。", authorId: "6351••••005", region: "上海" },
  { id: "comment-demo-04", noteId: "65a2-demo-03", time: "2026-07-29 11:40", nickname: "小满", content: "数据说话，比空泛建议实用。", authorId: "6617••••127", region: "浙江" },
];

const tabs = [
  { id: "search", label: "搜索笔记", icon: IconSearch },
  { id: "author", label: "作者笔记", icon: IconUserCircle },
  { id: "comments", label: "笔记评论", icon: IconMessageCircle },
  { id: "safe", label: "自动化", icon: IconPlayerPlay },
];

const QUEUE_STORAGE_KEY = "xhs-collector-task-queues-v1";
const WORKSPACES_STORAGE_KEY = "xhs-collector-workspaces-v2";
const ACCOUNT_CACHE_STORAGE_KEY = "xhs-collector-account-cache-v2";
const FALLBACK_ACCOUNT_ID = "current-browser";
const HOME_URL = "https://www.xiaohongshu.com/";
const PROFILE_URL = "https://www.xiaohongshu.com/user/profile/";
const EXPLORE_URL = "https://www.xiaohongshu.com/explore/";
const sleep = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

function callDesktop(method, accountId, ...args) {
  const desktop = globalThis.collectorDesktop;
  if (typeof desktop?.[method] !== "function") throw new Error(`桌面端暂不支持 ${method}`);
  // The multi-account preload exposes `accounts`; keep the legacy signature usable
  // for older desktop shells and local visual checks.
  return desktop.accounts ? desktop[method](accountId, ...args) : desktop[method](...args);
}

function resolveEventAccountId(payload, fallbackId, accountCount) {
  const explicit = payload?.accountId || payload?.account?.id;
  if (explicit) return explicit;
  return accountCount <= 1 ? fallbackId : "";
}

function loginPhaseOf(raw = {}) {
  if (raw.loggedIn === true || raw.authenticated === true) return "logged-in";
  if (raw.loggedIn === false || raw.authenticated === false) return "logged-out";
  const value = String(raw.loginState ?? raw.loginStatus ?? raw.status ?? raw.loginPhase ?? raw.phase ?? "").trim().toLowerCase();
  if (["logged-in", "logged_in", "loggedin", "authenticated", "signed-in", "signed_in", "已登录", "登录成功"].includes(value)) return "logged-in";
  if (["checking", "loading", "detecting", "检查中", "检测中", "登录中"].includes(value)) return "checking";
  if (["error", "failed", "异常", "失败"].includes(value)) return "error";
  if (["logged-out", "logged_out", "signed-out", "signed_out", "login-required", "login_required", "待登录", "未登录", "需要登录"].includes(value)) return "logged-out";
  return "unknown";
}

function loginPhaseLabel(account, desktopMode) {
  if (!desktopMode) return account?.extensionMode ? "当前浏览器" : "网页预览";
  return {
    "logged-in": "已登录",
    checking: "检查中",
    error: "状态异常",
    "logged-out": "待登录",
    unknown: "待确认",
  }[account?.loginPhase || "unknown"];
}

function normalizeAccount(raw, index = 0) {
  const id = String(raw?.id ?? raw?.accountId ?? raw?.partitionId ?? "");
  return {
    ...raw,
    id,
    platform: platformOf(raw),
    name: String(raw?.displayName ?? raw?.name ?? raw?.profileName ?? raw?.nickname ?? raw?.label ?? `账号 ${index + 1}`),
    nickname: String(raw?.profileName ?? raw?.nickname ?? raw?.displayName ?? ""),
    avatarUrl: raw?.avatarUrl ?? raw?.avatar ?? "",
    loginPhase: loginPhaseOf(raw),
  };
}

function normalizeAccountsPayload(payload, fallbackActiveId = "") {
  const source = Array.isArray(payload) ? payload : (payload?.accounts ?? payload?.items ?? payload?.list ?? []);
  const accounts = source.map(normalizeAccount).filter((account) => account.id);
  const activeAccountId = String(payload?.activeAccountId ?? payload?.activeId ?? accounts.find((account) => account.active)?.id ?? fallbackActiveId ?? accounts[0]?.id ?? "");
  return { accounts, activeAccountId };
}

function fallbackAccount(extensionMode) {
  return {
    id: FALLBACK_ACCOUNT_ID,
    name: extensionMode ? "当前浏览器" : "预览账号",
    nickname: "",
    avatarUrl: "",
    loginPhase: "unknown",
    extensionMode,
  };
}

function finiteNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function optionalNumber(value) {
  if (value == null || (typeof value === "string" && !value.trim())) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeRect(rect = {}) {
  const left = finiteNumber(rect.left, finiteNumber(rect.x, 0));
  const top = finiteNumber(rect.top, finiteNumber(rect.y, 0));
  const right = finiteNumber(rect.right, left + Math.max(0, finiteNumber(rect.width, 0)));
  const bottom = finiteNumber(rect.bottom, top + Math.max(0, finiteNumber(rect.height, 0)));
  return { left, top, right, bottom };
}

function clampBrowserBounds(previewRect, paneRect, viewport = {}) {
  const preview = normalizeRect(previewRect);
  const pane = normalizeRect(paneRect ?? previewRect);
  const viewportWidth = Math.max(0, finiteNumber(viewport.width, Number.POSITIVE_INFINITY));
  const viewportHeight = Math.max(0, finiteNumber(viewport.height, Number.POSITIVE_INFINITY));
  const left = Math.ceil(Math.max(0, preview.left, pane.left));
  const top = Math.ceil(Math.max(0, preview.top, pane.top));
  const right = Math.floor(Math.min(viewportWidth, preview.right, pane.right));
  const bottom = Math.floor(Math.min(viewportHeight, preview.bottom, pane.bottom));
  if (right <= left || bottom <= top) return { x: 0, y: 0, width: 1, height: 1 };
  return { x: left, y: top, width: right - left, height: bottom - top };
}

const DASHBOARD_CAPTURE_LABELS = {
  notes: "搜索笔记采集中",
  author: "作者笔记采集中",
  comments: "笔记评论采集中",
};

const DASHBOARD_CAPTURE_TABS = {
  notes: "search",
  author: "author",
  comments: "comments",
};

function dashboardCount(value) {
  return Math.max(0, Math.floor(Number.isFinite(Number(value)) ? Number(value) : 0));
}

function dashboardCapture(capture = {}) {
  const collected = dashboardCount(capture.collected);
  const target = dashboardCount(capture.target);
  return {
    collected,
    target,
    percent: target > 0 ? Math.min(100, Math.round((collected / target) * 100)) : 0,
  };
}

function dashboardPageLabel(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "等待打开小红书页面";
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return "等待打开小红书页面";
  }
}

function completedOperationCount(tasks) {
  return tasks.filter((task) => /^已完成(?:\s|$)/.test(String(task?.status || ""))).length;
}

function failedOperationCount(tasks) {
  return tasks.filter((task) => /失败/.test(String(task?.status || ""))).length;
}

function dashboardRow(account = {}, workspace = {}, runtime = {}) {
  const capture = dashboardCapture(account.capture);
  const captureActive = Boolean(account.capture?.active);
  const queueRunning = Boolean(workspace.operation?.running);
  const operationActive = Boolean(account.operationActive);
  const pageCrashed = Boolean(account.crashed);
  const runtimeFailed = runtime.phase === "error";
  const operationTasks = Array.isArray(workspace.operationTasks) ? workspace.operationTasks : [];
  const commentTasks = Array.isArray(workspace.commentTasks) ? workspace.commentTasks : [];
  let state = "idle";
  let stateLabel = "空闲";

  if (pageCrashed || runtimeFailed) {
    state = "error";
    stateLabel = pageCrashed ? "页面异常" : "任务异常";
  } else if (queueRunning) {
    state = "queue";
    stateLabel = operationActive ? "自动化操作中" : "自动化队列等待中";
  } else if (captureActive) {
    state = "capture";
    stateLabel = account.platform === "douyin" && account.capture?.kind === "comments"
      ? "视频评论采集中" : DASHBOARD_CAPTURE_LABELS[account.capture?.kind] || "采集中";
  } else if (operationActive) {
    state = "operation";
    stateLabel = "笔记操作中";
  } else if (account.loading) {
    state = "loading";
    stateLabel = "页面加载中";
  }

  const targetTab = queueRunning || operationActive
    ? "safe"
    : DASHBOARD_CAPTURE_TABS[account.capture?.kind] || workspace.ui?.activeTab || "search";

  return {
    id: String(account.id || account.accountId || ""),
    name: String(account.name || "未命名账号"),
    nickname: String(account.profileName || account.nickname || ""),
    avatarUrl: account.avatarUrl || "",
    loginPhase: account.loginPhase || "unknown",
    active: Boolean(account.active),
    state,
    stateLabel,
    runtimeMessage: String(runtime.message || ""),
    capture,
    captureActive,
    canStopCapture: captureActive,
    operationActive,
    queueRunning,
    notesCount: Array.isArray(workspace.notes) ? workspace.notes.length : 0,
    commentsCount: Array.isArray(workspace.comments) ? workspace.comments.length : 0,
    commentQueueCount: commentTasks.length,
    operationQueueCount: operationTasks.length,
    operationCompletedCount: completedOperationCount(operationTasks),
    operationFailedCount: failedOperationCount(operationTasks),
    updatedAt: dashboardCount(workspace.stats?.updatedAt),
    pageLabel: dashboardPageLabel(account.url || workspace.ui?.currentUrl),
    targetTab,
  };
}

function dashboardRows(accounts = [], workspaces = {}, runtimeStatuses = {}) {
  return accounts
    .filter((account) => account?.id)
    .map((account) => dashboardRow(account, workspaces[account.id] || {}, runtimeStatuses[account.id] || {}));
}

function dashboardSummary(rows = []) {
  return {
    total: rows.length,
    loggedIn: rows.filter((row) => row.loginPhase === "logged-in").length,
    collecting: rows.filter((row) => row.captureActive).length,
    queueRunning: rows.filter((row) => row.queueRunning || row.operationActive).length,
    errors: rows.filter((row) => row.state === "error").length,
  };
}

function dashboardUpdatedAt(value, now = Date.now()) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "暂无采集结果";
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 10) return "刚刚更新";
  if (seconds < 60) return `${seconds} 秒前更新`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前更新`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} 小时前更新` : `${Math.floor(hours / 24)} 天前更新`;
}

function noteIdFromUrl(rawUrl) {
  try {
    const match = new URL(rawUrl).pathname.match(/\/(?:explore|discovery\/item)\/([a-f\d]{24})/i);
    return match?.[1] || "";
  } catch {
    return "";
  }
}

function asQueueTask(note) {
  return {
    id: note.id || noteIdFromUrl(note.link),
    title: note.title || "未命名笔记",
    author: note.author || "",
    link: note.link,
    platform: platformOf(note),
    selected: true,
    status: "待执行",
    likeStatus: "待执行",
    commentStatus: "待执行",
    collectStatus: "待执行",
    sentComment: "",
    elapsedSeconds: 0,
  };
}

function mergeQueue(previous, notes) {
  const incoming = notes.filter((note) => note?.link).map(asQueueTask);
  const merged = new Map(previous.map((task) => [task.id || task.link, task]));
  for (const task of incoming) {
    const key = task.id || task.link;
    const existing = merged.get(key);
    merged.set(key, existing ? { ...existing, title: task.title, author: task.author, link: task.link, selected: true } : task);
  }
  return Array.from(merged.values());
}

function commentIdentity(comment) {
  if (comment?.platform === "douyin" && comment.id) return ["douyin", comment.noteId, comment.id].join("\u0000");
  return [comment?.noteId, comment?.authorId || comment?.nickname, comment?.content]
    .map((value) => String(value || "").trim())
    .join("\u0000");
}

function mergeComments(previous, incoming, max = 10000) {
  const merged = new Map();
  for (const comment of [...(previous ?? []), ...(incoming ?? [])]) {
    const key = commentIdentity(comment);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, comment);
      continue;
    }
    const incomingHasSyntheticId = String(comment.id || "").startsWith("dom-comment-");
    const existingHasRealId = existing.id && !String(existing.id).startsWith("dom-comment-");
    merged.set(key, {
      ...existing,
      ...comment,
      id: incomingHasSyntheticId && existingHasRealId ? existing.id : (comment.id || existing.id),
      time: comment.time || existing.time,
      region: comment.region || existing.region,
      authorId: comment.authorId || existing.authorId,
      likes: comment.likes ?? existing.likes ?? null,
      replyCount: comment.replyCount ?? existing.replyCount ?? null,
    });
  }
  return Array.from(merged.values()).slice(-max);
}

function mergeNotes(previous, incoming, max = 5000) {
  const merged = new Map((previous ?? []).map((note) => {
    const normalized = normalizeNoteTime(note);
    return [normalized.id, normalized];
  }));
  for (const rawNote of incoming ?? []) {
    const note = normalizeNoteTime(rawNote);
    const existing = merged.get(note.id);
    merged.set(note.id, existing ? { ...existing, ...note, time: note.time || existing.time || "" } : note);
  }
  return Array.from(merged.values()).slice(-max);
}

function dedupeComments(rows) {
  return mergeComments([], rows, Number.MAX_SAFE_INTEGER);
}

function restoreOperationTask(task) {
  const normalizeActionStatus = (action, status) => {
    if (!status || status === "—" || status === "执行中") return "待执行";
    if (["已完成", "原本已完成"].includes(status)) {
      return { like: "已完成点赞", comment: "已完成评论", collect: "已完成收藏" }[action];
    }
    if (action === "comment" && status === "需页面确认" && task.sentComment) return "已完成评论";
    return status;
  };
  return {
    ...task,
    status: /^(正在执行|进行中)/.test(task.status || "") ? "待执行" : (task.status || "待执行"),
    likeStatus: normalizeActionStatus("like", task.likeStatus),
    commentStatus: normalizeActionStatus("comment", task.commentStatus),
    collectStatus: normalizeActionStatus("collect", task.collectStatus),
    elapsedSeconds: Math.max(0, Number(task.elapsedSeconds) || 0),
  };
}

const csvEscape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;

function downloadCsv(name, rows, columns) {
  const body = [columns.map((column) => csvEscape(column.label)).join(",")]
    .concat(rows.map((row) => columns.map((column) => csvEscape(row[column.key])).join(",")))
    .join("\n");
  const url = URL.createObjectURL(new Blob(["\ufeff", body], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function parseCsv(text) {
  const lines = text.replace(/^\ufeff/, "").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const parseLine = (line) => {
    const cells = [];
    let value = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"' && quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else if (char === '"') quoted = !quoted;
      else if (char === "," && !quoted) { cells.push(value); value = ""; }
      else value += char;
    }
    cells.push(value);
    return cells;
  };
  const headers = parseLine(lines[0]);
  return lines.slice(1).map((line) => Object.fromEntries(headers.map((header, index) => [header, parseLine(line)[index] ?? ""])));
}

function createDefaultWorkspace(realMode, platform = "xhs") {
  const empty = realMode || platform === "douyin";
  return {
    platform,
    notes: empty ? [] : demoNotes,
    comments: empty ? [] : demoComments,
    stats: { captures: 0, lastUrl: realMode ? "等待真实页面响应" : "演示数据", updatedAt: Date.now() },
    ui: { activeTab: platform === "douyin" ? "comments" : "search", keyword: platform === "douyin" ? "" : "创业", currentUrl: platformHome(platform), live: false, muted: true },
    search: { limit: 100, minLikes: 0, type: "全部", timeRange: "all", selectedIds: realMode ? [] : [demoNotes[3].id] },
    author: { url: PROFILE_URL, tasks: [], selectedIds: [], intervalSeconds: 3 },
    commentsPanel: { url: platform === "douyin" ? "" : EXPLORE_URL, region: "", contains: "", timeRange: "all", unique: true },
    operation: {
      url: EXPLORE_URL,
      commentText: "支持支持",
      likeEnabled: true,
      collectEnabled: true,
      commentEnabled: false,
      intervalMinutes: 5,
      intervalStatus: "",
      running: false,
    },
    commentTasks: [],
    operationTasks: [],
  };
}

function normalizeWorkspace(value, realMode) {
  const base = createDefaultWorkspace(realMode, platformOf(value));
  const workspace = value && typeof value === "object" ? value : {};
  return {
    ...base,
    ...workspace,
    notes: (Array.isArray(workspace.notes) ? workspace.notes : base.notes).map((note) => normalizeNoteTime(note)),
    comments: dedupeComments(Array.isArray(workspace.comments) ? workspace.comments : base.comments),
    stats: { ...base.stats, ...(workspace.stats ?? {}) },
    ui: { ...base.ui, ...(workspace.ui ?? {}), live: false },
    search: { ...base.search, ...(workspace.search ?? {}), selectedIds: Array.isArray(workspace.search?.selectedIds) ? workspace.search.selectedIds : base.search.selectedIds },
    author: { ...base.author, ...(workspace.author ?? {}), tasks: Array.isArray(workspace.author?.tasks) ? workspace.author.tasks : [], selectedIds: Array.isArray(workspace.author?.selectedIds) ? workspace.author.selectedIds : [] },
    commentsPanel: { ...base.commentsPanel, ...(workspace.commentsPanel ?? {}) },
    operation: { ...base.operation, ...(workspace.operation ?? {}), intervalStatus: "", running: false },
    commentTasks: (Array.isArray(workspace.commentTasks) ? workspace.commentTasks : []).map((task) => ({
      ...task,
      status: ["正在打开", "采集中", "监听中"].includes(task.status) ? "已停止" : task.status,
      runId: "",
    })),
    operationTasks: (Array.isArray(workspace.operationTasks) ? workspace.operationTasks : []).map(restoreOperationTask),
  };
}

function readStoredWorkspaces(realMode) {
  try {
    const parsed = JSON.parse(localStorage.getItem(WORKSPACES_STORAGE_KEY) || "{}");
    return Object.fromEntries(Object.entries(parsed).map(([accountId, workspace]) => [accountId, normalizeWorkspace(workspace, realMode)]));
  } catch {
    return {};
  }
}

function readLegacyWorkspace(realMode, desktopMode) {
  const base = createDefaultWorkspace(realMode);
  try {
    const dataKey = desktopMode ? "xhs-collector-desktop-v1" : "xhs-collector-demo";
    const parsed = JSON.parse(localStorage.getItem(dataKey) || "{}");
    const queues = JSON.parse(localStorage.getItem(QUEUE_STORAGE_KEY) || "{}");
    if (!parsed.notes && !parsed.comments && !queues.commentTasks && !queues.operationTasks) return null;
    return normalizeWorkspace({
      ...base,
      notes: parsed.notes ?? base.notes,
      comments: parsed.comments ?? base.comments,
      stats: parsed.stats ?? base.stats,
      commentTasks: queues.commentTasks ?? [],
      operationTasks: queues.operationTasks ?? [],
    }, realMode);
  } catch {
    return null;
  }
}

function useCollectorWorkspaces({ desktopMode, extensionMode, accounts, activeAccountId }) {
  const realMode = desktopMode || extensionMode;
  const [workspaces, setWorkspaces] = useState(() => readStoredWorkspaces(realMode));
  const activeAccountRef = useRef(activeAccountId);
  const accountsRef = useRef(accounts);
  const migrationAttemptedRef = useRef(false);

  useEffect(() => { activeAccountRef.current = activeAccountId; }, [activeAccountId]);
  useEffect(() => { accountsRef.current = accounts; }, [accounts]);

  const updateWorkspace = useCallback((accountId, updater) => {
    if (!accountId) return;
    setWorkspaces((previous) => {
      const current = previous[accountId] ?? createDefaultWorkspace(realMode, platformOf(accountsRef.current.find((account) => account.id === accountId)));
      const nextWorkspace = typeof updater === "function" ? updater(current) : { ...current, ...updater };
      if (nextWorkspace === current) return previous;
      return { ...previous, [accountId]: nextWorkspace };
    });
  }, [realMode]);

  useEffect(() => {
    const accountIds = accounts.map((account) => account.id).filter(Boolean);
    if (activeAccountId && !accountIds.includes(activeAccountId)) accountIds.unshift(activeAccountId);
    if (!accountIds.length) return;
    setWorkspaces((previous) => {
      let changed = false;
      const next = { ...previous };
      for (const [index, accountId] of accountIds.entries()) {
        if (next[accountId]) continue;
        const platform = platformOf(accounts.find((account) => account.id === accountId));
        const legacy = platform === "xhs" && !migrationAttemptedRef.current && index === 0 && !Object.keys(previous).length
          ? readLegacyWorkspace(realMode, desktopMode)
          : null;
        next[accountId] = legacy ?? createDefaultWorkspace(realMode, platform);
        changed = true;
      }
      migrationAttemptedRef.current = true;
      return changed ? next : previous;
    });
  }, [accounts, activeAccountId, desktopMode, realMode]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { localStorage.setItem(WORKSPACES_STORAGE_KEY, JSON.stringify(workspaces)); } catch { /* keep the live in-memory workspace */ }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [workspaces]);

  useEffect(() => {
    if (!desktopMode || typeof globalThis.collectorDesktop?.onCapture !== "function") return undefined;
    return globalThis.collectorDesktop.onCapture((payload = {}) => {
      const accountId = resolveEventAccountId(payload, activeAccountRef.current, accountsRef.current.length);
      // Multi-account events without an owner are discarded instead of contaminating
      // whichever account happens to be visible when the event arrives.
      if (!accountId || !String(payload.runId || "").trim() || payload.kind === "passive") return;
      const account = accountsRef.current.find((item) => item.id === accountId);
      if (!account || payload.platform && payload.platform !== platformOf(account)) return;
      updateWorkspace(accountId, (workspace) => {
        const notes = mergeNotes(workspace.notes, payload.notes, 5000);
        const comments = mergeComments(workspace.comments, payload.comments, 10000);
        return {
          ...workspace,
          notes,
          comments,
          stats: {
            ...workspace.stats,
            captures: Number(workspace.stats?.captures || 0) + 1,
            lastUrl: payload.url || workspace.stats?.lastUrl,
            updatedAt: payload.capturedAt || Date.now(),
            lastNotesAdded: payload.notes?.length ?? 0,
            lastCommentsAdded: payload.comments?.length ?? 0,
          },
        };
      });
    });
  }, [desktopMode, updateWorkspace]);

  useEffect(() => {
    if (!extensionMode || !activeAccountId) return undefined;
    const hydrate = (result) => updateWorkspace(activeAccountId, (workspace) => ({
      ...workspace,
      notes: (result.collectorNotes ?? []).map((note) => normalizeNoteTime(note)),
      comments: dedupeComments(result.collectorComments ?? []),
      stats: result.captureStats ?? { captures: 0 },
    }));
    chrome.storage.local.get(["collectorNotes", "collectorComments", "captureStats"], hydrate);
    const listener = (changes, area) => {
      if (area !== "local") return;
      updateWorkspace(activeAccountId, (workspace) => ({
        ...workspace,
        notes: changes.collectorNotes ? (changes.collectorNotes.newValue ?? []).map((note) => normalizeNoteTime(note)) : workspace.notes,
        comments: changes.collectorComments ? dedupeComments(changes.collectorComments.newValue ?? []) : workspace.comments,
        stats: changes.captureStats ? (changes.captureStats.newValue ?? {}) : workspace.stats,
      }));
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [activeAccountId, extensionMode, updateWorkspace]);

  const platform = platformOf(accounts.find((account) => account.id === activeAccountId));
  const workspace = workspaces[activeAccountId] ?? createDefaultWorkspace(realMode, platform);
  const setNotes = useCallback((value) => updateWorkspace(activeAccountId, (current) => ({
    ...current,
    notes: typeof value === "function" ? value(current.notes) : value,
  })), [activeAccountId, updateWorkspace]);
  const setComments = useCallback((value) => updateWorkspace(activeAccountId, (current) => ({
    ...current,
    comments: typeof value === "function" ? value(current.comments) : value,
  })), [activeAccountId, updateWorkspace]);
  const save = useCallback(async (nextNotes = workspace.notes, nextComments = workspace.comments) => {
    updateWorkspace(activeAccountId, (current) => ({ ...current, notes: nextNotes, comments: nextComments }));
    if (extensionMode) await chrome.storage.local.set({ collectorNotes: nextNotes, collectorComments: nextComments });
  }, [activeAccountId, extensionMode, updateWorkspace, workspace.comments, workspace.notes]);
  const clearNotes = useCallback(async () => {
    updateWorkspace(activeAccountId, (current) => ({ ...current, notes: [] }));
    if (extensionMode) await chrome.storage.local.set({ collectorNotes: [] });
  }, [activeAccountId, extensionMode, updateWorkspace]);
  const clearComments = useCallback(async () => {
    updateWorkspace(activeAccountId, (current) => ({ ...current, comments: [] }));
    if (extensionMode) await chrome.storage.local.set({ collectorComments: [] });
  }, [activeAccountId, extensionMode, updateWorkspace]);
  const removeWorkspace = useCallback((accountId) => {
    setWorkspaces((previous) => {
      if (!previous[accountId]) return previous;
      const next = { ...previous };
      delete next[accountId];
      return next;
    });
  }, []);

  const deleteCommentCard = useCallback(async (noteId = null) => {
    if (extensionMode) {
      const stored = await chrome.storage.local.get(["collectorComments"]);
      const next = removeCommentCards({ comments: stored.collectorComments ?? [] }, noteId);
      await chrome.storage.local.set({ collectorComments: next.comments });
    }
    updateWorkspace(activeAccountId, (current) => removeCommentCards(current, noteId));
  }, [activeAccountId, extensionMode, updateWorkspace]);

  return {
    workspaces,
    workspace,
    updateWorkspace,
    removeWorkspace,
    data: {
      desktopMode,
      extensionMode,
      realMode,
      platform,
      notes: workspace.notes,
      comments: workspace.comments,
      stats: workspace.stats,
      setNotes,
      setComments,
      save,
      clearNotes,
      clearComments,
      deleteCommentCard,
    },
  };
}

function StatusDot({ active, phase = "unknown" }) {
  return <span className={`status-dot ${active ? "active" : ""} phase-${phase}`} aria-hidden="true" />;
}

function ActionMenu({ children }) {
  const ref = useRef(null);
  useEffect(() => {
    const closeOutside = (event) => {
      if (!ref.current?.contains(event.target)) ref.current?.removeAttribute("open");
    };
    const closeOnEscape = (event) => {
      if (event.key !== "Escape" || !ref.current?.open) return;
      ref.current.removeAttribute("open");
      ref.current.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);
  return (
    <details className="action-menu" ref={ref}>
      <summary className="button" title="更多操作"><IconDots size={16} aria-hidden="true" /><span>更多</span><IconChevronDown size={12} aria-hidden="true" /></summary>
      <div className="action-menu-items" onClick={(event) => {
        const button = event.target.closest("button");
        if (button && !button.disabled) {
          ref.current.removeAttribute("open");
          ref.current.querySelector("summary")?.focus();
        }
      }}>{children}</div>
    </details>
  );
}

function AccountBar({ accounts, activeAccountId, desktopMode, dashboardOpen, onDashboardToggle, onSwitch, onAdd, onRename, onRemove, onRefresh, onSettings }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const activeAccount = accounts.find((account) => account.id === activeAccountId) ?? accounts[0];

  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = () => setMenuOpen(false);
    const onKeyDown = (event) => { if (event.key === "Escape") close(); };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", close);
    };
  }, [menuOpen]);

  return (
    <div className="account-bar" aria-label="小红书账号">
      <span className="account-bar-label">账号</span>
      <div className="account-scroll" role="tablist" aria-label="已创建账号">
        {accounts.map((account) => {
          const active = account.id === activeAccountId;
          const phaseLabel = loginPhaseLabel(account, desktopMode);
          const identityLabel = account.nickname && account.nickname !== account.name ? `${account.nickname} · ${phaseLabel}` : phaseLabel;
          const detailLabel = account.platform === "douyin" ? `抖音 · ${identityLabel}` : identityLabel;
          return (
            <button
              className={`account-chip ${active ? "active" : ""}`}
              key={account.id}
              type="button"
              role="tab"
              aria-selected={active}
              title={`${account.name} · ${detailLabel}`}
              onClick={() => onSwitch(account.id)}
            >
              {account.avatarUrl
                ? <img src={account.avatarUrl} alt="" />
                : <IconUserCircle size={19} stroke={1.7} aria-hidden="true" />}
              <span className="account-chip-copy"><strong>{account.name}</strong><small>{detailLabel}</small></span>
              <StatusDot phase={account.loginPhase} active={account.loginPhase === "logged-in"} />
            </button>
          );
        })}
        {!accounts.length && <span className="account-empty">还没有账号</span>}
      </div>
      <button
        className={`account-dashboard-toggle ${dashboardOpen ? "active" : ""}`}
        type="button"
        aria-pressed={dashboardOpen}
        aria-current={dashboardOpen ? "page" : undefined}
        aria-controls="data-dashboard"
        onClick={onDashboardToggle}
        title={dashboardOpen ? "隐藏数据看板" : "显示数据看板"}
      >
        <IconChartBar size={17} stroke={1.9} /> <span>数据看板</span>
      </button>
      <button className="account-add" type="button" disabled={!desktopMode} onClick={onAdd} title={desktopMode ? "创建独立登录账号" : "多账号登录仅在桌面版可用"}>
        <IconPlus size={17} stroke={2} /> <span>添加账号</span>
      </button>
      <div className="account-menu-wrap" onPointerDown={(event) => event.stopPropagation()}>
        <button className="account-manage" type="button" aria-label="管理当前账号" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
          <IconDots size={18} stroke={2} />
        </button>
        {menuOpen && (
          <div className="account-menu" role="menu">
            {activeAccount && <div className="account-menu-summary">
              <span className="account-menu-avatar">{activeAccount.avatarUrl ? <img src={activeAccount.avatarUrl} alt="" /> : <IconUserCircle size={24} stroke={1.6} />}</span>
              <span><strong>{activeAccount.name}</strong><small><StatusDot phase={activeAccount.loginPhase} active={activeAccount.loginPhase === "logged-in"} />{loginPhaseLabel(activeAccount, desktopMode)}</small></span>
            </div>}
            <button disabled={!desktopMode || !activeAccount} role="menuitem" type="button" onClick={() => { setMenuOpen(false); onRefresh(activeAccount); }}><IconLogin2 size={16} />检查登录状态</button>
            <button disabled={!desktopMode || !activeAccount} role="menuitem" type="button" onClick={() => { setMenuOpen(false); onRename(activeAccount); }}><IconPencil size={16} />重命名账号</button>
            <button role="menuitem" type="button" onClick={() => { setMenuOpen(false); onSettings(); }}><IconSettings size={16} />设置</button>
            <span className="context-separator" />
            <button disabled={!desktopMode || !activeAccount} className="danger" role="menuitem" type="button" onClick={() => { setMenuOpen(false); onRemove(activeAccount); }}><IconTrash size={16} />移除账号</button>
          </div>
        )}
      </div>
    </div>
  );
}

function AccountsDashboard({ rows, summary, desktopMode, onOpenAccount, onOpenData, onRefresh, onStopCapture }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <section className="accounts-dashboard" id="all-accounts-dashboard" aria-labelledby="accounts-dashboard-title">
      <header className="dashboard-heading">
        <div>
          <span className="dashboard-eyebrow">实时总览</span>
          <h2 id="accounts-dashboard-title">全部账号采集进度</h2>
          <p>切换查看不会中断其他账号正在运行的任务。</p>
        </div>
        <div
          className="dashboard-summary"
          aria-live="polite"
          aria-label={`共 ${summary.total} 个账号，${summary.loggedIn} 个已登录，${summary.collecting} 个采集中，${summary.queueRunning} 个自动化队列运行中，${summary.errors} 个异常`}
        >
          <span><strong>{summary.total}</strong><small>全部账号</small></span>
          <span><strong>{summary.loggedIn}</strong><small>已登录</small></span>
          <span className="collecting"><strong>{summary.collecting}</strong><small>采集中</small></span>
          <span className="operating"><strong>{summary.queueRunning}</strong><small>自动化中</small></span>
          <span className={summary.errors ? "error" : ""}><strong>{summary.errors}</strong><small>异常</small></span>
        </div>
      </header>

      <div className="dashboard-card-grid">
        {rows.map((row) => {
          const phaseLabel = loginPhaseLabel({ loginPhase: row.loginPhase }, desktopMode);
          const running = row.captureActive || row.queueRunning || row.operationActive;
          return (
            <article
              className={`dashboard-account-card state-${row.state} ${row.active ? "current" : ""}`}
              aria-label={`${row.name}，${phaseLabel}，${row.stateLabel}`}
              key={row.id}
            >
              <div className="dashboard-card-head">
                <span className="dashboard-avatar">
                  {row.avatarUrl ? <img src={row.avatarUrl} alt="" /> : <IconUserCircle size={25} stroke={1.5} />}
                </span>
                <span className="dashboard-account-name">
                  <span className="dashboard-account-title-row">
                    <strong title={row.name}>{row.name}</strong>
                    <button
                      className="dashboard-login-check"
                      type="button"
                      disabled={!desktopMode}
                      onClick={() => onRefresh(row.id)}
                      title="检查登录"
                      aria-label={`检查 ${row.name} 的登录状态`}
                    >
                      <IconLogin2 size={14} stroke={1.8} />
                    </button>
                  </span>
                  <small>{row.nickname && row.nickname !== row.name ? row.nickname : phaseLabel}</small>
                </span>
                {row.active && <span className="current-account-pill">当前</span>}
                <span className={`dashboard-state state-${row.state}`}>
                  <StatusDot active={running} phase={row.state === "error" ? "error" : running ? "running" : row.loginPhase} />
                  {row.stateLabel}
                </span>
              </div>

              <div className="dashboard-progress-block">
                <div className="dashboard-progress-copy">
                  <strong>{row.captureActive || row.queueRunning ? row.stateLabel : "当前无采集任务"}</strong>
                  <span>{row.captureActive ? `${row.capture.collected} / ${row.capture.target}` : row.queueRunning ? `${row.operationCompletedCount} / ${row.operationQueueCount} 条操作` : "—"}</span>
                </div>
                <div
                  className="dashboard-progress-track"
                  role="progressbar"
                  aria-label={`${row.name}采集进度`}
                  aria-valuemin="0"
                  aria-valuemax="100"
                  aria-valuenow={row.captureActive ? row.capture.percent : 0}
                >
                  <span style={{ width: `${row.captureActive ? row.capture.percent : 0}%` }} />
                </div>
                {row.runtimeMessage && <p className="dashboard-runtime-message" title={row.runtimeMessage}>{row.runtimeMessage}</p>}
              </div>

              <dl className="dashboard-metrics">
                <div><dt>笔记结果</dt><dd>{row.notesCount}</dd></div>
                <div><dt>评论结果</dt><dd>{row.commentsCount}</dd></div>
                <div><dt>评论队列</dt><dd>{row.commentQueueCount}</dd></div>
                <div><dt>操作队列</dt><dd>{row.operationCompletedCount}/{row.operationQueueCount}</dd></div>
              </dl>

              <div className="dashboard-page-row">
                <span title={row.pageLabel}>{row.pageLabel}</span>
                <small>{dashboardUpdatedAt(row.updatedAt, now)}</small>
              </div>

              <div className="dashboard-card-actions">
                <button className="button primary" type="button" onClick={() => onOpenAccount(row.id, row.targetTab)}>打开账号</button>
                {row.canStopCapture && <button className="button" type="button" onClick={() => onStopCapture(row.id)}>停止采集</button>}
                <button className="button" type="button" onClick={() => onOpenData(row.id)}>查看数据</button>
              </div>
            </article>
          );
        })}
        {!rows.length && (
          <div className="dashboard-empty">
            <IconUserCircle size={34} stroke={1.4} />
            <strong>还没有账号</strong>
            <span>添加账号后，这里会显示每个账号的实时采集进度。</span>
          </div>
        )}
      </div>
    </section>
  );
}

function AccountDialog({ dialog, busy, onCancel, onSubmit }) {
  const [value, setValue] = useState(dialog.mode === "rename" ? dialog.account?.name ?? "" : dialog.suggestedName ?? "");
  const [platform, setPlatform] = useState("xhs");
  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === "Escape" && !busy) onCancel(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onCancel]);

  const deleting = dialog.mode === "remove";
  const title = deleting ? "移除账号" : dialog.mode === "rename" ? "重命名账号" : "添加账号";
  const submit = (event) => {
    event.preventDefault();
    if (!deleting && !value.trim()) return;
    onSubmit(value.trim(), platform);
  };
  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
      <form className="account-dialog" role="dialog" aria-modal="true" aria-labelledby="account-dialog-title" onSubmit={submit}>
        <button className="dialog-close" type="button" aria-label="关闭" disabled={busy} onClick={onCancel}><IconX size={18} /></button>
        <h2 id="account-dialog-title">{title}</h2>
        {deleting ? (
          <p>确认移除“{dialog.account?.name}”吗？该账号的独立登录会话、本地采集结果和任务队列都会被清除，其他账号不受影响。</p>
        ) : (
          <>
            <p>{dialog.mode === "add" ? "将创建独立登录空间，其他账号不受影响。" : "仅修改本机账号名称。"}</p>
            {dialog.mode === "add" && <label>平台<select aria-label="账号平台" value={platform} disabled={busy} onChange={(event) => setPlatform(event.target.value)}><option value="xhs">小红书</option><option value="douyin">抖音 · 视频评论</option></select></label>}
            <label>账号名称<input autoFocus disabled={busy} maxLength="24" value={value} onChange={(event) => setValue(event.target.value)} placeholder="例如：品牌主账号" /></label>
          </>
        )}
        <div className="dialog-actions">
          <button className="button" type="button" disabled={busy} onClick={onCancel}>取消</button>
          <button className={`button ${deleting ? "danger" : "primary"}`} type="submit" disabled={busy || (!deleting && !value.trim())}>{busy ? "处理中…" : deleting ? "确认移除" : "确认"}</button>
        </div>
      </form>
    </div>
  );
}

function BrowserPane({ account, keyword, currentUrl, live, muted, extensionMode, desktopMode, onHome, onReload, onMuted }) {
  const site = platformLabel(account);
  const browserMode = desktopMode ? "桌面浏览器" : extensionMode ? "当前浏览器" : "不可采集";
  const accountLabel = account?.name || (extensionMode ? "当前浏览器" : "预览账号");
  return (
    <section className="browser-pane" aria-label="浏览器预览">
      <div className="browser-toolbar">
        <span className="browser-label" title={`${accountLabel} · ${browserMode}`}><StatusDot active={live || account?.loginPhase === "logged-in"} phase={live ? "running" : account?.loginPhase} /><span>{desktopMode ? site : "网页预览"}</span><em>{!desktopMode && !extensionMode ? "演示" : ""}</em></span>
        <div className="browser-actions">
          <button type="button" className="icon-button" onClick={onHome} title={`返回${site}首页`} aria-label={`返回${site}首页`}><IconHome size={16} stroke={1.8} /></button>
          <label className="mute-check"><input type="checkbox" checked={muted} onChange={(event) => onMuted(event.target.checked)} /><IconVolume size={15} stroke={1.8} /> 静音</label>
          <div className="address-field" title={currentUrl}>{currentUrl}</div>
          <button type="button" className="icon-button" onClick={onReload} title="刷新嵌入页面" aria-label="刷新嵌入页面"><IconRefresh size={16} stroke={1.8} /></button>
        </div>
      </div>
      <div className={`browser-preview ${desktopMode ? "desktop-live" : ""}`}>
        {account?.platform !== "douyin" && <img src={`${import.meta.env.BASE_URL}assets/xhs-preview-apricot.png`} alt="杏桃柔和分区设计中的小红书内容预览" />}
        <div className="preview-caption">
          <strong>{account?.platform === "douyin" ? "抖音" : keyword || "创业"}</strong>
          <span>{desktopMode ? `真实${site}页面正在载入` : extensionMode ? "真实页面在当前 Chrome 标签中打开" : "网页预览不具备采集权限，请运行桌面版"}</span>
        </div>
      </div>
      <div className="browser-foot">
        <span>{desktopMode ? "可直接登录、搜索、点击和滚动" : "仅桌面版可操作真实网页"}</span>
        <span>{desktopMode ? "实时响应监听已启用" : "不会从演示页伪造数据"}</span>
      </div>
    </section>
  );
}

function NoteContextMenu({ menu, rows, selected, onClose, onSelectAll, onClearSelection, onQueueComments, onQueueOperations }) {
  useEffect(() => {
    if (!menu) return undefined;
    const close = () => onClose();
    const onKeyDown = (event) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", close);
    };
  }, [menu, onClose]);

  if (!menu) return null;
  const checked = rows.filter((row) => selected.has(row.id));
  const run = (callback) => (event) => {
    event.stopPropagation();
    callback();
    onClose();
  };
  const width = 224;
  const height = 208;
  const left = Math.min(menu.x, window.innerWidth - width - 8);
  const top = Math.min(menu.y, window.innerHeight - height - 8);
  return (
    <div className="context-menu" role="menu" style={{ left, top }} onPointerDown={(event) => event.stopPropagation()}>
      <button role="menuitem" type="button" onClick={run(onSelectAll)}>全选</button>
      <button role="menuitem" type="button" onClick={run(onClearSelection)}>取消选择</button>
      <span className="context-separator" />
      <button role="menuitem" type="button" onClick={run(() => onQueueComments?.([menu.row]))}>添加此条到笔记评论</button>
      <button role="menuitem" type="button" disabled={!checked.length} onClick={run(() => onQueueComments?.(checked))}>添加勾选到笔记评论</button>
      <span className="context-separator" />
      <button role="menuitem" type="button" onClick={run(() => onQueueOperations?.([menu.row]))}>添加此条到自动化</button>
      <button role="menuitem" type="button" disabled={!checked.length} onClick={run(() => onQueueOperations?.(checked))}>添加勾选到自动化</button>
    </div>
  );
}

function NotesTable({ rows, selected, setSelected, onOpenLink, onQueueComments, onQueueOperations, onCollectComments, commentStarting, activeCommentNoteId, commentCollectionIndex, onViewComments }) {
  const [menu, setMenu] = useState(null);
  const toggleAll = (checked) => setSelected(checked ? new Set(rows.map((row) => row.id)) : new Set());
  return (
    <>
      <div className="table-wrap">
        <table className="notes-table">
          <thead>
            <tr>
              <th className="check"><input aria-label="全选" type="checkbox" checked={rows.length > 0 && rows.every((row) => selected.has(row.id))} onChange={(event) => toggleAll(event.target.checked)} /></th>
              <th className="number">序号</th><th className="author-col">作者</th><th className="title-col">标题</th><th className="comment-action-col">评论</th><th className="link-col">链接</th><th className="likes">点赞</th><th className="type">类型</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const collection = commentCollectionState(row, commentCollectionIndex, { starting: commentStarting, activeNoteId: activeCommentNoteId });
              const collected = collection.kind === "collected";
              return <tr
                key={row.id}
                className={selected.has(row.id) ? "selected" : ""}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setMenu({ row, x: event.clientX, y: event.clientY });
                }}
              >
                <td className="check"><input aria-label={`选择 ${row.title}`} type="checkbox" checked={selected.has(row.id)} onChange={(event) => setSelected((previous) => { const next = new Set(previous); event.target.checked ? next.add(row.id) : next.delete(row.id); return next; })} /></td>
                <td className="number">{index + 1}</td><td title={row.author}>{row.author}</td><td className="note-title" title={row.title}>{row.title}</td>
                <td className="comment-action-col"><button className={`button quiet compact is-${collection.kind}`} type="button" disabled={Boolean(commentStarting) || collection.kind === "collecting"}
                  aria-label={`${collected ? "查看评论" : collection.label}：${row.title}`}
                  title={collected ? `已采集 ${collection.count.toLocaleString()} 条评论，点击查看` : collection.kind === "failed" || collection.kind === "stopped" ? `${collection.label}，点击重新采集` : collection.label}
                  onClick={() => collected ? onViewComments(row) : onCollectComments(row)}>
                  {collected ? <IconCircleCheck size={14} aria-hidden="true" /> : <IconMessageCircle size={14} aria-hidden="true" />}{collection.label}
                </button></td>
                <td className="link-col"><a className="note-link" href={row.link} target="_blank" rel="noreferrer" title={row.link} aria-label={`打开笔记：${row.title}`} onClick={(event) => onOpenLink?.(event, row)}><IconExternalLink size={16} aria-hidden="true" /></a></td><td className="likes">{row.likes}</td><td className="type">{row.type}</td>
              </tr>;
            })}
            {!rows.length && <tr><td className="empty" colSpan="8">还没有符合条件的数据</td></tr>}
          </tbody>
        </table>
      </div>
      <NoteContextMenu
        menu={menu}
        rows={rows}
        selected={selected}
        onClose={() => setMenu(null)}
        onSelectAll={() => toggleAll(true)}
        onClearSelection={() => toggleAll(false)}
        onQueueComments={onQueueComments}
        onQueueOperations={onQueueOperations}
      />
    </>
  );
}

function SearchPanel({ accountId, accountName, capture, data, state, setState, keyword, setKeyword, setCurrentUrl, live, setLive, notify, openNote, onQueueComments, onQueueOperations, onCollectComments, commentStarting, activeCommentNoteId, commentCollectionIndex, onViewComments }) {
  const { limit = 100, minLikes = 0, type = "全部", timeRange = "all" } = state;
  const searchCapture = capture?.kind === "notes" ? capture : null;
  const collectionActive = data.desktopMode ? Boolean(searchCapture?.active) : live;
  const capturedThisRun = Math.max(0, Math.floor(Number(searchCapture?.collected) || 0));
  const captureTarget = Math.max(1, Math.floor(Number(searchCapture?.target) || Number(limit) || 100));
  const progressLabel = searchCapture ? `本轮 ${capturedThisRun} / ${captureTarget}` : "本轮尚未开始";
  const selected = useMemo(() => new Set(state.selectedIds ?? []), [state.selectedIds]);
  const setSelected = (value) => setState((current) => {
    const previous = new Set(current.selectedIds ?? []);
    const next = typeof value === "function" ? value(previous) : value;
    return { ...current, selectedIds: Array.from(next) };
  });
  const fileRef = useRef(null);
  const filtered = useMemo(() => data.notes.filter((note) => Number(note.likes) >= Number(minLikes)
    && (type === "全部" || note.type === type)
    && noteMatchesTimeRange(note, timeRange)).slice(0, limit), [data.notes, limit, minLikes, timeRange, type]);

  const openSearch = async () => {
    const target = Math.min(1000, Math.max(1, Math.floor(Number(limit) || 100)));
    const url = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keyword.trim() || "创业")}`;
    if (target !== limit) setState({ limit: target });
    setCurrentUrl(url);
    try {
      if (data.desktopMode) {
        await callDesktop("startTask", accountId, { kind: "notes", url, target });
        setLive(true);
        notify("真实搜索页已打开，正在监听响应并自动滚动。", "success");
      } else if (data.extensionMode) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) await chrome.tabs.update(tab.id, { url });
        setLive(true);
        notify("已打开搜索页；浏览和滚动时会记录已返回的笔记。", "success");
      } else notify("当前是网页演示，无法采集；请运行 npm run desktop。", "error");
    } catch (error) {
      setLive(false);
      notify(`启动失败：${error.message}`, "error");
    }
  };

  const stopSearch = async () => {
    try {
      if (data.desktopMode) await callDesktop("stopTask", accountId);
      setLive(false);
      notify("采集已停止。", "info");
    } catch (error) {
      notify(`停止失败：${error.message}`, "error");
    }
  };

  const removeSelected = async () => {
    const next = data.notes.filter((note) => !selected.has(note.id));
    data.setNotes(next); await data.save(next, data.comments); setSelected(new Set()); notify(`已删除 ${data.notes.length - next.length} 条。`);
  };

  const importRows = async (file) => {
    if (!file) return;
    const parsed = parseCsv(await file.text()).map((row, index) => ({
      id: row.ID || row.id || `import-${Date.now()}-${index}`, author: row.作者 || row.author || "未知作者", title: row.标题 || row.title || "",
      link: row.笔记链接 || row.link || "", likes: optionalNumber(row.点赞数 ?? row.likes), type: row.类型 || row.type || "笔记", time: row.发布时间 || row.time || "", source: "导入",
    }));
    const merged = Array.from(new Map([...data.notes, ...parsed].map((row) => [row.id || row.link, row])).values());
    data.setNotes(merged); await data.save(merged, data.comments); notify(`已导入 ${parsed.length} 条笔记。`, "success");
  };

  return (
    <div className="panel-body">
      <div className="control-grid search-controls">
        <fieldset>
          <legend>搜索采集</legend>
          <label>搜索词 <input value={keyword} onChange={(event) => setKeyword(event.target.value)} /></label>
          <label>数量 <input className="short" type="number" min="1" max="1000" value={limit} onChange={(event) => setState({ limit: Number(event.target.value) })} /></label>
          <button className="button primary" type="button" onClick={openSearch}><IconPlayerPlay size={16} aria-hidden="true" />{collectionActive ? "重新采集" : "采集笔记"}</button>
          {data.desktopMode && <button className="button" type="button" disabled={!collectionActive} onClick={stopSearch}>停止</button>}
          {searchCapture && <span className="count-hint" role="status">{progressLabel}</span>}
        </fieldset>
        <fieldset>
          <legend><IconFilter size={14} aria-hidden="true" />筛选</legend>
          <label>点赞 ≥ <input className="short" type="number" min="0" value={minLikes} onChange={(event) => setState({ minLikes: Number(event.target.value) })} /></label>
          <label>类型 <select value={type} onChange={(event) => setState({ type: event.target.value })}><option>全部</option><option>视频</option><option>笔记</option></select></label>
          <label>发布时间 <select aria-label="搜索笔记发布时间" value={timeRange} onChange={(event) => setState({ timeRange: event.target.value })}><option value="all">不限</option><option value="day">一天内</option><option value="week">一周内</option><option value="month">一月内</option><option value="half-year">半年内</option></select></label>
          <button className="icon-button filter-reset" type="button" title="重置筛选" aria-label="重置搜索筛选" onClick={() => setState({ minLikes: 0, type: "全部", timeRange: "all" })}><IconRefresh size={15} aria-hidden="true" /></button>
        </fieldset>
      </div>
      <div className="action-row">
        <strong className="result-count">{filtered.length} 条笔记<span> / 共 {data.notes.length} 条</span></strong>
        {selected.size > 0 && <span className="selection-count">已选 {selected.size}</span>}
        {filtered.some((note) => selected.has(note.id)) && <>
          <button className="button quiet" type="button" onClick={() => onQueueComments(filtered.filter((note) => selected.has(note.id)))}><IconMessageCircle size={15} aria-hidden="true" />采集评论</button>
          <button className="button quiet" type="button" onClick={() => onQueueOperations(filtered.filter((note) => selected.has(note.id)))}><IconPlus size={15} aria-hidden="true" />加入自动化</button>
        </>}
        <span className="spacer" />
        <button className="button" type="button" onClick={() => downloadCsv(`${accountName}-小红书笔记.csv`, filtered, [{ key: "author", label: "作者" }, { key: "title", label: "标题" }, { key: "link", label: "笔记链接" }, { key: "likes", label: "点赞数" }, { key: "type", label: "类型" }, { key: "time", label: "发布时间" }])}><IconDownload size={16} aria-hidden="true" />导出</button>
        <ActionMenu>
          <button type="button" onClick={() => fileRef.current?.click()}><IconUpload size={16} aria-hidden="true" />导入 CSV</button>
          <button type="button" disabled={!selected.size} onClick={removeSelected}><IconTrash size={16} aria-hidden="true" />删除选中</button>
          <button type="button" onClick={() => { data.clearNotes(); setSelected(new Set()); notify("笔记列表已清空。") }}><IconTrash size={16} aria-hidden="true" />清空列表</button>
        </ActionMenu>
        <input className="visually-hidden" ref={fileRef} type="file" accept=".csv,text/csv" onChange={(event) => importRows(event.target.files?.[0])} />
      </div>
      <NotesTable rows={filtered} selected={selected} setSelected={setSelected} onOpenLink={openNote} onQueueComments={onQueueComments} onQueueOperations={onQueueOperations} onCollectComments={onCollectComments} commentStarting={commentStarting} activeCommentNoteId={activeCommentNoteId} commentCollectionIndex={commentCollectionIndex} onViewComments={onViewComments} />
    </div>
  );
}

function AuthorPanel({ accountId, accountName, data, state, setState, setCurrentUrl, setLive, notify, openNote, onQueueComments, onQueueOperations, onCollectComments, commentStarting, activeCommentNoteId, commentCollectionIndex, onViewComments }) {
  const { url = PROFILE_URL, tasks = [], intervalSeconds = 3 } = state;
  const setTasks = (value) => setState((current) => ({ ...current, tasks: typeof value === "function" ? value(current.tasks ?? []) : value }));
  const authorNotes = data.notes.filter((note) => note.source === "作者");
  const selected = useMemo(() => new Set(state.selectedIds ?? []), [state.selectedIds]);
  const setSelected = (value) => setState((current) => {
    const previous = new Set(current.selectedIds ?? []);
    const next = typeof value === "function" ? value(previous) : value;
    return { ...current, selectedIds: Array.from(next) };
  });

  const addTask = () => {
    if (!/^https:\/\/www\.xiaohongshu\.com\/user\/profile\//.test(url)) { notify("请输入小红书作者主页链接。", "error"); return; }
    setTasks((previous) => previous.some((task) => task.url === url) ? previous : [...previous, { url, status: "待采集" }]);
    notify("作者链接已加入任务列表。", "success");
  };
  const removeTask = (task) => {
    setTasks((previous) => previous.filter((item) => item.url !== task.url));
    notify(["监听中", "正在打开"].includes(task.status) ? "作者链接已从列表删除；当前采集不会自动停止。" : "作者链接已从任务列表删除。", "success");
  };
  const start = async (task) => {
    setCurrentUrl(task.url); setLive(true);
    setTasks((previous) => previous.map((item) => item.url === task.url ? { ...item, status: "监听中" } : item));
    try {
      if (data.desktopMode) await callDesktop("startTask", accountId, { kind: "author", url: task.url, target: 500 });
      else if (data.extensionMode) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) await chrome.tabs.update(tab.id, { url: task.url });
      } else {
        setLive(false);
        notify("当前是网页演示，无法采集；请运行桌面版。", "error");
        return;
      }
      notify("真实作者主页已打开，正在采集已返回的公开笔记。", "success");
    } catch (error) {
      setLive(false);
      notify(`作者采集启动失败：${error.message}`, "error");
    }
  };
  return (
    <div className="panel-body">
      <div className="author-layout">
        <fieldset className="task-box"><legend>作者任务</legend>
          <div className="inline-form"><input aria-label="作者链接" value={url} onChange={(event) => setState({ url: event.target.value })} /><button className="button primary" onClick={addTask}><IconPlus size={16} aria-hidden="true" />添加作者</button></div>
          <div className="task-list">{tasks.length ? tasks.map((task, index) => <div className="task-item" key={task.url}><span>{index + 1}</span><code title={task.url}>{task.url}</code><b>{task.status}</b><button className="button compact task-delete-button" type="button" aria-label={`删除作者任务 ${index + 1}`} title="删除作者任务" onClick={() => removeTask(task)}><IconTrash size={14} /></button><button className="button compact primary" type="button" onClick={() => start(task)}>开始</button></div>) : <div className="empty-task">暂无作者任务</div>}</div>
        </fieldset>
        <fieldset className="backup-box"><legend>采集设置</legend>
          <label>翻页间隔 <input className="short" type="number" value={intervalSeconds} min="2" onChange={(event) => setState({ intervalSeconds: Number(event.target.value) })} /> 秒</label>
          <button className="button" onClick={() => notify("任务和结果已保存到本地浏览器。", "success")}>保存备份</button>
          <button className="button" onClick={() => setTasks([])}>清空任务</button>
          {data.desktopMode && <button className="button" onClick={() => { callDesktop("stopTask", accountId); setLive(false); }}>停止采集</button>}
        </fieldset>
      </div>
      <div className="action-row"><strong>作者笔记 <span className="selection-count">{authorNotes.length} 条</span></strong><span className="spacer" /><button className="button" onClick={() => downloadCsv(`${accountName}-作者笔记.csv`, authorNotes, [{ key: "author", label: "作者" }, { key: "title", label: "标题" }, { key: "link", label: "笔记链接" }, { key: "likes", label: "点赞数" }, { key: "type", label: "类型" }])}><IconDownload size={16} aria-hidden="true" />导出</button></div>
      <NotesTable rows={authorNotes} selected={selected} setSelected={setSelected} onOpenLink={openNote} onQueueComments={onQueueComments} onQueueOperations={onQueueOperations} onCollectComments={onCollectComments} commentStarting={commentStarting} activeCommentNoteId={activeCommentNoteId} commentCollectionIndex={commentCollectionIndex} onViewComments={onViewComments} />
    </div>
  );
}


function OperationPanel({ accountId, data, state, setState, tasks, setTasks, setCurrentUrl, setLive, notify, openNote }) {
  const {
    url = EXPLORE_URL,
    commentText = "支持支持",
    likeEnabled = true,
    collectEnabled = true,
    commentEnabled = false,
    intervalMinutes = 5,
    intervalStatus = "",
    running = false,
  } = state;
  const runtimesRef = useRef(new Map());
  const selectedTasks = tasks.filter((task) => task.selected);

  const runtimeFor = (id) => {
    if (!runtimesRef.current.has(id)) runtimesRef.current.set(id, { stop: false, timer: null });
    return runtimesRef.current.get(id);
  };

  useEffect(() => () => {
    for (const runtime of runtimesRef.current.values()) {
      runtime.stop = true;
      if (runtime.timer) window.clearInterval(runtime.timer);
    }
  }, []);

  const updateTask = (task, changes) => setTasks((previous) => previous.map((item) => (item.id || item.link) === (task.id || task.link) ? { ...item, ...changes } : item));
  const toggleTask = (task, checked) => updateTask(task, { selected: checked });
  const addManual = () => {
    if (!/^https:\/\/www\.xiaohongshu\.com\/(explore|discovery\/item)\//.test(url)) { notify("请输入小红书笔记链接。", "error"); return; }
    setTasks((previous) => mergeQueue(previous, [{ id: noteIdFromUrl(url), link: url, title: "手动添加的笔记" }]));
    notify("已加入自动化任务列表。", "success");
  };
  const removeSelected = () => {
    const count = selectedTasks.length;
    setTasks((previous) => previous.filter((task) => !task.selected));
    notify(count ? `已移除 ${count} 个操作任务。` : "请先勾选任务。", count ? "success" : "info");
  };
  const pauseBetweenTasks = async (milliseconds, runtime) => {
    const total = Math.max(0, Math.round(milliseconds));
    for (let elapsed = 0; elapsed < total && !runtime.stop; elapsed += 250) await sleep(Math.min(250, total - elapsed));
  };
  const start = async () => {
    if (!data.desktopMode) { notify("真实互动操作只在桌面版的嵌入页面中执行。", "error"); return; }
    if (!selectedTasks.length) { notify("请先勾选至少一个笔记任务。", "error"); return; }
    if (!likeEnabled && !collectEnabled && !commentEnabled) { notify("请至少启用一项操作。", "error"); return; }
    if (commentEnabled && Array.from(commentText.trim()).length < 2) { notify("启用评论时请至少填写 2 个字符，便于在正文中间加入句点和表情。", "error"); return; }

    const runtime = runtimeFor(accountId);
    runtime.stop = false;
    setState({ intervalStatus: "", running: true });
    setLive(true);
    const selectedKeys = new Set(selectedTasks.map((task) => task.id || task.link));
    setTasks((previous) => previous.map((task) => selectedKeys.has(task.id || task.link) ? {
      ...task,
      status: "待执行",
      likeStatus: likeEnabled ? "待执行" : "未启用",
      collectStatus: collectEnabled ? "待执行" : "未启用",
      commentStatus: commentEnabled ? "待执行" : "未启用",
      elapsedSeconds: 0,
    } : task));
    let completed = 0;
    for (let index = 0; index < selectedTasks.length; index += 1) {
      if (runtime.stop) break;
      const task = selectedTasks[index];
      const preparedComment = commentEnabled ? randomizeComment(commentText).text : "";
      const startedAt = Date.now();
      const readElapsed = () => Math.floor((Date.now() - startedAt) / 1000);
      updateTask(task, {
        status: taskTimingLabel("running", 0),
        likeStatus: likeEnabled ? "进行中" : "未启用",
        collectStatus: collectEnabled ? "进行中" : "未启用",
        commentStatus: commentEnabled ? "进行中" : "未启用",
        sentComment: preparedComment,
        elapsedSeconds: 0,
      });
      runtime.timer = window.setInterval(() => {
        const elapsedSeconds = readElapsed();
        updateTask(task, { status: taskTimingLabel("running", elapsedSeconds), elapsedSeconds });
      }, 1000);
      try {
        const result = await callDesktop("operateNote", accountId, {
          note: { id: task.id, link: task.link, title: task.title },
          actions: { like: likeEnabled, collect: collectEnabled, comment: preparedComment },
        });
        window.clearInterval(runtime.timer);
        runtime.timer = null;
        const outcomes = [
          ["like", result.actions?.like],
          ["collect", result.actions?.collect],
          ["comment", result.actions?.comment],
        ].filter(([, outcome]) => Boolean(outcome));
        const confirmed = outcomes.every(([action, outcome]) => isActionComplete(action, outcome));
        const elapsedSeconds = readElapsed();
        updateTask(task, {
          status: taskTimingLabel(confirmed ? "completed" : "unconfirmed", elapsedSeconds),
          likeStatus: actionResultLabel("like", result.actions?.like),
          collectStatus: actionResultLabel("collect", result.actions?.collect),
          commentStatus: actionResultLabel("comment", result.actions?.comment),
          elapsedSeconds,
        });
        setCurrentUrl(result.url);
        completed += 1;
      } catch (error) {
        window.clearInterval(runtime.timer);
        runtime.timer = null;
        const elapsedSeconds = readElapsed();
        updateTask(task, { status: taskTimingLabel("failed", elapsedSeconds), likeStatus: likeEnabled ? "失败" : "未启用", collectStatus: collectEnabled ? "失败" : "未启用", commentStatus: commentEnabled ? "失败" : "未启用", elapsedSeconds });
        notify(`“${task.title}”执行失败：${error.message}`, "error");
      }
      if (index < selectedTasks.length - 1 && !runtime.stop) {
        const randomizedInterval = randomizeOperationInterval(Math.max(1, Number(intervalMinutes) || 1));
        setState({ intervalStatus: `本次实际间隔 ${randomizedInterval.totalLabel}（随机浮动 ${randomizedInterval.offsetLabel}）` });
        await pauseBetweenTasks(randomizedInterval.milliseconds, runtime);
        setState({ intervalStatus: "" });
      }
    }
    setState({ intervalStatus: "", running: false });
    setLive(false);
    notify(runtime.stop ? `已停止，共处理 ${completed} 条。` : `队列执行结束，共处理 ${completed} 条；请检查逐项状态。`, runtime.stop ? "info" : "success");
  };
  const stop = () => {
    runtimeFor(accountId).stop = true;
    notify("将在当前笔记处理结束后停止。", "info");
  };

  return (
    <div className="panel-body operation-panel">
      <div className="operation-controls">
        <fieldset className="operation-link-box"><legend>自动化任务</legend>
          <div className="inline-form"><input aria-label="自动化笔记链接" disabled={running} value={url} onChange={(event) => setState({ url: event.target.value })} /><button className="button" disabled={running} onClick={addManual}><IconPlus size={16} aria-hidden="true" />添加链接</button><button className="icon-button" title="删除选中任务" aria-label="删除选中任务" disabled={!selectedTasks.length || running} onClick={removeSelected}><IconTrash size={16} aria-hidden="true" /></button></div>
        </fieldset>
        <fieldset className="operation-config"><legend>执行配置</legend>
          <label><input type="checkbox" checked={likeEnabled} onChange={(event) => setState({ likeEnabled: event.target.checked })} /> 点赞</label>
          <label><input type="checkbox" checked={collectEnabled} onChange={(event) => setState({ collectEnabled: event.target.checked })} /> 收藏</label>
          <label><input type="checkbox" checked={commentEnabled} onChange={(event) => setState({ commentEnabled: event.target.checked })} /> 发布评论</label>
          <label>间隔 <input className="short" type="number" min="1" max="600" step="0.01" value={intervalMinutes} onChange={(event) => setState({ intervalMinutes: Number(event.target.value) })} /> 分钟</label>
          {commentEnabled && <textarea aria-label="评论内容" value={commentText} onChange={(event) => setState({ commentText: event.target.value })} placeholder="输入评论正文" />}
          {intervalStatus && <span className="interval-random-hint" role="status">{intervalStatus}</span>}
          <details className="operation-rules"><summary>执行规则</summary><span>间隔随机浮动 ±10 秒；评论发送前会随机加入 1 个“.”和 1 个 emoji。</span></details>
        </fieldset>
      </div>
      <div className="action-row">
        <strong className="result-count">{tasks.length} 条任务</strong><span className="selection-count">已选 {selectedTasks.length}</span>
        <span className="spacer" />
        {running ? <button className="button primary" onClick={stop}>停止执行</button> : <button className="button primary" disabled={!selectedTasks.length} onClick={start}><IconPlayerPlay size={16} aria-hidden="true" />开始执行</button>}
        <ActionMenu>
          <button type="button" disabled={running || !tasks.length} onClick={() => setTasks((previous) => previous.map((task) => ({ ...task, selected: true })))}>全选任务</button>
          <button type="button" disabled={running || !selectedTasks.length} onClick={() => setTasks((previous) => previous.map((task) => ({ ...task, selected: false })))}>取消选择</button>
          <button type="button" disabled={running || !tasks.length} onClick={() => setTasks([])}><IconTrash size={16} aria-hidden="true" />清空列表</button>
        </ActionMenu>
      </div>
      <div className="table-wrap"><table><thead><tr><th className="check"><input aria-label="全选操作任务" type="checkbox" disabled={running || !tasks.length} checked={tasks.length > 0 && tasks.every((task) => task.selected)} onChange={(event) => setTasks((previous) => previous.map((task) => ({ ...task, selected: event.target.checked })))} /></th><th className="number">序号</th><th>笔记</th><th className="link-col">链接</th><th className="op-status">点赞</th><th className="op-status">评论</th><th className="op-status">收藏</th><th className="task-status">任务状态</th></tr></thead><tbody>{tasks.map((task, index) => <tr key={task.id || task.link} className={task.selected ? "selected" : ""}><td className="check"><input aria-label={`选择操作任务 ${task.title}`} type="checkbox" checked={Boolean(task.selected)} disabled={running} onChange={(event) => toggleTask(task, event.target.checked)} /></td><td className="number">{index + 1}</td><td className="note-title" title={task.title}>{task.title}</td><td className="link-col"><a className="note-link" href={task.link} target="_blank" rel="noreferrer" title={task.link} aria-label={`打开笔记：${task.title}`} onClick={(event) => openNote(event, task)}><IconExternalLink size={16} aria-hidden="true" /></a></td><td className="op-status">{task.likeStatus || "—"}</td><td className="op-status" title={task.sentComment ? `实际评论：${task.sentComment}` : "尚未生成评论"}>{task.commentStatus || "—"}</td><td className="op-status">{task.collectStatus || "—"}</td><td className="task-status">{task.status || "待执行"}</td></tr>)}{!tasks.length && <tr><td colSpan="8" className="empty">暂无任务</td></tr>}</tbody></table></div>
    </div>
  );
}

function readAccountCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(ACCOUNT_CACHE_STORAGE_KEY) || "{}");
    return normalizeAccountsPayload(parsed, parsed.activeAccountId);
  } catch {
    return { accounts: [], activeAccountId: "" };
  }
}

export function App() {
  const desktop = globalThis.collectorDesktop;
  const desktopMode = Boolean(desktop?.isDesktop);
  const extensionMode = Boolean(globalThis.chrome?.runtime?.id && globalThis.chrome?.storage?.local);
  const accountApi = desktop?.accounts;
  const initialAccountCache = useMemo(() => readAccountCache(), []);
  const fallback = useMemo(() => fallbackAccount(extensionMode), [extensionMode]);
  const [accounts, setAccounts] = useState(() => {
    if (!desktopMode) return [fallback];
    if (initialAccountCache.accounts.length) return initialAccountCache.accounts;
    return accountApi ? [] : [normalizeAccount({ id: "legacy-desktop", name: "默认账号", loginState: "unknown" })];
  });
  const [activeAccountId, setActiveAccountId] = useState(() => {
    if (!desktopMode) return fallback.id;
    return initialAccountCache.activeAccountId || initialAccountCache.accounts[0]?.id || (accountApi ? "" : "legacy-desktop");
  });
  const [toast, setToast] = useState(null);
  const [accountDialog, setAccountDialog] = useState(null);
  const [accountBusy, setAccountBusy] = useState(false);
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [analysisAccountId, setAnalysisAccountId] = useState(null);
  const [analysisMounted, setAnalysisMounted] = useState(false);
  const [settingsTab, setSettingsTab] = useState(null);
  const [settingsRevision, setSettingsRevision] = useState(0);
  const updates = useAppUpdates();
  const [runtimeStatuses, setRuntimeStatuses] = useState({});
  const [commentStartingByAccount, setCommentStartingByAccount] = useState({});
  const commentStartLocks = useRef(new Set());
  const toastTimerRef = useRef(null);
  const accountsRef = useRef(accounts);
  const activeAccountRef = useRef(activeAccountId);

  useEffect(() => { accountsRef.current = accounts; }, [accounts]);
  useEffect(() => { activeAccountRef.current = activeAccountId; }, [activeAccountId]);

  const notify = useCallback((message, type = "info") => {
    setToast({ message, type });
    window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  const notifyForAccount = useCallback((accountId, message, type = "info") => {
    const account = accountsRef.current.find((item) => item.id === accountId);
    const prefix = accountsRef.current.length > 1 && account ? `${account.name}：` : "";
    notify(`${prefix}${message}`, type);
  }, [notify]);

  const applyAccountsPayload = useCallback((payload) => {
    const normalized = normalizeAccountsPayload(payload, activeAccountRef.current);
    setAccounts(normalized.accounts);
    setActiveAccountId((previous) => {
      if (normalized.activeAccountId && normalized.accounts.some((account) => account.id === normalized.activeAccountId)) return normalized.activeAccountId;
      if (normalized.accounts.some((account) => account.id === previous)) return previous;
      return normalized.accounts[0]?.id ?? "";
    });
    return normalized;
  }, []);

  const mergeAccountStatus = useCallback((payload = {}) => {
    const raw = payload.account ?? payload;
    const accountId = String(raw.accountId ?? raw.id ?? payload.accountId ?? "");
    if (!accountId) return;
    setAccounts((previous) => previous.map((account, index) => account.id === accountId
      ? normalizeAccount({ ...account, ...raw, id: accountId }, index)
      : account));
  }, []);

  const refreshAccounts = useCallback(async () => {
    if (!desktopMode || typeof accountApi?.list !== "function") return null;
    const payload = await accountApi.list();
    return applyAccountsPayload(payload);
  }, [accountApi, applyAccountsPayload, desktopMode]);

  useEffect(() => {
    if (!desktopMode || !accountApi) return undefined;
    refreshAccounts().catch((error) => notify(`读取账号失败：${error.message}`, "error"));
    const unsubscribers = [];
    if (typeof accountApi.onChanged === "function") unsubscribers.push(accountApi.onChanged(applyAccountsPayload));
    if (typeof accountApi.onStatus === "function") unsubscribers.push(accountApi.onStatus(mergeAccountStatus));
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe?.());
  }, [accountApi, applyAccountsPayload, desktopMode, mergeAccountStatus, notify, refreshAccounts]);

  useEffect(() => {
    if (!desktopMode) return;
    try { localStorage.setItem(ACCOUNT_CACHE_STORAGE_KEY, JSON.stringify({ accounts, activeAccountId })); } catch { /* backend remains the source of truth */ }
  }, [accounts, activeAccountId, desktopMode]);

  const { workspaces, workspace, updateWorkspace, removeWorkspace, data } = useCollectorWorkspaces({ desktopMode, extensionMode, accounts, activeAccountId });
  const activeAccount = accounts.find((account) => account.id === activeAccountId) ?? accounts[0] ?? null;
  const accountName = activeAccount?.name || "当前账号";
  const platform = platformOf(activeAccount);
  const activeTab = platform === "douyin" ? "comments" : workspace.ui.activeTab;
  const visibleTabs = platform === "douyin" ? [{ id: "comments", label: "视频评论", icon: IconMessageCircle }] : tabs;
  const keyword = workspace.ui.keyword;
  const currentUrl = workspace.ui.currentUrl;
  const live = Boolean(workspace.ui.live);
  const muted = workspace.ui.muted !== false;
  const commentTasks = workspace.commentTasks;
  const commentCollectionIndex = useMemo(() => buildCommentCollectionIndex(data.comments, commentTasks), [data.comments, commentTasks]);
  const commentStarting = commentStartingByAccount[activeAccountId] || "";
  const activeCommentNoteId = activeAccount?.capture?.active && activeAccount.capture.kind === "comments"
    ? activeAccount.capture.noteId || commentTasks.find((task) => task.runId === activeAccount.capture.runId)?.id || ""
    : "";
  const operationTasks = workspace.operationTasks;

  const setWorkspaceSection = (section, value, accountId = activeAccountId) => updateWorkspace(accountId, (current) => {
    const previous = current[section] ?? {};
    const next = typeof value === "function" ? value(previous) : { ...previous, ...value };
    return { ...current, [section]: next };
  });
  const setWorkspaceList = (field, value, accountId = activeAccountId) => updateWorkspace(accountId, (current) => ({
    ...current,
    [field]: typeof value === "function" ? value(current[field] ?? []) : value,
  }));
  const setUi = (patch, accountId = activeAccountId) => setWorkspaceSection("ui", patch, accountId);
  const setActiveTab = (value) => setUi({ activeTab: value });
  const openWorkbenchTab = (value) => {
    setAnalysisAccountId(null);
    setActiveTab(value);
  };
  const setKeyword = (value) => setUi({ keyword: typeof value === "function" ? value(keyword) : value });
  const setCurrentUrl = (value) => setUi({ currentUrl: typeof value === "function" ? value(currentUrl) : value });
  const setLive = (value) => setUi({ live: typeof value === "function" ? value(live) : value });
  const setCommentTasks = (value) => setWorkspaceList("commentTasks", value);
  const setOperationTasks = (value) => setWorkspaceList("operationTasks", value);
  const panelNotify = (message, type = "info") => notifyForAccount(activeAccountId, message, type);
  const analysisOpen = analysisAccountId !== null;

  useEffect(() => {
    for (const account of accounts) {
      updateWorkspace(account.id, (current) => ({
        ...current,
        ui: {
          ...current.ui,
          currentUrl: account.url || current.ui.currentUrl,
          live: typeof account.capture?.active === "boolean" || typeof account.operationActive === "boolean"
            ? Boolean(account.capture?.active || account.operationActive)
            : current.ui.live,
        },
      }));
    }
  }, [accounts, updateWorkspace]);

  useEffect(() => {
    if (!desktopMode) return undefined;
    const unsubscribers = [];
    if (typeof desktop?.onNavigation === "function") {
      unsubscribers.push(desktop.onNavigation((state = {}) => {
        const accountId = resolveEventAccountId(state, activeAccountRef.current, accountsRef.current.length);
        if (!accountId || !state.url) return;
        setWorkspaceSection("ui", { currentUrl: state.url }, accountId);
      }));
    }
    if (typeof desktop?.onStatus === "function") {
      unsubscribers.push(desktop.onStatus((status = {}) => {
        const accountId = resolveEventAccountId(status, activeAccountRef.current, accountsRef.current.length);
        if (!accountId) return;
        setRuntimeStatuses((previous) => ({
          ...previous,
          [accountId]: {
            phase: String(status.phase || ""),
            message: String(status.message || ""),
            runId: String(status.runId || ""),
            updatedAt: Date.now(),
          },
        }));
        const explicitActive = [status.active, status.capture?.active, status.operationActive]
          .find((value) => typeof value === "boolean");
        if (typeof explicitActive === "boolean") setWorkspaceSection("ui", { live: explicitActive }, accountId);
        updateWorkspace(accountId, (current) => ({ ...current, commentTasks: updateCommentTaskStatus(current.commentTasks, status) }));
        if (status.phase === "error") notifyForAccount(accountId, status.message || "任务执行异常。", "error");
        else if (status.phase === "stopped") notifyForAccount(accountId, status.message || "任务已停止。", "success");
      }));
    }
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe?.());
  }, [desktop, desktopMode, notifyForAccount, updateWorkspace]);

  useEffect(() => {
    if (!desktopMode || !activeAccountId) return undefined;
    if (analysisOpen || settingsTab) {
      desktop.setBrowserBounds({ x: 0, y: 0, width: 1, height: 1 });
      return undefined;
    }
    const preview = document.querySelector(".browser-preview");
    const browserPane = preview?.closest(".browser-pane");
    if (!preview) return undefined;
    const updateBounds = () => {
      desktop.setBrowserBounds(clampBrowserBounds(
        preview.getBoundingClientRect(),
        browserPane?.getBoundingClientRect(),
        { width: window.innerWidth, height: window.innerHeight },
      ));
    };
    const observer = new ResizeObserver(updateBounds);
    observer.observe(preview);
    if (browserPane) observer.observe(browserPane);
    window.addEventListener("resize", updateBounds);
    const frame = requestAnimationFrame(updateBounds);
    return () => { observer.disconnect(); window.removeEventListener("resize", updateBounds); cancelAnimationFrame(frame); };
  }, [activeAccountId, analysisOpen, desktop, desktopMode, settingsTab]);

  useEffect(() => {
    if (!desktopMode || typeof desktop?.setDataDashboardOpen !== "function") return;
    desktop.setDataDashboardOpen(dashboardOpen);
  }, [dashboardOpen, desktop, desktopMode]);

  const switchAccount = async (accountId) => {
    if (!accountId || accountId === activeAccountId) return;
    try {
      if (desktopMode && typeof accountApi?.switch === "function") await accountApi.switch(accountId);
      setActiveAccountId(accountId);
    } catch (error) {
      notify(`切换账号失败：${error.message}`, "error");
    }
  };

  const openDashboardAccount = async (accountId, targetTab) => {
    if (targetTab) setWorkspaceSection("ui", { activeTab: targetTab }, accountId);
    await switchAccount(accountId);
    setAnalysisAccountId(null);
    setDashboardOpen(false);
  };

  const openAccountAnalysis = (accountId) => {
    setDashboardOpen(false);
    setAnalysisMounted(true);
    setAnalysisAccountId(accountId || "");
  };

  const closeAccountAnalysis = () => {
    setAnalysisAccountId(null);
    setDashboardOpen(true);
  };

  const refreshDashboardAccountStatus = async (accountId) => {
    const account = accountsRef.current.find((item) => item.id === accountId);
    if (account) await refreshAccountStatus(account);
  };

  const stopDashboardCapture = async (accountId) => {
    try {
      await callDesktop("stopTask", accountId);
      setWorkspaceSection("ui", { live: false }, accountId);
      notifyForAccount(accountId, "采集已停止。", "info");
    } catch (error) {
      notifyForAccount(accountId, `停止采集失败：${error.message}`, "error");
    }
  };

  const refreshAccountStatus = async (account) => {
    try {
      const result = typeof accountApi?.refreshStatus === "function"
        ? await accountApi.refreshStatus(account.id)
        : await accountApi?.status?.(account.id);
      if (result) mergeAccountStatus(result);
      const normalized = normalizeAccount({ ...account, ...(result?.account ?? result ?? {}) });
      notify(`“${account.name}”状态已更新：${loginPhaseLabel(normalized, true)}。`, "success");
    } catch (error) {
      notify(`检查登录状态失败：${error.message}`, "error");
    }
  };

  const submitAccountDialog = async (name, newPlatform = "xhs") => {
    if (!accountApi || !accountDialog) return;
    setAccountBusy(true);
    try {
      if (accountDialog.mode === "add") {
        const result = await accountApi.add({ name, platform: newPlatform });
        const createdId = result?.accountId ?? result?.id ?? result?.account?.id;
        const refreshed = await refreshAccounts();
        if (createdId) {
          await accountApi.switch(createdId);
          setActiveAccountId(String(createdId));
        } else if (refreshed?.activeAccountId) setActiveAccountId(refreshed.activeAccountId);
        notify("独立账号空间已创建，请在左侧真实页面完成登录。", "success");
      } else if (accountDialog.mode === "rename") {
        await accountApi.rename({ accountId: accountDialog.account.id, name });
        await refreshAccounts();
        notify("账号名称已更新。", "success");
      } else if (accountDialog.mode === "remove") {
        const removedId = accountDialog.account.id;
        await accountApi.remove({ accountId: removedId, clearData: true });
        removeWorkspace(removedId);
        await refreshAccounts();
        notify("账号及其独立本地数据已移除。", "success");
      }
      setAccountDialog(null);
    } catch (error) {
      notify(`账号操作失败：${error.message}`, "error");
    } finally {
      setAccountBusy(false);
    }
  };

  const goHome = async () => {
    if (data.desktopMode) await callDesktop("home", activeAccountId);
    else setCurrentUrl(platformHome(platform));
  };
  const reloadBrowser = async () => {
    if (data.desktopMode) await callDesktop("reload", activeAccountId);
  };
  const setMuted = async (nextMuted) => {
    setUi({ muted: nextMuted });
    if (data.desktopMode) {
      try { await callDesktop("setMuted", activeAccountId, nextMuted); } catch (error) { notify(`静音设置失败：${error.message}`, "error"); }
    }
  };
  const openNote = async (event, note) => {
    if (!data.realMode) return;
    event.preventDefault();
    try {
      if (data.desktopMode) {
        const result = await callDesktop("openNote", activeAccountId, { id: note.id, link: note.link, title: note.title });
        setCurrentUrl(result.url);
      } else {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) throw new Error("没有可用的小红书标签页");
        await chrome.tabs.update(tab.id, { url: note.link });
        setCurrentUrl(note.link);
      }
      setLive(false);
      panelNotify(`已在左侧打开目标${platform === "douyin" ? "视频" : "笔记"}。`, "success");
    } catch (error) {
      panelNotify(`打开笔记失败：${error.message}`, "error");
    }
  };
  const openAnalyticsNote = async (accountId, note) => {
    if (!data.realMode || !note?.link) return;
    try {
      if (data.desktopMode) {
        if (accountId && accountId !== activeAccountId && typeof accountApi?.switch === "function") await accountApi.switch(accountId);
        if (accountId) setActiveAccountId(accountId);
        const result = await callDesktop("openNote", accountId || activeAccountId, { id: note.id, link: note.link, title: note.title });
        setWorkspaceSection("ui", { activeTab: platformOf(accountsRef.current.find((item) => item.id === (accountId || activeAccountId))) === "douyin" ? "comments" : "search", currentUrl: result.url, live: false }, accountId || activeAccountId);
      } else {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) throw new Error("没有可用的小红书标签页");
        await chrome.tabs.update(tab.id, { url: note.link });
        setWorkspaceSection("ui", { activeTab: "search", currentUrl: note.link, live: false }, accountId || activeAccountId);
      }
      setAnalysisAccountId(null);
      setDashboardOpen(false);
      notifyForAccount(accountId || activeAccountId, "已打开来源笔记。", "success");
    } catch (error) {
      notifyForAccount(accountId || activeAccountId, `打开来源笔记失败：${error.message}`, "error");
    }
  };
  const queueComments = (notes) => {
    setCommentTasks((previous) => mergeQueue(previous, notes));
    setActiveTab("comments");
    panelNotify(`已把 ${notes.length} 条笔记加入笔记评论。`, "success");
  };
  const collectNoteComments = async (note) => {
    const accountId = activeAccountId;
    if (commentStartLocks.current.has(accountId)) return;
    const link = commentNoteLink(note.link, platform);
    if (!link) { panelNotify(platform === "douyin" ? "请输入完整抖音视频链接：https://www.douyin.com/video/视频ID；短链接请先在浏览器打开后复制完整地址。" : "请输入完整的小红书笔记链接。", "error"); return; }
    const id = commentNoteId({ ...note, link });
    if (activeCommentNoteId === id) { setActiveTab("comments"); return; }
    const task = { ...asQueueTask({ ...note, id, link, platform, title: note.title || (platform === "douyin" ? `视频 ${id}` : "未命名笔记") }), status: data.realMode ? "正在打开" : "等待桌面版", runId: "" };
    commentStartLocks.current.add(accountId);
    setCommentStartingByAccount((previous) => ({ ...previous, [accountId]: id }));
    updateWorkspace(accountId, (current) => ({
      ...current,
      ui: { ...current.ui, activeTab: "comments", currentUrl: link },
      commentsPanel: { ...current.commentsPanel, url: link, selectedNoteId: "", scope: "all" },
      commentTasks: [...current.commentTasks.filter((item) => commentNoteId(item) !== id), task],
    }));
    setDashboardOpen(false);
    const updateTask = (patch) => setWorkspaceList("commentTasks", (previous) => previous.map((item) => commentNoteId(item) === id ? { ...item, ...patch } : item), accountId);
    try {
      if (data.desktopMode) {
        const result = await callDesktop("startTask", accountId, { kind: "comments", url: link, target: 1000 });
        // Status events may finish a short run before the navigation promise resolves.
        setWorkspaceList("commentTasks", (previous) => previous.map((item) => commentNoteId(item) === id && item.status === "正在打开"
          ? { ...item, status: "采集中", runId: result.runId || item.runId } : item), accountId);
      } else if (data.extensionMode) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) throw new Error("没有可用的小红书标签页");
        await chrome.tabs.update(tab.id, { url: link });
        updateTask({ status: "页面监听" });
        setUi({ live: true }, accountId);
      } else {
        notifyForAccount(accountId, "已加入评论卡片。真实评论采集需在桌面版中运行。", "info");
        return;
      }
      notifyForAccount(accountId, platform === "douyin" ? "已开始监听该视频，请在左侧打开评论区。" : "已启动该笔记的评论采集，结果将自动归入对应卡片。", "success");
    } catch (error) {
      updateTask({ status: "启动失败" });
      notifyForAccount(accountId, `评论采集启动失败：${error.message}`, "error");
    } finally {
      commentStartLocks.current.delete(accountId);
      setCommentStartingByAccount((previous) => ({ ...previous, [accountId]: "" }));
    }
  };
  const openCommentNote = async (group) => {
    if (commentStartLocks.current.has(activeAccountId)) {
      panelNotify("笔记正在打开，请稍后查看其他笔记。", "info");
      return;
    }
    setWorkspaceSection("commentsPanel", { selectedNoteId: group.id });
    setDashboardOpen(false);
    if (!group.link || activeCommentNoteId === group.id) return;
    if (!data.realMode) {
      setCurrentUrl(group.link);
      return;
    }
    await openNote({ preventDefault() {} }, group);
  };
  const viewCollectedComments = (note) => {
    setActiveTab("comments");
    setWorkspaceSection("commentsPanel", { scope: "all" });
    openCommentNote({ ...note, id: commentNoteId(note) });
  };
  const stopCommentCollection = async () => {
    const accountId = activeAccountId;
    try {
      if (data.desktopMode) await callDesktop("stopTask", accountId);
      setUi({ live: false }, accountId);
    } catch (error) { notifyForAccount(accountId, `停止采集失败：${error.message}`, "error"); }
  };
  const queueOperations = (notes) => {
    setOperationTasks((previous) => mergeQueue(previous, notes));
    setActiveTab("safe");
    panelNotify(`已把 ${notes.length} 条笔记加入自动化任务列表。`, "success");
  };

  const loggedInCount = accounts.filter((account) => account.loginPhase === "logged-in").length;
  const runningCount = accounts.filter((account) => Boolean(account.capture?.active || account.operationActive || workspaces[account.id]?.ui?.live || workspaces[account.id]?.operation?.running)).length;
  const activePhase = loginPhaseLabel(activeAccount, desktopMode);
  const allDashboardRows = useMemo(
    () => dashboardRows(accounts, workspaces, runtimeStatuses),
    [accounts, runtimeStatuses, workspaces],
  );
  const allDashboardSummary = useMemo(() => dashboardSummary(allDashboardRows), [allDashboardRows]);

  return (
    <main className={`app-shell ${analysisOpen ? "analysis-view" : ""} ${dashboardOpen ? "dashboard-open" : ""}`}>
      <header className="titlebar">
        <div className="brand-lockup" title={`多平台采集工作台 v${__APP_VERSION__}`}><img className="brand-mark" src={`${import.meta.env.BASE_URL}assets/ai-collector-icon.png`} alt="AI 采集" /><strong>{platform === "douyin" ? "抖音评论工作台" : "小红书采集工作台"}</strong><span className="app-version" aria-label={`软件版本 ${__APP_VERSION__}`}>v{__APP_VERSION__}</span>{["available", "downloading", "downloaded"].includes(updates.state.status) && <button className="icon-button app-update-notice" type="button" title={updates.state.status === "downloaded" ? "更新已下载" : "发现新版本"} aria-label="查看软件更新" onClick={() => setSettingsTab("general")}><IconDownload size={15} /></button>}</div>
        <AccountBar
          accounts={accounts}
          activeAccountId={activeAccountId}
          desktopMode={desktopMode}
          dashboardOpen={dashboardOpen}
          onDashboardToggle={() => {
            setAnalysisAccountId(null);
            setDashboardOpen((open) => !open);
          }}
          onSwitch={switchAccount}
          onAdd={() => setAccountDialog({ mode: "add", suggestedName: `账号 ${accounts.length + 1}` })}
          onRename={(account) => setAccountDialog({ mode: "rename", account })}
          onRemove={(account) => setAccountDialog({ mode: "remove", account })}
          onRefresh={refreshAccountStatus}
          onSettings={() => setSettingsTab("ai")}
        />
      </header>
      <nav className="tabs" aria-label="采集模块">{visibleTabs.map(({ icon: Icon, ...tab }) => <button key={tab.id} type="button" className={activeTab === tab.id ? "active" : ""} aria-current={activeTab === tab.id ? "page" : undefined} disabled={tab.disabled || !activeAccountId} onClick={() => openWorkbenchTab(tab.id)}><Icon size={17} stroke={1.8} aria-hidden="true" />{tab.label}</button>)}</nav>
      <div className="workspace">
        {!analysisOpen && <BrowserPane account={activeAccount} keyword={keyword} currentUrl={currentUrl} live={live} muted={muted} extensionMode={data.extensionMode} desktopMode={data.desktopMode} onHome={goHome} onReload={reloadBrowser} onMuted={setMuted} />}
        <section className="workbench">
          {analysisMounted && (
            <div className="analysis-route" hidden={!analysisOpen}>
              <AnalyticsPage
                accounts={accounts}
                workspaces={workspaces}
                initialAccountId={analysisAccountId}
                settingsRevision={settingsRevision}
                onConfigure={() => setSettingsTab("ai")}
                onBack={closeAccountAnalysis}
                onOpenAccount={openDashboardAccount}
                onOpenNote={openAnalyticsNote}
              />
            </div>
          )}
          {!analysisOpen && (!activeAccountId ? (
            <div className="account-required"><IconUserCircle size={36} stroke={1.5} /><strong>先添加一个账号</strong><span>创建独立登录空间后，即可在左侧登录并开始采集。</span><button className="button primary" type="button" onClick={() => setAccountDialog({ mode: "add", suggestedName: "账号 1" })}>添加账号</button></div>
          ) : (
            <>
              {platform !== "douyin" && <>
              <div className="panel-route" hidden={activeTab !== "safe"}><OperationPanel accountId={activeAccountId} data={data} state={workspace.operation} setState={(value) => setWorkspaceSection("operation", value)} tasks={operationTasks} setTasks={setOperationTasks} setCurrentUrl={setCurrentUrl} setLive={setLive} notify={panelNotify} openNote={openNote} /></div>
              <div className="panel-route" hidden={activeTab !== "search"}><SearchPanel accountId={activeAccountId} accountName={accountName} capture={activeAccount?.capture} data={data} state={workspace.search} setState={(value) => setWorkspaceSection("search", value)} keyword={keyword} setKeyword={setKeyword} setCurrentUrl={setCurrentUrl} live={live} setLive={setLive} notify={panelNotify} openNote={openNote} onQueueComments={queueComments} onQueueOperations={queueOperations} onCollectComments={collectNoteComments} commentStarting={commentStarting} activeCommentNoteId={activeCommentNoteId} commentCollectionIndex={commentCollectionIndex} onViewComments={viewCollectedComments} /></div>
              <div className="panel-route" hidden={activeTab !== "author"}><AuthorPanel accountId={activeAccountId} accountName={accountName} data={data} state={workspace.author} setState={(value) => setWorkspaceSection("author", value)} setCurrentUrl={setCurrentUrl} setLive={setLive} notify={panelNotify} openNote={openNote} onQueueComments={queueComments} onQueueOperations={queueOperations} onCollectComments={collectNoteComments} commentStarting={commentStarting} activeCommentNoteId={activeCommentNoteId} commentCollectionIndex={commentCollectionIndex} onViewComments={viewCollectedComments} /></div>
              </>}
              <div className="panel-route" hidden={activeTab !== "comments"}><CommentsPanel key={activeAccountId} accountId={activeAccountId} accountName={accountName} data={data} state={workspace.commentsPanel} setState={(value) => setWorkspaceSection("commentsPanel", value)} tasks={commentTasks} onStart={collectNoteComments} onStop={stopCommentCollection} onOpen={openCommentNote} activeNoteId={activeCommentNoteId} starting={commentStarting} notify={panelNotify} downloadCsv={downloadCsv} active={activeTab === "comments"} settingsRevision={settingsRevision} runtimeStatus={runtimeStatuses[activeAccountId]} onConfigure={() => setSettingsTab("ai")} /></div>
            </>
          ))}
        </section>
      </div>
      <footer className="statusbar"><span className="account-status" title={accountName}><StatusDot active={live || activeAccount?.loginPhase === "logged-in"} phase={live ? "running" : activeAccount?.loginPhase} />{live ? `${accountName} · 运行中` : `${accountName} · ${activePhase}`}</span><span>{desktopMode ? `${loggedInCount} 个账号已登录${runningCount ? ` · ${runningCount} 个运行中` : ""}` : "演示模式 · 采集需桌面版"}</span><span className="status-grow" title="每个账号的页面、采集结果和操作队列独立存储，不导出 Cookie">本地存储 · 账号隔离</span></footer>
      {dashboardOpen && !analysisOpen && (
        <DataDashboard
          accounts={accounts}
          workspaces={workspaces}
          rows={allDashboardRows}
          summary={allDashboardSummary}
          activeAccountId={activeAccountId}
          onClose={() => setDashboardOpen(false)}
          onOpenFullAnalysis={openAccountAnalysis}
        />
      )}
      {settingsTab && <SettingsDialog updates={updates} initialTab={settingsTab} accountName={accountName} muted={muted} onMuted={setMuted} onClose={() => setSettingsTab(null)} onSaved={() => setSettingsRevision((value) => value + 1)} />}
      {toast && <div className={`toast ${toast.type}`}>{toast.message}</div>}
      {accountDialog && <AccountDialog key={`${accountDialog.mode}-${accountDialog.account?.id ?? "new"}`} dialog={accountDialog} busy={accountBusy} onCancel={() => !accountBusy && setAccountDialog(null)} onSubmit={submitAccountDialog} />}
    </main>
  );
}
