import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IconDots,
  IconHome,
  IconLogin2,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconUserCircle,
  IconVolume,
  IconX,
} from "@tabler/icons-react";
import { randomizeComment } from "./comment-randomizer.js";
import { randomizeOperationInterval } from "./operation-interval.js";
import { actionResultLabel, isActionComplete, taskTimingLabel } from "./operation-status.js";
import { commentMatchesTimeRange, noteMatchesTimeRange } from "./comment-time-filter.js";

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
  { id: "safe", label: "[引流] 自动化操作区" },
  { id: "search", label: "[采集] 搜索笔记" },
  { id: "author", label: "[采集] 作者笔记" },
  { id: "comments", label: "[采集] 笔记评论" },
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
    });
  }
  return Array.from(merged.values()).slice(-max);
}

function mergeNotes(previous, incoming, max = 5000) {
  const merged = new Map((previous ?? []).map((note) => [note.id, note]));
  for (const note of incoming ?? []) {
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

function createDefaultWorkspace(realMode) {
  return {
    notes: realMode ? [] : demoNotes,
    comments: realMode ? [] : demoComments,
    stats: { captures: 0, lastUrl: realMode ? "等待真实页面响应" : "演示数据", updatedAt: Date.now() },
    ui: { activeTab: "search", keyword: "创业", currentUrl: HOME_URL, live: false, muted: true },
    search: { limit: 100, minLikes: 0, type: "全部", timeRange: "all", selectedIds: realMode ? [] : [demoNotes[3].id] },
    author: { url: PROFILE_URL, tasks: [], selectedIds: [], intervalSeconds: 3 },
    commentsPanel: { url: EXPLORE_URL, region: "", contains: "", timeRange: "all", unique: true },
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
  const base = createDefaultWorkspace(realMode);
  const workspace = value && typeof value === "object" ? value : {};
  return {
    ...base,
    ...workspace,
    notes: Array.isArray(workspace.notes) ? workspace.notes : base.notes,
    comments: dedupeComments(Array.isArray(workspace.comments) ? workspace.comments : base.comments),
    stats: { ...base.stats, ...(workspace.stats ?? {}) },
    ui: { ...base.ui, ...(workspace.ui ?? {}), live: false },
    search: { ...base.search, ...(workspace.search ?? {}), selectedIds: Array.isArray(workspace.search?.selectedIds) ? workspace.search.selectedIds : base.search.selectedIds },
    author: { ...base.author, ...(workspace.author ?? {}), tasks: Array.isArray(workspace.author?.tasks) ? workspace.author.tasks : [], selectedIds: Array.isArray(workspace.author?.selectedIds) ? workspace.author.selectedIds : [] },
    commentsPanel: { ...base.commentsPanel, ...(workspace.commentsPanel ?? {}) },
    operation: { ...base.operation, ...(workspace.operation ?? {}), intervalStatus: "", running: false },
    commentTasks: Array.isArray(workspace.commentTasks) ? workspace.commentTasks : [],
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
      const current = previous[accountId] ?? createDefaultWorkspace(realMode);
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
        const legacy = !migrationAttemptedRef.current && index === 0 && !Object.keys(previous).length
          ? readLegacyWorkspace(realMode, desktopMode)
          : null;
        next[accountId] = legacy ?? createDefaultWorkspace(realMode);
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
      if (!accountId) return;
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
      notes: result.collectorNotes ?? [],
      comments: dedupeComments(result.collectorComments ?? []),
      stats: result.captureStats ?? { captures: 0 },
    }));
    chrome.storage.local.get(["collectorNotes", "collectorComments", "captureStats"], hydrate);
    const listener = (changes, area) => {
      if (area !== "local") return;
      updateWorkspace(activeAccountId, (workspace) => ({
        ...workspace,
        notes: changes.collectorNotes ? (changes.collectorNotes.newValue ?? []) : workspace.notes,
        comments: changes.collectorComments ? dedupeComments(changes.collectorComments.newValue ?? []) : workspace.comments,
        stats: changes.captureStats ? (changes.captureStats.newValue ?? {}) : workspace.stats,
      }));
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [activeAccountId, extensionMode, updateWorkspace]);

  const workspace = workspaces[activeAccountId] ?? createDefaultWorkspace(realMode);
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

  return {
    workspaces,
    workspace,
    updateWorkspace,
    removeWorkspace,
    data: {
      desktopMode,
      extensionMode,
      realMode,
      notes: workspace.notes,
      comments: workspace.comments,
      stats: workspace.stats,
      setNotes,
      setComments,
      save,
      clearNotes,
      clearComments,
    },
  };
}

function StatusDot({ active, phase = "unknown" }) {
  return <span className={`status-dot ${active ? "active" : ""} phase-${phase}`} aria-hidden="true" />;
}

function AccountBar({ accounts, activeAccountId, desktopMode, onSwitch, onAdd, onRename, onRemove, onRefresh }) {
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
          const detailLabel = account.nickname && account.nickname !== account.name ? `${account.nickname} · ${phaseLabel}` : phaseLabel;
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
      <button className="account-add" type="button" disabled={!desktopMode} onClick={onAdd} title={desktopMode ? "创建独立登录账号" : "多账号登录仅在桌面版可用"}>
        <IconPlus size={17} stroke={2} /> <span>添加账号</span>
      </button>
      <div className="account-menu-wrap" onPointerDown={(event) => event.stopPropagation()}>
        <button className="account-manage" type="button" disabled={!desktopMode || !activeAccount} aria-label="管理当前账号" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
          <IconDots size={18} stroke={2} />
        </button>
        {menuOpen && activeAccount && (
          <div className="account-menu" role="menu">
            <div className="account-menu-summary">
              <span className="account-menu-avatar">{activeAccount.avatarUrl ? <img src={activeAccount.avatarUrl} alt="" /> : <IconUserCircle size={24} stroke={1.6} />}</span>
              <span><strong>{activeAccount.name}</strong><small><StatusDot phase={activeAccount.loginPhase} active={activeAccount.loginPhase === "logged-in"} />{loginPhaseLabel(activeAccount, desktopMode)}</small></span>
            </div>
            <button role="menuitem" type="button" onClick={() => { setMenuOpen(false); onRefresh(activeAccount); }}><IconLogin2 size={16} />检查登录状态</button>
            <button role="menuitem" type="button" onClick={() => { setMenuOpen(false); onRename(activeAccount); }}><IconPencil size={16} />重命名账号</button>
            <span className="context-separator" />
            <button className="danger" role="menuitem" type="button" onClick={() => { setMenuOpen(false); onRemove(activeAccount); }}><IconTrash size={16} />移除账号</button>
          </div>
        )}
      </div>
    </div>
  );
}

function AccountDialog({ dialog, busy, onCancel, onSubmit }) {
  const [value, setValue] = useState(dialog.mode === "rename" ? dialog.account?.name ?? "" : dialog.suggestedName ?? "");
  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === "Escape" && !busy) onCancel(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onCancel]);

  const deleting = dialog.mode === "remove";
  const title = deleting ? "移除账号" : dialog.mode === "rename" ? "重命名账号" : "添加小红书账号";
  const submit = (event) => {
    event.preventDefault();
    if (!deleting && !value.trim()) return;
    onSubmit(value.trim());
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
            <p>{dialog.mode === "add" ? "将创建一个全新的独立登录空间，切换账号不会共享 Cookie。" : "名称只用于本机工作台识别，不会修改小红书昵称。"}</p>
            <label>账号名称<input autoFocus maxLength="24" value={value} onChange={(event) => setValue(event.target.value)} placeholder="例如：品牌主账号" /></label>
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
  const browserMode = desktopMode ? "桌面浏览器" : extensionMode ? "当前浏览器" : "不可采集";
  const accountLabel = account?.name || (extensionMode ? "当前浏览器" : "预览账号");
  return (
    <section className="browser-pane" aria-label="浏览器预览">
      <div className="browser-toolbar">
        <span className="browser-label"><StatusDot active={live || account?.loginPhase === "logged-in"} phase={live ? "running" : account?.loginPhase} /><span>网页预览</span><b title={accountLabel}>{accountLabel}</b><em>（{browserMode}）</em></span>
        <div className="browser-actions">
          <button type="button" className="icon-button" onClick={onHome} title="返回小红书首页" aria-label="返回小红书首页"><IconHome size={16} stroke={1.8} /></button>
          <label className="mute-check"><input type="checkbox" checked={muted} onChange={(event) => onMuted(event.target.checked)} /><IconVolume size={15} stroke={1.8} /> 静音</label>
          <div className="address-field" title={currentUrl}>{currentUrl}</div>
          <button type="button" className="icon-button" onClick={onReload} title="刷新嵌入页面" aria-label="刷新嵌入页面"><IconRefresh size={16} stroke={1.8} /></button>
        </div>
      </div>
      <div className={`browser-preview ${desktopMode ? "desktop-live" : ""}`}>
        <img src={`${import.meta.env.BASE_URL}assets/xhs-preview-apricot.png`} alt="杏桃柔和分区设计中的小红书内容预览" />
        <div className="preview-caption">
          <strong>{keyword || "创业"}</strong>
          <span>{desktopMode ? "真实小红书页面正在载入" : extensionMode ? "真实页面在当前 Chrome 标签中打开" : "网页预览不具备采集权限，请运行桌面版"}</span>
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
      <button role="menuitem" type="button" onClick={run(() => onQueueComments?.([menu.row]))}>添加此条到评论采集</button>
      <button role="menuitem" type="button" disabled={!checked.length} onClick={run(() => onQueueComments?.(checked))}>添加勾选到评论采集</button>
      <span className="context-separator" />
      <button role="menuitem" type="button" onClick={run(() => onQueueOperations?.([menu.row]))}>添加此条到笔记操作区</button>
      <button role="menuitem" type="button" disabled={!checked.length} onClick={run(() => onQueueOperations?.(checked))}>添加勾选到笔记操作区</button>
    </div>
  );
}

function NotesTable({ rows, selected, setSelected, onOpenLink, onQueueComments, onQueueOperations }) {
  const [menu, setMenu] = useState(null);
  const toggleAll = (checked) => setSelected(checked ? new Set(rows.map((row) => row.id)) : new Set());
  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="check"><input aria-label="全选" type="checkbox" checked={rows.length > 0 && rows.every((row) => selected.has(row.id))} onChange={(event) => toggleAll(event.target.checked)} /></th>
              <th className="number">编号</th><th className="author-col">作者</th><th className="title-col">标题</th><th className="link-col">笔记链接</th><th className="likes">点赞数</th><th className="type">类型</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={row.id}
                className={selected.has(row.id) ? "selected" : ""}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setMenu({ row, x: event.clientX, y: event.clientY });
                }}
              >
                <td className="check"><input aria-label={`选择 ${row.title}`} type="checkbox" checked={selected.has(row.id)} onChange={(event) => setSelected((previous) => { const next = new Set(previous); event.target.checked ? next.add(row.id) : next.delete(row.id); return next; })} /></td>
                <td className="number">{index + 1}</td><td>{row.author}</td><td title={row.title}>{row.title}</td>
                <td><a href={row.link} target="_blank" rel="noreferrer" title={row.link} onClick={(event) => onOpenLink?.(event, row)}>{row.link}</a></td><td className="likes">{row.likes}</td><td className="type">{row.type}</td>
              </tr>
            ))}
            {!rows.length && <tr><td className="empty" colSpan="7">还没有符合条件的数据</td></tr>}
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

function SearchPanel({ accountId, accountName, data, state, setState, keyword, setKeyword, setCurrentUrl, live, setLive, notify, openNote, onQueueComments, onQueueOperations }) {
  const { limit = 100, minLikes = 0, type = "全部", timeRange = "all" } = state;
  const selected = useMemo(() => new Set(state.selectedIds ?? []), [state.selectedIds]);
  const setSelected = (value) => setState((current) => {
    const previous = new Set(current.selectedIds ?? []);
    const next = typeof value === "function" ? value(previous) : value;
    return { ...current, selectedIds: Array.from(next) };
  });
  const fileRef = useRef(null);
  const filtered = useMemo(() => data.notes.filter((note) => Number(note.likes) >= Number(minLikes)
    && (type === "全部" || note.type === type)
    && noteMatchesTimeRange(note.time, timeRange)).slice(0, limit), [data.notes, limit, minLikes, timeRange, type]);

  const openSearch = async () => {
    const url = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keyword.trim() || "创业")}`;
    setCurrentUrl(url);
    try {
      if (data.desktopMode) {
        await callDesktop("startTask", accountId, { kind: "notes", url, target: limit });
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
    if (data.desktopMode) await callDesktop("stopTask", accountId);
    setLive(false);
    notify("采集已停止。", "info");
  };

  const removeSelected = async () => {
    const next = data.notes.filter((note) => !selected.has(note.id));
    data.setNotes(next); await data.save(next, data.comments); setSelected(new Set()); notify(`已删除 ${data.notes.length - next.length} 条。`);
  };

  const importRows = async (file) => {
    if (!file) return;
    const parsed = parseCsv(await file.text()).map((row, index) => ({
      id: row.ID || row.id || `import-${Date.now()}-${index}`, author: row.作者 || row.author || "未知作者", title: row.标题 || row.title || "",
      link: row.笔记链接 || row.link || "", likes: Number(row.点赞数 || row.likes || 0), type: row.类型 || row.type || "笔记", time: row.发布时间 || row.time || "", source: "导入",
    }));
    const merged = Array.from(new Map([...data.notes, ...parsed].map((row) => [row.id || row.link, row])).values());
    data.setNotes(merged); await data.save(merged, data.comments); notify(`已导入 ${parsed.length} 条笔记。`, "success");
  };

  return (
    <div className="panel-body">
      <div className="control-grid search-controls">
        <fieldset>
          <legend>视频采集区</legend>
          <label>搜索词 <input value={keyword} onChange={(event) => setKeyword(event.target.value)} /></label>
          <label>数量 <input className="short" type="number" min="1" max="1000" value={limit} onChange={(event) => setState({ limit: Number(event.target.value) })} /></label>
          <button className="button primary" type="button" onClick={openSearch}>{live ? "重新采集" : "采集笔记"}</button>
          {data.desktopMode && <button className="button" type="button" disabled={!live} onClick={stopSearch}>停止</button>}
          <span className="count-hint">共 {data.notes.length} 条，显示 {filtered.length} 条</span>
        </fieldset>
        <fieldset>
          <legend>条件筛选</legend>
          <label>点赞 ≥ <input className="short" type="number" min="0" value={minLikes} onChange={(event) => setState({ minLikes: Number(event.target.value) })} /></label>
          <label>类型 <select value={type} onChange={(event) => setState({ type: event.target.value })}><option>全部</option><option>视频</option><option>笔记</option></select></label>
          <label>发布时间 <select aria-label="搜索笔记发布时间" value={timeRange} onChange={(event) => setState({ timeRange: event.target.value })}><option value="all">不限</option><option value="day">一天内</option><option value="week">一周内</option><option value="month">一月内</option><option value="half-year">半年内</option></select></label>
          <span className="filter-result">筛选结果 {filtered.length}</span>
        </fieldset>
      </div>
      <div className="action-row">
        <button className="button" type="button" disabled={!selected.size} onClick={removeSelected}>删除选中</button>
        <button className="button" type="button" onClick={() => { data.clearNotes(); setSelected(new Set()); notify("笔记列表已清空。") }}>清空列表</button>
        <span className="spacer" />
        <button className="button" type="button" onClick={() => setState({ minLikes: 0, type: "全部", timeRange: "all" })}>清空筛选</button>
        <button className="button" type="button" onClick={() => downloadCsv(`${accountName}-小红书笔记.csv`, filtered, [{ key: "author", label: "作者" }, { key: "title", label: "标题" }, { key: "link", label: "笔记链接" }, { key: "likes", label: "点赞数" }, { key: "type", label: "类型" }, { key: "time", label: "发布时间" }])}>导出 CSV</button>
        <button className="button" type="button" onClick={() => fileRef.current?.click()}>导入 CSV</button>
        <input className="visually-hidden" ref={fileRef} type="file" accept=".csv,text/csv" onChange={(event) => importRows(event.target.files?.[0])} />
      </div>
      <NotesTable rows={filtered} selected={selected} setSelected={setSelected} onOpenLink={openNote} onQueueComments={onQueueComments} onQueueOperations={onQueueOperations} />
    </div>
  );
}

function AuthorPanel({ accountId, accountName, data, state, setState, setCurrentUrl, setLive, notify, openNote, onQueueComments, onQueueOperations }) {
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
          <div className="inline-form"><input value={url} onChange={(event) => setState({ url: event.target.value })} /><button className="button" onClick={addTask}>添加作者链接</button></div>
          <div className="task-list">{tasks.length ? tasks.map((task, index) => <div className="task-item" key={task.url}><span>{index + 1}</span><code>{task.url}</code><b>{task.status}</b><button className="button compact" onClick={() => start(task)}>开始</button></div>) : <div className="empty-task">暂无作者任务</div>}</div>
        </fieldset>
        <fieldset className="backup-box"><legend>配置区</legend>
          <label>翻页间隔 <input className="short" type="number" value={intervalSeconds} min="2" onChange={(event) => setState({ intervalSeconds: Number(event.target.value) })} /> 秒</label>
          <button className="button" onClick={() => notify("任务和结果已保存到本地浏览器。", "success")}>保存备份</button>
          <button className="button" onClick={() => setTasks([])}>清空任务</button>
          {data.desktopMode && <button className="button" onClick={() => { callDesktop("stopTask", accountId); setLive(false); }}>停止采集</button>}
        </fieldset>
      </div>
      <div className="action-row"><strong>作者笔记结果</strong><span className="spacer" /><button className="button" onClick={() => downloadCsv(`${accountName}-作者笔记.csv`, authorNotes, [{ key: "author", label: "作者" }, { key: "title", label: "标题" }, { key: "link", label: "笔记链接" }, { key: "likes", label: "点赞数" }, { key: "type", label: "类型" }])}>导出 CSV</button></div>
      <NotesTable rows={authorNotes} selected={selected} setSelected={setSelected} onOpenLink={openNote} onQueueComments={onQueueComments} onQueueOperations={onQueueOperations} />
    </div>
  );
}

function CommentsPanel({ accountId, accountName, data, state, setState, tasks, setTasks, setCurrentUrl, setLive, notify }) {
  const { url = EXPLORE_URL, region = "", contains = "", timeRange = "all", unique = true } = state;
  const rows = useMemo(() => {
    let next = data.comments.filter((comment) => (!region || comment.region?.includes(region))
      && (!contains || comment.content?.includes(contains))
      && commentMatchesTimeRange(comment.time, timeRange));
    if (unique) next = Array.from(new Map(next.map((comment) => [comment.authorId || comment.nickname, comment])).values());
    return next;
  }, [data.comments, region, contains, timeRange, unique]);

  const setTaskStatus = (task, status) => setTasks((previous) => previous.map((item) => (item.id || item.link) === (task.id || task.link) ? { ...item, status } : item));
  const start = async (task) => {
    setCurrentUrl(task.link);
    setTaskStatus(task, "正在打开");
    try {
      if (data.desktopMode) await callDesktop("startTask", accountId, { kind: "comments", url: task.link, target: 1000 });
      else if (data.extensionMode) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) await chrome.tabs.update(tab.id, { url: task.link });
      } else {
        setLive(false);
        setTaskStatus(task, "等待桌面版");
        notify("当前是网页演示，无法采集；请运行桌面版。", "error");
        return;
      }
      setLive(true);
      setTaskStatus(task, "监听中");
      notify("真实笔记已打开，正在读取页面评论并监听分页响应。", "success");
    } catch (error) {
      setLive(false);
      setTaskStatus(task, "启动失败");
      notify(`评论采集启动失败：${error.message}`, "error");
    }
  };

  const addAndStart = async () => {
    if (!/^https:\/\/www\.xiaohongshu\.com\/(explore|discovery\/item)\//.test(url)) { notify("请输入小红书笔记链接。", "error"); return; }
    const task = asQueueTask({ id: noteIdFromUrl(url), link: url, title: "手动添加的笔记" });
    setTasks((previous) => mergeQueue(previous, [task]));
    await start(task);
  };

  const toggleTask = (task, checked) => setTasks((previous) => previous.map((item) => (item.id || item.link) === (task.id || task.link) ? { ...item, selected: checked } : item));
  const deleteSelectedTasks = () => {
    const count = tasks.filter((task) => task.selected).length;
    setTasks((previous) => previous.filter((task) => !task.selected));
    notify(count ? `已从评论采集队列移除 ${count} 条。` : "请先勾选要移除的任务。", count ? "success" : "info");
  };

  return (
    <div className="panel-body">
      <div className="comments-top">
        <fieldset className="link-box"><legend>笔记链接</legend><div className="inline-form"><input value={url} onChange={(event) => setState({ url: event.target.value })} /><button className="button" onClick={addAndStart}>添加并打开</button></div><div className="link-list">{tasks.map((task, index) => <div key={task.id || task.link}><input aria-label={`选择评论任务 ${task.title}`} type="checkbox" checked={Boolean(task.selected)} onChange={(event) => toggleTask(task, event.target.checked)} /><span>{index + 1}</span><code title={task.link}>{task.title || task.link}</code><b>{task.status || "待采集"}</b><button className="button compact" onClick={() => start(task)}>采集</button></div>)}{!tasks.length && <span className="empty-task">暂无链接；可在笔记表格右键加入</span>}</div></fieldset>
        <fieldset className="comment-filter"><legend>条件筛选</legend><label>地区含 <input value={region} onChange={(event) => setState({ region: event.target.value })} /></label><label>评论含 <input value={contains} onChange={(event) => setState({ contains: event.target.value })} /></label><label>发布时间 <select aria-label="发布时间" value={timeRange} onChange={(event) => setState({ timeRange: event.target.value })}><option value="all">不限</option><option value="day">一天内</option><option value="week">一周内</option><option value="month">一月内</option><option value="half-year">半年内</option></select></label><label><input type="checkbox" checked={unique} onChange={(event) => setState({ unique: event.target.checked })} /> 去除重复发言用户</label></fieldset>
      </div>
      <div className="action-row"><button className="button" onClick={deleteSelectedTasks}>移除选中任务</button><button className="button" onClick={() => setState({ region: "", contains: "", timeRange: "all" })}>清空筛选</button><button className="button" onClick={() => { data.clearComments(); notify("评论列表已清空。") }}>全部删除评论</button>{data.desktopMode && <button className="button" onClick={() => { callDesktop("stopTask", accountId); setLive(false); }}>停止采集</button>}<span className="spacer" /><strong>{rows.length} / {data.comments.length}</strong><button className="button" onClick={() => downloadCsv(`${accountName}-笔记评论.csv`, rows, [{ key: "noteId", label: "笔记ID" }, { key: "time", label: "时间" }, { key: "nickname", label: "昵称" }, { key: "content", label: "评论内容" }, { key: "authorId", label: "公开UID（已脱敏）" }, { key: "region", label: "地区" }])}>导出 CSV</button></div>
      <div className="table-wrap"><table><thead><tr><th className="number">编号</th><th>链接</th><th>时间</th><th>昵称</th><th>评论内容</th><th>公开 UID</th><th>地区</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.id}><td className="number">{index + 1}</td><td>{row.noteId}</td><td>{row.time}</td><td>{row.nickname}</td><td title={row.content}>{row.content}</td><td>{row.authorId}</td><td>{row.region}</td></tr>)}{!rows.length && <tr><td colSpan="7" className="empty">还没有符合条件的评论</td></tr>}</tbody></table></div>
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
    notify("已加入笔记操作区。", "success");
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
        <fieldset className="operation-link-box"><legend>笔记操作区</legend>
          <div className="inline-form"><input disabled={running} value={url} onChange={(event) => setState({ url: event.target.value })} /><button className="button" disabled={running} onClick={addManual}>添加链接</button><button className="button" disabled={!selectedTasks.length || running} onClick={removeSelected}>删除选中</button></div>
          <span className="operation-help">也可在搜索或作者笔记表格中右键，把当前条目或已勾选条目加入这里。</span>
        </fieldset>
        <fieldset className="operation-config"><legend>执行配置</legend>
          <label><input type="checkbox" checked={likeEnabled} onChange={(event) => setState({ likeEnabled: event.target.checked })} /> 点赞</label>
          <label><input type="checkbox" checked={collectEnabled} onChange={(event) => setState({ collectEnabled: event.target.checked })} /> 收藏</label>
          <label><input type="checkbox" checked={commentEnabled} onChange={(event) => setState({ commentEnabled: event.target.checked })} /> 发布评论</label>
          <label>间隔 <input className="short" type="number" min="1" max="600" step="0.01" value={intervalMinutes} onChange={(event) => setState({ intervalMinutes: Number(event.target.value) })} /> 分钟</label>
          <textarea aria-label="评论内容" disabled={!commentEnabled} value={commentText} onChange={(event) => setState({ commentText: event.target.value })} placeholder="输入评论正文" />
          <span className="interval-random-hint">{intervalStatus || "每条间隔会在设定值基础上随机浮动 -10.00～+10.00 秒，精确到 0.01 秒"}</span>
          <span className="random-comment-hint">每条发送前会在正文中间随机加入 1 个“.”和 1 个 emoji</span>
        </fieldset>
      </div>
      <div className="action-row"><button className="button" disabled={running || !tasks.length} onClick={() => setTasks((previous) => previous.map((task) => ({ ...task, selected: true })))}>全选任务</button><button className="button" disabled={running || !selectedTasks.length} onClick={() => setTasks((previous) => previous.map((task) => ({ ...task, selected: false })))}>取消选择</button><button className="button" disabled={running || !tasks.length} onClick={() => setTasks([])}>清空列表</button><span className="spacer" /><strong>已选 {selectedTasks.length} / {tasks.length}</strong>{running ? <button className="button primary" onClick={stop}>停止</button> : <button className="button primary" disabled={!selectedTasks.length} onClick={start}>开始逐条执行</button>}</div>
      <div className="table-wrap"><table><thead><tr><th className="check"><input aria-label="全选操作任务" type="checkbox" disabled={running || !tasks.length} checked={tasks.length > 0 && tasks.every((task) => task.selected)} onChange={(event) => setTasks((previous) => previous.map((task) => ({ ...task, selected: event.target.checked })))} /></th><th className="number">编号</th><th>笔记</th><th>链接</th><th className="op-status">点赞状态</th><th className="op-status">评论状态</th><th className="op-status">收藏状态</th><th className="task-status">任务状态</th></tr></thead><tbody>{tasks.map((task, index) => <tr key={task.id || task.link} className={task.selected ? "selected" : ""}><td className="check"><input aria-label={`选择操作任务 ${task.title}`} type="checkbox" checked={Boolean(task.selected)} disabled={running} onChange={(event) => toggleTask(task, event.target.checked)} /></td><td className="number">{index + 1}</td><td title={task.title}>{task.title}</td><td><a href={task.link} target="_blank" rel="noreferrer" title={task.link} onClick={(event) => openNote(event, task)}>{task.link}</a></td><td className="op-status">{task.likeStatus || "—"}</td><td className="op-status" title={task.sentComment ? `实际评论：${task.sentComment}` : "尚未生成评论"}>{task.commentStatus || "—"}</td><td className="op-status">{task.collectStatus || "—"}</td><td className="task-status">{task.status || "待执行"}</td></tr>)}{!tasks.length && <tr><td colSpan="8" className="empty">暂无任务；请在笔记表格右键加入</td></tr>}</tbody></table></div>
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
  const activeTab = workspace.ui.activeTab;
  const keyword = workspace.ui.keyword;
  const currentUrl = workspace.ui.currentUrl;
  const live = Boolean(workspace.ui.live);
  const muted = workspace.ui.muted !== false;
  const commentTasks = workspace.commentTasks;
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
  const setKeyword = (value) => setUi({ keyword: typeof value === "function" ? value(keyword) : value });
  const setCurrentUrl = (value) => setUi({ currentUrl: typeof value === "function" ? value(currentUrl) : value });
  const setLive = (value) => setUi({ live: typeof value === "function" ? value(live) : value });
  const setCommentTasks = (value) => setWorkspaceList("commentTasks", value);
  const setOperationTasks = (value) => setWorkspaceList("operationTasks", value);
  const panelNotify = (message, type = "info") => notifyForAccount(activeAccountId, message, type);

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
        setWorkspaceSection("ui", { live: Boolean(status.active ?? status.capture?.active ?? status.operationActive) }, accountId);
        if (status.phase === "error") notifyForAccount(accountId, status.message || "任务执行异常。", "error");
        else if (status.phase === "stopped") notifyForAccount(accountId, status.message || "任务已停止。", "success");
      }));
    }
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe?.());
  }, [desktop, desktopMode, notifyForAccount, updateWorkspace]);

  useEffect(() => {
    if (!desktopMode || !activeAccountId) return undefined;
    const preview = document.querySelector(".browser-preview");
    if (!preview) return undefined;
    const updateBounds = () => {
      const rect = preview.getBoundingClientRect();
      desktop.setBrowserBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
    };
    const observer = new ResizeObserver(updateBounds);
    observer.observe(preview);
    window.addEventListener("resize", updateBounds);
    const frame = requestAnimationFrame(updateBounds);
    return () => { observer.disconnect(); window.removeEventListener("resize", updateBounds); cancelAnimationFrame(frame); };
  }, [activeAccountId, desktop, desktopMode]);

  const switchAccount = async (accountId) => {
    if (!accountId || accountId === activeAccountId) return;
    try {
      if (desktopMode && typeof accountApi?.switch === "function") await accountApi.switch(accountId);
      setActiveAccountId(accountId);
    } catch (error) {
      notify(`切换账号失败：${error.message}`, "error");
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

  const submitAccountDialog = async (name) => {
    if (!accountApi || !accountDialog) return;
    setAccountBusy(true);
    try {
      if (accountDialog.mode === "add") {
        const result = await accountApi.add({ name });
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
    else setCurrentUrl(HOME_URL);
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
      panelNotify("已在左侧打开目标笔记。", "success");
    } catch (error) {
      panelNotify(`打开笔记失败：${error.message}`, "error");
    }
  };
  const queueComments = (notes) => {
    setCommentTasks((previous) => mergeQueue(previous, notes));
    setActiveTab("comments");
    panelNotify(`已把 ${notes.length} 条笔记加入评论采集队列。`, "success");
  };
  const queueOperations = (notes) => {
    setOperationTasks((previous) => mergeQueue(previous, notes));
    setActiveTab("safe");
    panelNotify(`已把 ${notes.length} 条笔记加入操作队列。`, "success");
  };

  const loggedInCount = accounts.filter((account) => account.loginPhase === "logged-in").length;
  const runningCount = accounts.filter((account) => Boolean(account.capture?.active || account.operationActive || workspaces[account.id]?.ui?.live || workspaces[account.id]?.operation?.running)).length;
  const activePhase = loginPhaseLabel(activeAccount, desktopMode);

  return (
    <main className="app-shell">
      <header className="titlebar">
        <div className="brand-lockup"><img className="brand-mark" src={`${import.meta.env.BASE_URL}assets/ai-collector-icon.png`} alt="AI 采集" /><strong>小红书多账号采集工作台</strong><span>V2.0</span></div>
        <AccountBar
          accounts={accounts}
          activeAccountId={activeAccountId}
          desktopMode={desktopMode}
          onSwitch={switchAccount}
          onAdd={() => setAccountDialog({ mode: "add", suggestedName: `账号 ${accounts.length + 1}` })}
          onRename={(account) => setAccountDialog({ mode: "rename", account })}
          onRemove={(account) => setAccountDialog({ mode: "remove", account })}
          onRefresh={refreshAccountStatus}
        />
      </header>
      <nav className="tabs" aria-label="采集模块">{tabs.map((tab) => <button key={tab.id} type="button" className={activeTab === tab.id ? "active" : ""} disabled={tab.disabled || !activeAccountId} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>)}</nav>
      <div className="workspace">
        <BrowserPane account={activeAccount} keyword={keyword} currentUrl={currentUrl} live={live} muted={muted} extensionMode={data.extensionMode} desktopMode={data.desktopMode} onHome={goHome} onReload={reloadBrowser} onMuted={setMuted} />
        <section className="workbench">
          {!activeAccountId ? (
            <div className="account-required"><IconUserCircle size={36} stroke={1.5} /><strong>先添加一个账号</strong><span>创建独立登录空间后，即可在左侧登录并开始采集。</span><button className="button primary" type="button" onClick={() => setAccountDialog({ mode: "add", suggestedName: "账号 1" })}>添加账号</button></div>
          ) : (
            <>
              <div className="panel-route" hidden={activeTab !== "safe"}><OperationPanel accountId={activeAccountId} data={data} state={workspace.operation} setState={(value) => setWorkspaceSection("operation", value)} tasks={operationTasks} setTasks={setOperationTasks} setCurrentUrl={setCurrentUrl} setLive={setLive} notify={panelNotify} openNote={openNote} /></div>
              <div className="panel-route" hidden={activeTab !== "search"}><SearchPanel accountId={activeAccountId} accountName={accountName} data={data} state={workspace.search} setState={(value) => setWorkspaceSection("search", value)} keyword={keyword} setKeyword={setKeyword} setCurrentUrl={setCurrentUrl} live={live} setLive={setLive} notify={panelNotify} openNote={openNote} onQueueComments={queueComments} onQueueOperations={queueOperations} /></div>
              <div className="panel-route" hidden={activeTab !== "author"}><AuthorPanel accountId={activeAccountId} accountName={accountName} data={data} state={workspace.author} setState={(value) => setWorkspaceSection("author", value)} setCurrentUrl={setCurrentUrl} setLive={setLive} notify={panelNotify} openNote={openNote} onQueueComments={queueComments} onQueueOperations={queueOperations} /></div>
              <div className="panel-route" hidden={activeTab !== "comments"}><CommentsPanel accountId={activeAccountId} accountName={accountName} data={data} state={workspace.commentsPanel} setState={(value) => setWorkspaceSection("commentsPanel", value)} tasks={commentTasks} setTasks={setCommentTasks} setCurrentUrl={setCurrentUrl} setLive={setLive} notify={panelNotify} /></div>
            </>
          )}
        </section>
      </div>
      <footer className="statusbar"><span><StatusDot active={live || activeAccount?.loginPhase === "logged-in"} phase={live ? "running" : activeAccount?.loginPhase} />{live ? `${accountName}任务运行中` : `${accountName} · ${activePhase}`}</span><span>{desktopMode ? `${loggedInCount} 个账号已登录${runningCount ? ` · ${runningCount} 个运行中` : ""}` : "多账号需桌面版"}</span><span>本地独立存储</span><span>不导出 Cookie</span><span className="status-grow">每个账号的页面、采集结果和操作队列相互隔离</span></footer>
      {toast && <div className={`toast ${toast.type}`}>{toast.message}</div>}
      {accountDialog && <AccountDialog key={`${accountDialog.mode}-${accountDialog.account?.id ?? "new"}`} dialog={accountDialog} busy={accountBusy} onCancel={() => !accountBusy && setAccountDialog(null)} onSubmit={submitAccountDialog} />}
    </main>
  );
}
