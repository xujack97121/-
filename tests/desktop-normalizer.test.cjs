const assert = require("node:assert/strict");
const { normalizeCapture, normalizeDomComments } = require("../electron/normalizer.cjs");

const noteResult = normalizeCapture("https://edith.xiaohongshu.com/api/sns/web/v1/search/notes", {
  data: { items: [{ id: "69abcdef0000000012345678", xsec_token: "token-real=", note_card: { display_title: "真实返回标题", type: "video", time: "2026-08-03 10:30", user: { nickname: "作者", user_id: "123456789012" }, interact_info: { liked_count: "2.5万" } } }] },
});
assert.equal(noteResult.notes.length, 1);
assert.equal(noteResult.notes[0].likes, 25000);
assert.equal(noteResult.notes[0].authorId, "1234••••012");
assert.equal(noteResult.notes[0].time, "2026-08-03 10:30");
assert.equal(noteResult.notes[0].link, "https://www.xiaohongshu.com/explore/69abcdef0000000012345678?xsec_token=token-real%3D&xsec_source=pc_search&source=web_search_result_notes");

const commentResult = normalizeCapture("https://edith.xiaohongshu.com/api/sns/web/v2/comment/page?note_id=note-real-1", {
  data: { comments: [{ id: "comment-real-1", content: "真实返回评论", create_time: 1785200000, ip_location: "IP属地：上海", user: { nickname: "用户", user_id: "987654321000" } }] },
});
assert.equal(commentResult.comments.length, 1);
assert.equal(commentResult.comments[0].noteId, "note-real-1");
assert.equal(commentResult.comments[0].region, "上海");

const feedCommentResult = normalizeCapture("https://edith.xiaohongshu.com/api/sns/web/v1/feed", {
  data: { comments: [{ id: "comment-feed-1", content: "详情接口内的评论", create_time: 1785200000, ip_location: "北京", sub_comment_count: 2, user: { nickname: "详情用户", user_id: "112233445566" } }] },
});
assert.equal(feedCommentResult.comments.length, 1);
assert.equal(feedCommentResult.comments[0].content, "详情接口内的评论");

const domComments = normalizeDomComments("https://www.xiaohongshu.com/explore/6a6d1415000000002202d4d1?xsec_token=real", [
  { nickname: "页面用户", authorId: "123456789012", content: "页面已经显示的真实评论", time: "昨天 10:47", region: "IP属地：北京" },
  { nickname: "页面用户", authorId: "123456789012", content: "页面已经显示的真实评论", time: "昨天 10:47", region: "IP属地：北京" },
]);
assert.equal(domComments.length, 1);
assert.equal(domComments[0].noteId, "6a6d1415000000002202d4d1");
assert.equal(domComments[0].authorId, "1234••••012");
assert.equal(domComments[0].region, "北京");
assert.match(domComments[0].id, /^dom-comment-/);

console.log("desktop response normalization: passed");
