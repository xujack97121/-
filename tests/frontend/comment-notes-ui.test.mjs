import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Optional browser check: use an installed Playwright package and an isolated profile.
const modulePath = process.env.PLAYWRIGHT_MODULE_PATH;
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : "playwright");
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "msedge", headless: true });
const baseUrl = process.env.UI_TEST_URL || "http://127.0.0.1:5173/";
const output = path.resolve(process.env.UI_TEST_OUTPUT || "../../artifacts/qa-comments-20260916");
await mkdir(output, { recursive: true });
const errors = [];
const setupPage = async (context) => {
  await context.route("https://www.xiaohongshu.com/**", (route) => route.abort());
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(baseUrl);
  return page;
};
const clickTab = (page, name) => page.getByRole("navigation", { name: "采集模块" }).getByRole("button", { name, exact: true }).click();
const noOverflow = async (page) => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

try {
  const demoContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const demo = await setupPage(demoContext);
  const table = demo.locator(".notes-table").first();
  assert.deepEqual(await table.locator("thead th").allTextContents(), ["", "序号", "作者", "标题", "评论", "链接", "点赞", "类型"]);
  assert.equal(await table.getByRole("button", { name: /^采集评论：/ }).count(), 4);
  assert.equal(await table.getByRole("button", { name: /^查看评论：/ }).count(), 2);
  assert.equal(await table.getByRole("button", { name: /^查看评论：/ }).first().textContent(), "已采集");
  await demo.reload();
  assert.equal(await table.getByRole("button", { name: /^查看评论：/ }).count(), 2, "Collected state is restored from saved comments");
  await demo.screenshot({ animations: "disabled", path: path.join(output, "01-search-row-actions.png") });
  await clickTab(demo, "笔记评论");
  assert.equal(await demo.locator(".comment-note-card").count(), 2);
  await demo.screenshot({ animations: "disabled", path: path.join(output, "02-note-cards.png") });
  await demo.locator(".comment-card-open").first().click();
  await demo.getByRole("complementary", { name: "笔记评论统计分析" }).waitFor();
  assert.equal(await demo.locator(".comment-metrics dd").first().textContent(), "3");
  assert.equal(await demo.locator(".comment-detail-list li").count(), 3);
  assert.equal(await demo.locator(".comment-details-heading h2").textContent(), "没钱还想创业？互联网是年轻人的第一桶金");
  await demo.screenshot({ animations: "disabled", path: path.join(output, "03-note-analysis-desktop.png") });
  const desktopBounds = await demo.locator(".comment-details").boundingBox();
  const cardBounds = await demo.locator(".comment-card-scroll").boundingBox();
  assert.ok(desktopBounds.x + desktopBounds.width <= 1441);
  assert.ok(cardBounds.x + cardBounds.width <= desktopBounds.x + 1, "Cards and drawer must not overlap");
  await noOverflow(demo);
  await demo.getByRole("button", { name: "关闭评论分析" }).press("Escape");
  assert.equal(await demo.locator(".comment-details").count(), 0);
  await demo.waitForFunction(() => document.querySelector(".comment-card-open") === document.activeElement);
  assert.equal(await demo.locator(".comment-card-open").first().evaluate((element) => element === document.activeElement), true);
  await demo.locator(".comment-card-open").last().click();
  assert.equal(await demo.locator(".comment-metrics dd").first().textContent(), "1");
  await demo.setViewportSize({ width: 1050, height: 800 });
  await demo.screenshot({ animations: "disabled", path: path.join(output, "04-note-analysis-narrow.png") });
  await noOverflow(demo);
  await demo.setViewportSize({ width: 390, height: 844 });
  await demo.screenshot({ animations: "disabled", path: path.join(output, "05-note-analysis-mobile.png") });
  const mobileBounds = await demo.locator(".comment-details").boundingBox();
  assert.ok(mobileBounds.x >= 0 && mobileBounds.x + mobileBounds.width <= 391);
  assert.equal(await demo.locator(".comment-card-scroll").isVisible(), false);
  await noOverflow(demo);
  await demo.getByRole("button", { name: "关闭评论分析" }).click();
  await clickTab(demo, "搜索笔记");
  await demo.locator(".notes-table").first().getByRole("button", { name: /^查看评论：/ }).first().click();
  assert.equal(await demo.locator(".comment-note-card").count(), 2, "Viewing existing comments must not create another task");
  assert.equal(await demo.locator(".comment-metrics dd").first().textContent(), "3");
  await demo.getByRole("button", { name: "关闭评论分析" }).click();
  assert.equal(await demo.locator(".comment-note-card input[type=checkbox]").count(), 0);
  assert.equal(await demo.getByRole("button", { name: "移除选中任务", exact: true }).count(), 0);
  await demo.setViewportSize({ width: 1440, height: 900 });
  await demo.screenshot({ animations: "disabled", path: path.join(output, "07-simplified-card-actions.png") });
  demo.once("dialog", async (dialog) => {
    assert.match(dialog.message(), /本地评论/);
    assert.match(dialog.message(), /不会删除小红书/);
    await dialog.dismiss();
  });
  await demo.getByRole("button", { name: /^删除卡片：/ }).last().click();
  assert.equal(await demo.locator(".comment-note-card").count(), 2, "Cancel must preserve the card");
  demo.once("dialog", (dialog) => dialog.accept());
  await demo.getByRole("button", { name: /^删除卡片：/ }).last().click();
  assert.equal(await demo.locator(".comment-note-card").count(), 1, "Cards without tasks must be deletable");
  await demo.locator(".comment-card-open").click();
  demo.once("dialog", (dialog) => dialog.accept());
  await demo.getByRole("button", { name: /^删除卡片：/ }).click();
  assert.equal(await demo.locator(".comment-note-card").count(), 0);
  assert.equal(await demo.locator(".comment-details").count(), 0, "Deleting the selected card closes its analysis");
  await demo.waitForFunction(() => {
    const workspace = JSON.parse(localStorage.getItem("xhs-collector-workspaces-v2") || "{}")["current-browser"];
    return workspace?.comments.length === 0 && workspace?.commentTasks.length === 0;
  });
  await demo.reload();
  await clickTab(demo, "笔记评论");
  assert.equal(await demo.locator(".comment-note-card").count(), 0, "Deleted cards must not return after reload");
  await clickTab(demo, "搜索笔记");
  assert.equal(await demo.locator(".notes-table").first().getByRole("button", { name: /^采集评论：/ }).count(), 6);
  await demo.locator(".notes-table").first().getByRole("button", { name: /^采集评论：/ }).first().click();
  assert.equal(await demo.locator(".comment-note-card").count(), 1);
  demo.once("dialog", (dialog) => dialog.accept());
  await demo.getByRole("button", { name: "清空全部卡片", exact: true }).click();
  assert.equal(await demo.locator(".comment-note-card").count(), 0, "Clear all also removes pending cards with zero comments");
  await demoContext.close();

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => {
    const link = (id) => `https://www.xiaohongshu.com/explore/${id}?xsec_token=test-token`;
    const accounts = [
      { id: "qa-account-a", name: "测试账号 A", loginState: "logged-in" },
      { id: "qa-account-b", name: "测试账号 B", loginState: "logged-in" },
    ];
    const notes = [
      { id: "test-note-a", title: "测试笔记甲：逐行采集", author: "测试作者甲", link: link("test-note-a"), likes: 50, type: "笔记", source: "搜索" },
      { id: "test-note-b", title: "测试笔记乙：独立统计", author: "测试作者乙", link: link("test-note-b"), likes: 20, type: "笔记", source: "作者" },
    ];
    localStorage.setItem("xhs-collector-account-cache-v2", JSON.stringify({ accounts, activeAccountId: accounts[0].id }));
    localStorage.setItem("xhs-collector-workspaces-v2", JSON.stringify(Object.fromEntries(accounts.map((account) => [account.id, {
      notes, comments: [], commentTasks: [], ui: { activeTab: "search" },
    }]))));
    const listeners = { status: [], capture: [], account: [] };
    const subscribe = (key) => (handler) => {
      listeners[key].push(handler);
      return () => { listeners[key] = listeners[key].filter((item) => item !== handler); };
    };
    const pending = new Map();
    const calls = [];
    let counter = 0;
    const emit = (key, payload) => listeners[key].forEach((handler) => handler(payload));
    const status = (accountId, phase, extra = {}) => {
      const account = accounts.find((item) => item.id === accountId);
      const old = account.capture;
      if (!old) throw new Error("No test capture");
      const active = !["stopped", "error"].includes(phase);
      account.capture = { ...old, ...extra, active };
      emit("status", { accountId, kind: "comments", ...account.capture, phase, message: "测试采集状态" });
      emit("account", account);
    };
    globalThis.collectorDesktop = {
      isDesktop: true,
      accounts: {
        list: async () => ({ accounts, activeAccountId: accounts[0].id }),
        onStatus: subscribe("account"),
        switch: async (accountId) => { calls.push({ method: "switch", accountId }); return { ok: true }; },
      },
      setBrowserBounds() {},
      setDataDashboardOpen() {},
      onStatus: subscribe("status"),
      onCapture: subscribe("capture"),
      startTask: (accountId, task) => {
        const runId = `qa-run-${++counter}`;
        const noteId = new URL(task.url).pathname.split("/").pop();
        const account = accounts.find((item) => item.id === accountId);
        if (account.capture?.active) status(accountId, "stopped");
        account.url = task.url;
        account.capture = { kind: "comments", noteId, runId, collected: 0, target: task.target, active: true };
        calls.push({ method: "startTask", accountId, task, runId });
        status(accountId, "loading");
        return new Promise((resolve, reject) => pending.set(accountId, { resolve: () => resolve({ runId, ok: true }), reject }));
      },
      stopTask: async (accountId) => { calls.push({ method: "stopTask", accountId }); status(accountId, "stopped"); return { ok: true }; },
      openNote: async (accountId, note) => {
        calls.push({ method: "openNote", accountId, note });
        if (accounts.find((item) => item.id === accountId).capture?.active) status(accountId, "stopped");
        return { url: note.link };
      },
    };
    globalThis.qa = {
      calls, status,
      resolve: (accountId) => pending.get(accountId).resolve(),
      fail: (accountId) => { status(accountId, "stopped"); pending.get(accountId).reject(new Error("测试网络失败")); },
      capture: (accountId, comments) => {
        const account = accounts.find((item) => item.id === accountId);
        emit("capture", { accountId, kind: "comments", runId: account.capture.runId, comments, notes: [], capturedAt: Date.now() });
        status(accountId, "collecting", { collected: comments.length });
      },
    };
  });
  const page = await setupPage(context);
  await page.locator(".notes-table").first().getByRole("button", { name: "采集评论：测试笔记甲：逐行采集" }).click();
  assert.equal(await page.locator(".comment-note-card").count(), 1);
  assert.equal(await page.evaluate(() => qa.calls.filter((call) => call.method === "startTask").length), 1);
  assert.equal(await page.evaluate(() => qa.calls[0].task.url), "https://www.xiaohongshu.com/explore/test-note-a?xsec_token=test-token");
  assert.equal(await page.locator(".comment-add-form button").isDisabled(), true);
  await page.evaluate(() => qa.resolve("qa-account-a"));
  await page.locator(".comment-add-form button").waitFor({ state: "visible" });
  await page.evaluate(() => qa.capture("qa-account-a", [
    { id: "qa-c-1", noteId: "test-note-a", nickname: "甲", authorId: "qa-1", content: "真实结构的测试评论一", region: "上海", time: "2026-09-16 09:00" },
    { id: "qa-c-2", noteId: "test-note-a", nickname: "乙", authorId: "qa-2", content: "真实结构的测试评论二", region: "北京", time: "2026-09-16 10:00" },
  ]));
  await clickTab(page, "搜索笔记");
  assert.equal(await page.getByRole("button", { name: "采集中：测试笔记甲：逐行采集", exact: true }).isDisabled(), true);
  await clickTab(page, "笔记评论");
  await page.locator(".comment-card-open").click();
  await page.getByRole("complementary", { name: "笔记评论统计分析" }).waitFor();
  assert.equal(await page.locator(".comment-metrics dd").first().textContent(), "2");
  await page.locator(".comment-filter-controls summary").click();
  await page.getByLabel("地区", { exact: true }).fill("上海");
  assert.equal(await page.locator(".comment-detail-list li").count(), 1);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出当前笔记评论", exact: true }).click();
  const download = await downloadPromise;
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  const csv = Buffer.concat(chunks).toString("utf8");
  assert.match(csv, /真实结构的测试评论一/);
  assert.doesNotMatch(csv, /真实结构的测试评论二/);
  await page.getByLabel("地区", { exact: true }).fill("");
  await page.locator(".comment-filter-controls summary").click();
  assert.equal(await page.evaluate(() => qa.calls.filter((call) => call.method === "openNote").length), 0, "Opening current capture analysis must not stop it");
  await page.getByRole("button", { name: "停止采集", exact: true }).click();
  await page.getByRole("button", { name: "重新采集", exact: true }).last().waitFor();
  await page.getByRole("button", { name: "关闭评论分析" }).click();
  await page.locator(".comment-card-open").click();
  assert.equal(await page.evaluate(() => qa.calls.filter((call) => call.method === "openNote").length), 1);
  await page.getByRole("button", { name: "关闭评论分析" }).click();
  await clickTab(page, "搜索笔记");
  const collectedAction = page.getByRole("button", { name: "查看评论：测试笔记甲：逐行采集", exact: true });
  assert.equal(await collectedAction.textContent(), "已采集");
  assert.match(await collectedAction.getAttribute("title"), /已采集 2 条评论/);
  const startsBeforeView = await page.evaluate(() => qa.calls.filter((call) => call.method === "startTask").length);
  await collectedAction.click();
  assert.equal(await page.locator(".comment-metrics dd").first().textContent(), "2");
  assert.equal(await page.evaluate(() => qa.calls.filter((call) => call.method === "startTask").length), startsBeforeView);
  await page.getByRole("button", { name: "关闭评论分析" }).click();
  await clickTab(page, "作者笔记");
  await page.getByRole("button", { name: "采集评论：测试笔记乙：独立统计" }).click();
  await page.evaluate(() => qa.fail("qa-account-a"));
  await page.getByText("启动失败", { exact: true }).waitFor();
  assert.match(await page.locator(".toast").textContent(), /测试网络失败/);
  await clickTab(page, "作者笔记");
  assert.equal(await page.getByRole("button", { name: "采集失败：测试笔记乙：独立统计", exact: true }).textContent(), "采集失败");
  await clickTab(page, "笔记评论");
  await page.getByRole("button", { name: "采集评论", exact: true }).last().click();
  await page.evaluate(() => qa.status("qa-account-a", "stopped", { collected: 0 }));
  await page.evaluate(() => qa.resolve("qa-account-a"));
  await page.locator(".comment-card-status").getByText("已停止", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "停止评论采集", exact: true }).count(), 0, "Late start response must not resurrect a finished run");

  // A completion after switching accounts must update only its original owner.
  await page.getByRole("button", { name: "采集评论", exact: true }).last().click();
  await page.locator(".account-chip").filter({ hasText: "测试账号 B" }).click();
  await clickTab(page, "搜索笔记");
  assert.equal(await page.getByRole("button", { name: "采集评论：测试笔记甲：逐行采集", exact: true }).textContent(), "采集评论");
  await page.evaluate(() => qa.resolve("qa-account-a"));
  await page.evaluate(() => qa.capture("qa-account-a", [
    { id: "qa-c-3", noteId: "test-note-b", nickname: "丙", authorId: "qa-3", content: "只属于账号 A", region: "浙江", time: "2026-09-16 11:00" },
  ]));
  await clickTab(page, "笔记评论");
  assert.equal(await page.locator(".comment-note-card").count(), 0);
  await page.locator(".account-chip").filter({ hasText: "测试账号 A" }).click();
  assert.equal(await page.locator(".comment-note-card").count(), 2);
  await page.getByRole("button", { name: "查看评论分析：测试笔记乙：独立统计" }).click();
  assert.equal(await page.locator(".comment-metrics dd").first().textContent(), "1");
  assert.equal(await page.locator(".comment-detail-list li").count(), 1);
  await page.screenshot({ animations: "disabled", path: path.join(output, "06-desktop-bridge-flow.png") });
  await page.evaluate(() => qa.capture("qa-account-a", Array.from({ length: 120 }, (_, i) => ({
    id: `page-comment-${i}`, noteId: "test-note-b", authorId: `page-user-${i}`, nickname: `测试用户 ${i}`,
    content: `分页长评论 ${i}：` + "测试文本".repeat(50), region: "上海", time: "2026-09-16 12:00",
  }))));
  assert.equal(await page.locator(".comment-detail-list li").count(), 50);
  await page.getByRole("button", { name: "下一页评论", exact: true }).click();
  await page.getByRole("button", { name: "下一页评论", exact: true }).click();
  assert.equal(await page.locator(".comment-detail-list li").count(), 21);
  await noOverflow(page);
  assert.equal(await page.getByRole("button", { name: "删除卡片：测试笔记乙：独立统计", exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "清空全部卡片", exact: true }).isDisabled(), true);
  await page.getByRole("button", { name: "停止采集", exact: true }).click();
  await clickTab(page, "作者笔记");
  assert.equal(await page.getByRole("button", { name: "查看评论：测试笔记乙：独立统计", exact: true }).textContent(), "已采集");
  await clickTab(page, "笔记评论");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "删除卡片：测试笔记乙：独立统计", exact: true }).click();
  assert.equal(await page.locator(".comment-note-card").count(), 1);
  assert.equal(await page.locator(".comment-details").count(), 0);
  await page.waitForFunction(() => {
    const workspace = JSON.parse(localStorage.getItem("xhs-collector-workspaces-v2"))["qa-account-a"];
    return workspace.comments.length === 2 && workspace.commentTasks.every((task) => task.id !== "test-note-b");
  });
  await clickTab(page, "作者笔记");
  assert.equal(await page.getByRole("button", { name: "采集评论：测试笔记乙：独立统计", exact: true }).textContent(), "采集评论");
  await clickTab(page, "笔记评论");
  await page.locator(".account-chip").filter({ hasText: "测试账号 B" }).click();
  assert.equal(await page.locator(".comment-note-card").count(), 0);
  await page.locator(".account-chip").filter({ hasText: "测试账号 A" }).click();
  assert.equal(await page.locator(".comment-note-card").count(), 1);
  assert.deepEqual(errors, [], "No browser runtime errors");
  await context.close();
  console.log(`Comment UI and mocked desktop flow passed. Screenshots: ${output}`);
} finally {
  await browser.close();
}
