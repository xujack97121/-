import { commentMatchesTimeRange, parseCommentTime } from "./comment-time-filter.js";

export function commentNoteId(note = {}) {
  try {
    const url = new URL(note.link || "");
    if (url.protocol === "https:" && url.hostname === "www.xiaohongshu.com") {
      const match = url.pathname.match(/^\/(?:explore|discovery\/item)\/([^/]+)\/?$/);
      if (match) return match[1];
    }
  } catch { /* Imported records may only contain an ID. */ }
  return String(note.id || "");
}

export function commentNoteLink(link) {
  try {
    const url = new URL(link);
    return url.protocol === "https:" && url.hostname === "www.xiaohongshu.com"
      && /^\/(?:explore|discovery\/item)\/[^/]+\/?$/.test(url.pathname) ? url.href : "";
  } catch {
    return "";
  }
}

export function buildCommentCollectionIndex(comments = [], tasks = []) {
  const index = new Map();
  for (const task of tasks) {
    const id = commentNoteId(task);
    if (id) index.set(id, { count: 0, status: task.status || "" });
  }
  for (const comment of comments) {
    const id = String(comment.noteId || "");
    if (!id) continue;
    const entry = index.get(id) || { count: 0, status: "" };
    index.set(id, { ...entry, count: entry.count + 1 });
  }
  return index;
}

export function commentCollectionState(note, index, { starting = "", activeNoteId = "" } = {}) {
  const id = commentNoteId(note);
  const entry = index.get(id);
  const count = entry?.count || 0;
  let kind = "idle", label = "采集评论";
  if (id && starting === id) { kind = "opening"; label = "正在打开"; }
  else if (id && activeNoteId === id) { kind = "collecting"; label = "采集中"; }
  else if (count) { kind = "collected"; label = "已采集"; }
  else if (/失败/.test(entry?.status || "")) { kind = "failed"; label = "采集失败"; }
  else if (entry?.status === "已停止") { kind = "stopped"; label = "已停止"; }
  // Persisted running labels are not proof that a desktop task is still active.
  else if (entry) { kind = "pending"; label = "待采集"; }
  return { id, count, kind, label };
}

export function groupCommentNotes(notes = [], comments = [], tasks = []) {
  const metadata = new Map(notes.map((note) => [commentNoteId(note), note]));
  const groups = new Map();
  const ensure = (id, task) => {
    const key = id || "__unlinked__";
    if (!groups.has(key)) {
      const note = metadata.get(id);
      groups.set(key, {
        id: key,
        title: note?.title || task?.title || (id ? `笔记 ${id}` : "未关联笔记的评论"),
        author: note?.author || task?.author || "未知作者",
        link: commentNoteLink(task?.link) || commentNoteLink(note?.link)
          || (id ? `https://www.xiaohongshu.com/explore/${encodeURIComponent(id)}` : ""),
        task: task || null,
        comments: [],
      });
    }
    return groups.get(key);
  };
  for (const task of tasks) ensure(commentNoteId(task), task);
  for (const comment of comments) ensure(String(comment.noteId || "")).comments.push(comment);
  const priority = (group) => ["正在打开", "采集中", "监听中"].includes(group.task?.status) ? 2 : Number(group.comments.length > 0);
  return [...groups.values()].sort((a, b) => priority(b) - priority(a));
}

export function removeCommentCards(workspace, noteId = null) {
  const keep = (id) => noteId !== null && (id || "__unlinked__") !== noteId;
  return {
    ...workspace,
    comments: (workspace.comments || []).filter((comment) => keep(String(comment.noteId || ""))),
    commentTasks: (workspace.commentTasks || []).filter((task) => keep(commentNoteId(task))),
    commentsPanel: {
      ...workspace.commentsPanel,
      selectedNoteId: keep(workspace.commentsPanel?.selectedNoteId) ? workspace.commentsPanel?.selectedNoteId || "" : "",
    },
  };
}

export function filterNoteComments(comments, { region = "", contains = "", timeRange = "all", unique = false } = {}) {
  const seen = new Set();
  return comments.filter((comment) => {
    if (region.trim() && !String(comment.region || "").includes(region.trim())) return false;
    if (contains.trim() && !String(comment.content || "").includes(contains.trim())) return false;
    if (!commentMatchesTimeRange(comment.time, timeRange)) return false;
    const author = comment.authorId || comment.nickname;
    if (!unique || !author) return true;
    // The same commenter on two different notes must remain in both note groups.
    const key = JSON.stringify([comment.noteId || "", author]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function summarizeNoteComments(comments, now = new Date()) {
  const people = new Set();
  const regions = new Map();
  const days = new Map();
  let unknownUsers = 0;
  let unknownTimes = 0;
  let latest = null;
  for (const comment of comments) {
    const person = comment.authorId || comment.nickname;
    if (person) people.add(person);
    else unknownUsers += 1;
    const region = String(comment.region || "").trim() || "未知地区";
    regions.set(region, (regions.get(region) || 0) + 1);
    const time = parseCommentTime(comment.time, now);
    if (time == null) { unknownTimes += 1; continue; }
    if (latest == null || time > latest) latest = time;
    const date = new Date(time);
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    days.set(day, (days.get(day) || 0) + 1);
  }
  return {
    total: comments.length,
    people: people.size,
    unknownUsers,
    regionCount: [...regions.keys()].filter((name) => name !== "未知地区").length,
    regions: [...regions].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    days: [...days].sort(([a], [b]) => a.localeCompare(b)).map(([label, count]) => ({ label, count })),
    unknownTimes,
    latest,
  };
}

export function updateCommentTaskStatus(tasks, event) {
  if (event.kind !== "comments" || !event.runId || !event.noteId) return tasks;
  return tasks.map((task) => {
    if (commentNoteId(task) !== event.noteId) return task;
    if (event.phase !== "loading" && task.runId !== event.runId) return task;
    const status = {
      loading: "正在打开",
      collecting: "采集中",
      stopped: "已停止",
      error: "采集失败",
    }[event.phase];
    return status ? { ...task, status, runId: event.runId, collected: event.collected ?? task.collected ?? 0 } : task;
  });
}
