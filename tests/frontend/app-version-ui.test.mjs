import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const pkg = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
const lock = JSON.parse(await readFile(new URL("../../package-lock.json", import.meta.url), "utf8"));
assert.equal(lock.version, pkg.version);
assert.equal(lock.packages[""].version, pkg.version);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : "playwright");
const browser = await chromium.launch({ channel: "msedge", headless: true });
const output = new URL("../../../../artifacts/qa-version-20260922/", import.meta.url);
await mkdir(output, { recursive: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.UI_TEST_URL || "http://127.0.0.1:5173/");
  const version = page.getByLabel(`软件版本 ${pkg.version}`, { exact: true });
  for (const width of [1440, 980, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 860 });
    await version.waitFor({ state: "visible" });
    assert.equal(await version.textContent(), `v${pkg.version}`);
    assert.equal(await version.evaluate((element) => element.scrollWidth <= element.clientWidth), true);
    const badge = await version.boundingBox();
    const accounts = await page.locator(".account-bar").boundingBox();
    assert.ok(badge.x + badge.width <= accounts.x + 1, `Version overlaps account controls at ${width}`);
    assert.ok(accounts.x + accounts.width <= width + 1, `Account controls overflow at ${width}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (width >= 980) {
      const name = await page.locator(".brand-lockup > strong").boundingBox();
      assert.ok(badge.x >= name.x + name.width, "Version belongs after the software name");
    }
    await page.screenshot({ animations: "disabled", path: fileURLToPath(new URL(`version-${width}.png`, output)) });
  }
  assert.deepEqual(errors, []);
  console.log(`PASS: v${pkg.version} matches package/lockfile and fits desktop/mobile headers`);
} finally {
  await browser.close();
}
