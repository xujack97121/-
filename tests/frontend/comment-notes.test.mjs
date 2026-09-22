import assert from "node:assert/strict";
import {
  commentNoteId, commentNoteLink, filterNoteComments, groupCommentNotes,
  summarizeNoteComments, updateCommentTaskStatus, removeCommentCards,
  buildCommentCollectionIndex, commentCollectionState,
} from "../../frontend/src/features/comments/comment-notes.js";

const signedLink = "https://www.xiaohongshu.com/explore/note-a?xsec_token=keep-me";
assert.equal(commentNoteLink(signedLink), signedLink);
assert.equal(commentNoteId({ id: "csv-1", link: signedLink }), "note-a");
for (const link of ["javascript:alert(1)", "https://evil.com/explore/note-a", "https://www.xiaohongshu.com/explore/", "https://www.xiaohongshu.com/explore/a/extra"]) {
  assert.equal(commentNoteLink(link), "");
}

const comments = [
  { id: "1", noteId: "note-a", authorId: "user-1", nickname: "One", region: "上海", time: "2026-09-14 09:00", content: "first" },
  { id: "2", noteId: "note-a", authorId: "user-1", nickname: "One", region: "上海", time: "2026-09-15 09:00", content: "second" },
  { id: "3", noteId: "note-b", authorId: "user-1", nickname: "One", region: "北京", time: "2026-09-15 09:00", content: "other note" },
  { id: "4", noteId: "note-a", time: "", content: "anonymous one" },
  { id: "5", noteId: "note-a", time: "unknown", content: "anonymous two" },
  { id: "6", content: "unlinked" },
];
const notes = [{ id: "csv-1", link: signedLink, title: "Original title", author: "Author" }];
const tasks = [
  { id: "note-a", link: signedLink, title: "Queued title", status: "采集中" },
  { id: "note-c", link: "https://www.xiaohongshu.com/explore/note-c", status: "已停止" },
];
const groups = groupCommentNotes(notes, comments, tasks);
const collectionIndex = buildCommentCollectionIndex(comments, tasks);
assert.deepEqual(commentCollectionState(notes[0], collectionIndex), { id: "note-a", kind: "collected", count: 4, label: "已采集" });
assert.equal(commentCollectionState({ id: "note-b" }, collectionIndex).kind, "collected", "Saved comments work without a task");
assert.equal(commentCollectionState(notes[0], collectionIndex, { activeNoteId: "note-a" }).kind, "collecting");
assert.equal(commentCollectionState(notes[0], collectionIndex, { starting: "note-a", activeNoteId: "note-a" }).kind, "opening");
assert.equal(commentCollectionState({ id: "note-c" }, collectionIndex).kind, "stopped", "Zero-comment stopped tasks are not marked collected");
assert.equal(commentCollectionState({ id: "unseen" }, collectionIndex).kind, "idle");
assert.equal(commentCollectionState(notes[0], buildCommentCollectionIndex([], tasks)).kind, "pending", "Stored running labels must not imply an active run");
assert.equal(commentCollectionState(notes[0], buildCommentCollectionIndex([], [{ id: "note-a", status: "启动失败" }])).kind, "failed");
assert.equal(commentCollectionState(notes[0], buildCommentCollectionIndex(comments, [{ id: "note-a", status: "采集失败" }])).kind, "collected", "Partial comments remain available after failure");
assert.equal(commentCollectionState(notes[0], buildCommentCollectionIndex([], [])).kind, "idle", "Account isolation and deleting comments must clear the collected state");
assert.equal(collectionIndex.has(""), false, "Unlinked comments must not mark an arbitrary note collected");
assert.equal(groups.length, 4);
const group = groups.find((item) => item.id === "note-a");
assert.equal(group.comments.length, 4);
assert.equal(group.title, "Original title");
assert.equal(group.link, signedLink);
assert.equal(groups.find((item) => item.id === "__unlinked__").link, "");
assert.equal(groups.find((item) => item.id === "note-c").comments.length, 0);
assert.equal(groupCommentNotes([], comments).length, 3, "Deleting source notes must not lose collected comments");
assert.deepEqual(groupCommentNotes([], [], []), []);
assert.equal(filterNoteComments(comments, { unique: true }).length, 5, "Dedupe users per note; do not merge anonymous comments");
assert.equal(filterNoteComments(comments, { region: " 上海 ", contains: "second" }).length, 1);
assert.equal(filterNoteComments(comments, { contains: "not present" }).length, 0);
const stats = summarizeNoteComments(group.comments, new Date(2026, 8, 16));
assert.equal(stats.total, 4);
assert.equal(stats.people, 1);
assert.equal(stats.unknownUsers, 2);
assert.equal(stats.unknownTimes, 2);
assert.equal(stats.regionCount, 1);
assert.equal(stats.regions.reduce((sum, item) => sum + item.count, 0), 4);
assert.deepEqual(stats.days, [{ label: "2026-09-14", count: 1 }, { label: "2026-09-15", count: 1 }]);
assert.equal(summarizeNoteComments([]).latest, null);

let statuses = updateCommentTaskStatus(tasks, { kind: "comments", noteId: "note-a", runId: "run-new", phase: "loading" });
assert.equal(statuses[0].status, "正在打开");
statuses = updateCommentTaskStatus(statuses, { kind: "comments", noteId: "note-a", runId: "run-old", phase: "stopped" });
assert.equal(statuses[0].status, "正在打开", "Old capture events cannot stop a new run");
statuses = updateCommentTaskStatus(statuses, { kind: "comments", noteId: "note-a", runId: "run-new", phase: "collecting", collected: 12 });
assert.equal(statuses[0].collected, 12);
statuses = updateCommentTaskStatus(statuses, { kind: "comments", noteId: "note-a", runId: "run-new", phase: "stopped" });
assert.equal(statuses[0].status, "已停止");
assert.equal(statuses[1], tasks[1], "Unrelated note state must be untouched");
assert.equal(updateCommentTaskStatus(statuses, { kind: "notes", runId: "run-new", noteId: "note-a", phase: "loading" }), statuses);
assert.equal(updateCommentTaskStatus(statuses, { kind: "comments", noteId: "note-a", phase: "loading" }), statuses);
const workspace = { notes, comments, commentTasks: tasks, operationTasks: [{ id: "operation-a" }], commentsPanel: { selectedNoteId: "note-a", region: "上海" } };
const removed = removeCommentCards(workspace, "note-a");
assert.equal(removed.comments.some((comment) => comment.noteId === "note-a"), false);
assert.equal(removed.commentTasks.some((task) => task.id === "note-a"), false);
assert.equal(removed.commentsPanel.selectedNoteId, "");
assert.equal(removed.commentsPanel.region, "上海");
assert.equal(removed.notes, workspace.notes, "Deleting a comment card preserves collected source notes");
assert.equal(removed.operationTasks, workspace.operationTasks, "Other workflows remain untouched");
assert.equal(workspace.comments.length, 6, "Deletion must not mutate the original workspace");
assert.equal(removeCommentCards(workspace, "note-c").comments.length, 6, "Pending cards have no comments to remove");
assert.equal(removeCommentCards(workspace, "note-c").commentTasks.length, 1);
assert.equal(removeCommentCards(workspace, "note-c").commentsPanel.selectedNoteId, "note-a");
assert.equal(removeCommentCards(workspace, "__unlinked__").comments.length, 5);
assert.equal(removeCommentCards(workspace, "note-b").comments.length, 5, "Cards without a task can also be deleted");
const cleared = removeCommentCards(workspace);
assert.deepEqual(cleared.comments, []);
assert.deepEqual(cleared.commentTasks, []);
assert.equal(cleared.commentsPanel.selectedNoteId, "");
assert.equal(cleared.notes, notes);
assert.equal(groupCommentNotes(cleared.notes, cleared.comments, cleared.commentTasks).length, 0);
console.log("comment note grouping, deletion, statistics, filtering and capture lifecycle: passed");
