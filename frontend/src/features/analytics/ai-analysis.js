export const AI_ANALYSIS_SCHEMA_VERSION = 1;

export const AI_SENTIMENT_LABELS = Object.freeze([
  "positive",
  "neutral",
  "negative",
  "mixed",
  "unclear",
]);

const MAX_REPORT_ITEMS = 10000;
const MAX_LIMITATIONS = 20;

const asObject = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : null;
const asArray = (value) => Array.isArray(value) ? value : [];
const round = (value, digits = 6) => Number(Number(value || 0).toFixed(digits));

function cleanText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function sourceText(value, maxLength = 1000) {
  if (value == null) return "";
  const text = typeof value === "string" || typeof value === "number" ? String(value) : "";
  return text.normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function contentFingerprint(value) {
  const input = stableStringify(value);
  let first = 2166136261;
  let second = 2246822507;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    first ^= code;
    first = Math.imul(first, 16777619);
    second ^= code + index;
    second = Math.imul(second, 3266489909);
  }
  return `ai1-${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

function temporarySourceId(prefix, index) {
  return `${prefix}${String(index + 1).padStart(6, "0")}`;
}

function evidenceRows(model, kind) {
  return Object.values(asObject(model?.evidenceIndex) || {})
    .filter((entry) => asObject(entry) && entry.kind === kind && typeof entry.ref === "string" && entry.ref)
    .sort((left, right) => left.ref.localeCompare(right.ref));
}

export function buildAiDataset(model) {
  const sourceIdToEvidenceRef = {};
  const evidenceRefToSourceId = {};
  const records = [];
  const noteRows = evidenceRows(model, "note")
    .filter((entry) => sourceText(asObject(entry.data)?.title, 500));
  const commentRows = evidenceRows(model, "comment")
    .filter((entry) => sourceText(asObject(entry.data)?.content, 2000));

  noteRows.forEach((entry, index) => {
    const sourceId = temporarySourceId("N", index);
    sourceIdToEvidenceRef[sourceId] = entry.ref;
    evidenceRefToSourceId[entry.ref] = sourceId;
    const data = asObject(entry.data) || {};
    records.push({
      sourceId,
      kind: "note",
      title: sourceText(data.title, 500),
      type: sourceText(data.type, 80),
      time: sourceText(data.time, 100),
    });
  });

  commentRows.forEach((entry, index) => {
    const sourceId = temporarySourceId("C", index);
    sourceIdToEvidenceRef[sourceId] = entry.ref;
    evidenceRefToSourceId[entry.ref] = sourceId;
    const data = asObject(entry.data) || {};
    records.push({
      sourceId,
      kind: "comment",
      content: sourceText(data.content, 2000),
      region: sourceText(data.region, 100),
      time: sourceText(data.time, 100),
      noteSourceId: typeof entry.noteRef === "string" ? evidenceRefToSourceId[entry.noteRef] || "" : "",
    });
  });

  const linkedCommentCount = records.filter((record) => record.kind === "comment" && record.noteSourceId).length;
  const coverage = {
    totalRecords: records.length,
    noteCount: noteRows.length,
    commentCount: commentRows.length,
    linkedCommentCount,
    unlinkedCommentCount: commentRows.length - linkedCommentCount,
  };
  const fingerprint = contentFingerprint({
    schemaVersion: AI_ANALYSIS_SCHEMA_VERSION,
    scopeEvidenceRefs: asArray(model?.scope?.evidenceRefs).filter((ref) => typeof ref === "string").sort(),
    sources: records.map((record) => ({
      evidenceRef: sourceIdToEvidenceRef[record.sourceId],
      record,
    })),
  });

  return {
    records,
    sourceIdToEvidenceRef,
    evidenceRefToSourceId,
    fingerprint,
    coverage,
  };
}

function datasetIndex(dataset, model) {
  const recordsBySourceId = new Map();
  for (const record of asArray(dataset?.records)) {
    if (!asObject(record) || typeof record.sourceId !== "string" || !["note", "comment"].includes(record.kind)) continue;
    if (!recordsBySourceId.has(record.sourceId)) recordsBySourceId.set(record.sourceId, record);
  }

  const evidenceIndex = asObject(model?.evidenceIndex) || {};
  const forward = asObject(dataset?.sourceIdToEvidenceRef) || {};
  const reverse = asObject(dataset?.evidenceRefToSourceId) || {};
  const resolve = (sourceId, allowedKinds) => {
    if (typeof sourceId !== "string" || !recordsBySourceId.has(sourceId)) return null;
    const record = recordsBySourceId.get(sourceId);
    if (!allowedKinds.has(record.kind)) return null;
    const evidenceRef = forward[sourceId];
    if (typeof evidenceRef !== "string" || reverse[evidenceRef] !== sourceId) return null;
    const evidence = evidenceIndex[evidenceRef];
    if (!asObject(evidence) || evidence.ref !== evidenceRef || evidence.kind !== record.kind) return null;
    return { sourceId, evidenceRef, record, evidence };
  };

  return { recordsBySourceId, resolve };
}

function validatedSources(values, resolve, allowedKinds, globallyUsed = null) {
  const sourceIds = [];
  const evidenceRefs = [];
  const localSeen = new Set();
  for (const sourceId of asArray(values).slice(0, MAX_REPORT_ITEMS)) {
    if (typeof sourceId !== "string" || localSeen.has(sourceId) || globallyUsed?.has(sourceId)) continue;
    const resolved = resolve(sourceId, allowedKinds);
    if (!resolved) continue;
    localSeen.add(sourceId);
    globallyUsed?.add(sourceId);
    sourceIds.push(sourceId);
    evidenceRefs.push(resolved.evidenceRef);
  }
  return { sourceIds, evidenceRefs };
}

function validItemId(value, fallback, usedIds) {
  const supplied = cleanText(value, 64);
  const id = supplied && /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,63}$/u.test(supplied) ? supplied : fallback;
  if (usedIds.has(id)) return "";
  usedIds.add(id);
  return id;
}

function localMetric(sourceIds, evidenceRefs, denominator) {
  const count = evidenceRefs.length;
  return {
    count,
    share: denominator > 0 ? round(count / denominator) : 0,
    sourceIds,
    evidenceRefs,
  };
}

function cleanProvider(value) {
  const provider = asObject(value);
  if (!provider) return { baseUrl: "", model: "", wireApi: "", reasoningEffort: "" };
  return {
    baseUrl: cleanText(provider.baseUrl, 1000),
    model: cleanText(provider.model, 200),
    wireApi: cleanText(provider.wireApi, 80),
    reasoningEffort: cleanText(provider.reasoningEffort, 32),
  };
}

function emptyReport(dataset) {
  const coverage = asObject(dataset?.coverage) || {};
  return {
    schemaVersion: AI_ANALYSIS_SCHEMA_VERSION,
    promptVersion: "",
    generatedAt: null,
    provider: { baseUrl: "", model: "", wireApi: "", reasoningEffort: "" },
    fingerprint: typeof dataset?.fingerprint === "string" ? dataset.fingerprint : "",
    sentiments: [],
    sentimentSummary: AI_SENTIMENT_LABELS.map((label) => ({ label, count: 0, share: 0, evidenceRefs: [] })),
    topics: [],
    needs: [],
    recommendations: [],
    publicOpinion: null,
    limitations: [],
    coverage: {
      totalRecords: Number(coverage.totalRecords) || 0,
      noteCount: Number(coverage.noteCount) || 0,
      commentCount: Number(coverage.commentCount) || 0,
      linkedCommentCount: Number(coverage.linkedCommentCount) || 0,
      unlinkedCommentCount: Number(coverage.unlinkedCommentCount) || 0,
      sentimentAnalyzedCount: 0,
      sentimentCoverage: 0,
      sentimentClassifiedCount: 0,
      sentimentFallbackCount: 0,
      sentimentModelCoverage: 0,
      topicSourceCount: 0,
      topicCoverage: 0,
      needSourceCount: 0,
      needCoverage: 0,
      recommendationSourceCount: 0,
      recommendationCoverage: 0,
    },
  };
}

export function materializeAiReport(raw, dataset, model) {
  const report = emptyReport(dataset);
  const payload = asObject(raw);
  if (!payload || payload.schemaVersion !== AI_ANALYSIS_SCHEMA_VERSION) return report;

  report.promptVersion = cleanText(payload.promptVersion, 200);
  report.generatedAt = Number.isFinite(Number(payload.generatedAt)) && Number(payload.generatedAt) > 0
    ? Number(payload.generatedAt)
    : null;
  report.provider = cleanProvider(payload.provider);

  const { recordsBySourceId, resolve: resolveRecord } = datasetIndex(dataset, model);
  const partialSourceIds = payload.partial === true && Array.isArray(payload.analyzedSourceIds)
    ? new Set(payload.analyzedSourceIds.filter((sourceId) => recordsBySourceId.has(sourceId)))
    : null;
  const resolve = (sourceId, allowedKinds) => {
    if (partialSourceIds && !partialSourceIds.has(sourceId)) return null;
    return resolveRecord(sourceId, allowedKinds);
  };
  if (partialSourceIds) {
    let noteCount = 0;
    let commentCount = 0;
    for (const sourceId of partialSourceIds) {
      const record = recordsBySourceId.get(sourceId);
      if (record?.kind === "note") noteCount += 1;
      else if (record?.kind === "comment") commentCount += 1;
    }
    report.coverage.totalRecords = noteCount + commentCount;
    report.coverage.noteCount = noteCount;
    report.coverage.commentCount = commentCount;
  }
  const noteOrComment = new Set(["note", "comment"]);
  const commentsOnly = new Set(["comment"]);
  const usedSentimentSources = new Set();

  for (const item of asArray(payload.sentiments).slice(0, MAX_REPORT_ITEMS)) {
    const row = asObject(item);
    if (!row || !AI_SENTIMENT_LABELS.includes(row.label) || usedSentimentSources.has(row.sourceId)) continue;
    const resolved = resolve(row.sourceId, commentsOnly);
    if (!resolved) continue;
    usedSentimentSources.add(row.sourceId);
    report.sentiments.push({
      sourceId: row.sourceId,
      label: row.label,
      reason: cleanText(row.reason, 300),
      count: 1,
      share: report.coverage.commentCount > 0 ? round(1 / report.coverage.commentCount) : 0,
      evidenceRefs: [resolved.evidenceRef],
    });
  }

  const sentimentClassifiedCount = report.sentiments.length;
  for (const [sourceId, record] of recordsBySourceId) {
    if (record.kind !== "comment" || usedSentimentSources.has(sourceId)) continue;
    const resolved = resolve(sourceId, commentsOnly);
    if (!resolved) continue;
    usedSentimentSources.add(sourceId);
    report.sentiments.push({
      sourceId,
      label: "unclear",
      reason: "模型未返回有效分类",
      count: 1,
      share: report.coverage.commentCount > 0 ? round(1 / report.coverage.commentCount) : 0,
      evidenceRefs: [resolved.evidenceRef],
    });
  }

  report.sentimentSummary = AI_SENTIMENT_LABELS.map((label) => {
    const rows = report.sentiments.filter((item) => item.label === label);
    return {
      label,
      count: rows.length,
      share: report.sentiments.length ? round(rows.length / report.sentiments.length) : 0,
      evidenceRefs: rows.flatMap((item) => item.evidenceRefs),
    };
  });

  const usedTopicIds = new Set();
  const usedTopicSources = new Set();
  asArray(payload.topics).slice(0, MAX_REPORT_ITEMS).forEach((item, index) => {
    const row = asObject(item);
    if (!row) return;
    const id = validItemId(row.id, `topic-${index + 1}`, usedTopicIds);
    const label = cleanText(row.label, 80);
    if (!id || !label) return;
    const sources = validatedSources(row.sourceIds, resolve, noteOrComment, usedTopicSources);
    if (!sources.evidenceRefs.length) return;
    report.topics.push({
      id,
      label,
      summary: cleanText(row.summary, 600),
      ...localMetric(sources.sourceIds, sources.evidenceRefs, report.coverage.totalRecords),
    });
  });

  const usedNeedIds = new Set();
  asArray(payload.needs).slice(0, MAX_REPORT_ITEMS).forEach((item, index) => {
    const row = asObject(item);
    if (!row) return;
    const id = validItemId(row.id, `need-${index + 1}`, usedNeedIds);
    const label = cleanText(row.label, 100);
    if (!id || !label) return;
    const sources = validatedSources(row.sourceIds, resolve, commentsOnly);
    if (!sources.evidenceRefs.length) return;
    report.needs.push({
      id,
      label,
      summary: cleanText(row.summary, 600),
      ...localMetric(sources.sourceIds, sources.evidenceRefs, report.coverage.commentCount),
    });
  });

  const usedRecommendationIds = new Set();
  asArray(payload.recommendations).slice(0, MAX_REPORT_ITEMS).forEach((item, index) => {
    const row = asObject(item);
    if (!row) return;
    const id = validItemId(row.id, `recommendation-${index + 1}`, usedRecommendationIds);
    const title = cleanText(row.title, 100);
    const action = cleanText(row.action, 600);
    if (!id || !title || !action) return;
    const sources = validatedSources(row.sourceIds, resolve, noteOrComment);
    if (!sources.evidenceRefs.length) return;
    report.recommendations.push({
      id,
      title,
      action,
      rationale: cleanText(row.rationale, 600),
      evidenceStrength: sources.evidenceRefs.length >= 2 ? "multiple" : "single",
      ...localMetric(sources.sourceIds, sources.evidenceRefs, report.coverage.totalRecords),
    });
  });

  if (asObject(payload.publicOpinion)) {
    const kinds = ["overall", "positives", "concerns", "demands", "response"];
    const seen = new Set();
    const sections = [];
    for (const item of asArray(payload.publicOpinion.sections).slice(0, 5)) {
      if (!asObject(item) || !kinds.includes(item.kind) || seen.has(item.kind)) continue;
      const summary = cleanText(item.summary, 600);
      const ids = asArray(item.sourceIds);
      if (!summary || !ids.length || ids.length > 4 || ids.some((id) => !resolve(id, commentsOnly))) continue;
      seen.add(item.kind);
      const sources = validatedSources(ids, resolve, commentsOnly);
      sections.push({ kind: item.kind, summary, ...sources });
    }
    report.publicOpinion = {
      status: payload.publicOpinion.status === "complete" && seen.has("overall") ? "complete" : "unavailable",
      sections: payload.publicOpinion.status === "complete" && seen.has("overall")
        ? sections.sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind)) : [],
    };
  }

  report.limitations = Array.from(new Set(asArray(payload.limitations)
    .map((item) => cleanText(item, 300))
    .filter(Boolean)))
    .slice(0, MAX_LIMITATIONS);

  report.topics.sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, "zh-CN"));
  report.needs.sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, "zh-CN"));
  report.recommendations.sort((left, right) => right.count - left.count || left.title.localeCompare(right.title, "zh-CN"));

  const topicSources = new Set(report.topics.flatMap((item) => item.sourceIds));
  const needSources = new Set(report.needs.flatMap((item) => item.sourceIds));
  const recommendationSources = new Set(report.recommendations.flatMap((item) => item.sourceIds));
  report.coverage.sentimentAnalyzedCount = report.sentiments.length;
  report.coverage.sentimentCoverage = report.coverage.commentCount ? round(report.sentiments.length / report.coverage.commentCount) : 0;
  report.coverage.sentimentClassifiedCount = sentimentClassifiedCount;
  report.coverage.sentimentFallbackCount = report.sentiments.length - sentimentClassifiedCount;
  report.coverage.sentimentModelCoverage = report.coverage.commentCount ? round(sentimentClassifiedCount / report.coverage.commentCount) : 0;
  report.coverage.topicSourceCount = topicSources.size;
  report.coverage.topicCoverage = report.coverage.totalRecords ? round(topicSources.size / report.coverage.totalRecords) : 0;
  report.coverage.needSourceCount = needSources.size;
  report.coverage.needCoverage = report.coverage.commentCount ? round(needSources.size / report.coverage.commentCount) : 0;
  report.coverage.recommendationSourceCount = recommendationSources.size;
  report.coverage.recommendationCoverage = report.coverage.totalRecords ? round(recommendationSources.size / report.coverage.totalRecords) : 0;

  return report;
}

export function buildAiCacheKey({ fingerprint = "", model = "", baseUrl = "", wireApi = "", reasoningEffort = "", promptVersion = "" } = {}) {
  const normalizedBaseUrl = cleanText(baseUrl, 1000).replace(/\/+$/, "").toLowerCase();
  return `xhs-ai:${AI_ANALYSIS_SCHEMA_VERSION}:${contentFingerprint({
    fingerprint: cleanText(fingerprint, 200),
    model: cleanText(model, 200),
    baseUrl: normalizedBaseUrl,
    wireApi: cleanText(wireApi, 80),
    reasoningEffort: cleanText(reasoningEffort, 32),
    promptVersion: cleanText(promptVersion, 200),
  })}`;
}

function validCachedReport(report, fingerprint) {
  return asObject(report)
    && report.schemaVersion === AI_ANALYSIS_SCHEMA_VERSION
    && report.fingerprint === fingerprint
    && Array.isArray(report.sentiments)
    && Array.isArray(report.sentimentSummary)
    && Array.isArray(report.topics)
    && Array.isArray(report.needs)
    && Array.isArray(report.recommendations)
    && Array.isArray(report.limitations)
    && asObject(report.coverage);
}

export function serializeAiCacheEntry({ cacheKey, report, createdAt = Date.now() } = {}) {
  if (typeof cacheKey !== "string" || !cacheKey || !validCachedReport(report, report?.fingerprint)) return "";
  const timestamp = Number(createdAt);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  return JSON.stringify({
    schemaVersion: AI_ANALYSIS_SCHEMA_VERSION,
    cacheKey,
    fingerprint: report.fingerprint,
    createdAt: timestamp,
    report,
  });
}

export function deserializeAiCacheEntry(serialized, { cacheKey = "", fingerprint = "", maxAgeMs = Infinity, now = Date.now() } = {}) {
  try {
    const entry = JSON.parse(serialized);
    if (!asObject(entry) || entry.schemaVersion !== AI_ANALYSIS_SCHEMA_VERSION) return null;
    if (!cacheKey || entry.cacheKey !== cacheKey || entry.fingerprint !== fingerprint) return null;
    if (!validCachedReport(entry.report, fingerprint)) return null;
    const createdAt = Number(entry.createdAt);
    const currentTime = Number(now);
    const maximumAge = Number(maxAgeMs);
    if (!Number.isFinite(createdAt) || createdAt <= 0 || !Number.isFinite(currentTime)) return null;
    if (Number.isFinite(maximumAge) && maximumAge >= 0 && currentTime - createdAt > maximumAge) return null;
    return entry.report;
  } catch {
    return null;
  }
}

export function readAiReportCache(storage, {
  fingerprint = "",
  baseUrl = "",
  model = "",
  wireApi = "",
  reasoningEffort = "",
  promptVersion = "",
  maxAgeMs = Infinity,
  now = Date.now(),
  dataset = null,
  analyticsModel = null,
} = {}) {
  if (!storage || typeof storage.getItem !== "function") return null;
  const cacheKey = buildAiCacheKey({ fingerprint, baseUrl, model, wireApi, reasoningEffort, promptVersion });
  try {
    const cached = deserializeAiCacheEntry(storage.getItem(cacheKey), { cacheKey, fingerprint, maxAgeMs, now });
    if (!cached) return null;
    return dataset && analyticsModel ? materializeAiReport(cached, dataset, analyticsModel) : cached;
  } catch {
    return null;
  }
}

export function writeAiReportCache(storage, { fingerprint = "", baseUrl = "", model = "", wireApi = "", reasoningEffort = "", promptVersion = "", createdAt = Date.now() } = {}, raw) {
  if (!storage || typeof storage.setItem !== "function" || !validCachedReport(raw, fingerprint)) return false;
  const cacheKey = buildAiCacheKey({ fingerprint, baseUrl, model, wireApi, reasoningEffort, promptVersion });
  const serialized = serializeAiCacheEntry({ cacheKey, report: raw, createdAt });
  if (!serialized) return false;
  try {
    storage.setItem(cacheKey, serialized);
    return true;
  } catch {
    return false;
  }
}
