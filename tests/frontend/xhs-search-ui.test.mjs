import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href);
const browser = await chromium.launch({ channel: "msedge", headless: true });
const output = new URL("../../../../artifacts/qa-xhs-start-20260926/", import.meta.url);
await mkdir(output, { recursive: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route("https://www.xiaohongshu.com/**", (route) => route.abort());
  await context.addInitScript(() => {
    const accounts = [
      { id: "fixture-a", name: "测试账号 A", platform: "xhs", loginState: "logged-in" },
      { id: "fixture-b", name: "测试账号 B", platform: "xhs", loginState: "logged-in" },
    ];
    localStorage.setItem("xhs-collector-account-cache-v2", JSON.stringify({ accounts, activeAccountId: "fixture-a" }));
    localStorage.setItem("xhs-collector-workspaces-v2", JSON.stringify(Object.fromEntries(accounts.map((account) => [account.id, {
      notes: [], comments: [], ui: { activeTab: "search", keyword: "乙女", currentUrl: "https://www.xiaohongshu.com/" },
    }]))));
    const handlers = { status: [], capture: [], account: [] };
    const subscribe = (key) => (callback) => {
      handlers[key].push(callback);
      return () => { handlers[key] = handlers[key].filter((item) => item !== callback); };
    };
    const emit = (key, payload) => handlers[key].forEach((callback) => callback(payload));
    globalThis.qa = { calls: [], fail: false };
    globalThis.collectorDesktop = {
      isDesktop: true,
      accounts: {
        list: async () => ({ accounts, activeAccountId: "fixture-a" }),
        switch: async () => ({ ok: true }),
        onStatus: subscribe("account"),
      },
      setBrowserBounds() {}, setDataDashboardOpen() {},
      onStatus: subscribe("status"), onCapture: subscribe("capture"),
      startTask: async (accountId, task) => {
        qa.calls.push({ accountId, task });
        const account = accounts.find((item) => item.id === accountId);
        const runId = `fixture-run-${qa.calls.length}`;
        const active = !qa.fail;
        account.capture = { active, runId, kind: task.kind, collected: 0, target: task.target };
        if (qa.fail) {
          const message = "未进入指定的采集页面，任务已停止；请在左侧确认登录、验证或访问限制后重试";
          emit("status", { accountId, ...account.capture, phase: "error", message });
          emit("account", account);
          throw new Error(message);
        }
        emit("status", { accountId, ...account.capture, phase: "collecting", message: "真实页面已加载，正在监听页面响应并滚动采集" });
        emit("account", account);
        emit("capture", {
          accountId, runId, kind: task.kind, platform: "xhs", notes: [{
            id: `fixture-note-${accountId}`, author: account.name, title: `${account.name}的采集结果`,
            likes: 20, type: "笔记", link: "https://www.xiaohongshu.com/explore/65a200000000000000000001",
          }], comments: [],
        });
        return { ok: true, runId, active };
      },
      stopTask: async (accountId) => {
        const account = accounts.find((item) => item.id === accountId);
        account.capture.active = false;
        emit("status", { accountId, ...account.capture, phase: "stopped", message: "用户已停止采集" });
        emit("account", account);
        return { ok: true };
      },
    };
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.UI_TEST_URL || "http://127.0.0.1:5173/");
  const start = page.getByRole("button", { name: "采集笔记", exact: true });
  await start.click();
  await page.getByText("测试账号 A的采集结果", { exact: true }).waitFor();
  const first = await page.evaluate(() => qa.calls[0]);
  assert.equal(first.accountId, "fixture-a");
  assert.equal(new URL(first.task.url).pathname, "/search_result/");
  assert.equal(new URL(first.task.url).searchParams.get("keyword"), "乙女");
  await page.getByRole("tab", { name: /测试账号 B/ }).click();
  assert.equal(await page.locator(".notes-table tbody tr").filter({ hasText: "测试账号 A的采集结果" }).count(), 0);
  await page.evaluate(() => { qa.fail = true; });
  await start.click();
  await page.locator(".toast.error").filter({ hasText: "启动失败：未进入指定的采集页面" }).waitFor();
  assert.ok(await start.isEnabled());
  assert.equal(await page.getByRole("button", { name: "停止", exact: true }).isEnabled(), false);
  assert.equal(await page.locator(".notes-table tbody tr").filter({ hasText: "采集结果" }).count(), 0);
  await page.screenshot({ path: fileURLToPath(new URL("failed-start.png", output)), animations: "disabled" });
  await page.evaluate(() => { qa.fail = false; });
  await start.click();
  await page.getByText("测试账号 B的采集结果", { exact: true }).waitFor();
  await page.getByRole("tab", { name: /测试账号 A/ }).click();
  await page.getByText("测试账号 A的采集结果", { exact: true }).waitFor();
  assert.equal(await page.getByText("测试账号 B的采集结果", { exact: true }).count(), 0);
  await page.screenshot({ path: fileURLToPath(new URL("isolated-accounts.png", output)), animations: "disabled" });
  assert.deepEqual(errors, []);
  console.log("PASS: canonical XHS search URL, failed-start controls, retry and two-account result isolation");
} finally {
  await browser.close();
}
