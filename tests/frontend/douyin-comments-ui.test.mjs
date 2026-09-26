import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const modulePath = process.env.PLAYWRIGHT_MODULE_PATH;
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : "playwright");
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "msedge", headless: true });
const output = path.resolve(process.env.UI_TEST_OUTPUT || "../../artifacts/qa-douyin-20260926");
await mkdir(output, { recursive: true });
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route("https://www.douyin.com/**", (route) => route.abort());
  await context.route("https://www.xiaohongshu.com/**", (route) => route.abort());
  await context.addInitScript(() => {
    const saved = JSON.parse(localStorage.getItem("xhs-collector-account-cache-v2") || "null");
    const accounts = saved?.accounts || [{ id: "qa-xhs", name: "小红书测试账号", platform: "xhs", loginState: "logged-in" }];
    let activeId = saved?.activeAccountId || "qa-xhs";
    const callbacks = { status: [], capture: [], account: [] };
    const emit = (type, payload) => callbacks[type].forEach((callback) => callback(payload));
    const subscribe = (type) => (callback) => { callbacks[type].push(callback); return () => { callbacks[type] = callbacks[type].filter((item) => item !== callback); }; };
    const calls = [];
    const id = "7520000000000000001";
    localStorage.setItem("xhs-collector-account-cache-v2", JSON.stringify({ accounts, activeAccountId: activeId }));
    if (!localStorage.getItem("xhs-collector-workspaces-v2")) localStorage.setItem("xhs-collector-workspaces-v2", JSON.stringify({
      "qa-xhs": { notes: [{ id: "xhs-note", title: "小红书保留笔记", link: "https://www.xiaohongshu.com/explore/xhs-note" }], comments: [{ id: "xhs-c", noteId: "xhs-note", content: "小红书原有评论" }], ui: { activeTab: "comments" } },
    }));
    const account = () => accounts.find((item) => item.id === "qa-douyin");
    const status = (phase, message) => {
      account().capture.active = phase === "collecting" || phase === "loading";
      emit("status", { accountId: "qa-douyin", platform: "douyin", kind: "comments", ...account().capture, phase, message });
      emit("account", { ...account() });
    };
    globalThis.collectorDesktop = {
      isDesktop: true,
      accounts: {
        list: async () => ({ accounts, activeAccountId: activeId }),
        add: async (options) => {
          calls.push({ method: "add", options });
          accounts.push({ id: "qa-douyin", name: options.name, platform: options.platform, url: "https://www.douyin.com/", loginState: "logged-in" });
          return { accountId: "qa-douyin" };
        },
        switch: async (accountId) => { activeId = accountId; return { ok: true }; },
        onStatus: subscribe("account"),
      },
      setBrowserBounds() {}, setDataDashboardOpen() {},
      onCapture: subscribe("capture"), onStatus: subscribe("status"),
      openNote: async (accountId, note) => { calls.push({ method: "open", accountId, note }); return { url: note.link }; },
      home: async (accountId) => { calls.push({ method: "home", accountId }); return { ok: true }; },
      startTask: async (accountId, task) => {
        calls.push({ method: "start", accountId, task });
        account().capture = { active: true, noteId: id, runId: "douyin-run", kind: "comments", target: task.target, collected: 0 };
        status("loading", "正在打开真实抖音视频页面…");
        status("collecting", "请在左侧打开评论区，正在监听目标视频的公开评论");
        emit("capture", {
          accountId, runId: "douyin-run", kind: "comments", platform: "douyin",
          notes: [{ id, title: "公开视频评论样例", author: "公开作者", link: task.url, platform: "douyin", type: "视频" }],
          comments: [
            { id: "7530000000000000001", noteId: id, platform: "douyin", nickname: "用户甲", content: "讲解清楚，很有帮助", likes: 100, replyCount: 2 },
            { id: "7530000000000000002", noteId: id, platform: "douyin", nickname: "用户甲", content: "讲解清楚，很有帮助", likes: 3, replyCount: 0 },
            { id: "7530000000000000003", noteId: id, platform: "douyin", nickname: "用户乙", content: "有些地方不太准确", likes: 8, replyCount: 12 },
          ],
        });
        return { runId: "douyin-run", ok: true };
      },
      stopTask: async () => { status("stopped", "请在左侧完成抖音安全验证，再重新采集"); return { ok: true }; },
      ai: {
        getSettings: async () => ({ hasApiKey: true, baseUrl: "https://ai.example.test/v1", model: "test-model", promptVersion: "test-v1" }),
        analyze: async (request) => {
          calls.push({ method: "analyze", request });
          const comments = request.records.filter((item) => item.kind === "comment");
          return {
            schemaVersion: 1, generatedAt: Date.now(),
            sentiments: comments.map((item, index) => ({ sourceId: item.sourceId, label: index === 2 ? "negative" : "positive", reason: index === 2 ? "对内容准确度表示疑虑。" : "表达对讲解内容的认可。" })),
            publicOpinion: { status: "complete", sections: [{ kind: "overall", summary: "采集样本中有对讲解清晰度的认可，也有对准确度的疑虑，不能据此推断平台整体看法。", sourceIds: comments.map((item) => item.sourceId) }] },
          };
        },
      },
    };
    globalThis.qa = {
      calls,
      injectWrongPlatform: () => emit("capture", { accountId: "qa-douyin", runId: "wrong", kind: "comments", platform: "xhs", comments: [{ id: "wrong", noteId: id, content: "不应混入的评论" }] }),
      injectDuplicate: () => emit("capture", { accountId: "qa-douyin", runId: "douyin-run", kind: "comments", platform: "douyin", notes: [], comments: [{ id: "7530000000000000001", noteId: id, platform: "douyin", nickname: "用户甲", content: "讲解清楚，很有帮助", likes: 105, replyCount: 2 }] }),
    };
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.UI_TEST_URL || "http://127.0.0.1:5173/");
  await page.getByRole("button", { name: "添加账号", exact: true }).click();
  await page.getByRole("combobox", { name: "账号平台" }).selectOption("douyin");
  await page.getByLabel("账号名称", { exact: true }).fill("抖音测试账号");
  await page.screenshot({ path: path.join(output, "01-add-platform.png"), animations: "disabled" });
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await page.getByRole("navigation", { name: "采集模块" }).getByRole("button", { name: "视频评论", exact: true }).waitFor();
  assert.deepEqual(await page.locator(".tabs button").allTextContents(), ["视频评论"]);
  assert.equal(await page.locator(".comment-note-card").count(), 0, "New Douyin account has no fake or migrated XHS comments");
  assert.equal(await page.getByLabel("评论采集视频链接").inputValue(), "");
  assert.equal(await page.locator(".notes-table").count(), 0, "Unsupported panels are not mounted");
  assert.equal(await page.getByRole("button", { name: "返回抖音首页" }).count(), 1);
  assert.match(await page.locator(".brand-lockup strong").textContent(), /抖音/);
  await page.getByLabel("评论采集视频链接").fill("https://www.xiaohongshu.com/explore/test");
  await page.getByRole("button", { name: "采集评论", exact: true }).click();
  assert.equal(await page.locator(".comment-note-card").count(), 0);
  assert.equal(await page.evaluate(() => qa.calls.filter((item) => item.method === "start").length), 0);
  await page.getByLabel("评论采集视频链接").fill("https://www.douyin.com/video/7520000000000000001");
  await page.getByRole("button", { name: "采集评论", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".comment-card-count strong")?.textContent === "3");
  await page.evaluate(() => { qa.injectDuplicate(); qa.injectWrongPlatform(); });
  assert.equal(await page.locator(".comment-card-count strong").textContent(), "3", "Comment ID deduplication keeps separate identical-text comments");
  assert.equal(await page.locator(".comment-card-open h3").textContent(), "公开视频评论样例");
  await page.locator(".comment-card-open").click();
  await page.getByRole("complementary", { name: "视频评论统计分析" }).waitFor();
  assert.equal(await page.locator(".comment-metrics dd").first().textContent(), "3");
  assert.equal(await page.getByRole("button", { name: "分析评论", exact: true }).isEnabled(), false);
  await page.getByRole("button", { name: "停止采集", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "请在左侧完成抖音安全验证" }).waitFor();
  page.once("dialog", async (dialog) => {
    assert.match(dialog.message(), /本视频/);
    await dialog.accept();
  });
  await page.getByRole("button", { name: "分析评论", exact: true }).click();
  await page.getByRole("button", { name: "重新分析", exact: true }).waitFor();
  assert.equal(await page.locator(".comment-sentiment-stat").count(), 3);
  assert.ok((await page.locator(".comment-details").textContent()).includes("整体"));
  const analysis = await page.evaluate(() => qa.calls.find((item) => item.method === "analyze").request);
  assert.equal(analysis.scopeLabel, "单个公开视频评论分析");
  assert.equal(analysis.includePublicOpinion, true);
  assert.equal(JSON.stringify(analysis).includes("7530000000000000001"), false);
  assert.equal(JSON.stringify(analysis).includes("用户甲"), false);
  for (const width of [1440, 980, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: path.join(output, `02-douyin-analysis-${width}.png`), animations: "disabled" });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const bounds = await page.locator(".comment-details").boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("tab", { name: /小红书测试账号/ }).click();
  await page.getByRole("navigation", { name: "采集模块" }).getByRole("button", { name: "笔记评论", exact: true }).waitFor();
  assert.equal(await page.locator(".comment-card-open h3").textContent(), "小红书保留笔记");
  await page.getByRole("tab", { name: /抖音测试账号/ }).click();
  assert.equal(await page.locator(".comment-card-open h3").textContent(), "公开视频评论样例");
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("xhs-collector-workspaces-v2") || "{}")["qa-douyin"]?.comments.length === 3);
  await page.reload();
  await page.getByRole("button", { name: "视频评论", exact: true }).waitFor();
  assert.equal(await page.locator(".comment-card-count strong").textContent(), "3", "Douyin data survives reload");
  assert.deepEqual(errors, []);
  console.log("Douyin platform creation, comments, AI, account isolation and responsive UI: passed");
} finally {
  await browser.close();
}
