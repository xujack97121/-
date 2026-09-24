const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { opinionInput, opinionMessages, normalizeOpinion } = require("../../backend/ai/comment-opinion.cjs");
const { AiService } = require("../../backend/ai/ai-service.cjs");

const records = [
  { sourceId: "N000001", kind: "note", title: "产品说明" },
  { sourceId: "C000001", kind: "comment", content: "讲解清楚，希望补充价格", nickname: "private-name", authorId: "private-id" },
  { sourceId: "C000002", kind: "comment", content: "实际体验卡顿，不推荐" },
];
const sections = [
  { kind: "overall", summary: "评论同时表达认可与顾虑。说明清晰获得肯定，但体验问题仍需要回应。", sourceIds: ["C000001", "C000002"] },
  { kind: "concerns", summary: "评论者反馈卡顿，属于待核实的使用体验问题，不能据此判断整体质量。", sourceIds: ["C000002"] },
];
const clean = (value, limit) => typeof value === "string" ? value.trim().slice(0, limit) : "";

test("opinion evidence is bounded, anonymous and balances viewpoints", () => {
  const many = Array.from({ length: 80 }, (_, i) => ({ kind: "comment", sourceId: `C${String(i).padStart(6, "0")}`, content: "测".repeat(2000), nickname: "secret" }));
  const sentiments = many.map((row, i) => ({ sourceId: row.sourceId, label: i < 60 ? "positive" : "negative" }));
  const input = opinionInput(many, sentiments, [], []);
  assert.equal(input.records.length, 6);
  assert.equal(input.records.filter((row) => row.sentiment === "negative").length, 3);
  assert.ok(input.records.every((row) => row.content.length <= 240));
  assert.ok(!JSON.stringify(input).includes("secret"));
  assert.match(opinionMessages(input)[0].content, /不可信数据/);
  assert.match(opinionMessages(input)[0].content, /不是随机或全量样本/);
});

test("opinion rejects fabricated, cross-scope and note-only evidence", () => {
  const input = opinionInput(records, [], [], []);
  assert.equal(normalizeOpinion({ sections }, input, clean).status, "complete");
  for (const sourceIds of [[], ["C999999"], ["N000001"], ["C000001", "C999999"]]) {
    assert.throws(() => normalizeOpinion({ sections: [{ ...sections[0], sourceIds }] }, input, clean));
  }
  assert.throws(() => normalizeOpinion({ sections: [] }, input, clean));
  assert.throws(() => normalizeOpinion({ sections: Array(6).fill(sections[0]) }, input, clean));
});

test("opt-in synthesis is integrated, recoverable, cancellable and never changes counts", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "comment-opinion-test-"));
  const tasks = [];
  let mode = "success";
  let service;
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value),
    decryptString: (value) => value.toString(),
  };
  service = new AiService({
    filePath: path.join(directory, "settings.json"), safeStorage,
    fetchImpl: async (url, options) => {
      const user = JSON.parse(JSON.parse(options.body).messages.at(-1).content);
      tasks.push(user.task);
      let content;
      if (user.task === "analyze-record-batch") content = {
        sentiments: [{ sourceId: "C000001", label: "positive", reason: "表达认可" }, { sourceId: "C000002", label: "negative", reason: "表达不满" }],
        topics: [{ label: "产品体验", summary: "包含讲解与使用体验的讨论", sourceIds: records.map((row) => row.sourceId) }],
        needs: [], recommendations: [], limitations: [],
      };
      else if (user.task === "synthesize-recommendations") content = { recommendations: [], limitations: [] };
      else if (user.task === "summarize-comment-opinion") {
        assert.ok(!JSON.stringify(user).includes("private-"));
        assert.ok(user.records.every((row) => Object.keys(row).every((key) => ["sourceId", "content", "sentiment"].includes(key))));
        if (mode === "cancel") { service.cancel("opinion-cancel"); throw new Error("cancelled"); }
        content = mode === "invalid" ? { sections: [{ ...sections[0], sourceIds: ["N000001"] }] }
          : mode === "numeric" ? { sections: [{ ...sections[0], summary: "90%用户满意" }] } : { sections };
      } else throw new Error(`Unexpected task: ${user.task}`);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { headers: { "content-type": "application/json" } });
    },
  });
  try {
    await service.saveSettings({ baseUrl: "https://ai.example.test/v1", model: "test", apiKey: "test-only" });
    const progress = [];
    const report = await service.analyze({ requestId: "opinion-success", records, includePublicOpinion: true }, { onProgress: (event) => progress.push(event) });
    assert.equal(report.publicOpinion.status, "complete");
    assert.equal(report.publicOpinion.sections.length, 2);
    assert.equal(report.sentiments.length, 2);
    assert.ok(progress.some((event) => event.phase === "opinion_synthesis"));
    for (mode of ["invalid", "numeric"]) {
      const fallback = await service.analyze({ requestId: `opinion-${mode}`, records, includePublicOpinion: true });
      assert.equal(fallback.publicOpinion.status, "unavailable");
      assert.equal(fallback.sentiments.length, 2);
    }
    mode = "cancel";
    await assert.rejects(service.analyze({ requestId: "opinion-cancel", records, includePublicOpinion: true }), /取消/);
    tasks.length = 0;
    await service.analyze({ requestId: "opinion-opt-out", records });
    assert.ok(!tasks.includes("summarize-comment-opinion"), "Other analytics must not add a paid synthesis request");
  } finally {
    service.cancelAll();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
