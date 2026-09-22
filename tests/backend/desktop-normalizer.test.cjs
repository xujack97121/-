const assert = require("node:assert/strict");
const { normalizeCapture, normalizeDomComments, noteTimeFromId, parseMetric } = require("../../backend/capture/normalizer.cjs");

assert.equal(parseMetric(undefined), null, "缺失指标不能伪装成零观测");
assert.equal(parseMetric(""), null, "空指标不能伪装成零观测");
assert.equal(parseMetric("无法获取"), null, "无法解析的指标应保留为缺失");
assert.equal(parseMetric(0), 0, "真实零值仍应作为有效观测保留");

const noteResult = normalizeCapture("https://edith.xiaohongshu.com/api/sns/web/v1/search/notes", {
  data: { items: [{ id: "69abcdef0000000012345678", xsec_token: "token-real=", note_card: { display_title: "真实返回标题", type: "video", time: "2026-08-03 10:30", user: { nickname: "作者", user_id: "123456789012" }, interact_info: { liked_count: "2.5万" } } }] },
});
assert.equal(noteResult.notes.length, 1);
assert.equal(noteResult.notes[0].likes, 25000);
assert.equal(noteResult.notes[0].authorId, "1234••••012");
assert.equal(noteResult.notes[0].time, "2026-08-03 10:30");
assert.equal(noteResult.notes[0].link, "https://www.xiaohongshu.com/explore/69abcdef0000000012345678?xsec_token=token-real%3D&xsec_source=pc_search&source=web_search_result_notes");

const missingLikesResult = normalizeCapture("https://edith.xiaohongshu.com/api/sns/web/v1/search/notes", {
  data: { items: [
    { id: "69abcdef0000000012345679", note_card: { display_title: "点赞缺失", user: { nickname: "作者" }, interact_info: {} } },
    { id: "69abcdef0000000012345680", note_card: { display_title: "真实零点赞", user: { nickname: "作者" }, interact_info: { liked_count: 0 } } },
  ] },
});
assert.equal(missingLikesResult.notes[0].likes, null);
assert.equal(missingLikesResult.notes[1].likes, 0);

const inferredTimeId = "6a47919900000000160277c9";
const inferredTimeResult = normalizeCapture("https://edith.xiaohongshu.com/api/sns/web/v1/search/notes", {
  data: { items: [{ id: inferredTimeId, note_card: { display_title: "缺少发布时间的搜索结果", type: "normal", user: { nickname: "作者" }, interact_info: { liked_count: "101" } } }] },
});
assert.equal(inferredTimeResult.notes[0].time, noteTimeFromId(inferredTimeId));
assert.notEqual(inferredTimeResult.notes[0].time, "");

const commentResult = normalizeCapture("https://edith.xiaohongshu.com/api/sns/web/v2/comment/page?note_id=note-real-1", {
  data: { comments: [{ id: "comment-real-1", content: "真实返回评论", create_time: 1785200000, ip_location: "IP属地：上海", user: { nickname: "用户", user_id: "987654321000" } }] },
});
assert.equal(commentResult.comments.length, 1);
assert.equal(commentResult.comments[0].noteId, "note-real-1");
assert.equal(commentResult.comments[0].region, "上海");
assert.equal(commentResult.comments[0].likes, null);
assert.equal(commentResult.comments[0].replyCount, null);
const metrics = normalizeCapture("https://edith.xiaohongshu.com/api/sns/web/v2/comment/page?note_id=note-metrics", {
  comments: [
    { id: "metric-1", content: "高赞评论", user: { nickname: "用户" }, like_count: "1.2万", sub_comment_count: 56 },
    { id: "metric-2", content: "真实零值", user: { nickname: "用户" }, likeCount: 0, replyCount: 0 },
  ],
}).comments;
assert.equal(metrics[0].likes, 12000);
assert.equal(metrics[0].replyCount, 56);
assert.equal(metrics[1].likes, 0);
assert.equal(metrics[1].replyCount, 0);

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
assert.equal(domComments[0].likes, null);
const domMetrics = normalizeDomComments("https://www.xiaohongshu.com/explore/6a6d1415000000002202d4d1", [
  { nickname: "用户", content: "页面指标", likes: "3.5k", replyCount: "12" },
]);
assert.equal(domMetrics[0].likes, 3500);
assert.equal(domMetrics[0].replyCount, 12);

console.log("desktop response normalization: passed");
