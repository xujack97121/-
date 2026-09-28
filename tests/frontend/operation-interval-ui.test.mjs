import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : "playwright");
const browser = await chromium.launch({ channel: "msedge", headless: true });
const output = new URL("../../../../artifacts/qa-operation-interval-20260928/", import.meta.url);
await mkdir(output, { recursive: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route("https://www.xiaohongshu.com/**", (route) => route.abort());
  await context.addInitScript(() => {
    const account = { id: "fixture-interval", name: "间隔测试账号", platform: "xhs", loginState: "logged-in" };
    if (!localStorage.getItem("xhs-collector-account-cache-v2"))
      localStorage.setItem("xhs-collector-account-cache-v2", JSON.stringify({ accounts: [account], activeAccountId: account.id }));
    if (!localStorage.getItem("xhs-collector-workspaces-v2"))
      localStorage.setItem("xhs-collector-workspaces-v2", JSON.stringify({
        [account.id]: {
          notes: [], comments: [], ui: { activeTab: "safe" },
          operation: { intervalMinutes: 5, commentEnabled: true, likeEnabled: false, collectEnabled: false, commentText: "公开评论测试" },
          operationTasks: ["65a200000000000000000001", "65a200000000000000000002"].map((id, index) => ({
            id, title: `测试任务 ${index + 1}`, link: `https://www.xiaohongshu.com/explore/${id}`, selected: true,
          })),
        },
      }));
    Math.random = () => 0.65;
    globalThis.qa = { calls: [] };
    globalThis.collectorDesktop = {
      isDesktop: true,
      accounts: { list: async () => ({ accounts: [account], activeAccountId: account.id }) },
      setBrowserBounds() {}, setDataDashboardOpen() {},
      operateNote: async (accountId, operation) => {
        qa.calls.push({ accountId, operation, at: Date.now() });
        return { url: operation.note.link, actions: { comment: { status: "done" } } };
      },
    };
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install();
  await page.goto(process.env.UI_TEST_URL || "http://127.0.0.1:5173/");
  const interval = page.getByRole("spinbutton", { name: "自动化间隔秒数" });
  assert.equal(await interval.inputValue(), "10", "Legacy minutes migrate to the new seconds default");
  assert.equal(await interval.getAttribute("step"), "0.1");
  assert.match(await interval.locator("..").textContent(), /秒/);
  assert.doesNotMatch(await interval.locator("..").textContent(), /分钟/);
  await interval.fill("12.34");
  await interval.blur();
  assert.equal(await interval.inputValue(), "12.3");
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("xhs-collector-workspaces-v2"))["fixture-interval"].operation.intervalSeconds === 12.3);
  await page.reload();
  assert.equal(await interval.inputValue(), "12.3", "Seconds settings survive reload");
  await interval.fill("10");
  await interval.blur();
  await page.clock.pauseAt(await page.evaluate(() => Date.now()) + 50);
  await page.getByRole("button", { name: "开始执行", exact: true }).click({ force: true });
  await page.locator(".interval-random-hint").waitFor();
  assert.equal(await page.locator(".interval-random-hint").textContent(), "本次实际间隔 10.3 秒（随机浮动 +0.3 秒）");
  assert.equal(await interval.isDisabled(), true);
  for (const width of [1440, 980]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: fileURLToPath(new URL(`interval-${width}.png`, output)), animations: "disabled" });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  const first = await page.evaluate(() => qa.calls[0]);
  assert.equal(first.accountId, "fixture-interval");
  assert.ok(first.operation.actions.comment.length > 0);
  const elapsed = await page.evaluate(() => Date.now() - qa.calls[0].at);
  await page.clock.runFor(10_200 - elapsed);
  assert.equal(await page.evaluate(() => qa.calls.length), 1, "Do not send the next operation before the randomized interval");
  await page.clock.runFor(100);
  assert.equal(await page.evaluate(() => qa.calls.length), 2);
  assert.equal(await page.evaluate(() => qa.calls[1].at - qa.calls[0].at), 10_300);
  assert.equal(await interval.isEnabled(), true);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("xhs-collector-workspaces-v2"))["fixture-interval"].operation);
  assert.equal(Number(stored.intervalSeconds), 10);
  assert.equal(Object.hasOwn(stored, "intervalMinutes"), false);
  assert.deepEqual(errors, []);
  console.log("PASS: seconds migration, one-decimal settings, persistence, 10.3-second queue wait and desktop layout");
} finally {
  await browser.close();
}
