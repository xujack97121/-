import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : "playwright");
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "msedge", headless: true });
const output = path.resolve(process.env.UI_TEST_OUTPUT || "../../artifacts/qa-creator-relevance-20261103");
await mkdir(output, { recursive: true });
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route("https://www.xiaohongshu.com/**", (route) => route.abort());
  await context.route("https://*.xhscdn.com/**", (route) => route.abort());
  await context.addInitScript(() => {
    const accounts = [
      { id: "creator-a", name: "达人测试甲", platform: "xhs", loginState: "logged-in" },
      { id: "creator-b", name: "达人测试乙", platform: "xhs", loginState: "logged-in" },
    ];
    if (!localStorage.getItem("xhs-collector-account-cache-v2")) localStorage.setItem("xhs-collector-account-cache-v2", JSON.stringify({ accounts, activeAccountId: "creator-a" }));
    if (!localStorage.getItem("xhs-collector-workspaces-v2")) localStorage.setItem("xhs-collector-workspaces-v2", JSON.stringify({
      "creator-a": { ui: { activeTab: "creators" } },
      "creator-b": { ui: { activeTab: "creators" } },
    }));
    const listeners = new Set();
    const calls = [];
    const states = {};
    const reads = {};
    const epoch = crypto.randomUUID();
    const runId = (index) => epoch + "-fixture-run-" + index;
    let run = 0;
    let keyword = "护肤领域";
    const empty = (accountId) => ({ accountId, runId: "", revision: 0, phase: "idle", active: false, keyword: "", creators: [], scanned: 0, message: "", stage: "", candidates: 0, checked: 0, rejected: 0, insufficient: 0 });
    const broadcast = (state) => { for (const callback of listeners) callback(structuredClone(state)); return structuredClone(state); };
    const emit = (state) => {
      states[state.accountId] = structuredClone(state);
      return broadcast(state);
    };
    const creator = (index, patch = {}) => {
      const row = {
      userId: "65b20000000000000000000" + index,
      profileUrl: "https://www.xiaohongshu.com/user/profile/65b20000000000000000000" + index + "?xsec_token=public-fixture&xsec_source=pc_search",
      nickname: index === 1 ? "认真护肤的林同学" : "超长中文达人昵称用于检查窄窗口换行仍然完整可读",
      avatarUrl: "https://sns-avatar-qc.xhscdn.com/avatar/fixture.jpg",
      followers: 12000 + index, followerLabel: "1.2万", redId: "public-creator-" + index,
      description: "专注分享日常护肤、成分研究和真实体验。\n公开简介中的完整内容和长英文标识 creator_public_profile_long_identifier_should_wrap_without_overflow。",
      ...patch,
      };
      return { ...row, relevance: patch.relevance === undefined ? {
        version: 2, keyword, userId: row.userId, status: "matched", matched: true, label: "资料与内容相符",
        reasons: ["简介与多篇公开内容呈现一致领域"], tags: [keyword, "真实记录"], matchedNotes: 2, totalNotes: 4,
        evidence: [
          { kind: "profile", text: "专注分享" + keyword + "领域的真实体验与实践记录", terms: [keyword] },
          { kind: "tag", text: keyword + "研究", terms: [keyword] },
          { kind: "note", noteId: "65c200000000000000000001", text: keyword + "实用方法与日常分享", terms: [keyword] },
          { kind: "note", noteId: "65c200000000000000000002", text: keyword + "常见问题与经验复盘", terms: [keyword] },
        ],
      } : patch.relevance };
    };
    globalThis.collectorDesktop = {
      isDesktop: true,
      accounts: {
        list: async () => ({ accounts, activeAccountId: JSON.parse(localStorage.getItem("xhs-collector-account-cache-v2")).activeAccountId }),
        switch: async () => ({ ok: true }),
      },
      setBrowserBounds() {}, setDataDashboardOpen() {},
      creators: {
        getState: (accountId) => new Promise((resolve) => { reads[accountId] = resolve; }),
        onProgress: (callback) => { listeners.add(callback); return () => listeners.delete(callback); },
        search: async (accountId, config) => {
          calls.push({ action: "search", accountId, config });
          keyword = config.keyword;
          if (qa.rejectSearch) throw new Error("平台要求验证，请先完成验证");
          return emit({ ...empty(accountId), runId: runId(++run), revision: 1, phase: "searching", active: true, stage: "collecting", keyword: config.keyword, message: "正在发现候选作者" });
        },
        stop: async (accountId) => {
          calls.push({ action: "stop", accountId });
          return emit({ ...states[accountId], revision: states[accountId].revision + 1, phase: "stopped", active: false, message: "已停止查找，保留当前结果" });
        },
        openConversation: async (accountId, row) => {
          calls.push({ action: "conversation", accountId, creator: row });
          if (qa.rejectConversation) throw new Error("该达人暂未开放私信");
          if (qa.delayConversation) await new Promise((resolve) => { qa.finishConversation = resolve; });
          return { status: "opened", url: "https://www.xiaohongshu.com/message", recipientId: row.userId };
        },
      },
    };
    globalThis.qa = { calls, states, reads, emit, broadcast, creator, empty, runId, rejectSearch: false, rejectConversation: false };
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.UI_TEST_URL || "http://127.0.0.1:5180/");
  await page.getByRole("button", { name: "找达人", exact: true }).click();
  const panel = page.getByRole("region", { name: "找达人", exact: true });
  await panel.getByText("暂无达人", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("达人粉丝量范围").locator("option").count(), 8);
  await page.getByRole("button", { name: "查找达人", exact: true }).click();
  await page.getByText("请输入 1 至 80 字的行业或领域关键词", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("行业关键词").evaluate((element) => element === document.activeElement), true);
  await page.getByLabel("行业关键词").fill("  护肤领域  ");
  await page.getByLabel("达人粉丝量范围").selectOption("custom");
  await page.getByLabel("最低粉丝量").fill("10000");
  await page.getByLabel("最高粉丝量").fill("5000");
  await page.getByRole("button", { name: "查找达人", exact: true }).click();
  await page.getByText("最高粉丝量不能小于最低粉丝量", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => qa.calls.length), 0);
  await page.getByLabel("最高粉丝量").fill("50000");
  await page.getByLabel("行业关键词").press("Enter");
  await page.getByRole("button", { name: "停止查找", exact: true }).waitFor();
  await panel.locator(".creator-verification-progress").getByText("发现候选作者", { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => qa.calls[0]), { action: "search", accountId: "creator-a", config: { keyword: "护肤领域", minFollowers: 10000, maxFollowers: 50000, limit: 30 } });
  await page.evaluate(() => {
    qa.reads["creator-a"](qa.empty("creator-a"));
    qa.emit({ ...qa.states["creator-a"], revision: 2, stage: "checking", scanned: 6, candidates: 6, checked: 4, rejected: 1, insufficient: 1, creators: [qa.creator(1), qa.creator(2, { followers: 45000, followerLabel: "4.5万", likes: 24680, noteCount: 123 }), qa.creator(5, { nickname: "未经核验的候选作者", relevance: null })] });
  });
  await panel.locator(".creator-card").nth(1).waitFor();
  await panel.getByText("核验公开主页与内容", { exact: true }).waitFor();
  assert.equal(await panel.getByText("未经核验的候选作者", { exact: true }).count(), 0);
  assert.equal(await panel.getByText("证据不足 1 位", { exact: true }).count(), 1);
  await page.screenshot({ path: path.join(output, "creators-checking-1440.png"), animations: "disabled" });
  assert.equal(await page.getByLabel("私信达人 认真护肤的林同学", { exact: true }).isDisabled(), true);
  await page.evaluate(() => {
    qa.broadcast({ ...qa.states["creator-a"], revision: 1, creators: [] });
    qa.broadcast({ ...qa.empty("creator-b"), runId: "foreign", revision: 99, phase: "completed", creators: [qa.creator(3)] });
  });
  assert.equal(await panel.locator(".creator-card").count(), 2);
  await page.evaluate(() => qa.emit({ ...qa.states["creator-a"], revision: 3, stage: "done", phase: "completed", active: false, scanned: 9, message: "查找完成", creators: [qa.creator(1), qa.creator(2, { followers: 45000, followerLabel: "4.5万", likes: 24680, noteCount: 123 })] }));
  await page.getByRole("button", { name: "查找达人", exact: true }).waitFor();
  assert.equal(await panel.locator(".creator-followers").first().textContent(), "1.2万粉丝");
  await panel.locator(".creator-card").first().getByText("更多匹配依据（1）", { exact: true }).click();
  await panel.locator(".creator-card").first().locator(".creator-more-evidence").getByText("护肤领域研究", { exact: true }).waitFor();
  await panel.locator(".creator-card").first().getByText("更多匹配依据（1）", { exact: true }).click();
  for (const width of [1440, 980]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: path.join(output, `creators-${width}.png`), animations: "disabled" });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "No page-level horizontal overflow");
    const list = await panel.locator(".creator-list").boundingBox();
    assert.ok(list.height >= 120, "Creator list retains usable height");
    assert.equal(await panel.locator(".creator-card").evaluateAll((cards) => cards.every((card) => {
      const bounds = card.getBoundingClientRect();
      return [...card.querySelectorAll("h2, p, button")].every((child) => {
        const childBounds = child.getBoundingClientRect();
        return childBounds.left >= bounds.left && childBounds.right <= bounds.right + 1;
      });
    })), true, "Card contents stay inside their card");
  }
  await page.evaluate(() => { qa.delayConversation = true; });
  await page.getByLabel("私信达人 认真护肤的林同学", { exact: true }).click();
  await panel.getByText("打开中", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("私信达人 认真护肤的林同学", { exact: true }).evaluate((button) => button.scrollWidth <= button.clientWidth), true, "Opening label remains inside its fixed-width button");
  await page.evaluate(() => { qa.delayConversation = false; qa.finishConversation(); });
  const conversation = await page.evaluate(() => qa.calls.find((call) => call.action === "conversation"));
  assert.equal(conversation.accountId, "creator-a");
  assert.equal(conversation.creator.userId, "65b200000000000000000001");
  assert.ok(conversation.creator.profileUrl.includes("xsec_token=public-fixture"));
  await page.getByText("已打开与“认真护肤的林同学”的私信会话。", { exact: false }).waitFor();
  await page.evaluate(() => { qa.rejectConversation = true; });
  await page.getByLabel("私信达人 认真护肤的林同学", { exact: true }).click();
  await panel.getByText("该达人暂未开放私信", { exact: true }).waitFor();
  await page.getByLabel("行业关键词").fill("瑜伽");
  await page.getByLabel("达人粉丝量范围").selectOption("all");
  await page.getByRole("button", { name: "查找达人", exact: true }).click();
  await page.getByRole("button", { name: "停止查找", exact: true }).waitFor();
  await page.evaluate(() => {
    qa.broadcast({ ...qa.empty("creator-a"), runId: qa.runId(1), revision: 999, phase: "completed", creators: [qa.creator(1)] });
  });
  assert.equal(await panel.locator(".creator-card").count(), 0, "A retired run cannot replace a new search");
  await page.evaluate(() => qa.emit({ ...qa.states["creator-a"], runId: qa.runId(2), revision: 2, phase: "searching", active: true, creators: [qa.creator(3, { nickname: "瑜伽记录", followers: null, followerLabel: "" })] }));
  await panel.getByText("未公开", { exact: true }).waitFor();
  await page.getByRole("button", { name: "停止查找", exact: true }).click();
  await panel.getByText("已停止查找，保留当前结果", { exact: true }).waitFor();
  assert.equal((await page.evaluate(() => qa.calls.find((call) => call.action === "stop"))).accountId, "creator-a");
  await page.getByRole("tab", { name: /达人测试乙/ }).click();
  await panel.getByText("暂无达人", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("行业关键词").inputValue(), "");
  await page.getByLabel("行业关键词").fill("咖啡");
  await page.getByLabel("达人粉丝量范围").selectOption("under-1k");
  await page.getByRole("button", { name: "查找达人", exact: true }).click();
  await page.getByRole("button", { name: "停止查找", exact: true }).waitFor();
  await page.evaluate(() => {
    qa.broadcast({ ...qa.empty("creator-a"), runId: "late-a", revision: 1000, phase: "completed", creators: [qa.creator(1)] });
    qa.emit({ ...qa.states["creator-b"], revision: 2, phase: "completed", active: false, creators: [qa.creator(4, { nickname: "咖啡记录", followers: 500, followerLabel: "500" })], message: "查找完成" });
  });
  await panel.getByText("咖啡记录", { exact: true }).waitFor();
  assert.equal(await panel.getByText("瑜伽记录", { exact: true }).count(), 0);
  await page.getByRole("tab", { name: /达人测试甲/ }).click();
  await panel.getByText("瑜伽记录", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("行业关键词").inputValue(), "瑜伽");
  assert.equal(await page.getByLabel("达人粉丝量范围").inputValue(), "all");
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("xhs-collector-workspaces-v2"))["creator-a"].creators?.snapshot?.creators?.[0]?.nickname === "瑜伽记录");
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("xhs-collector-account-cache-v2")).activeAccountId === "creator-a");
  await page.reload();
  await panel.getByText("瑜伽记录", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("行业关键词").inputValue(), "瑜伽");
  await page.evaluate(() => { qa.rejectSearch = true; });
  await page.getByRole("button", { name: "查找达人", exact: true }).click();
  await panel.getByText("平台要求验证，请先完成验证", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "查找达人", exact: true }).isEnabled(), true);
  await page.evaluate(() => { qa.rejectSearch = false; });
  await page.getByRole("button", { name: "查找达人", exact: true }).click();
  await page.getByRole("button", { name: "停止查找", exact: true }).waitFor();
  await page.evaluate(() => qa.emit({ ...qa.states["creator-a"], revision: 2, phase: "paused", active: false, message: "请在左侧完成平台验证" }));
  await panel.getByText("请在左侧完成平台验证", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "查找达人", exact: true }).isEnabled(), true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.screenshot({ path: path.join(output, "creators-error-980.png"), animations: "disabled" });
  await page.getByLabel("行业关键词").fill("恢复搜索");
  await page.getByRole("button", { name: "查找达人", exact: true }).click();
  await page.getByRole("button", { name: "停止查找", exact: true }).waitFor();
  await page.evaluate(() => qa.emit({ ...qa.states["creator-a"], revision: 2, phase: "searching", active: true, creators: [qa.creator(7, { nickname: "重启前已找到的达人" })] }));
  await panel.getByText("重启前已找到的达人", { exact: true }).waitFor();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("xhs-collector-workspaces-v2"))["creator-a"].creators?.snapshot?.phase === "searching");
  await page.reload();
  await panel.getByText("重启前已找到的达人", { exact: true }).waitFor();
  await page.waitForFunction(() => typeof qa.reads["creator-a"] === "function");
  await page.evaluate(() => qa.reads["creator-a"](qa.empty("creator-a")));
  await panel.getByText("上次查找已中断，可重新查找", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "查找达人", exact: true }).isEnabled(), true);
  assert.equal(await page.getByLabel("行业关键词").inputValue(), "恢复搜索");
  await page.getByRole("button", { name: "查找达人", exact: true }).click();
  await page.getByRole("button", { name: "停止查找", exact: true }).waitFor();
  await page.evaluate(() => qa.emit({ ...qa.states["creator-a"], revision: 2, phase: "completed", active: false, creators: [qa.creator(8, { nickname: "重启后新找到的达人" })], message: "查找完成" }));
  await panel.getByText("重启后新找到的达人", { exact: true }).waitFor();
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("xhs-collector-workspaces-v2"));
    saved["creator-a"].creators = {
      keyword: "家居", preset: "10k-50k", minFollowers: "123", maxFollowers: "456", limit: 30,
      snapshot: { accountId: "creator-a", runId: "legacy-v218", phase: "completed", keyword: "家居", creators: [qa.creator(9, { nickname: "旧版本未核验达人", relevance: null })], message: "已匹配旧缓存达人" },
    };
    localStorage.setItem("xhs-collector-workspaces-v2", JSON.stringify(saved));
  });
  await page.reload();
  await panel.getByText("历史结果需要重新核验", { exact: true }).waitFor();
  await page.waitForFunction(() => typeof qa.reads["creator-a"] === "function");
  await page.evaluate(() => qa.reads["creator-a"](qa.empty("creator-a")));
  await panel.getByText("历史结果尚未通过领域核验，请重新查找", { exact: true }).waitFor();
  assert.equal(await panel.getByText("旧版本未核验达人", { exact: true }).count(), 0);
  assert.equal(await panel.getByText("已匹配旧缓存达人", { exact: true }).count(), 0);
  assert.equal(await page.getByLabel("行业关键词").inputValue(), "家居");
  assert.equal(await page.getByLabel("达人粉丝量范围").inputValue(), "10k-50k");
  assert.equal(await page.getByRole("button", { name: "查找达人", exact: true }).isEnabled(), true);
  await page.screenshot({ path: path.join(output, "creators-legacy-recheck-980.png"), animations: "disabled" });
  assert.deepEqual(errors, []);
  console.log("PASS: verified evidence cards desktop/narrow screenshots, two-stage real progress, unverified exclusion, filters, safe chat, account/run guards, interrupted restart, legacy cache clearing and retry");
} finally { await browser.close(); }
