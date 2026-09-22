import { buildAnalyticsModel } from "../analytics/analytics.js";
import { buildAiDataset, materializeAiReport } from "../analytics/ai-analysis.js";

export const COMMENT_SENTIMENTS = [
  { key: "positive", label: "正向" },
  { key: "negative", label: "负向" },
  { key: "neutral", label: "中性" },
];

export function commentMetricValue(value) {
  if (value == null || value === "" || typeof value === "boolean") return null;
  const text = String(value).trim().replaceAll(",", "").toLowerCase();
  const match = text.match(/^(\d+(?:\.\d+)?)(万|w|k)?\+?$/);
  if (!match) return null;
  const metric = Number(match[1]) * (match[2] === "k" ? 1000 : match[2] ? 10000 : 1);
  return Number.isFinite(metric) ? Math.round(metric) : null;
}

export function rankCommentExamples(comments, limit = 3) {
  const rows = comments.map((comment, index) => ({
    comment, index, likes: commentMetricValue(comment.likes), replies: commentMetricValue(comment.replyCount),
  }));
  const rank = (key) => rows.filter((row) => row[key] !== null && row[key] > 0)
    .sort((a, b) => b[key] - a[key] || a.index - b.index).slice(0, limit);
  return {
    discussion: rank("replies"),
    liked: rank("likes"),
    knownLikes: rows.filter((row) => row.likes !== null).length,
    knownReplies: rows.filter((row) => row.replies !== null).length,
    total: rows.length,
  };
}

export function buildNoteAnalysis(accountId, group) {
  // IDs and user fields stay local; buildAiDataset sends anonymous source IDs and text only.
  const comments = group.comments.map((comment, index) => ({ ...comment, id: `local-comment-${index}`, originalIndex: index }));
  const model = buildAnalyticsModel({
    accounts: [{ id: accountId, name: "当前账号" }],
    workspaces: { [accountId]: { notes: [{ id: group.id, title: group.title }], comments } },
    scopeAccountId: accountId,
  });
  const dataset = buildAiDataset(model);
  const sourceIndexes = new Map(dataset.records.filter((record) => record.kind === "comment").map((record) => [
    record.sourceId, model.evidenceIndex[dataset.sourceIdToEvidenceRef[record.sourceId]].data.originalIndex,
  ]));
  return { model, dataset, sourceIndexes, total: comments.length };
}

export function materializeNoteInsights(raw, analysis) {
  if (raw?.schemaVersion !== 1) throw new Error("AI 返回格式无效，请重试。");
  const report = materializeAiReport(raw, analysis.dataset, analysis.model);
  const byIndex = new Map();
  const counts = { positive: 0, negative: 0, neutral: 0 };
  let mixed = 0;
  for (const item of report.sentiments) {
    const index = analysis.sourceIndexes.get(item.sourceId);
    if (index == null || item.label === "unclear") continue;
    const label = item.label === "mixed" ? "neutral" : item.label;
    if (!Object.hasOwn(counts, label)) continue;
    counts[label] += 1;
    if (item.label === "mixed") mixed += 1;
    const topic = report.topics.find((entry) => entry.sourceIds?.includes(item.sourceId))?.label || "";
    byIndex.set(index, { label, reason: item.reason, mixed: item.label === "mixed", topic });
  }
  const classified = Object.values(counts).reduce((sum, count) => sum + count, 0);
  return {
    report, byIndex, counts, classified, mixed,
    unknown: analysis.total - classified,
    fingerprint: analysis.dataset.fingerprint,
  };
}
