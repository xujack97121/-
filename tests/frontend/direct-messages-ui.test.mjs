import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : "playwright");
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "msedge", headless: true });
const output = path.resolve(process.env.UI_TEST_OUTPUT || "../../artifacts/qa-direct-messages-20261015");
await mkdir(output, { recursive: true });
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route("https://www.xiaohongshu.com/**", (route) => route.abort());
  await context.addInitScript(() => {
    const accounts = [
      { id: "fixture-a", name: "私信测试甲", platform: "xhs", loginState: "logged-in" },
      { id: "fixture-b", name: "私信测试乙", platform: "xhs", loginState: "logged-in" },
    ];
    const note = { id: "65b200000000000000000001", title: "完整的目标笔记标题，用于验证紧凑窗口的长中文文本", link: "https://www.xiaohongshu.com/explore/65b200000000000000000001?xsec_token=fixture-only", selected: true };
    if (!localStorage.getItem("xhs-collector-account-cache-v2")) localStorage.setItem("xhs-collector-account-cache-v2", JSON.stringify({ accounts, activeAccountId: "fixture-a" }));
    if (!localStorage.getItem("xhs-collector-workspaces-v2")) localStorage.setItem("xhs-collector-workspaces-v2", JSON.stringify({
      "fixture-a": { ui: { activeTab: "safe" }, operationTasks: [note] },
      "fixture-b": { ui: { activeTab: "safe" }, operationTasks: [] },
    }));
    const listeners = new Set();
    const calls = [];
    const states = {};
    const empty = (accountId) => ({ accountId, phase: "idle", active: false, sessionId: "", candidates: [], notes: [], message: "", total: 0, completed: 0, revision: 0 });
    const emit = (state) => { states[state.accountId] = state; for (const callback of listeners) callback(structuredClone(state)); return structuredClone(state); };
    globalThis.collectorDesktop = {
      isDesktop: true,
      accounts: {
        list: async () => ({ accounts, activeAccountId: JSON.parse(localStorage.getItem("xhs-collector-account-cache-v2")).activeAccountId }),
        switch: async () => ({ ok: true }),
      },
      setBrowserBounds() {}, setDataDashboardOpen() {},
      directMessages: {
        getState: async (accountId) => structuredClone(states[accountId] || empty(accountId)),
        onProgress: (callback) => { listeners.add(callback); return () => listeners.delete(callback); },
        collect: async (accountId, notes) => {
          calls.push({ action: "collect", accountId, notes });
          return emit({ ...empty(accountId), revision: 1, sessionId: "session-" + accountId, phase: "ready",
            notes: notes.map((note) => ({ id: note.id, title: note.title, collected: 6, status: "采集结束" })), total: 1, completed: 1, message: "采集结束，请审核名单",
            candidates: ["用户甲", "用户乙", "长昵称用户用于测试窄窗口截断", "历史已发用户"].map((nickname, index) => ({
              token: "recipient-" + index, nickname, status: index === 3 ? "sent" : "ready",
              reason: index === 3 ? "该账号已发送，跨任务跳过" : "",
              sources: [{ noteId: note.id, title: note.title, content: "公开主评论内容，包含较长中文文本，不能让表格超出页面宽度。" }],
            })),
          });
        },
        review: async (accountId, config) => {
          calls.push({ action: "review", accountId, config });
          if (config.messages.some((text) => !text.trim())) throw new Error("消息不能为空");
          return { reviewId: "review-" + accountId, intervalSeconds: config.intervalSeconds,
            assignments: states[accountId].candidates.filter((row) => row.status === "ready" && config.tokens.includes(row.token)).slice(0, Number(config.limit))
              .map((row, index) => ({ token: row.token, nickname: row.nickname, message: config.messages[index % config.messages.length] })),
          };
        },
        start: async (accountId, reviewId) => {
          calls.push({ action: "start", accountId, reviewId });
          return emit({ ...states[accountId], revision: 2, phase: "sending", active: true, total: 2, completed: 0, message: "正在发送" });
        },
        stop: async (accountId) => {
          calls.push({ action: "stop", accountId });
          return emit({ ...states[accountId], revision: 3, phase: "stopped", active: false, message: "已停止发送" });
        },
      },
    };
    globalThis.qa = { calls, emit, states };
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.UI_TEST_URL || "http://127.0.0.1:5180/");
  await page.getByRole("button", { name: "评论区私信", exact: true }).click();
  assert.equal(await page.getByLabel("私信发送人数上限").inputValue(), "20");
  assert.equal(await page.getByLabel("私信发送间隔秒数").inputValue(), "60");
  await page.getByRole("button", { name: "采集用户", exact: true }).click();
  await page.getByLabel("选择私信用户 用户甲", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("选择私信用户 历史已发用户", { exact: true }).isDisabled(), true);
  await page.getByLabel("私信消息 1", { exact: true }).fill("第一段消息\n保留原始换行");
  await page.getByRole("button", { name: "添加私信消息", exact: true }).click();
  await page.getByLabel("私信消息 2", { exact: true }).fill("第二段消息，逐人轮换，不追加标点或表情。");
  await page.getByLabel("私信发送人数上限").fill("2");
  for (const width of [1440, 980]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: path.join(output, `list-${width}.png`), animations: "disabled" });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const table = await page.locator(".dm-candidates").boundingBox();
    assert.ok(table.height >= 110, "Recipient table remains usable");
  }
  await page.getByRole("button", { name: "确认发送", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "确认发送 2 人" });
  await dialog.waitFor();
  assert.equal(await page.evaluate(() => qa.calls.filter((call) => call.action === "start").length), 0, "No send before explicit confirmation");
  assert.deepEqual(await dialog.locator(".dm-confirm-list p").allTextContents(), ["第一段消息\n保留原始换行", "第二段消息，逐人轮换，不追加标点或表情。"]);
  for (const width of [1440, 980]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: path.join(output, `confirm-${width}.png`), animations: "disabled" });
    const bounds = await dialog.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
    assert.ok(bounds.y + bounds.height <= 900);
  }
  await dialog.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await page.getByLabel("选择私信用户 用户甲", { exact: true }).uncheck();
  await page.getByRole("button", { name: "确认发送", exact: true }).click();
  await dialog.waitFor();
  assert.equal(await dialog.locator(".dm-confirm-list strong").first().textContent(), "1. 用户乙");
  await dialog.getByRole("button", { name: "开始发送", exact: true }).click();
  await page.getByRole("button", { name: "停止任务", exact: true }).waitFor();
  assert.equal(await page.getByLabel("私信消息 1", { exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "笔记互动", exact: true }).isDisabled(), true);
  await page.screenshot({ path: path.join(output, "running-980.png"), animations: "disabled" });
  await page.getByRole("tab", { name: /私信测试乙/ }).click();
  await page.getByRole("button", { name: "评论区私信", exact: true }).click();
  assert.equal(await page.locator(".dm-candidates tbody tr").count(), 1);
  assert.equal(await page.getByLabel("私信消息 1", { exact: true }).inputValue(), "");
  await page.getByRole("tab", { name: /私信测试甲/ }).click();
  await page.getByRole("button", { name: "停止任务", exact: true }).click();
  await page.getByRole("button", { name: "确认发送", exact: true }).waitFor();
  const stop = await page.evaluate(() => qa.calls.find((call) => call.action === "stop"));
  assert.equal(stop.accountId, "fixture-a");
  await page.reload();
  assert.equal(await page.getByLabel("私信发送人数上限").inputValue(), "2");
  assert.equal(await page.getByLabel("私信消息 1", { exact: true }).inputValue(), "第一段消息\n保留原始换行");
  assert.deepEqual(errors, []);
  console.log("PASS: desktop/narrow screenshots, checked notes, message editing, rotation preview, explicit confirmation, no pre-confirm send, account switching, stop routing and persisted configuration");
} finally { await browser.close(); }
