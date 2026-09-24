import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { COMMENT_DOM_CAPTURE_SCRIPT } = require("../../backend/capture/comment-dom-capture.cjs");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : "playwright");
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "msedge", headless: true });
const output = path.resolve(process.env.UI_TEST_OUTPUT || "../../artifacts/qa-comment-insights-20260917");
await mkdir(output, { recursive: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  await context.route("https://www.xiaohongshu.com/**", (route) => route.abort());
  await context.addInitScript(() => {
    const account = (id) => ({ id, name: id === "insights-A" ? "分析账号 A" : "分析账号 B", loginState: "logged-in" });
    const accounts = [account("insights-A"), account("insights-B")];
    const comments = [
      { id: "c1", noteId: "note-a", nickname: "用户甲", authorId: "private-uid", content: "很有帮助，解释清楚。", likes: 180, replyCount: 4 },
      { id: "c2", noteId: "note-a", nickname: "用户乙", content: "质量太差，不推荐。", likes: 20, replyCount: 50 },
      { id: "c3", noteId: "note-a", nickname: "用户丙", content: "请问什么时候更新？", likes: 0, replyCount: 3 },
      { id: "c4", noteId: "note-a", nickname: "用户丁", content: "优点明显，缺点也不少。", likes: 3, replyCount: 0 },
      { id: "c5", noteId: "note-a", nickname: "用户戊", content: "未覆盖的评论。" },
    ];
    const workspaces = {
      "insights-A": { notes: [{ id: "note-a", title: "评论分析测试笔记", author: "作者", link: "https://www.xiaohongshu.com/explore/note-a" }], comments, ui: { activeTab: "comments" } },
      "insights-B": { notes: [], comments: [{ id: "b1", noteId: "note-b", content: "账号 B 独立评论", nickname: "其他用户", likes: 10, replyCount: 2 }], ui: { activeTab: "comments" } },
    };
    localStorage.setItem("xhs-collector-account-cache-v2", JSON.stringify({ accounts, activeAccountId: "insights-A" }));
    localStorage.setItem("xhs-collector-workspaces-v2", JSON.stringify(workspaces));
    const pending = new Map();
    const requests = [];
    const cancelled = [];
    let captureListener;
    let progressListener;
    globalThis.collectorDesktop = {
      isDesktop: true,
      accounts: { list: async () => ({ accounts, activeAccountId: "insights-A" }), switch: async () => ({ ok: true }) },
      setBrowserBounds() {}, setDataDashboardOpen() {},
      openNote: async (id, note) => ({ url: note.link }),
      onCapture: (handler) => { captureListener = handler; return () => { captureListener = null; }; },
      ai: {
        getSettings: async () => ({ hasApiKey: true, baseUrl: "https://ai.example.test/v1", model: "test-model", wireApi: "chat_completions", promptVersion: "test-v1" }),
        onProgress: (handler) => { progressListener = handler; return () => { progressListener = null; }; },
        analyze: (payload) => { requests.push(payload); return new Promise((resolve, reject) => pending.set(payload.requestId, { resolve, reject, payload })); },
        cancel: async (id) => { cancelled.push(id); return { cancelled: true }; },
      },
    };
    globalThis.qa = {
      requests, cancelled,
      complete: (id = requests.at(-1).requestId) => {
        const job = pending.get(id);
        job.resolve({
          schemaVersion: 1, generatedAt: Date.now(), promptVersion: "test-v1",
          publicOpinion: { status: "complete", sections: [
            { kind: "overall", summary: "评论同时出现对讲解清晰度的认可和对质量的不满，讨论存在不同立场。当前证据不足以推断全部用户的共识。", sourceIds: job.payload.records.filter((row) => row.kind === "comment").slice(0, 2).map((row) => row.sourceId) },
            { kind: "positives", summary: "解释清楚带来了实用价值的认可。可以保留讲解方式，但不能据此推断整体满意程度。", sourceIds: [job.payload.records.find((row) => row.kind === "comment").sourceId] },
            { kind: "concerns", summary: "评论者对质量提出负面评价，但没有给出具体场景。建议先询问问题细节，再核实原因，不宜直接作出质量定论。", sourceIds: [job.payload.records.filter((row) => row.kind === "comment")[1].sourceId] },
            { kind: "demands", summary: "评论中有对更新时间的询问，体现出信息透明的诉求。可以回应当前进展，避免承诺尚未确认的时间。", sourceIds: [job.payload.records.filter((row) => row.kind === "comment")[2].sourceId] },
            { kind: "response", summary: "先回应质量顾虑并收集使用场景，再单独同步更新进展。对认可保持感谢，不用正面评论抵消具体投诉。", sourceIds: job.payload.records.filter((row) => row.kind === "comment").slice(1, 3).map((row) => row.sourceId) },
          ] },
          sentiments: job.payload.records.filter((record) => record.kind === "comment" && !record.content.startsWith("未覆盖"))
            .map((record) => ({
              sourceId: record.sourceId,
              label: record.content.startsWith("很有帮助") ? "positive" : record.content.startsWith("质量太差") ? "negative" : record.content.startsWith("优点明显") ? "mixed" : "neutral",
              reason: record.content.startsWith("很有帮助") ? "通过肯定解释质量表达认可。" : record.content.startsWith("质量太差") ? "对质量表达不满并反对推荐。" : "描述情况或同时表达不同倾向。",
            })),
        });
      },
      fail: () => pending.get(requests.at(-1).requestId).reject(new Error("测试服务失败")),
      progress: (requestId, message, details = {}) => progressListener?.({ requestId, message, ...details }),
      add: (rows) => captureListener?.({ accountId: "insights-A", kind: "comments", runId: "test-capture", comments: rows, notes: [] }),
    };
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.UI_TEST_URL || "http://127.0.0.1:5173/");
  await page.locator(".comment-card-open").click();
  await page.getByRole("button", { name: "分析评论", exact: true }).waitFor();
  assert.equal(await page.locator(".comment-sentiment-stat").count(), 3);
  assert.equal(await page.getByRole("region", { name: "高讨论评论", exact: true }).locator("li").first().locator("blockquote").textContent(), "质量太差，不推荐。");
  assert.equal(await page.getByRole("region", { name: "高点赞评论", exact: true }).locator("li").first().locator("blockquote").textContent(), "很有帮助，解释清楚。");
  assert.equal(await page.evaluate(() => qa.requests.length), 0, "Opening a card must never send data automatically");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "分析评论", exact: true }).click();
  assert.equal(await page.evaluate(() => qa.requests.length), 0);
  page.once("dialog", async (dialog) => {
    assert.match(dialog.message(), /ai\.example\.test/);
    assert.match(dialog.message(), /5 条评论/);
    await dialog.accept();
  });
  await page.getByRole("button", { name: "分析评论", exact: true }).click();
  await page.getByRole("button", { name: "停止分析", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => qa.requests[0].includePublicOpinion), true);
  await page.evaluate(() => qa.progress(qa.requests.at(-1).requestId, "正在综合评论观点，生成舆情判断与回应建议", { phase: "opinion_synthesis", elapsedMs: 72000, totalRecords: 6, analyzedRecords: 6, totalBatches: 1, completedBatches: 1 }));
  await page.waitForFunction(() => document.querySelector(".comment-ai-stages [aria-current=step]")?.textContent === "舆情总结");
  assert.equal(await page.locator(".comment-ai-stages [aria-current=step]").textContent(), "舆情总结");
  assert.match(await page.getByRole("status", { name: "AI 分析进度" }).textContent(), /1 分 12 秒/);
  assert.notEqual(await page.locator(".comment-ai-spinner").evaluate((el) => getComputedStyle(el).animationName), "none");
  await page.waitForFunction(() => {
    const toolbar = document.querySelector(".comment-ai-toolbar").getBoundingClientRect();
    const progress = document.querySelector(".comment-ai-progress").getBoundingClientRect();
    const scroll = document.querySelector(".comment-details-scroll").getBoundingClientRect();
    return progress.top >= toolbar.bottom && progress.bottom <= scroll.bottom + 1;
  });
  await page.screenshot({ path: path.join(output, "opinion-running-desktop.png") });
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(await page.locator(".comment-ai-spinner").evaluate((el) => getComputedStyle(el).animationName), "none");
  assert.equal(await page.locator(".comment-ai-activity i").evaluate((el) => getComputedStyle(el).animationName), "none");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(output, "opinion-running-mobile.png") });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const sent = await page.evaluate(() => JSON.stringify(qa.requests[0].records));
  assert.ok(!sent.includes("private-uid") && !sent.includes("用户甲") && !sent.includes("账号 B"));
  await page.evaluate(() => qa.progress("other-job", "错误任务进度"));
  assert.equal(await page.getByText("错误任务进度", { exact: true }).count(), 0);
  await page.evaluate(() => qa.complete());
  await page.getByRole("button", { name: "重新分析", exact: true }).waitFor();
  assert.equal(await page.locator(".comment-ai-progress").count(), 0);
  assert.equal(await page.locator(".comment-opinion-section").count(), 5);
  await page.locator(".comment-opinion-section details").first().locator("summary").click();
  assert.match(await page.locator(".comment-opinion-section").first().textContent(), /很有帮助，解释清楚/);
  await page.locator(".comment-opinion-section details").first().locator("summary").click();
  await page.locator(".comment-opinion").evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: path.join(output, "opinion-summary-desktop.png") });
  await page.locator(".comment-ai-run").evaluate((el) => el.focus());
  assert.deepEqual(await page.locator(".comment-sentiment-stat strong").allTextContents(), ["1条", "1条", "2条"]);
  assert.equal(await page.getByText("1 条未明确判定，不归入中性", { exact: true }).count(), 1);
  assert.match(await page.getByRole("region", { name: "高点赞评论", exact: true }).locator("li").first().textContent(), /通过肯定解释质量表达认可/);
  await page.screenshot({ animations: "disabled", path: path.join(output, "sentiment-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ animations: "disabled", path: path.join(output, "sentiment-mobile.png") });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const bounds = await page.locator(".comment-details").boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391);
  for (const width of [980, 390]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.locator(".comment-ai-run").evaluate((el) => el.getBoundingClientRect().height >= 40));
    const overflow = await page.locator(".comment-opinion-section p, .comment-ai-toolbar").evaluateAll((els) => els.some((el) => el.scrollWidth > el.clientWidth + 1));
    assert.equal(overflow, false, `Opinion UI must fit at ${width}`);
    await page.locator(".comment-opinion").evaluate((el) => el.scrollIntoView({ block: "start" }));
    const title = await page.locator(".comment-opinion h3").boundingBox();
    const toolbar = await page.locator(".comment-ai-toolbar").boundingBox();
    assert.ok(title.y >= toolbar.y + toolbar.height, "Sticky actions must not cover the summary heading");
    await page.screenshot({ path: path.join(output, `opinion-summary-${width}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "关闭评论分析", exact: true }).click();
  await page.locator(".comment-card-open").click();
  await page.getByRole("button", { name: "重新分析", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => qa.requests.length), 1, "Reopening restores cached analysis without another provider call");
  await page.evaluate(() => qa.add([{ id: "c1", noteId: "note-a", nickname: "用户甲", authorId: "private-uid", content: "很有帮助，解释清楚。", likes: null, replyCount: null }]));
  assert.match(await page.getByRole("region", { name: "高点赞评论", exact: true }).locator("li").first().textContent(), /点赞 180/);
  assert.deepEqual(await page.locator(".comment-sentiment-stat strong").allTextContents(), ["1条", "1条", "2条"]);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "重新分析", exact: true }).click();
  await page.evaluate(() => qa.fail());
  await page.getByText("测试服务失败", { exact: true }).waitFor();
  assert.deepEqual(await page.locator(".comment-sentiment-stat strong").allTextContents(), ["1条", "1条", "2条"], "Failure preserves the previous valid report");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "重新分析", exact: true }).click();
  await page.getByRole("button", { name: "停止分析", exact: true }).click();
  await page.getByText("分析已取消", { exact: true }).waitFor();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "重新分析", exact: true }).click();
  const lateRequest = await page.evaluate(() => qa.requests.at(-1).requestId);
  await page.locator(".account-chip").filter({ hasText: "分析账号 B" }).click();
  await page.locator(".comment-card-open").click();
  await page.evaluate((id) => qa.complete(id), lateRequest);
  assert.deepEqual(await page.locator(".comment-sentiment-stat strong").allTextContents(), ["—条", "—条", "—条"], "A late account A result must not populate account B");
  assert.ok(await page.evaluate((id) => qa.cancelled.includes(id), lateRequest));
  await page.locator(".account-chip").filter({ hasText: "分析账号 A" }).click();
  await page.getByRole("button", { name: "重新分析", exact: true }).waitFor();
  await page.evaluate(() => qa.add([{ id: "c6", noteId: "note-a", content: "新增评论", nickname: "新增用户" }]));
  await page.getByRole("button", { name: "分析评论", exact: true }).waitFor();
  assert.deepEqual(await page.locator(".comment-sentiment-stat strong").allTextContents(), ["—条", "—条", "—条"], "Changed text requires a fresh analysis");
  await page.getByRole("button", { name: "管理当前账号", exact: true }).click();
  await page.getByRole("menuitem", { name: "设置", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  assert.deepEqual(errors, []);
  await context.close();

  const dom = await browser.newPage();
  await dom.setContent(`<div id="noteContainer">
    <div class="comment-item" data-comment-id="parent">
      <a href="https://www.xiaohongshu.com/user/profile/111111111111">用户甲</a>
      <div class="comment-content">正文里有 2026 和 500，不是点赞数</div>
      <span class="like"><span class="count">1.2万</span></span><span class="reply"><span class="count">30</span></span>
      <div class="comment-item" data-comment-id="child">
        <a href="https://www.xiaohongshu.com/user/profile/222222222222">用户乙</a>
        <div class="comment-content">回复文本</div><span class="like"><span class="count">999</span></span>
      </div>
    </div>
    <div class="comment-item" data-comment-id="missing">
      <a href="https://www.xiaohongshu.com/user/profile/333333333333">用户丙</a>
      <div class="comment-content">只有正文数字 888</div><span>展开 4 条回复</span>
    </div>
  </div>`);
  const domRows = await dom.evaluate(COMMENT_DOM_CAPTURE_SCRIPT);
  assert.equal(domRows.find((row) => row.id === "parent").likes, "1.2万");
  assert.equal(domRows.find((row) => row.id === "parent").replyCount, "30");
  assert.equal(domRows.find((row) => row.id === "child").likes, "999");
  assert.equal(domRows.find((row) => row.id === "missing").likes, null);
  assert.equal(domRows.find((row) => row.id === "missing").replyCount, null, "Remaining collapsed replies are not a total count");
  await dom.locator('[data-comment-id="parent"] > .like').evaluate((element) => element.remove());
  const nestedRows = await dom.evaluate(COMMENT_DOM_CAPTURE_SCRIPT);
  assert.equal(nestedRows.find((row) => row.id === "parent").likes, null, "A child's likes must not become the parent's likes");
  await dom.close();
  console.log(`Sentiment UI, AI consent/cache/cancellation/isolation and DOM metrics passed. Screenshots: ${output}`);
} finally {
  await browser.close();
}
