import assert from "node:assert/strict";
import { STATISTICAL_MODEL_METHODS, STATISTICAL_MODEL_VERSION, buildAnalyticsModel, parseAnalyticsTimestamp } from "../src/analytics.js";

const NOW = new Date("2026-08-21T12:00:00+08:00").getTime();
const NOTE_A = "69a000000000000000000001";
const NOTE_B = "69a000000000000000000002";
const NOTE_C = "69a000000000000000000003";

assert.equal(parseAnalyticsTimestamp("刚刚", NOW), NOW);
assert.equal(parseAnalyticsTimestamp("15分钟前", NOW), NOW - 15 * 60 * 1000);
assert.equal(parseAnalyticsTimestamp("2小时前", NOW), NOW - 2 * 60 * 60 * 1000);
assert.equal(parseAnalyticsTimestamp("3天前", NOW), NOW - 3 * 24 * 60 * 60 * 1000);
assert.equal(parseAnalyticsTimestamp("2周前", NOW), NOW - 14 * 24 * 60 * 60 * 1000);
assert.equal(parseAnalyticsTimestamp("1月前", NOW), new Date("2026-07-21T12:00:00+08:00").getTime());
assert.equal(parseAnalyticsTimestamp("2个月前", NOW), new Date("2026-06-21T12:00:00+08:00").getTime());
assert.equal(parseAnalyticsTimestamp("1年前", NOW), new Date("2025-08-21T12:00:00+08:00").getTime());
assert.equal(parseAnalyticsTimestamp("时间缺失", NOW), null);
assert.equal(parseAnalyticsTimestamp("1天后", NOW), null);

const monthEndNow = new Date("2025-03-31T12:00:00+08:00").getTime();
assert.equal(parseAnalyticsTimestamp("1个月前", monthEndNow), new Date("2025-02-28T12:00:00+08:00").getTime(), "按自然月回退时应钳制月末日期");
const leapDayNow = new Date("2024-02-29T12:00:00+08:00").getTime();
assert.equal(parseAnalyticsTimestamp("1年前", leapDayNow), new Date("2023-02-28T12:00:00+08:00").getTime(), "按自然年回退时应钳制闰日");

const accounts = [
  { id: "account-a", name: "账号 A", loginPhase: "logged-in" },
  { id: "account-b", name: "账号 B", loginPhase: "logged-in" },
];

const workspaces = {
  "account-a": {
    stats: { captures: 4, updatedAt: NOW - 1000 },
    notes: [
      { id: NOTE_A, title: "创业 复盘 方法", author: "作者甲", authorId: "author-1", likes: 100, type: "笔记", time: "2026-07-10 10:00", source: "搜索", link: `https://www.xiaohongshu.com/explore/${NOTE_A}?xsec=1` },
      { id: NOTE_B, title: "创业 复盘 清单", author: "作者甲", authorId: "author-1", likes: 300, type: "笔记", time: "2026-08-10 10:00", source: "搜索", link: `https://www.xiaohongshu.com/explore/${NOTE_B}` },
      { id: "import-row", title: "创业 视频 案例", author: "作者乙", authorId: "author-2", likes: 500, type: "视频", time: "时间缺失", source: "导入", link: `https://www.xiaohongshu.com/explore/${NOTE_C}?token=old` },
      { id: "video-extra-1", title: "视频 案例 一", author: "作者乙", likes: 200, type: "视频", time: "2天前", source: "搜索", link: "https://example.test/note/video-extra-1" },
      { id: "video-extra-2", title: "视频 案例 二", author: "作者乙", likes: 400, type: "视频", time: "1天前", source: "搜索", link: "https://example.test/note/video-extra-2" },
      { id: "article-extra", title: "创业 方法 补充", author: "作者丙", likes: 50, type: "笔记", time: "2026-06-01 09:00", source: "作者", link: "https://example.test/note/article-extra" },
    ],
    comments: [
      { id: "comment-1", noteId: NOTE_A, nickname: "用户一", authorId: "user-1", content: "很有帮助", region: "上海", time: "2026-07-11 09:00" },
      { id: "comment-2", noteId: NOTE_A, nickname: "用户二", authorId: "user-2", content: "求模板", region: "北京", time: "2026-07-11 10:00" },
      { id: "comment-orphan", noteId: "missing-note", nickname: "用户三", content: "找不到原笔记", region: "", time: "" },
    ],
    commentTasks: [
      { id: NOTE_A, title: "创业 复盘 方法", link: `https://www.xiaohongshu.com/explore/${NOTE_A}`, status: "监听中" },
      { id: "missing-task-note", title: "已删除笔记", link: "https://example.test/missing", status: "待采集" },
    ],
    operationTasks: [
      { id: NOTE_A, title: "创业 复盘 方法", link: `https://www.xiaohongshu.com/explore/${NOTE_A}`, status: "已完成 00:05", likeStatus: "已完成点赞" },
      { id: NOTE_B, title: "创业 复盘 清单", link: `https://www.xiaohongshu.com/explore/${NOTE_B}`, status: "执行失败 00:03", likeStatus: "失败" },
      { id: NOTE_C, title: "部分动作成功", link: `https://www.xiaohongshu.com/explore/${NOTE_C}`, status: "待确认 00:04", likeStatus: "已完成点赞", collectStatus: "失败" },
    ],
  },
  "account-b": {
    stats: { captures: 2, updatedAt: NOW - 500 },
    notes: [
      { id: NOTE_A, title: "同一公开笔记由另一账号采集", author: "作者甲", authorId: "author-1", likes: 120, type: "笔记", time: "2026-07-10 10:00", source: "搜索", link: `https://www.xiaohongshu.com/explore/${NOTE_A}` },
    ],
    comments: [
      { id: "comment-1", noteId: NOTE_A, nickname: "用户一", authorId: "user-1", content: "很有帮助", region: "上海", time: "2026-07-11 09:00" },
    ],
    commentTasks: [],
    operationTasks: [],
  },
};

const model = buildAnalyticsModel({ accounts, workspaces, now: NOW });

assert.equal(model.scope.mode, "all");
assert.deepEqual(model.statisticalModel, {
  id: "local-descriptive-statistics",
  name: "本地描述性数学统计模型",
  version: STATISTICAL_MODEL_VERSION,
  deterministic: true,
  aiInvolved: false,
  methods: [...STATISTICAL_MODEL_METHODS],
});
assert.deepEqual(model.scope.accountIds, ["account-a", "account-b"]);
assert.equal(model.summaryById.accountCount.value, 2);
assert.equal(model.summaryById.noteCount.value, 7, "同一 noteId 在不同账号下必须保留为两个可追溯记录");
assert.equal(model.summaryById.commentCount.value, 4);
assert.equal(model.summaryById.linkedCommentCount.value, 3);
assert.equal(model.summaryById.orphanCommentCount.value, 1);
assert.equal(model.summaryById.medianLikes.value, 200);
assert.equal(model.summaryById.knownLikesCount.value, 7);
assert.equal(model.summaryById.unknownLikesCount.value, 0);
assert.equal(model.summaryById.likesCoverage.value, 1);
assert.equal(model.summaryById.captureBatchCount.value, 6);
assert.equal(model.summaryById.operationTaskCount.value, 3);
assert.equal(model.summaryById.completedOperationTaskCount.value, 1, "部分动作成功的任务不得计为整条完成");
assert.equal(buildAnalyticsModel({ accounts, workspaces, scopeAccountId: "account-a", now: NOW }).summaryById.medianLikes.value, 250, "偶数样本应取中间两项平均数");
assert.equal(model.accounts.length, 2);
assert.equal(model.evidenceByRef, model.evidenceIndex);
assert.ok(model.summary.every((metric) => metric.id && metric.label && Array.isArray(metric.evidenceRefs) && typeof metric.formula === "string"));

const accountANoteRef = `note:${encodeURIComponent("account-a")}:${encodeURIComponent(NOTE_A)}`;
const accountBNoteRef = `note:${encodeURIComponent("account-b")}:${encodeURIComponent(NOTE_A)}`;
assert.ok(model.evidenceIndex[accountANoteRef]);
assert.ok(model.evidenceIndex[accountBNoteRef]);
assert.notEqual(accountANoteRef, accountBNoteRef);
assert.equal(model.lineage.byNoteRef[accountANoteRef].commentRefs.length, 2);
assert.equal(model.lineage.byNoteRef[accountANoteRef].commentTaskRefs.length, 1);
assert.equal(model.lineage.byNoteRef[accountANoteRef].operationTaskRefs.length, 1);
assert.equal(model.lineage.byNoteRef[accountBNoteRef].commentRefs.length, 1, "评论不得跨账号串联");
assert.equal(model.lineage.orphanCommentRefs.length, 1);
assert.equal(model.lineage.orphanCommentTaskRefs.length, 1);

const importedNote = model.topNotes.find((note) => note.noteId === NOTE_C && note.accountId === "account-a");
assert.ok(importedNote, "导入行应优先从真实小红书链接恢复 noteId");
assert.equal(importedNote.likes, 500);

assert.ok(model.trend.some((item) => item.period === "2026-07"));
assert.ok(model.trend.some((item) => item.period === "unknown" && item.evidenceRefs.includes(importedNote.noteRef)));
assert.ok(model.types.every((item) => Array.isArray(item.evidenceRefs) && item.evidenceRefs.length));
assert.ok(model.authors.every((item) => Array.isArray(item.evidenceRefs) && item.evidenceRefs.length));
assert.ok(model.keywords.every((item) => Array.isArray(item.evidenceRefs) && item.evidenceRefs.length));
assert.ok(model.regions.every((item) => Array.isArray(item.evidenceRefs) && item.evidenceRefs.length));
assert.ok(model.topNotes.every((item) => Array.isArray(item.evidenceRefs) && item.evidenceRefs.includes(item.noteRef)));
assert.ok(model.insights.every((item) => item.evidenceRefs.length && item.metric.evidenceRefs.length));
assert.ok(model.insights.every((item) => !/(导致|驱动|提升了|影响了)/.test(item.text)), "结论不应使用因果措辞");

for (const metric of model.summary) {
  assert.ok(Array.isArray(metric.evidenceRefs), "所有汇总指标都必须携带 evidenceRefs");
  for (const ref of metric.evidenceRefs) assert.ok(model.evidenceIndex[ref], `汇总证据 ${ref} 必须存在`);
}
for (const collection of [model.trend, model.types, model.authors, model.keywords, model.regions, model.topNotes, model.insights]) {
  for (const item of collection) {
    assert.ok(Array.isArray(item.evidenceRefs));
    for (const ref of item.evidenceRefs) assert.ok(model.evidenceIndex[ref], `图表或结论证据 ${ref} 必须存在`);
  }
}

const scoped = buildAnalyticsModel({ accounts, workspaces, scopeAccountId: "account-a", now: NOW });
assert.equal(scoped.scope.mode, "account");
assert.deepEqual(scoped.scope.accountIds, ["account-a"]);
assert.equal(scoped.summaryById.noteCount.value, 6);
assert.equal(scoped.summaryById.commentCount.value, 3);
assert.ok(!scoped.evidenceIndex[accountBNoteRef]);

const empty = buildAnalyticsModel({ accounts: [], workspaces: {}, now: NOW });
assert.equal(empty.summaryById.noteCount.value, 0);
assert.equal(empty.summaryById.medianLikes.value, null);
assert.equal(empty.summaryById.likesCoverage.value, null);
assert.deepEqual(empty.trend, []);
assert.deepEqual(empty.insights, []);

const missingValues = buildAnalyticsModel({
  accounts: [{ id: "account-x", name: "X" }],
  workspaces: {
    "account-x": {
      notes: [{ title: "无字段样本" }],
      comments: [{ content: "缺少 ID 和 noteId" }],
      commentTasks: [{}],
      operationTasks: [{}],
    },
  },
  now: NOW,
});
assert.equal(missingValues.summaryById.noteCount.value, 1);
assert.equal(missingValues.summaryById.commentCount.value, 1);
assert.equal(missingValues.summaryById.orphanCommentCount.value, 1);
assert.equal(missingValues.summaryById.unknownNoteTimeCount.value, 1);
assert.equal(missingValues.summaryById.totalLikes.value, null, "无点赞观测时累计值应保持未知，不能伪装成真实零点赞");
assert.equal(missingValues.summaryById.totalLikes.evidenceRefs.length, 0);
assert.equal(missingValues.summaryById.medianLikes.value, null);
assert.equal(missingValues.summaryById.knownLikesCount.value, 0);
assert.equal(missingValues.summaryById.unknownLikesCount.value, 1);
assert.equal(missingValues.summaryById.likesCoverage.value, 0);
assert.equal(missingValues.authors[0].totalLikes, null);
assert.equal(missingValues.trend[0].totalLikes, null);
assert.ok(Object.keys(missingValues.evidenceIndex).length >= 6);
assert.ok(Object.values(missingValues.evidenceByRef).every((evidence) => Object.hasOwn(evidence, "noteId")));

const deduped = buildAnalyticsModel({
  accounts: [{ id: "account-d", name: "D" }],
  workspaces: {
    "account-d": {
      notes: [
        { id: NOTE_A, title: "旧标题", likes: 10, link: `https://www.xiaohongshu.com/explore/${NOTE_A}` },
        { id: NOTE_A, title: "新标题", likes: 20, link: `https://www.xiaohongshu.com/explore/${NOTE_A}?xsec=2` },
      ],
      comments: [
        { noteId: NOTE_A, nickname: "同一用户", content: "同一内容", time: "2026-08-01 10:00" },
        { noteId: NOTE_A, nickname: "同一用户", content: "同一内容", time: "2026-08-01 10:00" },
      ],
      commentTasks: [{ link: `https://www.xiaohongshu.com/explore/${NOTE_A}` }],
      operationTasks: [],
    },
  },
  now: NOW,
});
assert.equal(deduped.summaryById.noteCount.value, 1);
assert.equal(deduped.summaryById.commentCount.value, 1);
assert.equal(deduped.topNotes[0].likes, 20, "同一笔记重复观测保留较高的已知点赞值");
assert.equal(deduped.lineage.byNoteRef[deduped.topNotes[0].noteRef].commentTaskRefs.length, 1, "仅有链接的任务也应回连笔记");

const zeroAndMissingLikes = buildAnalyticsModel({
  accounts: [{ id: "account-likes", name: "点赞质量" }],
  workspaces: {
    "account-likes": {
      notes: [
        { id: "zero", title: "真实零点赞", likes: 0 },
        { id: "empty", title: "空字符串", likes: "" },
        { id: "spaces", title: "空白字符串", likes: "   " },
        { id: "missing", title: "字段缺失" },
        { id: "invalid", title: "无法解析", likes: "未知" },
        { id: "positive", title: "有效点赞", likes: "10" },
      ],
    },
  },
  now: NOW,
});
assert.equal(zeroAndMissingLikes.summaryById.totalLikes.value, 10);
assert.equal(zeroAndMissingLikes.summaryById.medianLikes.value, 5, "中位数只纳入真实的 0 和 10 两次观测");
assert.equal(zeroAndMissingLikes.summaryById.knownLikesCount.value, 2);
assert.equal(zeroAndMissingLikes.summaryById.unknownLikesCount.value, 4);
assert.equal(zeroAndMissingLikes.summaryById.likesCoverage.value, 0.3333);
assert.equal(zeroAndMissingLikes.summaryById.totalLikes.evidenceRefs.length, 2);

console.log("analytics: passed");
