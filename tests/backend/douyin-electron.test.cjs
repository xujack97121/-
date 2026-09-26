const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const electron = require("electron");
const { app, BrowserWindow, session } = electron;
const VIDEO = "7520000000000000001";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "douyin-electron-fixture-"));
app.setPath("userData", root);
app.disableHardwareAcceleration();
let window;
let context;
let api;
const messages = [];

async function waitFor(predicate, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for the isolated Electron fixture");
}

async function main() {
  await app.whenReady();
  // An ephemeral partition handles every HTTPS request locally; no real account or platform is contacted.
  const partition = `douyin-fixture-${Date.now()}`;
  const fixtureSession = session.fromPartition(partition);
  fixtureSession.protocol.handle("https", (request) => {
    const url = new URL(request.url);
    if (url.hostname !== "www.douyin.com") return new Response("", { status: 403 });
    if (url.pathname === "/aweme/v1/web/comment/list/") return new Response(JSON.stringify({
      status_code: 0,
      comments: [
        { cid: "7530000000000000001", aweme_id: VIDEO, text: "公开测试评论", user: { nickname: "测试用户", uid: "1234567890123456789" }, digg_count: 20, reply_comment_total: 3 },
        { cid: "7530000000000000002", aweme_id: "7520000000000000002", text: "其他视频不应进入", user: { nickname: "其他用户" } },
      ],
    }), { headers: { "Content-Type": "application/json" } });
    if (url.pathname === "/aweme/v1/web/aweme/detail/") return new Response(JSON.stringify({
      aweme_detail: { aweme_id: VIDEO, desc: "Electron 公开视频样例", author: { nickname: "公开作者" } },
    }), { headers: { "Content-Type": "application/json" } });
    const video = url.pathname === `/video/${VIDEO}`;
    return new Response(`<!doctype html><html><body><h1>Fixture</h1>
      <div data-e2e="comment-list" style="height:160px;overflow:auto"><div style="height:900px">公开评论区</div></div>
      ${video ? `<script>
        fetch('/aweme/v1/web/aweme/detail/?aweme_id=${VIDEO}');
        fetch('/aweme/v1/web/comment/list/?aweme_id=${VIDEO}');
      </script>` : ""}
      </body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  });
  window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  const filename = path.resolve(__dirname, "../../backend/main.cjs");
  const localRequire = createRequire(filename);
  const testElectron = {
    ...electron,
    app: { setName() {}, requestSingleInstanceLock: () => false, quit() {}, on() {}, isPackaged: false },
    ipcMain: { handle() {}, on() {} },
  };
  const sandbox = {
    require: (name) => name === "electron" ? testElectron : localRequire(name),
    __dirname: path.dirname(filename), process, Buffer, URL, Set, Map, console,
    setTimeout, clearTimeout, setInterval, clearInterval, testWindow: window, testMessages: messages,
  };
  vm.createContext(sandbox);
  vm.runInContext(`${fs.readFileSync(filename, "utf8")}
    mainWindow = testWindow;
    sendToRenderer = (channel, payload) => testMessages.push({ channel, payload });
    accountRegistry = { get: id => ({ id, name: 'fixture', platform: 'douyin' }), list: () => [] };
    globalThis.testApi = { createAccountContext, startTask, scrollOneStep, disposeAccountContext };
  `, sandbox, { filename });
  api = sandbox.testApi;
  context = api.createAccountContext({ id: "fixture-account", partition, platform: "douyin" });
  context.view.setBounds({ x: 0, y: 0, width: 800, height: 600 });
  context.view.setVisible(true);
  await waitFor(() => !context.view.webContents.isLoading() && context.view.webContents.getURL() === "https://www.douyin.com/");
  await api.startTask(context, { kind: "comments", url: `https://www.douyin.com/video/${VIDEO}`, target: 10 });
  await waitFor(() => messages.some((item) => item.channel === "collector:capture" && item.payload.comments.length));
  const captures = messages.filter((item) => item.channel === "collector:capture").map((item) => item.payload);
  const comments = captures.flatMap((item) => item.comments);
  assert.equal(comments.length, 1);
  assert.equal(comments[0].noteId, VIDEO);
  assert.equal(comments[0].accountId, "fixture-account");
  assert.equal(comments[0].likes, 20);
  assert.equal(comments[0].replyCount, 3);
  assert.equal(comments[0].platform, "douyin");
  assert.equal(captures.flatMap((item) => item.notes)[0].title, "Electron 公开视频样例");
  assert.equal(captures.some((item) => item.url.includes("/aweme/")), false, "Do not persist API query tokens in the renderer");
  await context.view.webContents.executeJavaScript("document.body.insertAdjacentHTML('beforeend', '<div id=\"captcha\"><p>请完成安全验证</p></div>')");
  await waitFor(() => !context.capture.scrollBusy);
  await api.scrollOneStep(context, context.capture.runId);
  assert.equal(context.capture.active, false);
  assert.ok(messages.some((item) => /安全验证/.test(item.payload.message || "")));
  console.log("Electron Douyin fixture: CDP capture, video metadata, ownership, filtering and verification pause passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (context && api) await api.disposeAccountContext(context);
  if (window && !window.isDestroyed()) window.destroy();
  // Electron may hold cache files until exit; keep this disposable, isolated profile in the system temp directory.
  app.exit(process.exitCode || 0);
});
