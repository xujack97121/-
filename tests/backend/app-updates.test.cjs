const assert = require("node:assert/strict");
const { test } = require("node:test");
const { EventEmitter } = require("node:events");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { AppUpdates, newerVersion, FEED, RELEASE_PAGE } = require("../../backend/platform/app-updates.cjs");

async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "xhs-updates-"));
  const updater = new EventEmitter();
  const calls = [];
  updater.setFeedURL = (feed) => calls.push(["feed", feed]);
  updater.checkForUpdates = async () => { calls.push(["check"]); updater.emit("update-available", { version: "2.1.0" }); };
  updater.downloadUpdate = async () => {
    calls.push(["download"]);
    updater.emit("download-progress", { percent: 40, transferred: 40, total: 100 });
    updater.emit("update-downloaded", { version: "2.1.0" });
  };
  updater.quitAndInstall = (...args) => calls.push(["install", ...args]);
  const service = new AppUpdates({
    version: "2.0.6", isPackaged: true, platform: "win32", updater,
    settingsPath: path.join(directory, "updates.json"),
    beforeInstall: async () => true,
    openRelease: async (url) => calls.push(["open", url]),
    ...options,
  });
  t.after(async () => { service.dispose(); await fs.rm(directory, { recursive: true, force: true }); });
  await service.initialize();
  return { service, updater, calls };
}

test("stable version ordering rejects downgrades, prereleases and invalid tags", () => {
  assert.ok(newerVersion("v2.0.10", "2.0.9"));
  for (const version of ["2.0.6", "2.0.5", "2.1.0-beta", "bad", "9.0.0/path"]) assert.equal(newerVersion(version, "2.0.6"), false);
});

test("check, download and install remain separate user actions", async (t) => {
  const states = [];
  const { service, updater, calls } = await fixture(t, { onState: (state) => states.push(state) });
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.allowPrerelease, false);
  assert.equal(updater.allowDowngrade, false);
  assert.deepEqual(calls[0], ["feed", FEED]);
  await service.install();
  assert.equal(calls.some(([action]) => action === "install"), false);
  assert.equal((await service.check()).status, "available");
  assert.equal(calls.some(([action]) => action === "download"), false);
  assert.equal((await service.download()).status, "downloaded");
  assert.ok(states.some((state) => state.progress === 40));
  assert.equal(calls.some(([action]) => action === "install"), false);
  await service.check();
  assert.equal(calls.filter(([action]) => action === "check").length, 1);
  await service.install();
  assert.deepEqual(calls.at(-1), ["install", false, true]);
});

test("cancelled confirmation and active tasks do not install or lose downloaded state", async (t) => {
  let blocked = false;
  const { service, calls } = await fixture(t, { beforeInstall: async () => {
    if (blocked) throw new Error("请先停止采集");
    return false;
  } });
  await service.check();
  await service.download();
  await service.install();
  blocked = true;
  const state = await service.install();
  assert.equal(state.status, "downloaded");
  assert.match(state.error, /停止采集/);
  assert.equal(calls.some(([action]) => action === "install"), false);
});

test("check failure is recoverable and does not expose internal paths", async (t) => {
  const { service, updater } = await fixture(t);
  updater.checkForUpdates = async () => { throw new Error("C:/private/path token=secret"); };
  assert.equal((await service.check()).status, "error");
  assert.ok(!service.getState().error.includes("secret"));
  updater.checkForUpdates = async () => updater.emit("update-not-available");
  assert.equal((await service.check()).status, "current");
});

test("checksum failure must never enable installation", async (t) => {
  const { service, updater, calls } = await fixture(t);
  updater.downloadUpdate = async () => { const error = new Error("invalid hash"); error.code = "ERR_SHA512_CHECKSUM_MISMATCH"; throw error; };
  await service.check();
  const state = await service.download();
  assert.equal(state.status, "error");
  assert.match(state.error, /校验未通过/);
  await service.install();
  assert.equal(calls.some(([action]) => action === "install"), false);
});

test("duplicate checks cannot start concurrent downloads or requests", async (t) => {
  const { service, updater, calls } = await fixture(t);
  let finish;
  updater.checkForUpdates = () => new Promise((resolve) => { finish = resolve; calls.push(["check"]); });
  const first = service.check();
  await Promise.resolve();
  await service.check();
  await service.download();
  assert.equal(calls.filter(([action]) => action === "check").length, 1);
  assert.equal(calls.some(([action]) => action === "download"), false);
  updater.emit("update-not-available");
  finish();
  await first;
});

test("automatic checks can be disabled and the preference persists", async (t) => {
  const { service } = await fixture(t);
  assert.ok(service.timer);
  await service.setPreferences({ autoCheck: false });
  assert.equal(service.getState().autoCheck, false);
  const saved = JSON.parse(await fs.readFile(service.settingsPath, "utf8"));
  assert.deepEqual(saved, { autoCheck: false });
  service.state.autoCheck = true;
  await service.initialize();
  assert.equal(service.getState().autoCheck, false);
  await assert.rejects(service.setPreferences({ autoCheck: "yes" }), /无效/);
});

test("development builds do not start network or installer operations", async (t) => {
  const { service, calls } = await fixture(t, { isPackaged: false });
  assert.equal(service.getState().mode, "development");
  await service.check();
  await service.download();
  await service.install();
  assert.deepEqual(calls, []);
});

test("unsigned macOS checks releases but opens only the fixed official download page", async (t) => {
  const urls = [];
  const { service, calls } = await fixture(t, {
    platform: "darwin",
    fetchImpl: async (url) => { urls.push(url); return { ok: true, json: async () => ({ tag_name: "v2.1.0", html_url: "https://untrusted.test" }) }; },
  });
  assert.equal((await service.check()).status, "available");
  await service.download();
  await service.install();
  await service.openDownloadPage();
  assert.deepEqual(calls, [["open", RELEASE_PAGE]]);
  assert.deepEqual(urls, ["https://api.github.com/repos/xujack97121/-/releases/latest"]);
});
