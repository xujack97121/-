const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

const filename = path.resolve(__dirname, "../../backend/main.cjs");
const localRequire = createRequire(filename);
const handlers = new Map();
const calls = [];
let rendererUrl = "file:///creator-fixture/index.html";
const renderer = { getURL: () => rendererUrl };
const creators = Object.fromEntries(["search", "stop", "getState", "openConversation"].map((method) => [
  method, (...args) => {
    calls.push({ method, args });
    return { accountId: args[0], method };
  },
]));
const sandbox = {
  require: (name) => name === "electron" ? {
    app: { setName() {}, requestSingleInstanceLock: () => false, quit() {}, on() {}, isPackaged: false },
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler), on() {} },
  } : localRequire(name),
  __dirname: path.dirname(filename), process, Buffer, URL, Set, Map, console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  fixtureRenderer: renderer, fixtureCreators: creators,
};
vm.createContext(sandbox);
vm.runInContext(`${fs.readFileSync(filename, "utf8")}
  mainWindow = { isDestroyed: () => false, webContents: fixtureRenderer };
  mainRendererUrl = "file:///creator-fixture/index.html";
  creators = fixtureCreators;
  accountContexts.set("account-a", { id: "account-a", platform: "xhs", disposed: false });
  accountContexts.set("account-b", { id: "account-b", platform: "xhs", disposed: false });
  accountContexts.set("douyin", { id: "douyin", platform: "douyin", disposed: false });
  accountContexts.set("disposed", { id: "disposed", platform: "xhs", disposed: true });
`, sandbox, { filename });

const event = { sender: renderer };
const query = { keyword: "美妆", minFollowers: 1000, maxFollowers: 50000 };
const creator = { userId: "65a200000000000000000003", profileUrl: "https://www.xiaohongshu.com/user/profile/65a200000000000000000003" };
for (const [channel, method, payload, expectedArgs] of [
  ["search", "search", { accountId: "ACCOUNT-A", query }, ["account-a", query]],
  ["stop", "stop", { accountId: "account-b" }, ["account-b"]],
  ["state", "getState", { accountId: "account-b" }, ["account-b"]],
  ["open-conversation", "openConversation", { accountId: "account-a", creator }, ["account-a", creator]],
]) {
  const handle = handlers.get(`creators:${channel}`);
  assert.equal(typeof handle, "function");
  calls.length = 0;
  const result = handle(event, payload);
  assert.equal(result.accountId, expectedArgs[0]);
  assert.deepEqual(calls, [{ method, args: expectedArgs }]);
  assert.throws(() => handle({ sender: { getURL: () => rendererUrl } }, payload), /无效请求/);
  assert.throws(() => handle(event, { ...payload, accountId: "douyin" }), /仅支持小红书/);
  assert.throws(() => handle(event, { ...payload, accountId: "missing" }), /不存在/);
  assert.throws(() => handle(event, { ...payload, accountId: "disposed" }), /不存在/);
  rendererUrl = "https://www.xiaohongshu.com/";
  assert.throws(() => handle(event, payload), /无效请求来源/);
  rendererUrl = "file:///creator-fixture/index.html";
}
console.log("Creator IPC: explicit account routing, platform/lifecycle guards and main-renderer origin authorization passed");
