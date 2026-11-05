const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const invocations = [];
const sends = [];
const listeners = new Map();
const removedListeners = [];
let exposedApi;

const ipcRenderer = {
  invoke: async (channel, payload) => {
    invocations.push({ channel, payload });
    return { channel, payload };
  },
  send: (channel, payload) => sends.push({ channel, payload }),
  on: (channel, listener) => listeners.set(channel, listener),
  removeListener: (channel, listener) => removedListeners.push({ channel, listener }),
};

const source = fs.readFileSync(path.join(__dirname, "..", "..", "backend", "preload.cjs"), "utf8");
vm.runInNewContext(source, {
  require: (moduleName) => {
    assert.equal(moduleName, "electron");
    return {
      contextBridge: { exposeInMainWorld: (name, api) => {
        assert.equal(name, "collectorDesktop");
        exposedApi = api;
      } },
      ipcRenderer,
    };
  },
}, { filename: "backend/preload.cjs" });

assert.ok(exposedApi);
assert.equal(exposedApi.isDesktop, true);
assert.equal(Object.isFrozen(exposedApi.accounts), true);

async function expectInvoke(run, channel, payload) {
  invocations.length = 0;
  await run();
  assert.equal(invocations.length, 1);
  assert.equal(invocations[0].channel, channel);
  if (payload === undefined) assert.equal(invocations[0].payload, undefined);
  else assert.deepEqual(JSON.parse(JSON.stringify(invocations[0].payload)), payload);
}

async function main() {
  await expectInvoke(() => exposedApi.accounts.list(), "accounts:list", undefined);
  await expectInvoke(() => exposedApi.addAccount("品牌主账号"), "accounts:add", { name: "品牌主账号" });
  await expectInvoke(() => exposedApi.createAccount({ name: "内容账号" }), "accounts:add", { name: "内容账号" });
  await expectInvoke(() => exposedApi.createAccount({ name: "抖音账号", platform: "douyin" }), "accounts:add", { name: "抖音账号", platform: "douyin" });
  await expectInvoke(() => exposedApi.switchAccount("account-a"), "accounts:switch", { accountId: "account-a" });
  await expectInvoke(() => exposedApi.renameAccount("account-a", "新名称"), "accounts:rename", { accountId: "account-a", name: "新名称" });
  await expectInvoke(() => exposedApi.removeAccount("account-a", { clearData: false }), "accounts:remove", { accountId: "account-a", clearData: false });
  await expectInvoke(() => exposedApi.removeAccount({ accountId: "account-b", clearData: true }), "accounts:remove", { accountId: "account-b", clearData: true });
  await expectInvoke(() => exposedApi.getAccountStatus("account-a"), "accounts:status", { accountId: "account-a" });
  await expectInvoke(() => exposedApi.checkAccountLogin("account-b"), "accounts:refresh-status", { accountId: "account-b" });

  const note = { id: "note-a", link: "https://www.xiaohongshu.com/explore/note-a" };
  const task = { kind: "notes", target: 20 };
  await expectInvoke(() => exposedApi.navigate("account-a", "https://www.xiaohongshu.com/"), "browser:navigate", { accountId: "account-a", url: "https://www.xiaohongshu.com/" });
  await expectInvoke(() => exposedApi.openNote("account-a", note), "browser:open-note", { accountId: "account-a", note });
  await expectInvoke(() => exposedApi.operateNote("account-a", task), "browser:operate-note", { accountId: "account-a", task });
  await expectInvoke(() => exposedApi.startTask("account-b", task), "browser:start-task", { accountId: "account-b", task });
  await expectInvoke(() => exposedApi.stopTask("account-b"), "browser:stop-task", { accountId: "account-b" });
  await expectInvoke(() => exposedApi.reload("account-a"), "browser:reload", { accountId: "account-a" });
  await expectInvoke(() => exposedApi.home("account-a"), "browser:home", { accountId: "account-a" });
  await expectInvoke(() => exposedApi.setMuted("account-b", false), "browser:set-muted", { accountId: "account-b", muted: false });
  assert.equal(Object.isFrozen(exposedApi.directMessages), true);
  await expectInvoke(() => exposedApi.directMessages.collect("account-a", [note]), "direct-messages:collect", { accountId: "account-a", notes: [note] });
  await expectInvoke(() => exposedApi.directMessages.review("account-a", { messages: ["fixture"] }), "direct-messages:review", { accountId: "account-a", config: { messages: ["fixture"] } });
  await expectInvoke(() => exposedApi.directMessages.start("account-a", "review-1"), "direct-messages:start", { accountId: "account-a", reviewId: "review-1" });
  await expectInvoke(() => exposedApi.directMessages.stop("account-b"), "direct-messages:stop", { accountId: "account-b" });
  await expectInvoke(() => exposedApi.directMessages.getState("account-b"), "direct-messages:state", { accountId: "account-b" });
  let messageProgress;
  const unsubscribeMessages = exposedApi.directMessages.onProgress((state) => { messageProgress = state; });
  listeners.get("direct-messages:progress")({}, { accountId: "account-b", phase: "paused" });
  assert.equal(messageProgress.accountId, "account-b");
  unsubscribeMessages();
  assert.equal(removedListeners.at(-1).channel, "direct-messages:progress");
  assert.equal(Object.isFrozen(exposedApi.creators), true);
  const creator = { userId: "65a200000000000000000001", nickname: "公开达人" };
  const query = { keyword: "美妆", minFollowers: 1000, maxFollowers: 50000, limit: 30 };
  await expectInvoke(() => exposedApi.creators.search("account-a", query), "creators:search", { accountId: "account-a", query });
  await expectInvoke(() => exposedApi.creators.stop("account-b"), "creators:stop", { accountId: "account-b" });
  await expectInvoke(() => exposedApi.creators.getState("account-b"), "creators:state", { accountId: "account-b" });
  await expectInvoke(() => exposedApi.creators.openProfile("account-a", creator), "creators:open-profile", { accountId: "account-a", creator });
  await expectInvoke(() => exposedApi.creators.openConversation("account-a", creator), "creators:open-conversation", { accountId: "account-a", creator });
  await expectInvoke(() => exposedApi.creators.openTaskPage("account-b"), "creators:open-task-page", { accountId: "account-b" });
  let creatorProgress;
  const unsubscribeCreators = exposedApi.creators.onProgress((state) => { creatorProgress = state; });
  listeners.get("creators:progress")({}, { accountId: "account-b", phase: "searching" });
  assert.equal(creatorProgress.accountId, "account-b");
  unsubscribeCreators();
  assert.equal(removedListeners.at(-1).channel, "creators:progress");

  sends.length = 0;
  exposedApi.setBrowserBounds({ x: 1, y: 2, width: 300, height: 400 });
  assert.deepEqual(sends, [{ channel: "browser:set-bounds", payload: { x: 1, y: 2, width: 300, height: 400 } }]);

  sends.length = 0;
  exposedApi.setDataDashboardOpen(true);
  exposedApi.setDataDashboardOpen(false);
  assert.deepEqual(sends, [
    { channel: "window:set-data-dashboard-open", payload: true },
    { channel: "window:set-data-dashboard-open", payload: false },
  ]);

  let received;
  const unsubscribe = exposedApi.onCapture((payload) => { received = payload; });
  const captureListener = listeners.get("collector:capture");
  assert.equal(typeof captureListener, "function");
  captureListener({}, { accountId: "account-b", notes: [{ id: "note-b" }] });
  assert.deepEqual(received, { accountId: "account-b", notes: [{ id: "note-b" }] });
  unsubscribe();
  assert.equal(removedListeners.at(-1).channel, "collector:capture");
  assert.equal(removedListeners.at(-1).listener, captureListener);
  assert.throws(() => exposedApi.onStatus(null), /订阅回调必须是函数/);

  console.log("preload account-aware IPC routing: passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
