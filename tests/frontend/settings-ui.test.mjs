import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : "playwright");
const browser = await chromium.launch({ channel: "msedge", headless: true });
const output = new URL("../../../../artifacts/qa-settings-20260918/", import.meta.url);
await mkdir(output, { recursive: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 860 } });
  await context.addInitScript(() => {
    const accounts = [{ id: "settings-test", name: "设置测试账号", loginPhase: "logged-in" }];
    const settings = { baseUrl: "https://ai.example.test/v1", model: "test-model", hasApiKey: true, wireApi: "chat_completions" };
    localStorage.setItem("xhs-collector-account-cache-v2", JSON.stringify({ accounts, activeAccountId: accounts[0].id }));
    localStorage.setItem("xhs-collector-workspaces-v2", JSON.stringify({
      "settings-test": { comments: [{ id: "c1", noteId: "test-note", content: "测试评论" }], ui: { activeTab: "comments", muted: true } },
    }));
    globalThis.qa = { saved: [], tested: [], bounds: [], muted: [], tests: 0, reads: 0, failSave: false, failLoad: false, failModels: false, failTest: false };
    globalThis.collectorDesktop = {
      isDesktop: true,
      accounts: { list: async () => ({ accounts, activeAccountId: accounts[0].id }) },
      setBrowserBounds: (value) => qa.bounds.push(value), setDataDashboardOpen() {},
      setMuted: async (...args) => qa.muted.push(args),
      openNote: async (_id, note) => ({ url: note.link }),
      ai: {
        getSettings: async () => { qa.reads++; if (qa.failLoad) throw new Error("读取失败"); return { ...settings }; },
        saveSettings: async (payload) => {
          if (qa.failSave) throw new Error("保存失败");
          qa.saved.push(payload);
          Object.assign(settings, payload);
          if (Object.hasOwn(payload, "apiKey")) settings.hasApiKey = Boolean(payload.apiKey);
          delete settings.apiKey;
          return { ...settings };
        },
        listModels: async () => { if (qa.failModels) throw new Error("无法获取模型列表：系统代理连接失败"); return { models: [{ id: "test-new-model", ownedBy: "测试服务" }] }; },
        testConnection: async () => { qa.tests++; qa.tested.push({ ...settings }); if (qa.failTest) throw new Error("服务拒绝连接"); return { wireApi: "chat_completions", latencyMs: 10 }; },
        analyze: async () => { throw new Error("Must not send analysis from settings"); },
        onProgress: () => () => {},
      },
    };
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.UI_TEST_URL || "http://127.0.0.1:5173/");
  await page.locator(".comment-card-open").click();
  await page.getByRole("button", { name: "分析评论", exact: true }).waitFor();
  const open = async () => {
    await page.getByRole("button", { name: "管理当前账号", exact: true }).click();
    assert.deepEqual(await page.getByRole("menuitem").allTextContents(), ["检查登录状态", "重命名账号", "设置", "移除账号"]);
    await page.getByRole("menuitem", { name: "设置", exact: true }).click();
    await page.getByRole("dialog", { name: "设置", exact: true }).waitFor();
    await page.waitForFunction(() => qa.bounds.at(-1)?.width === 1);
  };
  await open();
  const dialog = page.getByRole("dialog", { name: "设置", exact: true });
  await page.getByRole("button", { name: "获取模型列表", exact: true }).click();
  await page.getByRole("radio", { name: /test-new-model/ }).check();
  assert.equal(await page.getByRole("button", { name: "保存并测试", exact: true }).isEnabled(), true);
  await page.getByRole("button", { name: "保存并测试", exact: true }).click();
  await page.getByText(/连接成功，当前使用/).waitFor();
  assert.equal(await page.evaluate(() => Object.hasOwn(qa.saved[0], "apiKey")), false);
  assert.equal(await page.evaluate(() => qa.saved[0].model), "test-new-model");
  assert.equal(await page.evaluate(() => qa.tested[0].model), "test-new-model", "Testing must use the newly saved configuration");
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await page.getByText(/连接成功，当前使用/).waitFor();
  await page.screenshot({ animations: "disabled", path: fileURLToPath(new URL("settings-ai-desktop.png", output)) });
  await page.evaluate(() => { qa.failModels = true; });
  await page.getByRole("button", { name: "获取模型列表", exact: true }).click();
  await page.locator(".ai-model-catalog-error").waitFor();
  assert.match(await page.locator(".ai-model-catalog header").textContent(), /未获取/);
  assert.doesNotMatch(await page.locator(".ai-model-catalog header").textContent(), /0 个/);
  await page.getByLabel("模型", { exact: true }).fill("custom-relay-model");
  await page.getByLabel("推理强度").selectOption("xhigh");
  await page.getByRole("button", { name: "保存并测试", exact: true }).click();
  await page.getByText(/连接成功，当前使用/).waitFor();
  assert.equal(await page.evaluate(() => qa.tested.at(-1).model), "custom-relay-model");
  assert.equal(await page.evaluate(() => qa.tested.at(-1).reasoningEffort), "xhigh");
  assert.equal(await page.evaluate(() => Object.hasOwn(qa.saved.at(-1), "apiKey")), false);
  await page.screenshot({ animations: "disabled", path: fileURLToPath(new URL("settings-catalog-failure.png", output)) });
  await page.evaluate(() => { qa.failTest = true; });
  await page.getByLabel("推理强度").selectOption("low");
  await page.getByRole("button", { name: "保存并测试", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "设置已保存，但连接测试未通过：服务拒绝连接" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "测试连接", exact: true }).isEnabled(), true);
  await page.evaluate(() => { qa.failTest = false; });
  await page.getByLabel("模型", { exact: true }).fill("test-new-model");
  await page.getByLabel("推理强度").selectOption("");
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await page.getByText("设置已保存，API Key 已加密保留，关闭或重启后仍会继续使用。", { exact: true }).waitFor();
  await page.getByRole("tab", { name: "通用", exact: true }).click();
  await page.getByRole("switch", { name: "网页静音", exact: true }).uncheck();
  assert.deepEqual(await page.evaluate(() => qa.muted.at(-1)), ["settings-test", false]);
  await page.screenshot({ animations: "disabled", path: fileURLToPath(new URL("settings-general-desktop.png", output)) });
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await page.waitForFunction(() => qa.bounds.at(-1)?.width > 1);
  assert.equal(await page.locator(".comment-details").isVisible(), true, "Settings must preserve the current comments view");
  assert.equal(await page.getByRole("button", { name: "分析评论", exact: true }).isVisible(), true);
  await open();
  assert.equal(await page.getByLabel("模型", { exact: true }).inputValue(), "test-new-model");
  await page.getByLabel("模型", { exact: true }).fill("unsaved");
  page.once("dialog", (confirmation) => confirmation.dismiss());
  await page.keyboard.press("Escape");
  assert.equal(await dialog.isVisible(), true);
  page.once("dialog", (confirmation) => confirmation.accept());
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await open();
  assert.equal(await page.getByLabel("模型", { exact: true }).inputValue(), "test-new-model");
  await page.getByRole("button", { name: "保存设置", exact: true }).focus();
  await page.keyboard.press("Tab");
  assert.equal(await page.getByRole("button", { name: "关闭设置", exact: true }).evaluate((element) => element === document.activeElement), true);
  await page.keyboard.press("Shift+Tab");
  assert.equal(await page.getByRole("button", { name: "保存设置", exact: true }).evaluate((element) => element === document.activeElement), true);
  await page.getByRole("tab", { name: "AI 服务", exact: true }).focus();
  await page.keyboard.press("ArrowLeft");
  assert.equal(await page.getByRole("tab", { name: "通用", exact: true }).getAttribute("aria-selected"), "true");
  await page.getByRole("tab", { name: "AI 服务", exact: true }).click();
  await page.getByRole("button", { name: "更换 Key", exact: true }).click();
  await page.getByLabel("API Key", { exact: true }).fill("test-replacement-key");
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await page.getByLabel("已安全保存的 API Key", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => qa.saved.at(-1).apiKey), "test-replacement-key");
  assert.ok(!(await dialog.textContent()).includes("test-replacement-key"));
  await page.evaluate(() => { qa.failSave = true; });
  const testsBeforeFailedSave = await page.evaluate(() => qa.tests);
  await page.getByLabel("模型", { exact: true }).fill("bad-save-model");
  await page.getByRole("button", { name: "保存并测试", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "保存失败" }).waitFor();
  assert.equal(await page.evaluate(() => qa.tests), testsBeforeFailedSave, "A failed save must not test stale settings");
  assert.equal(await page.getByLabel("模型", { exact: true }).inputValue(), "bad-save-model");
  await page.getByLabel("模型", { exact: true }).fill("test-new-model");
  for (const width of [980, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const bounds = await dialog.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
    await page.locator("#settings-panel-ai").evaluate((element) => { element.scrollTop = element.scrollHeight; });
    for (const control of [page.getByRole("button", { name: "关闭设置", exact: true }), page.getByRole("button", { name: "保存设置", exact: true }), page.getByRole("button", { name: "测试连接", exact: true })]) {
      const box = await control.boundingBox();
      assert.ok(box.y >= bounds.y && box.y + box.height <= bounds.y + bounds.height, "Header and action buttons must stay inside the dialog");
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ animations: "disabled", path: fileURLToPath(new URL(`settings-${width}.png`, output)) });
  }
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 860 });
  await page.evaluate(() => { qa.failLoad = true; });
  await open();
  await page.getByRole("alert").filter({ hasText: "读取失败" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "保存设置", exact: true }).isDisabled(), true);
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  await page.evaluate(() => { qa.failLoad = false; qa.failSave = false; });
  await open();
  await page.getByLabel("服务地址 / 中转地址", { exact: false }).fill("https://another-relay.example.test/v1");
  assert.equal(await page.getByRole("button", { name: "保存并测试", exact: true }).isDisabled(), true, "Changing providers must not send the old key");
  await page.getByLabel("服务地址 / 中转地址", { exact: false }).fill("https://ai.example.test/v1");
  await page.getByRole("checkbox", { name: "保存设置时清除已保存的 API Key", exact: true }).check();
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await page.getByText("设置已保存，API Key 已清除。", { exact: true }).waitFor();
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  await page.getByRole("button", { name: "前往设置", exact: true }).click();
  await dialog.waitFor();
  assert.equal(await page.locator(".comment-details").isVisible(), true);
  assert.equal(await page.locator(".analysis-route").count(), 0, "AI configuration must not navigate to full analytics");
  await page.getByLabel("API Key", { exact: true }).fill("restored-test-key");
  await page.getByRole("button", { name: "保存并测试", exact: true }).click();
  await page.getByText(/连接成功，当前使用/).waitFor();
  await page.getByLabel("已安全保存的 API Key", { exact: true }).waitFor();
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  await page.getByRole("button", { name: "分析评论", exact: true }).waitFor();
  await page.getByRole("button", { name: "数据看板", exact: true }).click();
  await page.getByRole("button", { name: /查看完整分析/ }).click();
  await page.locator(".analysis-route").waitFor();
  await open();
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  assert.equal(await page.locator(".analysis-route").isVisible(), true);
  assert.equal(await page.evaluate(() => qa.bounds.at(-1).width), 1);
  assert.deepEqual(errors, []);
  await context.close();
  const preview = await browser.newPage();
  await preview.goto(process.env.UI_TEST_URL || "http://127.0.0.1:5173/");
  await preview.getByRole("button", { name: "管理当前账号", exact: true }).click();
  await preview.getByRole("menuitem", { name: "设置", exact: true }).click();
  await preview.getByText("AI 服务配置仅在桌面版可用。", { exact: true }).waitFor();
  assert.equal(await preview.getByRole("button", { name: "保存设置", exact: true }).isDisabled(), true);
  await preview.close();
  const main = await readFile(new URL("../../backend/main.cjs", import.meta.url), "utf8");
  assert.match(main, /autoHideMenuBar: true/);
  assert.match(main, /if \(process\.platform !== "darwin"\) mainWindow\.setMenu\(null\)/);
  console.log("PASS: settings menu, save/key security, general toggle, focus, dirty state, errors, native-view restore, responsive layout and preview fallback");
} finally {
  await browser.close();
}
