import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href);
const browser = await chromium.launch({ channel: "msedge", headless: true });
const output = new URL("../../../../artifacts/qa-updates-20260926/", import.meta.url);
await mkdir(output, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
  await page.addInitScript(() => {
    const state = { currentVersion: "2.0.6", mode: "automatic", status: "idle", autoCheck: true, progress: 0, latestVersion: "", error: "" };
    let listener;
    globalThis.qa = { calls: [], blocked: false, fail: false, pendingCheck: false, latestVersion: "2.1.0", update: (patch) => { Object.assign(state, patch); listener?.({ ...state }); } };
    const respond = (name, patch) => { qa.calls.push(name); qa.update(patch); return { ...state }; };
    globalThis.collectorDesktop = {
      updates: {
        getState: async () => ({ ...state }),
        onState: (fn) => { listener = fn; return () => { listener = null; }; },
        check: async () => {
          if (qa.pendingCheck) {
            respond("check", { status: "checking", checkSource: "release-page", error: "" });
            return new Promise((resolve) => {
              qa.finishCheck = () => resolve(respond("check-finished", { status: "available", latestVersion: qa.latestVersion, error: "" }));
            });
          }
          return respond("check", qa.fail ? { status: "error", error: state.mode === "manual"
            ? "连接更新服务超时，请检查网络或系统代理后重试，也可前往下载新版。"
            : "更新请求失败，请检查网络。" } : { status: "available", latestVersion: qa.latestVersion, error: "" });
        },
        download: async () => respond("download", { status: "downloading", progress: 42 }),
        install: async () => respond("install", qa.blocked ? { status: "downloaded", error: "请先停止采集、自动化任务和 AI 分析，再安装更新。" } : { status: "installing", error: "" }),
        setPreferences: async (payload) => respond("preferences", payload),
        openRelease: async () => respond("release", {}),
      },
    };
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.UI_TEST_URL || "http://127.0.0.1:5173/");
  const open = async () => {
    await page.getByRole("button", { name: "管理当前账号", exact: true }).click();
    await page.getByRole("menuitem", { name: "设置", exact: true }).click();
    await page.getByRole("tab", { name: "通用", exact: true }).click();
  };
  await open();
  await page.getByRole("button", { name: "检查更新", exact: true }).click();
  await page.getByText("发现新版本 v2.1.0", { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => qa.calls), ["check"], "Checking must not download automatically");
  await page.getByRole("switch", { name: "自动检查更新" }).uncheck();
  await page.getByRole("button", { name: "下载更新", exact: true }).click();
  await page.getByRole("progressbar", { name: "更新下载进度" }).waitFor();
  assert.equal(await page.getByRole("progressbar").getAttribute("value"), "42");
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  await page.getByRole("button", { name: "查看软件更新", exact: true }).click();
  await page.getByRole("progressbar").waitFor();
  await page.evaluate(() => qa.update({ status: "downloaded", progress: 100 }));
  await page.getByRole("button", { name: "安装并重启", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => qa.calls.includes("install")), false);
  for (const width of [1440, 980, 390]) {
    await page.setViewportSize({ width, height: 860 });
    const bounds = await page.getByRole("dialog").boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ animations: "disabled", path: fileURLToPath(new URL(`updates-${width}.png`, output)) });
  }
  await page.evaluate(() => { qa.blocked = true; });
  await page.getByRole("button", { name: "安装并重启", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "请先停止采集" }).waitFor();
  await page.evaluate(() => { qa.update({ status: "idle", error: "" }); qa.fail = true; });
  await page.getByRole("button", { name: "检查更新", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "更新请求失败" }).waitFor();
  await page.evaluate(() => { qa.fail = false; });
  await page.getByRole("button", { name: "重试检查", exact: true }).click();
  await page.getByRole("button", { name: "下载更新", exact: true }).waitFor();
  await page.evaluate(() => qa.update({ mode: "manual" }));
  await page.getByRole("button", { name: "前往下载新版", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "下载更新", exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => qa.calls.at(-1)), "release");
  await page.evaluate(() => {
    qa.fail = true;
    qa.latestVersion = "2.1.3";
    qa.update({ currentVersion: "2.1.1", status: "idle", error: "", latestVersion: "" });
  });
  await page.getByRole("button", { name: "检查更新", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "连接更新服务超时" }).waitFor();
  const retry = page.getByRole("button", { name: "重试检查", exact: true });
  assert.ok(await retry.isEnabled());
  assert.ok(await page.getByRole("button", { name: "前往下载新版", exact: true }).isEnabled());
  assert.match(await page.getByRole("button", { name: "前往下载新版", exact: true }).getAttribute("class"), /primary/);
  assert.equal(await page.getByRole("button", { name: "安装并重启", exact: true }).count(), 0);
  for (const width of [1440, 980, 390]) {
    await page.setViewportSize({ width, height: 860 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const alert = page.getByRole("alert");
    assert.ok(await alert.evaluate((element) => element.scrollWidth <= element.clientWidth));
    await page.screenshot({ animations: "disabled", path: fileURLToPath(new URL(`mac-check-error-${width}.png`, output)) });
  }
  await page.getByRole("button", { name: "前往下载新版", exact: true }).click();
  assert.equal(await page.evaluate(() => qa.calls.at(-1)), "release");
  await page.evaluate(() => { qa.fail = false; qa.pendingCheck = true; });
  const checksBefore = await page.evaluate(() => qa.calls.filter((call) => call === "check").length);
  await retry.click();
  await page.getByText("正在通过官方发布页检查", { exact: true }).waitFor();
  assert.ok(await page.getByRole("button", { name: "检查中", exact: true }).isDisabled());
  assert.equal(await page.getByRole("button", { name: "检查中", exact: true }).locator(".spin").count(), 1);
  assert.equal(await page.getByRole("alert").count(), 0);
  assert.equal(await page.evaluate(() => qa.calls.filter((call) => call === "check").length), checksBefore + 1);
  await page.evaluate(() => qa.finishCheck());
  await page.getByText("发现新版本 v2.1.3", { exact: true }).waitFor();
  assert.ok(await page.getByRole("button", { name: "检查更新", exact: true }).isEnabled());
  assert.equal(await page.getByRole("button", { name: "下载更新", exact: true }).count(), 0);
  await page.setViewportSize({ width: 1440, height: 860 });
  await page.screenshot({ animations: "disabled", path: fileURLToPath(new URL("mac-check-recovered.png", output)) });
  assert.deepEqual(errors, []);
  console.log("PASS: update consent/progress, install guard, macOS failure/retry, fallback loading, official download action and responsive layouts");
} finally {
  await browser.close();
}
