const NOTE_ID_PATTERN = /^[a-f\d]{24}$/i;
const UNKNOWN_LABEL = "未知";
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

export const STATISTICAL_MODEL_VERSION = "xhs-descriptive-statistics-2026-08-24-v1";
export const STATISTICAL_MODEL_METHODS = Object.freeze([
  "计数",
  "求和",
  "中位数",
  "频次分组",
  "占比",
  "时间分桶",
  "关联覆盖率",
  "缺失值校验",
]);

const KEYWORD_STOP_WORDS = new Set([
  "一个", "一些", "这个", "这些", "那个", "那些", "什么", "怎么", "如何", "为什么",
  "可以", "就是", "还是", "真的", "自己", "我们", "你们", "他们", "关于", "以及",
  "小红书", "笔记", "视频", "分享", "记录", "今天", "昨天",
]);

const asText = (value) => value == null ? "" : String(value).trim();
const asArray = (value) => Array.isArray(value) ? value : [];
const joinKey = (accountId, noteId) => `${accountId}\u0000${noteId}`;
const round = (value, digits = 4) => Number(Number(value || 0).toFixed(digits));

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function stableId(value) {
  let hash = 2166136261;
  for (const character of asText(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function evidenceRef(kind, accountId, entityId) {
  return `${kind}:${encodeURIComponent(accountId)}:${encodeURIComponent(entityId)}`;
}

function canonicalLink(rawLink) {
  const link = asText(rawLink);
  if (!link) return "";
  try {
    const url = new URL(link);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.protocol.toLowerCase()}//${url.hostname.toLowerCase()}${pathname}`;
  } catch {
    return link.split(/[?#]/, 1)[0].replace(/\/+$/, "");
  }
}

function noteIdFromLink(rawLink) {
  try {
    return new URL(rawLink).pathname.match(/\/(?:explore|discovery\/item)\/([a-f\d]{24})/i)?.[1]?.toLowerCase() || "";
  } catch {
    return asText(rawLink).match(/\/(?:explore|discovery\/item)\/([a-f\d]{24})/i)?.[1]?.toLowerCase() || "";
  }
}

function noteEntityId(row, fallback) {
  const rawId = asText(row?.id);
  if (NOTE_ID_PATTERN.test(rawId)) return rawId.toLowerCase();
  const linkedId = noteIdFromLink(row?.link);
  if (linkedId) return linkedId;
  if (rawId) return rawId;
  const link = canonicalLink(row?.link);
  return link || fallback;
}

function relatedNoteId(value) {
  const id = asText(value);
  return NOTE_ID_PATTERN.test(id) ? id.toLowerCase() : id;
}

function numberOrNull(value) {
  if (value == null || (typeof value === "string" && !value.trim())) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function parseClock(text) {
  const match = asText(text).match(/(\d{1,2})(?::(\d{1,2}))?/);
  return match ? { hours: Number(match[1]), minutes: Number(match[2] || 0) } : { hours: 0, minutes: 0 };
}

function subtractCalendarMonths(now, months) {
  const date = new Date(now);
  const day = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() - months);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(day, lastDay));
  return date;
}

function subtractCalendarYears(now, years) {
  const date = new Date(now);
  const month = date.getMonth();
  const day = date.getDate();
  date.setDate(1);
  date.setFullYear(date.getFullYear() - years);
  date.setMonth(month);
  const lastDay = new Date(date.getFullYear(), month + 1, 0).getDate();
  date.setDate(Math.min(day, lastDay));
  return date;
}

export function parseAnalyticsTimestamp(value, now = Date.now()) {
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(nowMs)) return null;
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) && timestamp <= nowMs + FUTURE_TOLERANCE_MS ? timestamp : null;
  }

  const numeric = numberOrNull(value);
  if (numeric != null && numeric > 0 && !/^\d{4}-\d{1,2}/.test(asText(value))) {
    const timestamp = numeric < 1e12 ? numeric * 1000 : numeric;
    return timestamp <= nowMs + FUTURE_TOLERANCE_MS ? timestamp : null;
  }

  const text = asText(value);
  if (!text) return null;
  const nowDate = new Date(nowMs);
  if (text === "刚刚") return nowMs;

  const relative = text.match(/^(\d+)\s*(分钟|小时|天|周|个月|月|年)前$/);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2];
    if (unit === "分钟") return nowMs - amount * 60 * 1000;
    if (unit === "小时") return nowMs - amount * 60 * 60 * 1000;
    if (unit === "天") return nowMs - amount * 24 * 60 * 60 * 1000;
    if (unit === "周") return nowMs - amount * 7 * 24 * 60 * 60 * 1000;
    if (unit === "个月" || unit === "月") return subtractCalendarMonths(nowDate, amount).getTime();
    if (unit === "年") return subtractCalendarYears(nowDate, amount).getTime();
  }
  if (/^(今天|昨天)/.test(text)) {
    const clock = parseClock(text);
    const date = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate(), clock.hours, clock.minutes);
    if (text.startsWith("昨天")) date.setDate(date.getDate() - 1);
    return date.getTime();
  }

  const timestamp = Date.parse(text.replace(/年|月/g, "-").replace(/日/g, ""));
  return Number.isFinite(timestamp) && timestamp <= nowMs + FUTURE_TOLERANCE_MS ? timestamp : null;
}

function monthKey(timestamp) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function mergeRecord(previous, incoming) {
  if (!previous) return { ...incoming };
  const merged = { ...previous, ...incoming };
  for (const key of Object.keys(previous)) {
    if (incoming[key] == null || incoming[key] === "") merged[key] = previous[key];
  }
  const previousLikes = numberOrNull(previous.likes);
  const incomingLikes = numberOrNull(incoming.likes);
  if (previousLikes != null || incomingLikes != null) merged.likes = Math.max(previousLikes ?? -Infinity, incomingLikes ?? -Infinity);
  return merged;
}

function makeMetric(value, evidenceRefs, extra = {}) {
  return { value, evidenceRefs: unique(evidenceRefs), ...extra };
}

function tokenizeTitle(title) {
  const normalized = asText(title).normalize("NFKC").toLowerCase();
  if (!normalized) return [];
  let candidates = [];
  if (typeof Intl?.Segmenter === "function") {
    const segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });
    candidates = Array.from(segmenter.segment(normalized))
      .filter((entry) => entry.isWordLike !== false)
      .map((entry) => entry.segment);
  } else {
    candidates = normalized.match(/[\p{Script=Han}]{2,8}|[\p{L}\p{N}]{2,}/gu) || [];
  }
  return unique(candidates.map((candidate) => candidate.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((candidate) => candidate.length >= 2 && !KEYWORD_STOP_WORDS.has(candidate)));
}

function operationTaskComplete(task) {
  if (/^已完成(?:\s|$)/.test(asText(task?.status))) return true;
  const actionStatuses = [task?.likeStatus, task?.commentStatus, task?.collectStatus].map(asText).filter(Boolean);
  return actionStatuses.length > 0
    && actionStatuses.every((status) => status === "未启用" || /^已完成/.test(status));
}

function makeInsight({ id, title, text, evidenceRefs, value, unit = "", numerator = null, denominator = null, formula = "", limitations = [] }) {
  const refs = unique(evidenceRefs);
  return {
    id,
    title,
    text,
    value,
    evidenceRefs: refs,
    metric: makeMetric(value, refs, { unit, numerator, denominator, formula }),
    limitations,
  };
}

function groupNotes(notes, keyOf, labelOf = (key) => key) {
  const groups = new Map();
  for (const note of notes) {
    const key = keyOf(note);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(note);
  }
  return Array.from(groups.entries()).map(([key, rows]) => {
    const likes = rows.map((row) => row.likes).filter(Number.isFinite);
    return {
      key,
      label: labelOf(key, rows),
      value: rows.length,
      noteCount: rows.length,
      knownLikesCount: likes.length,
      totalLikes: likes.length ? likes.reduce((sum, value) => sum + value, 0) : null,
      medianLikes: median(likes),
      likes: median(likes),
      evidenceRefs: rows.map((row) => row.ref),
    };
  });
}

export function buildAnalyticsModel({ accounts = [], workspaces = {}, scopeAccountId = "", now = Date.now() } = {}) {
  const nowMs = new Date(now).getTime();
  const effectiveNow = Number.isFinite(nowMs) ? nowMs : Date.now();
  const accountRows = asArray(accounts).filter((account) => asText(account?.id));
  const accountMap = new Map(accountRows.map((account) => [asText(account.id), account]));
  const orderedAccountIds = unique([
    ...accountRows.map((account) => asText(account.id)),
    ...Object.keys(workspaces || {}).map(asText).sort(),
  ]);
  const requestedAccountId = asText(scopeAccountId);
  const accountIds = requestedAccountId ? [requestedAccountId] : orderedAccountIds;
  const evidenceIndex = {};
  const byAccountId = {};
  const noteMap = new Map();
  const comments = [];
  const commentTasks = [];
  const operationTasks = [];
  const accountRefs = [];
  const workspaceRefs = [];

  const addEvidence = (kind, accountId, entityId, data, extra = {}) => {
    let ref = evidenceRef(kind, accountId, entityId);
    let suffix = 2;
    while (evidenceIndex[ref]) {
      ref = evidenceRef(kind, accountId, `${entityId}#${suffix}`);
      suffix += 1;
    }
    evidenceIndex[ref] = { ref, kind, accountId, entityId, noteId: "", data, ...extra };
    return ref;
  };

  for (const accountId of accountIds) {
    const account = accountMap.get(accountId) || { id: accountId, name: `账号 ${accountId}` };
    const workspace = workspaces?.[accountId] && typeof workspaces[accountId] === "object" ? workspaces[accountId] : {};
    const accountRef = addEvidence("account", accountId, accountId, { ...account, id: accountId });
    const workspaceRef = addEvidence("workspace", accountId, accountId, {
      accountId,
      stats: { ...(workspace.stats || {}) },
    });
    accountRefs.push(accountRef);
    workspaceRefs.push(workspaceRef);
    byAccountId[accountId] = {
      accountId,
      accountRef,
      workspaceRef,
      noteRefs: [],
      commentRefs: [],
      commentTaskRefs: [],
      operationTaskRefs: [],
      evidenceRefs: [accountRef, workspaceRef],
    };

    asArray(workspace.notes).forEach((rawNote, index) => {
      const entityId = noteEntityId(rawNote, `anonymous-${stableId(`${accountId}\u0000${index}\u0000${asText(rawNote?.title)}`)}`);
      const key = joinKey(accountId, entityId);
      const incoming = { ...rawNote, accountId, entityId };
      const existing = noteMap.get(key);
      noteMap.set(key, existing ? { ...existing, ...mergeRecord(existing, incoming) } : incoming);
    });
  }

  const notes = Array.from(noteMap.entries()).map(([join, row]) => {
    const accountId = row.accountId;
    const entityId = row.entityId;
    const likes = numberOrNull(row.likes);
    const timestamp = parseAnalyticsTimestamp(row.time, effectiveNow);
    const data = {
      ...row,
      id: asText(row.id) || entityId,
      accountId,
      likes,
    };
    delete data.entityId;
    const ref = addEvidence("note", accountId, entityId, data, { noteId: entityId });
    byAccountId[accountId].noteRefs.push(ref);
    byAccountId[accountId].evidenceRefs.push(ref);
    return { ...data, entityId, join, ref, timestamp };
  });
  const noteByJoin = new Map(notes.map((note) => [note.join, note]));
  const byNoteRef = Object.fromEntries(notes.map((note) => [note.ref, {
    noteRef: note.ref,
    accountId: note.accountId,
    noteId: note.entityId,
    commentRefs: [],
    commentTaskRefs: [],
    operationTaskRefs: [],
    evidenceRefs: [note.ref],
  }]));

  for (const accountId of accountIds) {
    const workspace = workspaces?.[accountId] && typeof workspaces[accountId] === "object" ? workspaces[accountId] : {};
    const commentMap = new Map();
    asArray(workspace.comments).forEach((rawComment, index) => {
      const noteId = relatedNoteId(rawComment?.noteId);
      const identity = [noteId, rawComment?.authorId || rawComment?.nickname, rawComment?.content, rawComment?.time].map(asText).join("\u0000");
      const fallback = stableId(identity.replaceAll("\u0000", "") ? identity : `${accountId}\u0000${index}`);
      const entityId = asText(rawComment?.id) || `anonymous-${fallback}`;
      commentMap.set(entityId, mergeRecord(commentMap.get(entityId), { ...rawComment, accountId, entityId, noteId }));
    });

    for (const row of commentMap.values()) {
      const note = row.noteId ? noteByJoin.get(joinKey(accountId, row.noteId)) : null;
      const timestamp = parseAnalyticsTimestamp(row.time, effectiveNow);
      const data = { ...row, id: asText(row.id) || row.entityId, accountId, noteId: row.noteId };
      delete data.entityId;
      const ref = addEvidence("comment", accountId, row.entityId, data, { noteId: row.noteId, noteRef: note?.ref || "" });
      const comment = { ...data, entityId: row.entityId, ref, noteRef: note?.ref || "", timestamp };
      comments.push(comment);
      byAccountId[accountId].commentRefs.push(ref);
      byAccountId[accountId].evidenceRefs.push(ref);
      if (note) {
        byNoteRef[note.ref].commentRefs.push(ref);
        byNoteRef[note.ref].evidenceRefs.push(ref);
      }
    }

    const collectTasks = (rows, kind, target) => {
      asArray(rows).forEach((rawTask, index) => {
        const entityId = noteEntityId(rawTask, `anonymous-${stableId(`${accountId}\u0000${kind}\u0000${index}\u0000${asText(rawTask?.title)}`)}`);
        const note = noteByJoin.get(joinKey(accountId, entityId));
        const taskId = asText(rawTask?.taskId) || entityId || `anonymous-${index + 1}`;
        const data = { ...rawTask, accountId, taskKey: taskId, noteId: entityId };
        const ref = addEvidence(kind, accountId, taskId, data, { noteId: entityId, noteRef: note?.ref || "" });
        const task = { ...data, entityId: taskId, ref, noteRef: note?.ref || "" };
        target.push(task);
        const accountField = kind === "comment-task" ? "commentTaskRefs" : "operationTaskRefs";
        byAccountId[accountId][accountField].push(ref);
        byAccountId[accountId].evidenceRefs.push(ref);
        if (note) {
          byNoteRef[note.ref][accountField].push(ref);
          byNoteRef[note.ref].evidenceRefs.push(ref);
        }
      });
    };

    collectTasks(workspace.commentTasks, "comment-task", commentTasks);
    collectTasks(workspace.operationTasks, "operation-task", operationTasks);
  }

  for (const relation of Object.values(byNoteRef)) relation.evidenceRefs = unique(relation.evidenceRefs);
  for (const relation of Object.values(byAccountId)) relation.evidenceRefs = unique(relation.evidenceRefs);

  const noteRefs = notes.map((note) => note.ref);
  const commentRefs = comments.map((comment) => comment.ref);
  const linkedComments = comments.filter((comment) => comment.noteRef);
  const orphanComments = comments.filter((comment) => !comment.noteRef);
  const orphanCommentTasks = commentTasks.filter((task) => !task.noteRef);
  const orphanOperationTasks = operationTasks.filter((task) => !task.noteRef);
  const knownNoteTimes = notes.filter((note) => note.timestamp != null);
  const knownCommentTimes = comments.filter((comment) => comment.timestamp != null);
  const knownLikeNotes = notes.filter((note) => Number.isFinite(note.likes));
  const unknownLikeNotes = notes.filter((note) => !Number.isFinite(note.likes));
  const knownLikes = knownLikeNotes.map((note) => note.likes);
  const authorKeys = new Set(notes.map((note) => asText(note.authorId) || asText(note.author)).filter(Boolean));
  const commenterKeys = new Set(comments.map((comment) => asText(comment.authorId) || asText(comment.nickname)).filter(Boolean));
  const commentedNoteRefs = unique(linkedComments.map((comment) => comment.noteRef));
  const completedOperationTasks = operationTasks.filter(operationTaskComplete);
  const captureBatchCount = accountIds.reduce((sum, accountId) => sum + Math.max(0, Number(workspaces?.[accountId]?.stats?.captures) || 0), 0);
  const updatedAtValues = accountIds.map((accountId) => numberOrNull(workspaces?.[accountId]?.stats?.updatedAt)).filter(Number.isFinite);

  const summaryById = {
    accountCount: makeMetric(accountIds.length, accountRefs, { label: "账号数" }),
    noteCount: makeMetric(notes.length, noteRefs, { label: "笔记记录" }),
    commentCount: makeMetric(comments.length, commentRefs, { label: "评论记录" }),
    linkedCommentCount: makeMetric(linkedComments.length, linkedComments.map((comment) => comment.ref), { label: "可关联评论" }),
    orphanCommentCount: makeMetric(orphanComments.length, orphanComments.map((comment) => comment.ref), { label: "孤立评论" }),
    commentedNoteCount: makeMetric(commentedNoteRefs.length, unique([...commentedNoteRefs, ...linkedComments.map((comment) => comment.ref)]), { label: "有关联评论的笔记" }),
    authorCount: makeMetric(authorKeys.size, noteRefs, { label: "笔记作者" }),
    commenterCount: makeMetric(commenterKeys.size, commentRefs, { label: "估算去重评论用户", estimated: true }),
    totalLikes: makeMetric(knownLikes.length ? knownLikes.reduce((sum, value) => sum + value, 0) : null, knownLikeNotes.map((note) => note.ref), { label: "累计观测点赞" }),
    medianLikes: makeMetric(median(knownLikes), knownLikeNotes.map((note) => note.ref), { label: "点赞中位数" }),
    knownLikesCount: makeMetric(knownLikeNotes.length, knownLikeNotes.map((note) => note.ref), { label: "点赞值已知笔记" }),
    unknownLikesCount: makeMetric(unknownLikeNotes.length, unknownLikeNotes.map((note) => note.ref), { label: "点赞值未知笔记" }),
    likesCoverage: makeMetric(notes.length ? round(knownLikeNotes.length / notes.length) : null, noteRefs, { label: "点赞观测完整率" }),
    knownNoteTimeCount: makeMetric(knownNoteTimes.length, knownNoteTimes.map((note) => note.ref), { label: "发布时间已知笔记" }),
    unknownNoteTimeCount: makeMetric(notes.length - knownNoteTimes.length, notes.filter((note) => note.timestamp == null).map((note) => note.ref), { label: "发布时间未知笔记" }),
    knownCommentTimeCount: makeMetric(knownCommentTimes.length, knownCommentTimes.map((comment) => comment.ref), { label: "时间已知评论" }),
    commentTaskCount: makeMetric(commentTasks.length, commentTasks.map((task) => task.ref), { label: "评论采集任务" }),
    operationTaskCount: makeMetric(operationTasks.length, operationTasks.map((task) => task.ref), { label: "操作任务" }),
    completedOperationTaskCount: makeMetric(completedOperationTasks.length, completedOperationTasks.map((task) => task.ref), { label: "已完成操作任务" }),
    captureBatchCount: makeMetric(captureBatchCount, workspaceRefs, { label: "采集响应批次" }),
    updatedAt: makeMetric(updatedAtValues.length ? Math.max(...updatedAtValues) : null, workspaceRefs, { label: "最近数据更新时间" }),
  };
  const summaryFormulas = {
    accountCount: "当前分析范围内的账号数",
    noteCount: "按 accountId + noteId（无 noteId 时用规范化链接）去重",
    commentCount: "按 accountId + commentId 去重；缺失 commentId 时使用稳定内容标识",
    linkedCommentCount: "comment.noteId 与同账号笔记关联键匹配",
    orphanCommentCount: "comment.noteId 为空或在同账号笔记索引中无匹配项",
    commentedNoteCount: "至少关联一条已采集评论的笔记去重数",
    authorCount: "按脱敏作者公开标识；缺失时按作者名称估算去重",
    commenterCount: "按脱敏评论用户公开标识；缺失时按昵称估算去重",
    totalLikes: "所有点赞值有效的笔记记录之和；无有效观测时返回 null",
    medianLikes: "所有点赞值有效的笔记记录中位数",
    knownLikesCount: "点赞值为有效有限数值的笔记数；真实的 0 点赞属于有效观测",
    unknownLikesCount: "点赞字段为空、缺失或无法解析的笔记数",
    likesCoverage: "点赞值有效笔记数 / 全部笔记数；无笔记时返回 null",
    knownNoteTimeCount: "发布时间可解析且不晚于报告时间 5 分钟的笔记数",
    unknownNoteTimeCount: "发布时间为空、不可解析或异常未来时间的笔记数",
    knownCommentTimeCount: "评论时间可解析且不晚于报告时间 5 分钟的评论数",
    commentTaskCount: "当前保存的评论采集队列记录数",
    operationTaskCount: "当前保存的操作队列记录数",
    completedOperationTaskCount: "任务状态以“已完成”开头，或全部已记录动作状态均为“已完成/未启用”",
    captureBatchCount: "各账号 workspace.stats.captures 之和；表示采集响应批次，不等同于任务次数",
    updatedAt: "各账号 workspace.stats.updatedAt 的最大值",
  };
  const summaryDetails = {
    commenterCount: "公开用户 ID 已脱敏，因此为估算去重值。",
    captureBatchCount: "这是响应批次数，不是已执行的采集任务数。",
    updatedAt: "没有更新时间时返回 null。",
  };
  const summary = Object.entries(summaryById).map(([id, metric]) => ({
    id,
    ...metric,
    detail: summaryDetails[id] || "",
    formula: summaryFormulas[id] || "",
  }));

  const trendGroups = new Map();
  for (const note of notes) {
    const key = note.timestamp == null ? "unknown" : monthKey(note.timestamp);
    if (!trendGroups.has(key)) trendGroups.set(key, []);
    trendGroups.get(key).push(note);
  }
  const trend = Array.from(trendGroups.entries()).map(([period, rows]) => ({
    period,
    label: period === "unknown" ? "时间未知" : period,
    unknown: period === "unknown",
    value: rows.length,
    noteCount: rows.length,
    totalLikes: rows.some((row) => Number.isFinite(row.likes))
      ? rows.map((row) => row.likes).filter(Number.isFinite).reduce((sum, value) => sum + value, 0)
      : null,
    medianLikes: median(rows.map((row) => row.likes).filter(Number.isFinite)),
    likes: median(rows.map((row) => row.likes).filter(Number.isFinite)),
    evidenceRefs: rows.map((row) => row.ref),
  })).sort((left, right) => {
    if (left.unknown) return 1;
    if (right.unknown) return -1;
    return left.period.localeCompare(right.period);
  });

  const types = groupNotes(notes, (note) => asText(note.type) || UNKNOWN_LABEL)
    .sort((left, right) => right.noteCount - left.noteCount || (right.medianLikes ?? -1) - (left.medianLikes ?? -1) || left.label.localeCompare(right.label, "zh-CN"));

  const authors = groupNotes(
    notes,
    (note) => asText(note.authorId) ? `id:${asText(note.authorId)}` : `name:${asText(note.author) || UNKNOWN_LABEL}`,
    (_key, rows) => asText(rows[0]?.author) || asText(rows[0]?.authorId) || UNKNOWN_LABEL,
  ).map((item) => ({
    ...item,
    authorId: asText(evidenceIndex[item.evidenceRefs[0]]?.data?.authorId),
  })).sort((left, right) => (right.totalLikes ?? -1) - (left.totalLikes ?? -1) || right.noteCount - left.noteCount || left.label.localeCompare(right.label, "zh-CN"));

  const keywordGroups = new Map();
  for (const note of notes) {
    for (const keyword of tokenizeTitle(note.title)) {
      if (!keywordGroups.has(keyword)) keywordGroups.set(keyword, []);
      keywordGroups.get(keyword).push(note);
    }
  }
  const keywords = Array.from(keywordGroups.entries()).map(([keyword, rows]) => ({
    key: keyword,
    label: keyword,
    value: rows.length,
    noteCount: rows.length,
    totalLikes: rows.some((row) => Number.isFinite(row.likes))
      ? rows.map((row) => row.likes).filter(Number.isFinite).reduce((sum, value) => sum + value, 0)
      : null,
    medianLikes: median(rows.map((row) => row.likes).filter(Number.isFinite)),
    likes: median(rows.map((row) => row.likes).filter(Number.isFinite)),
    evidenceRefs: rows.map((row) => row.ref),
  })).sort((left, right) => right.noteCount - left.noteCount || (right.medianLikes ?? -1) - (left.medianLikes ?? -1) || left.label.localeCompare(right.label, "zh-CN")).slice(0, 40);

  const knownRegionComments = comments.filter((comment) => asText(comment.region));
  const regionGroups = new Map();
  for (const comment of comments) {
    const region = asText(comment.region) || UNKNOWN_LABEL;
    if (!regionGroups.has(region)) regionGroups.set(region, []);
    regionGroups.get(region).push(comment);
  }
  const regions = Array.from(regionGroups.entries()).map(([region, rows]) => ({
    key: region,
    label: region,
    unknown: region === UNKNOWN_LABEL,
    value: rows.length,
    commentCount: rows.length,
    share: comments.length ? round(rows.length / comments.length) : 0,
    knownShare: region === UNKNOWN_LABEL || !knownRegionComments.length ? null : round(rows.length / knownRegionComments.length),
    evidenceRefs: rows.map((row) => row.ref),
  })).sort((left, right) => right.commentCount - left.commentCount || left.label.localeCompare(right.label, "zh-CN"));

  const topNotes = notes.map((note) => {
    const relation = byNoteRef[note.ref];
    return {
      accountId: note.accountId,
      noteId: note.entityId,
      noteRef: note.ref,
      author: asText(note.author) || UNKNOWN_LABEL,
      title: asText(note.title) || "未命名笔记",
      link: asText(note.link),
      likes: note.likes,
      value: note.likes,
      type: asText(note.type) || UNKNOWN_LABEL,
      time: asText(note.time),
      source: asText(note.source) || UNKNOWN_LABEL,
      commentCount: relation.commentRefs.length,
      commentTaskCount: relation.commentTaskRefs.length,
      operationTaskCount: relation.operationTaskRefs.length,
      evidenceRefs: relation.evidenceRefs,
    };
  }).sort((left, right) => (right.likes ?? -1) - (left.likes ?? -1) || right.commentCount - left.commentCount || left.title.localeCompare(right.title, "zh-CN")).slice(0, 30);

  const insights = [];
  if (notes.length || comments.length) {
    insights.push(makeInsight({
      id: "collection-overview",
      title: "数据收录概况",
      text: `当前范围收录 ${notes.length} 条笔记记录和 ${comments.length} 条评论记录，其中 ${linkedComments.length} 条评论可关联到已存笔记。`,
      evidenceRefs: [...noteRefs, ...commentRefs],
      value: notes.length + comments.length,
      numerator: linkedComments.length,
      denominator: comments.length,
      formula: "笔记记录数 + 评论记录数；关联评论按同账号 noteId 匹配",
    }));
  }

  const comparableTypes = types.filter((item) => item.noteCount >= 3 && item.medianLikes != null);
  if (comparableTypes.length >= 2) {
    const leader = comparableTypes.slice().sort((left, right) => right.medianLikes - left.medianLikes || right.noteCount - left.noteCount)[0];
    insights.push(makeInsight({
      id: "type-median-likes",
      title: "类型样本对比",
      text: `在当前样本中，“${leader.label}”类型的点赞中位数最高，为 ${leader.medianLikes}（${leader.noteCount} 条）。`,
      evidenceRefs: comparableTypes.flatMap((item) => item.evidenceRefs),
      value: leader.medianLikes,
      unit: "点赞",
      numerator: leader.noteCount,
      denominator: comparableTypes.reduce((sum, item) => sum + item.noteCount, 0),
      formula: "按类型分组后比较点赞中位数；仅纳入样本数不少于 3 的类型",
      limitations: ["这是当前采集样本的描述性比较，不表示内容类型会造成点赞差异。"],
    }));
  }

  const leadingAuthor = authors.find((author) => author.noteCount >= 2 && author.knownLikesCount);
  if (leadingAuthor) {
    insights.push(makeInsight({
      id: "author-observation",
      title: "作者收录表现",
      text: `当前样本中，“${leadingAuthor.label}”收录 ${leadingAuthor.noteCount} 条笔记，累计观测点赞 ${leadingAuthor.totalLikes}。`,
      evidenceRefs: leadingAuthor.evidenceRefs,
      value: leadingAuthor.totalLikes,
      unit: "点赞",
      numerator: leadingAuthor.noteCount,
      denominator: notes.length,
      formula: "按作者公开标识或名称分组，仅汇总当前保存的有效点赞观测值",
    }));
  }

  const leadingKeyword = keywords.find((keyword) => keyword.noteCount >= 2);
  if (leadingKeyword) {
    insights.push(makeInsight({
      id: "keyword-observation",
      title: "标题关键词",
      text: `标题关键词“${leadingKeyword.label}”出现在 ${leadingKeyword.noteCount} 条笔记中，这些笔记的点赞中位数为 ${leadingKeyword.medianLikes ?? "未知"}。`,
      evidenceRefs: leadingKeyword.evidenceRefs,
      value: leadingKeyword.noteCount,
      unit: "条",
      numerator: leadingKeyword.noteCount,
      denominator: notes.length,
      formula: "对标题分词后按笔记去重计数，并汇总命中笔记的点赞中位数",
      limitations: ["关键词出现与点赞表现仅为同一批样本中的并列观察，不表示因果关系。"],
    }));
  }

  const leadingRegion = regions.find((region) => !region.unknown);
  if (leadingRegion && knownRegionComments.length) {
    const denominatorRefs = knownRegionComments.map((comment) => comment.ref);
    insights.push(makeInsight({
      id: "comment-region",
      title: "评论地区分布",
      text: `在地区已知的已采集评论中，“${leadingRegion.label}”有 ${leadingRegion.commentCount} 条，占 ${round(leadingRegion.commentCount / knownRegionComments.length * 100, 2)}%。`,
      evidenceRefs: denominatorRefs,
      value: round(leadingRegion.commentCount / knownRegionComments.length, 4),
      unit: "比例",
      numerator: leadingRegion.commentCount,
      denominator: knownRegionComments.length,
      formula: "该地区评论数 / 地区非空评论数",
      limitations: ["地区分布只代表已采集评论样本，不代表平台整体用户分布。"],
    }));
  }

  if (orphanComments.length) {
    insights.push(makeInsight({
      id: "orphan-comments",
      title: "关联完整性提示",
      text: `有 ${orphanComments.length} 条评论暂时无法关联到同账号下的已存笔记，可在来源表中核对 noteId。`,
      evidenceRefs: orphanComments.map((comment) => comment.ref),
      value: orphanComments.length,
      unit: "条",
      numerator: orphanComments.length,
      denominator: comments.length,
      formula: "评论 noteId 在同账号笔记索引中无匹配项",
    }));
  }

  if (operationTasks.length) {
    insights.push(makeInsight({
      id: "operation-status",
      title: "自动化任务状态",
      text: `当前保存 ${operationTasks.length} 条操作任务，其中 ${completedOperationTasks.length} 条带有已完成状态。`,
      evidenceRefs: operationTasks.map((task) => task.ref),
      value: completedOperationTasks.length,
      unit: "条",
      numerator: completedOperationTasks.length,
      denominator: operationTasks.length,
      formula: "任务状态以“已完成”开头，或全部已记录动作状态均为“已完成/未启用”",
      limitations: ["当前队列只保存最新状态，不代表完整的历史执行次数。"],
    }));
  }

  const modelAccounts = accountIds.map((accountId) => {
    const relation = byAccountId[accountId];
    const account = accountMap.get(accountId) || { id: accountId, name: `账号 ${accountId}` };
    return {
      id: accountId,
      name: asText(account.name) || `账号 ${accountId}`,
      nickname: asText(account.profileName || account.nickname),
      loginPhase: asText(account.loginPhase || account.loginState) || "unknown",
      noteCount: relation.noteRefs.length,
      commentCount: relation.commentRefs.length,
      commentTaskCount: relation.commentTaskRefs.length,
      operationTaskCount: relation.operationTaskRefs.length,
      evidenceRefs: relation.evidenceRefs,
    };
  });

  return {
    generatedAt: effectiveNow,
    statisticalModel: {
      id: "local-descriptive-statistics",
      name: "本地描述性数学统计模型",
      version: STATISTICAL_MODEL_VERSION,
      deterministic: true,
      aiInvolved: false,
      methods: [...STATISTICAL_MODEL_METHODS],
    },
    scope: {
      mode: requestedAccountId ? "account" : "all",
      accountId: requestedAccountId,
      accountIds,
      evidenceRefs: accountRefs,
    },
    accounts: modelAccounts,
    summary,
    summaryById,
    trend,
    types,
    authors,
    keywords,
    regions,
    topNotes,
    insights,
    evidenceByRef: evidenceIndex,
    evidenceIndex,
    lineage: {
      byAccountId,
      byNoteRef,
      orphanCommentRefs: orphanComments.map((comment) => comment.ref),
      orphanCommentTaskRefs: orphanCommentTasks.map((task) => task.ref),
      orphanOperationTaskRefs: orphanOperationTasks.map((task) => task.ref),
      evidenceRefs: unique([...accountRefs, ...workspaceRefs, ...noteRefs, ...commentRefs, ...commentTasks.map((task) => task.ref), ...operationTasks.map((task) => task.ref)]),
    },
  };
}
