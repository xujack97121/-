import assert from "node:assert/strict";
import { buildNoteAnalysis, commentMetricValue, materializeNoteInsights, rankCommentExamples } from "../../frontend/src/features/comments/comment-insights.js";

for (const value of [null, undefined, "", "未知", false, -1, Infinity]) assert.equal(commentMetricValue(value), null);
assert.equal(commentMetricValue(0), 0);
assert.equal(commentMetricValue("1.2万"), 12000);
assert.equal(commentMetricValue("2,500"), 2500);
const group = {
  id: "sample-note", title: "样本笔记",
  comments: [
    { id: "c1", noteId: "sample-note", nickname: "不应发送的昵称", authorId: "private-user", content: "很有帮助", likes: 30, replyCount: 2 },
    { id: "c2", noteId: "sample-note", content: "太差了", likes: 12, replyCount: 15 },
    { id: "c3", noteId: "sample-note", content: "什么时候更新？", likes: null, replyCount: 0 },
    { id: "c4", noteId: "sample-note", content: "有优点，也有缺点", likes: 0 },
    { id: "c5", noteId: "sample-note", content: "难以理解的梗" },
  ],
};
const ranking = rankCommentExamples(group.comments);
assert.deepEqual(ranking.discussion.map((row) => row.index), [1, 0]);
assert.deepEqual(ranking.liked.map((row) => row.index), [0, 1]);
assert.equal(ranking.knownLikes, 3);
assert.equal(ranking.knownReplies, 3);
assert.equal(rankCommentExamples([{ content: "缺失指标" }]).liked.length, 0);
const analysis = buildNoteAnalysis("account-A", group);
assert.equal(analysis.dataset.coverage.commentCount, 5);
const sent = JSON.stringify(analysis.dataset.records);
assert.ok(!sent.includes("不应发送的昵称") && !sent.includes("private-user") && !sent.includes("account-A"));
const sourceAt = (index) => [...analysis.sourceIndexes].find(([, value]) => value === index)[0];
const raw = {
  schemaVersion: 1,
  sentiments: [
    { sourceId: sourceAt(0), label: "positive", reason: "明确表达认可。" },
    { sourceId: sourceAt(1), label: "negative", reason: "表达不满。" },
    { sourceId: sourceAt(2), label: "neutral", reason: "询问更新时间。" },
    { sourceId: sourceAt(3), label: "mixed", reason: "同时肯定和批评。" },
    { sourceId: "out-of-scope", label: "positive", reason: "不应接受的来源" },
    { sourceId: sourceAt(0), label: "negative", reason: "重复引用不应重复计数" },
  ],
};
const result = materializeNoteInsights(raw, analysis);
assert.deepEqual(result.counts, { positive: 1, negative: 1, neutral: 2 });
assert.equal(result.classified, 4);
assert.equal(result.unknown, 1, "Missing AI output is not neutral");
assert.equal(result.mixed, 1);
assert.equal(result.byIndex.get(0).reason, "明确表达认可。");
assert.equal(result.byIndex.has(4), false);
const opinion = materializeNoteInsights({ ...raw, publicOpinion: { status: "complete", sections: [
  { kind: "overall", summary: "认可与顾虑并存，需要区分具体诉求。", sourceIds: [sourceAt(0), sourceAt(1)] },
  { kind: "concerns", summary: "不应展示的跨范围判断", sourceIds: [sourceAt(0), "other-account"] },
  { kind: "demands", summary: "不应引用笔记推断用户需求", sourceIds: [analysis.dataset.records.find((row) => row.kind === "note").sourceId] },
] } }, analysis);
assert.equal(opinion.report.publicOpinion.sections.length, 1);
assert.equal(opinion.report.publicOpinion.sections[0].evidenceRefs.length, 2);
assert.deepEqual(opinion.counts, result.counts);
assert.equal(materializeNoteInsights(opinion.report, analysis).report.publicOpinion.sections.length, 1, "Cached evidence is revalidated");
assert.equal(materializeNoteInsights({ ...raw, publicOpinion: { status: "complete", sections: [] } }, analysis).report.publicOpinion.status, "unavailable");
assert.throws(() => materializeNoteInsights({ schemaVersion: 99 }, analysis));
assert.notEqual(buildNoteAnalysis("account-B", group).dataset.fingerprint, analysis.dataset.fingerprint);
assert.notEqual(buildNoteAnalysis("account-A", { ...group, id: "other-note" }).dataset.fingerprint, analysis.dataset.fingerprint);
assert.notEqual(buildNoteAnalysis("account-A", { ...group, comments: [...group.comments, { content: "新增" }] }).dataset.fingerprint, analysis.dataset.fingerprint);
assert.equal(buildNoteAnalysis("account-A", { ...group, comments: group.comments.map((row) => ({ ...row, likes: 500 })) }).dataset.fingerprint, analysis.dataset.fingerprint, "Metric refresh does not invalidate a text-only AI classification");
console.log("note-specific sentiment grounding, privacy, coverage and ranking: passed");
