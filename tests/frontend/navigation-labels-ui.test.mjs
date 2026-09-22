import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : "playwright");
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.UI_TEST_URL || "http://127.0.0.1:5173/");
  const nav = page.getByRole("navigation", { name: "采集模块" });
  const search = () => nav.getByRole("button", { name: "搜索笔记", exact: true }).click();
  const menu = page.locator(".context-menu");
  const openMenu = () => page.locator(".notes-table").first().locator("tbody tr").first().click({ button: "right" });
  await openMenu();
  assert.deepEqual(await menu.getByRole("menuitem").allTextContents(), [
    "全选", "取消选择", "添加此条到笔记评论", "添加勾选到笔记评论", "添加此条到自动化", "添加勾选到自动化",
  ]);
  await menu.getByRole("menuitem", { name: "取消选择", exact: true }).click();
  await openMenu();
  assert.equal(await menu.getByRole("menuitem", { name: "添加勾选到自动化", exact: true }).isDisabled(), true);
  await menu.getByRole("menuitem", { name: "添加此条到自动化", exact: true }).click();
  assert.equal(await nav.getByRole("button", { name: "自动化", exact: true }).getAttribute("aria-current"), "page");
  await page.getByText("自动化任务", { exact: true }).waitFor();
  await page.getByText("已把 1 条笔记加入自动化任务列表。", { exact: true }).waitFor();
  await search();
  await page.locator(".notes-table").first().locator("tbody input[type=checkbox]").nth(0).check();
  await page.locator(".notes-table").first().locator("tbody input[type=checkbox]").nth(1).check();
  await openMenu();
  await menu.getByRole("menuitem", { name: "添加勾选到自动化", exact: true }).click();
  await page.getByText("已把 2 条笔记加入自动化任务列表。", { exact: true }).waitFor();
  assert.equal(await nav.getByRole("button", { name: "自动化", exact: true }).getAttribute("aria-current"), "page");
  await search();
  await openMenu();
  await menu.getByRole("menuitem", { name: "添加此条到笔记评论", exact: true }).click();
  assert.equal(await nav.getByRole("button", { name: "笔记评论", exact: true }).getAttribute("aria-current"), "page");
  await page.getByText("已把 1 条笔记加入笔记评论。", { exact: true }).waitFor();
  await search();
  await openMenu();
  await menu.getByRole("menuitem", { name: "添加勾选到笔记评论", exact: true }).click();
  await page.getByText("已把 2 条笔记加入笔记评论。", { exact: true }).waitFor();
  assert.equal(await nav.getByRole("button", { name: "笔记评论", exact: true }).getAttribute("aria-current"), "page");
  const output = new URL("../../../../artifacts/qa-navigation-labels-20260920/", import.meta.url);
  await mkdir(output, { recursive: true });
  for (const width of [1440, 980]) {
    await page.setViewportSize({ width, height: 860 });
    await search();
    await openMenu();
    const bounds = await menu.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
    assert.equal(await menu.getByRole("menuitem").evaluateAll((items) => items.every((item) => item.scrollWidth <= item.clientWidth)), true);
    await page.screenshot({ animations: "disabled", path: fileURLToPath(new URL(`menu-${width}.png`, output)) });
    await page.keyboard.press("Escape");
  }
  assert.deepEqual(errors, []);
  console.log("PASS: context-menu destination labels, single/batch navigation, feedback and menu text bounds");
} finally {
  await browser.close();
}
