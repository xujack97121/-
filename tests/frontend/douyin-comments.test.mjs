import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { commentNoteId, commentNoteLink, groupCommentNotes } from "../../frontend/src/features/comments/comment-notes.js";
import { douyinVideoId, platformHome } from "../../frontend/src/features/platforms/content-platforms.js";
const require = createRequire(import.meta.url);
const backend = require("../../backend/platform/content-platforms.cjs");
const id = "7520000000000000001";
const link = `https://www.douyin.com/video/${id}`;
for (const candidate of [
  link, `${link}?modal_id=7520000000000000002`, `https://www.douyin.com/?modal_id=${id}`,
  `https://www.douyin.com/user/user-a?modal_id=${id}`, `https://www.douyin.com:444/video/${id}`,
  `https://user@www.douyin.com/video/${id}`, `https://www.douyin.com.evil.test/video/${id}`,
]) assert.equal(douyinVideoId(candidate), backend.douyinVideoId(candidate));
assert.equal(commentNoteId({ id: "wrong", link }), id);
assert.equal(commentNoteLink(link, "douyin"), link);
assert.equal(commentNoteLink(link, "xhs"), "");
assert.equal(commentNoteLink("https://www.xiaohongshu.com/explore/test", "douyin"), "");
assert.equal(platformHome("douyin"), backend.platformHome("douyin"));
const groups = groupCommentNotes(
  [{ id, link, title: "公开视频", author: "公开作者", platform: "douyin" }],
  [{ id: "comment-1", noteId: id, content: "测试评论", platform: "douyin" }],
  [{ id, link, platform: "douyin" }], "douyin",
);
assert.equal(groups.length, 1);
assert.equal(groups[0].title, "公开视频");
assert.equal(groups[0].link, link);
assert.equal(groups[0].platform, "douyin");
assert.equal(groups[0].comments.length, 1);
assert.equal(groupCommentNotes([], [{ noteId: id }], [], "douyin")[0].title, `视频 ${id}`);
console.log("Douyin frontend URLs and video cards: passed");
