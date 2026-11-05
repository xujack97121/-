const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { createDirectMessageHost } = require("../../backend/operations/direct-message-host.cjs");

test("background creator search permits foreground navigation but preserves automation and opening locks", async () => {
  const filename = path.resolve(__dirname, "../../backend/main.cjs");
  const localRequire = createRequire(filename);
  const handlers = new Map();
  const loads = [];
  const messages = [];
  const stopped = [];
  let reloads = 0;
  const renderer = {
    getURL: () => "file:///creator-routing-fixture/index.html",
    send: (channel, payload) => { messages.push({ channel, payload }); },
  };
  let resolveNote;
  const contents = {
    isDestroyed: () => false,
    getURL: () => "https://www.xiaohongshu.com/",
    executeJavaScript: async () => resolveNote ? new Promise((resolve) => { resolveNote = resolve; }) : "",
    loadURL: async (url) => { loads.push(url); },
    reload: () => { reloads += 1; },
    setBackgroundThrottling() {},
  };
  const sandbox = {
    require: (name) => name === "electron" ? {
      app: { setName() {}, requestSingleInstanceLock: () => false, quit() {}, on() {}, isPackaged: false },
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler), on() {} },
    } : localRequire(name),
    __dirname: path.dirname(filename), process, Buffer, URL, Set, Map, console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    fixtureRenderer: renderer, fixtureContents: contents, fixtureStopped: stopped,
  };
  vm.createContext(sandbox);
  vm.runInContext(`${fs.readFileSync(filename, "utf8")}
    mainWindow = { isDestroyed: () => false, webContents: fixtureRenderer };
    mainRendererUrl = "file:///creator-routing-fixture/index.html";
    accountRegistry = { get: id => ({ id, name: "Fixture account" }) };
    creators = { stop: id => fixtureStopped.push(id) };
    const context = {
      id: "fixture-account", platform: "xhs", disposed: false,
      view: { webContents: fixtureContents }, capture: makeCaptureState(),
      operation: { active: true, kind: "creator-search", runId: "background-run" },
      foregroundOperation: { active: false }, pendingResponses: new Map(), requestRuns: new Map(),
      navigation: { url: "https://www.xiaohongshu.com/", loading: false, title: "Fixture" },
      identity: { state: "unknown", name: "", profileUrl: "" }
    };
    accountContexts.set(context.id, context);
    globalThis.fixture = { context, assertIdleForUpdate, sendStatus };
  `, sandbox, { filename });

  const context = sandbox.fixture.context;
  const event = { sender: renderer };
  const note = {
    id: "65b200000000000000000001",
    link: "https://www.xiaohongshu.com/explore/65b200000000000000000001?xsec_token=fixture-public",
  };
  const routes = [
    ["browser:navigate", { url: "https://www.xiaohongshu.com/user/profile/65a200000000000000000001" }],
    ["browser:open-note", { note }],
    ["browser:home", {}],
    ["browser:reload", {}],
  ];
  for (const [channel, payload] of routes) {
    const result = await handlers.get(channel)(event, { accountId: context.id, ...payload });
    assert.equal(result.ok, true, channel);
    assert.equal(context.operation.runId, "background-run");
  }
  assert.equal(loads.length, 3);
  assert.equal(reloads, 1);
  sandbox.fixture.sendStatus(context, "warning", "Fixture browser warning");
  const status = messages.findLast((entry) => entry.channel === "collector:status").payload;
  assert.equal(status.active, false, "Background discovery never marks foreground capture active");
  assert.equal(status.runId, "");
  await handlers.get("browser:stop-task")(event, { accountId: context.id });
  assert.deepEqual(stopped, [], "Foreground stop controls cannot stop the background discovery job");
  assert.equal(context.operation.runId, "background-run");

  resolveNote = true;
  const openingNote = handlers.get("browser:open-note")(event, { accountId: context.id, note });
  assert.equal(context.foregroundOperation.active, true);
  await assert.rejects(
    handlers.get("browser:home")(event, { accountId: context.id }),
    /正在打开达人主页或私信/,
  );
  resolveNote("");
  resolveNote = null;
  await openingNote;
  assert.equal(loads.length, 4, "A pending note lookup owns the foreground navigation lock");
  assert.equal(context.foregroundOperation.active, false);
  await assert.rejects(
    handlers.get("browser:navigate")(event, { accountId: context.id, url: "https://outside.example/" }),
    /不匹配|不安全/,
  );
  assert.throws(sandbox.fixture.assertIdleForUpdate, /先停止/);
  const host = createDirectMessageHost({ requireContext: () => context, publishAccount() {} });
  assert.throws(() => host.lock(context.id), /正在采集或执行自动化/);
  await assert.rejects(handlers.get("browser:start-task")(event, { accountId: context.id, task: {} }), /正在执行笔记操作/);
  await assert.rejects(handlers.get("browser:operate-note")(event, { accountId: context.id, task: {} }), /笔记操作/);

  for (const kind of ["direct-message", "other-automation"]) {
    context.operation = { active: true, kind };
    for (const [channel, payload] of routes) {
      await assert.rejects(async () => handlers.get(channel)(event, { accountId: context.id, ...payload }), /笔记操作/);
    }
  }
  context.operation = { active: false };
  context.foregroundOperation = { active: true, kind: "creator-conversation", runId: "foreground-run" };
  for (const [channel, payload] of routes) {
    await assert.rejects(async () => handlers.get(channel)(event, { accountId: context.id, ...payload }), /正在打开达人主页或私信/);
  }
  await assert.rejects(handlers.get("browser:start-task")(event, { accountId: context.id, task: {} }), /正在打开达人/);
  await assert.rejects(handlers.get("browser:operate-note")(event, { accountId: context.id, task: {} }), /正在打开达人/);
  assert.throws(() => host.lock(context.id), /正在采集或执行自动化/);
  assert.throws(sandbox.fixture.assertIdleForUpdate, /先停止/);
  assert.equal(loads.length, 4, "Rejected foreground and automation requests cannot navigate either page");
  assert.equal(reloads, 1);
});
