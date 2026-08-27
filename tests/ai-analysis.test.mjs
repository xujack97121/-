import assert from "node:assert/strict";
import { buildAnalyticsModel } from "../src/analytics.js";
import {
  AI_SENTIMENT_LABELS,
  buildAiCacheKey,
  buildAiDataset,
  deserializeAiCacheEntry,
  materializeAiReport,
  readAiReportCache,
  serializeAiCacheEntry,
  writeAiReportCache,
} from "../src/ai-analysis.js";

const NOW = new Date("2026-08-21T12:00:00+08:00").getTime();
const NOTE_A = "69a000000000000000000001";
const NOTE_B = "69a000000000000000000002";

const accounts = [
  { id: "account-a", name: "账号 A" },
  { id: "account-b", name: "账号 B" },
];

const workspaces = {
  "account-a": {
    notes: [{
      id: NOTE_A,
      title: "轻量露营清单",
      type: "笔记",
      time: "2026-08-20 10:00",
      author: "不应发送的作者",
      authorId: "private-author-a",
      link: `https://www.xiaohongshu.com/explore/${NOTE_A}?private=1`,
      likes: 300,
    }],
    comments: [{
      id: "comment-a",
      noteId: NOTE_A,
      content: "想知道帐篷型号和预算",
      region: "上海",
      time: "2026-08-20 11:00",
      nickname: "不应发送的昵称",
      authorId: "private-user-a",
    }],
    commentTasks: [],
    operationTasks: [],
  },
  "account-b": {
    notes: [{
      id: NOTE_B,
      title: "城市周末路线",
      type: "视频",
      time: "2026-08-19 09:00",
      author: "另一作者",
      link: `https://www.xiaohongshu.com/explore/${NOTE_B}`,
      likes: 800,
    }],
    comments: [{
      id: "comment-b",
      noteId: NOTE_B,
      content: "路线很实用",
      region: "北京",
      time: "2026-08-19 10:00",
      nickname: "另一昵称",
    }],
    commentTasks: [],
    operationTasks: [],
  },
};

const model = buildAnalyticsModel({ accounts, workspaces, now: NOW });
const dataset = buildAiDataset(model);

assert.deepEqual(dataset.coverage, {
  totalRecords: 4,
  noteCount: 2,
  commentCount: 2,
  linkedCommentCount: 2,
  unlinkedCommentCount: 0,
});
assert.deepEqual(dataset.records.filter((record) => record.kind === "note").map((record) => record.sourceId), ["N000001", "N000002"]);
assert.deepEqual(dataset.records.filter((record) => record.kind === "comment").map((record) => record.sourceId), ["C000001", "C000002"]);

for (const [sourceId, evidenceRef] of Object.entries(dataset.sourceIdToEvidenceRef)) {
  assert.equal(dataset.evidenceRefToSourceId[evidenceRef], sourceId, "临时编号必须可逆映射到当前模型证据");
  assert.ok(model.evidenceIndex[evidenceRef]);
}

for (const record of dataset.records) {
  if (record.kind === "note") {
    assert.deepEqual(Object.keys(record).sort(), ["kind", "sourceId", "time", "title", "type"]);
  } else {
    assert.deepEqual(Object.keys(record).sort(), ["content", "kind", "noteSourceId", "region", "sourceId", "time"]);
    assert.match(record.noteSourceId, /^N\d{6}$/);
  }
}

const outboundJson = JSON.stringify(dataset.records);
for (const secret of [
  "account-a",
  "account-b",
  "不应发送的作者",
  "不应发送的昵称",
  "private-author-a",
  "private-user-a",
  "xiaohongshu.com",
  NOTE_A,
  NOTE_B,
]) {
  assert.ok(!outboundJson.includes(secret), `AI 数据集不得包含 ${secret}`);
}

const scopedModel = buildAnalyticsModel({ accounts, workspaces, scopeAccountId: "account-a", now: NOW });
const scopedDataset = buildAiDataset(scopedModel);
assert.equal(scopedDataset.coverage.noteCount, 1);
assert.equal(scopedDataset.coverage.commentCount, 1);
assert.ok(Object.values(scopedDataset.sourceIdToEvidenceRef).every((ref) => model.evidenceIndex[ref]?.accountId === "account-a"));
assert.ok(Object.values(scopedDataset.sourceIdToEvidenceRef).every((ref) => !ref.includes("account-b")));

const changedWorkspaces = structuredClone(workspaces);
changedWorkspaces["account-a"].notes[0].title = "轻量露营装备清单（更新）";
const changedDataset = buildAiDataset(buildAnalyticsModel({ accounts, workspaces: changedWorkspaces, now: NOW }));
assert.notEqual(changedDataset.fingerprint, dataset.fingerprint, "任何发送内容变化都必须改变指纹");
assert.equal(buildAiDataset(model).fingerprint, dataset.fingerprint, "相同范围和内容必须生成稳定指纹");

const noteSourceIds = dataset.records.filter((record) => record.kind === "note").map((record) => record.sourceId);
const commentSourceIds = dataset.records.filter((record) => record.kind === "comment").map((record) => record.sourceId);
const [noteOne, noteTwo] = noteSourceIds;
const [commentOne, commentTwo] = commentSourceIds;

const report = materializeAiReport({
  schemaVersion: 1,
  promptVersion: "grounded-v1",
  generatedAt: NOW,
  provider: { baseUrl: "https://api.example.com/v1", model: "example-model", wireApi: "responses", reasoningEffort: "xhigh", apiKey: "must-not-pass" },
  sentiments: [
    { sourceId: commentOne, label: "positive", reason: "表达认可", count: 999, share: 0.99, evidenceRefs: ["forged"] },
    { sourceId: commentOne, label: "negative", reason: "重复分类必须丢弃" },
    { sourceId: noteOne, label: "positive", reason: "笔记不能作为评论情绪" },
    { sourceId: "C999999", label: "negative", reason: "越权引用" },
    { sourceId: commentTwo, label: "unsupported", reason: "非法分类" },
  ],
  topics: [
    { id: "topic-outdoor", label: "户外准备", summary: "围绕装备和预算", sourceIds: [noteOne, commentOne, noteOne, "N999999"], count: 999, share: 1 },
    { id: "topic-duplicate", label: "重复来源", summary: "不应重复计算", sourceIds: [noteOne] },
    { id: "topic-city", label: "城市路线", summary: "周末路线", sourceIds: [noteTwo] },
    { id: "topic-empty", label: "无依据", summary: "必须删除", sourceIds: ["N999999"] },
  ],
  needs: [
    { id: "need-budget", label: "预算信息", summary: "希望补充价格区间", sourceIds: [commentOne, noteOne, commentOne], count: 999 },
    { id: "need-note-only", label: "笔记推断", summary: "不能作为用户需求", sourceIds: [noteTwo] },
  ],
  recommendations: [
    { id: "recommendation-detail", title: "补充清单细节", action: "增加型号与预算说明", rationale: "来源提出了明确问题", sourceIds: [commentOne, noteOne, commentOne], count: 999, share: 1 },
    { id: "recommendation-title", title: "延展路线内容", action: "继续发布路线主题", rationale: "当前只有标题依据", sourceIds: [noteTwo] },
    { id: "recommendation-empty", title: "凭空建议", action: "不应保留", sourceIds: ["C999999"] },
  ],
  limitations: ["仅分析当前采集样本", "仅分析当前采集样本", 123],
  count: 999999,
}, dataset, model);

assert.equal(report.schemaVersion, 1);
assert.equal(report.fingerprint, dataset.fingerprint);
assert.equal(report.promptVersion, "grounded-v1");
assert.equal(report.generatedAt, NOW);
assert.deepEqual(report.provider, { baseUrl: "https://api.example.com/v1", model: "example-model", wireApi: "responses", reasoningEffort: "xhigh" });
assert.equal(report.sentiments.length, 2, "模型漏标的合法评论必须由本地补为 unclear");
assert.deepEqual(report.sentiments[0].evidenceRefs, [dataset.sourceIdToEvidenceRef[commentOne]]);
assert.equal(report.sentiments[0].count, 1);
assert.equal(report.sentiments[0].share, 0.5);
assert.equal(report.sentiments[1].sourceId, commentTwo);
assert.equal(report.sentiments[1].label, "unclear");
assert.deepEqual(report.sentiments[1].evidenceRefs, [dataset.sourceIdToEvidenceRef[commentTwo]]);
assert.equal(report.sentimentSummary.find((item) => item.label === "positive").count, 1);
assert.equal(report.sentimentSummary.find((item) => item.label === "positive").share, 0.5);
assert.equal(report.sentimentSummary.find((item) => item.label === "unclear").count, 1);
assert.equal(report.sentimentSummary.find((item) => item.label === "unclear").share, 0.5);
assert.deepEqual(report.sentimentSummary.map((item) => item.label), AI_SENTIMENT_LABELS);

assert.equal(report.topics.length, 2, "越权主题及只含跨主题重复来源的主题必须删除");
assert.equal(report.topics[0].count, 2);
assert.equal(report.topics[0].share, 0.5);
assert.deepEqual(report.topics[0].sourceIds, [noteOne, commentOne]);
assert.deepEqual(report.topics[0].evidenceRefs, [dataset.sourceIdToEvidenceRef[noteOne], dataset.sourceIdToEvidenceRef[commentOne]]);
assert.equal(report.topics[1].count, 1);

assert.equal(report.needs.length, 1);
assert.deepEqual(report.needs[0].sourceIds, [commentOne]);
assert.equal(report.needs[0].count, 1);
assert.equal(report.needs[0].share, 0.5);

assert.equal(report.recommendations.length, 2);
assert.equal(report.recommendations[0].count, 2);
assert.equal(report.recommendations[0].share, 0.5);
assert.equal(report.recommendations[0].evidenceStrength, "multiple");
assert.equal(report.recommendations[1].count, 1);
assert.equal(report.recommendations[1].evidenceStrength, "single", "无评论时也必须允许标题依据形成单来源建议");
assert.deepEqual(report.limitations, ["仅分析当前采集样本"]);
assert.equal(report.coverage.sentimentAnalyzedCount, 2);
assert.equal(report.coverage.sentimentCoverage, 1);
assert.equal(report.coverage.sentimentClassifiedCount, 1);
assert.equal(report.coverage.sentimentFallbackCount, 1);
assert.equal(report.coverage.sentimentModelCoverage, 0.5);
assert.equal(report.coverage.topicSourceCount, 3);
assert.equal(report.coverage.topicCoverage, 0.75);
assert.equal(report.coverage.needSourceCount, 1);
assert.equal(report.coverage.needCoverage, 0.5);
assert.equal(report.coverage.recommendationSourceCount, 3);
assert.equal(report.coverage.recommendationCoverage, 0.75);

for (const collection of [report.sentiments, report.sentimentSummary, report.topics, report.needs, report.recommendations]) {
  for (const item of collection) {
    assert.ok(Array.isArray(item.evidenceRefs));
    for (const evidenceRef of item.evidenceRefs) assert.ok(model.evidenceIndex[evidenceRef], `本地生成的依据 ${evidenceRef} 必须存在`);
  }
}
assert.ok(!JSON.stringify(report).includes("forged"));
assert.ok(!report.topics.some((item) => item.count === 999 || item.share === 1));
assert.ok(!report.needs.some((item) => item.count === 999));
assert.ok(!report.recommendations.some((item) => item.count === 999));

const partialReport = materializeAiReport({
  schemaVersion: 1,
  partial: true,
  analyzedSourceIds: [noteOne, commentOne],
  sentiments: [{ sourceId: commentOne, label: "positive", reason: "首批已完成分类" }],
  topics: [{ id: "topic-partial", label: "首批主题", sourceIds: [noteOne, commentOne, noteTwo] }],
  needs: [{ id: "need-partial", label: "首批需求", sourceIds: [commentOne, commentTwo] }],
  recommendations: [{ id: "recommendation-partial", title: "首批建议", action: "先验证当前依据", sourceIds: [noteOne, commentOne, noteTwo] }],
}, dataset, model);
assert.equal(partialReport.coverage.totalRecords, 2, "部分报告只计算已完成批次的本地记录");
assert.equal(partialReport.coverage.noteCount, 1);
assert.equal(partialReport.coverage.commentCount, 1);
assert.deepEqual(partialReport.sentiments.map((item) => item.sourceId), [commentOne], "未处理评论不得提前补为 unclear");
assert.deepEqual(partialReport.topics[0].sourceIds, [noteOne, commentOne]);
assert.deepEqual(partialReport.needs[0].sourceIds, [commentOne]);
assert.deepEqual(partialReport.recommendations[0].sourceIds, [noteOne, commentOne]);

const noCommentModel = buildAnalyticsModel({
  accounts: [{ id: "account-only-note", name: "只有笔记" }],
  workspaces: {
    "account-only-note": {
      notes: [{ id: NOTE_A, title: "只有标题也可生成内容建议", type: "笔记", time: "2026-08-20" }],
      comments: [],
    },
  },
  now: NOW,
});
const noCommentDataset = buildAiDataset(noCommentModel);
const onlyNoteSourceId = noCommentDataset.records[0].sourceId;
const noCommentReport = materializeAiReport({
  schemaVersion: 1,
  sentiments: [{ sourceId: onlyNoteSourceId, label: "positive", reason: "非法" }],
  needs: [{ id: "need-without-comment", label: "无评论需求", sourceIds: [onlyNoteSourceId] }],
  topics: [{ id: "topic-title", label: "标题主题", sourceIds: [onlyNoteSourceId] }],
  recommendations: [{ id: "recommendation-title", title: "标题建议", action: "扩展该主题", sourceIds: [onlyNoteSourceId] }],
}, noCommentDataset, noCommentModel);
assert.equal(noCommentReport.coverage.commentCount, 0);
assert.deepEqual(noCommentReport.sentiments, []);
assert.deepEqual(noCommentReport.needs, []);
assert.equal(noCommentReport.topics.length, 1);
assert.equal(noCommentReport.recommendations.length, 1);

const invalidSchemaReport = materializeAiReport({ schemaVersion: 2, topics: [{ sourceIds: [noteOne] }] }, dataset, model);
assert.deepEqual(invalidSchemaReport.topics, []);
assert.deepEqual(invalidSchemaReport.recommendations, []);

const cacheKey = buildAiCacheKey({
  fingerprint: report.fingerprint,
  model: "example-model",
  baseUrl: "HTTPS://API.EXAMPLE.COM/v1/",
  wireApi: "responses",
  reasoningEffort: "xhigh",
  promptVersion: "grounded-v1",
});
assert.equal(cacheKey, buildAiCacheKey({
  fingerprint: report.fingerprint,
  model: "example-model",
  baseUrl: "https://api.example.com/v1",
  wireApi: "responses",
  reasoningEffort: "xhigh",
  promptVersion: "grounded-v1",
}));
assert.notEqual(cacheKey, buildAiCacheKey({ fingerprint: changedDataset.fingerprint, model: "example-model", baseUrl: "https://api.example.com/v1", wireApi: "responses", reasoningEffort: "xhigh", promptVersion: "grounded-v1" }));
assert.notEqual(cacheKey, buildAiCacheKey({ fingerprint: report.fingerprint, model: "another-model", baseUrl: "https://api.example.com/v1", wireApi: "responses", reasoningEffort: "xhigh", promptVersion: "grounded-v1" }));
assert.notEqual(cacheKey, buildAiCacheKey({ fingerprint: report.fingerprint, model: "example-model", baseUrl: "https://api.example.com/v1", wireApi: "responses", reasoningEffort: "xhigh", promptVersion: "grounded-v2" }));
assert.notEqual(cacheKey, buildAiCacheKey({ fingerprint: report.fingerprint, model: "example-model", baseUrl: "https://api.example.com/v1", wireApi: "chat_completions", reasoningEffort: "xhigh", promptVersion: "grounded-v1" }));
assert.notEqual(cacheKey, buildAiCacheKey({ fingerprint: report.fingerprint, model: "example-model", baseUrl: "https://api.example.com/v1", wireApi: "responses", reasoningEffort: "low", promptVersion: "grounded-v1" }));

const serialized = serializeAiCacheEntry({ cacheKey, report, createdAt: NOW });
assert.ok(serialized);
assert.deepEqual(deserializeAiCacheEntry(serialized, { cacheKey, fingerprint: report.fingerprint, now: NOW + 1000, maxAgeMs: 5000 }), report, "缓存读取应返回序列化后的等价报告");
assert.equal(deserializeAiCacheEntry(serialized, { cacheKey: `${cacheKey}-other`, fingerprint: report.fingerprint }), null);
assert.equal(deserializeAiCacheEntry(serialized, { cacheKey, fingerprint: changedDataset.fingerprint }), null);
assert.equal(deserializeAiCacheEntry(serialized, { cacheKey, fingerprint: report.fingerprint, now: NOW + 6000, maxAgeMs: 5000 }), null);
assert.equal(deserializeAiCacheEntry("not-json", { cacheKey, fingerprint: report.fingerprint }), null);

const cacheState = new Map();
const storage = {
  getItem(key) { return cacheState.has(key) ? cacheState.get(key) : null; },
  setItem(key, value) { cacheState.set(key, value); },
};
const cacheDescriptor = {
  fingerprint: report.fingerprint,
  baseUrl: "https://api.example.com/v1",
  model: "example-model",
  wireApi: "responses",
  reasoningEffort: "xhigh",
  promptVersion: "grounded-v1",
  createdAt: NOW,
};
assert.equal(writeAiReportCache(storage, cacheDescriptor, report), true);
assert.deepEqual(readAiReportCache(storage, { ...cacheDescriptor, now: NOW + 1000, maxAgeMs: 5000 }), report);
const poisonedCache = structuredClone(report);
poisonedCache.topics[0].count = 999;
poisonedCache.topics[0].share = 0.999;
poisonedCache.topics[0].evidenceRefs = ["forged"];
poisonedCache.topics[0].medianLikes = 999999;
assert.equal(writeAiReportCache(storage, cacheDescriptor, poisonedCache), true);
const rematerializedCache = readAiReportCache(storage, {
  ...cacheDescriptor,
  now: NOW + 1000,
  maxAgeMs: 5000,
  dataset,
  analyticsModel: model,
});
assert.equal(rematerializedCache.topics[0].count, 2, "缓存中的 AI 自带计数不得直接进入界面");
assert.equal(rematerializedCache.topics[0].share, 0.5);
assert.deepEqual(rematerializedCache.topics[0].evidenceRefs, [dataset.sourceIdToEvidenceRef[noteOne], dataset.sourceIdToEvidenceRef[commentOne]]);
assert.equal("medianLikes" in rematerializedCache.topics[0], false, "旧缓存中的非物化字段必须被丢弃");
assert.equal(readAiReportCache(storage, { ...cacheDescriptor, model: "other-model" }), null);
assert.equal(writeAiReportCache(null, cacheDescriptor, report), false);

console.log("ai analysis grounding: passed");
