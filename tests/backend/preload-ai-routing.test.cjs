const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const invocations = [];
const listeners = new Map();
const removedListeners = [];
let exposedApi;

const ipcRenderer = {
  invoke: async (channel, payload) => {
    invocations.push({ channel, payload });
    return { channel, payload };
  },
  send: () => {},
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

async function expectInvoke(run, channel, payload) {
  invocations.length = 0;
  await run();
  assert.equal(invocations.length, 1);
  assert.equal(invocations[0].channel, channel);
  if (payload === undefined) assert.equal(invocations[0].payload, undefined);
  else assert.deepEqual(JSON.parse(JSON.stringify(invocations[0].payload)), payload);
}

async function main() {
  assert.ok(exposedApi);
  assert.equal(Object.isFrozen(exposedApi.ai), true);
  await expectInvoke(() => exposedApi.ai.getSettings(), "ai:get-settings", undefined);
  await expectInvoke(
    () => exposedApi.ai.saveSettings({ baseUrl: "https://api.example.com/v1", model: "model-a", apiKey: "secret" }),
    "ai:save-settings",
    { baseUrl: "https://api.example.com/v1", model: "model-a", apiKey: "secret" },
  );
  await expectInvoke(() => exposedApi.ai.listModels(), "ai:list-models", undefined);
  await expectInvoke(() => exposedApi.ai.testConnection(), "ai:test-connection", undefined);
  const request = {
    requestId: "request-a",
    scopeLabel: "全部账号",
    fingerprint: "fingerprint-a",
    records: [{ sourceId: "note:a", kind: "note", title: "标题" }],
  };
  await expectInvoke(() => exposedApi.ai.analyze(request), "ai:analyze", request);
  await expectInvoke(() => exposedApi.ai.cancel("request-a"), "ai:cancel", { requestId: "request-a" });

  let progress;
  const unsubscribe = exposedApi.ai.onProgress((payload) => { progress = payload; });
  const listener = listeners.get("ai:progress");
  assert.equal(typeof listener, "function");
  listener({}, { requestId: "request-a", phase: "analyzing", completedBatches: 1, totalBatches: 2 });
  assert.deepEqual(progress, { requestId: "request-a", phase: "analyzing", completedBatches: 1, totalBatches: 2 });
  unsubscribe();
  assert.equal(removedListeners.at(-1).channel, "ai:progress");
  assert.equal(removedListeners.at(-1).listener, listener);
  assert.throws(() => exposedApi.ai.onProgress(null), /订阅回调必须是函数/);

  console.log("preload AI IPC routing: passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
