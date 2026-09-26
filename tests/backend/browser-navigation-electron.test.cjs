const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const electron = require("electron");
const { app, BrowserWindow, session } = electron;
const VIDEO = "7520000000000000001";
app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "navigation-electron-fixture-")));
app.disableHardwareAcceleration();
let window;
let context;
let api;
const messages = [];

async function waitFor(predicate, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for the isolated navigation fixture");
}

function fixtureResponse(request, origin, platform) {
  const url = new URL(request.url);
  if (url.origin === "https://embedded.example")
    return new Response("<script>parent.postMessage('fixture-embedded-ready', '*')</script>", { headers: { "Content-Type": "text/html" } });
  if (url.origin !== origin) return new Response("", { status: 403 });
  if (url.pathname === "/embedded-redirect")
    return new Response("", { status: 302, headers: { Location: "https://embedded.example/ready?token=fixture-private" } });
  if (url.pathname === "/external-main-redirect")
    return new Response("", { status: 302, headers: { Location: "https://outside.example/login?token=fixture-private" } });
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/aweme/")) {
    const body = platform === "xhs" ? {
      data: { items: [{ id: "65a200000000000000000001", note_card: {
        display_title: "Public navigation fixture", user: { nickname: "Fixture author" }, interact_info: { liked_count: 20 },
      } }] },
    } : {
      status_code: 0, comments: [{ cid: "7530000000000000001", aweme_id: VIDEO, text: "Public fixture comment", user: { nickname: "Fixture user" } }],
    };
    return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
  }
  if (url.pathname !== "/" && !url.searchParams.has("loaded"))
    return new Response("", { status: 302, headers: { Location: `${origin}${url.pathname}?loaded=1` } });
  const endpoint = platform === "xhs" ? "/api/sns/web/v1/search/notes"
    : `/aweme/v1/web/comment/list/?aweme_id=${VIDEO}`;
  return new Response(`<!doctype html><html><body><h1>Public page fixture</h1>
    ${url.pathname === "/" ? "" : `<script>
      addEventListener('message', event => {
        if (event.origin === 'https://embedded.example' && event.data === 'fixture-embedded-ready') {
          document.body.dataset.embeddedReady = '1';
          fetch('${endpoint}');
        }
      });
    </script><iframe src="/embedded-redirect"></iframe>`}
    </body></html>`, { headers: { "Content-Type": "text/html" } });
}

async function main() {
  await app.whenReady();
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
    accountRegistry = { get: id => ({ id, name: 'fixture' }), list: () => [] };
    globalThis.testApi = { createAccountContext, startTask, disposeAccountContext };
  `, sandbox, { filename });
  api = sandbox.testApi;
  for (const platform of ["xhs", "douyin"]) {
    // No real account, cookies or platform requests: all HTTPS traffic stays in this disposable partition.
    const partition = `navigation-fixture-${platform}-${Date.now()}`;
    const origin = platform === "xhs" ? "https://www.xiaohongshu.com" : "https://www.douyin.com";
    session.fromPartition(partition).protocol.handle("https", (request) => fixtureResponse(request, origin, platform));
    context = api.createAccountContext({ id: `navigation-${platform}`, partition, platform });
    const contents = context.view.webContents;
    context.view.setBounds({ x: 0, y: 0, width: 800, height: 600 });
    context.view.setVisible(true);
    await waitFor(() => !contents.isLoading() && contents.getURL() === `${origin}/`);
    const redirects = [];
    contents.on("will-redirect", (event, url, _inPlace, mainFrame) => {
      redirects.push({ url: event.url ?? url, mainFrame: event.isMainFrame ?? mainFrame, prevented: event.defaultPrevented });
    });
    const url = platform === "xhs" ? `${origin}/search_result?keyword=fixture` : `${origin}/video/${VIDEO}`;
    await api.startTask(context, { kind: platform === "xhs" ? "notes" : "comments", url, target: 100 });
    const runId = context.capture.runId;
    await waitFor(() => redirects.some((item) => item.url.startsWith("https://embedded.example/")));
    assert.equal(context.capture.active, true, `${platform}: an iframe redirect must not cancel capture`);
    assert.equal(context.capture.runId, runId);
    assert.ok(redirects.some((item) => item.mainFrame === false && item.prevented === false));
    assert.ok(redirects.some((item) => item.mainFrame === true && item.url.startsWith(origin) && item.prevented === false));
    await waitFor(() => messages.some((item) => item.channel === "collector:capture" && item.payload.accountId === context.id));
    const payload = messages.find((item) => item.channel === "collector:capture" && item.payload.accountId === context.id).payload;
    assert.equal((platform === "xhs" ? payload.notes : payload.comments).length, 1);
    await contents.executeJavaScript("location.href='/external-main-redirect'; void 0");
    await waitFor(() => context.capture.active === false);
    assert.ok(redirects.some((item) => item.mainFrame === true && item.url.startsWith("https://outside.example/") && item.prevented === true));
    const stopped = messages.find((item) => item.channel === "collector:status" && item.payload.accountId === context.id && item.payload.phase === "stopped");
    assert.match(stopped.payload.message, /outside\.example/);
    assert.equal(stopped.payload.message.includes("fixture-private"), false);
    assert.ok(contents.getURL().startsWith(origin), "An external main-frame redirect must not enter the account page");
    await api.disposeAccountContext(context);
    context = undefined;
    console.log(`Electron ${platform}: same-platform redirects, embedded redirect + capture, external main-frame guard passed`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (context && api) await api.disposeAccountContext(context);
  if (window && !window.isDestroyed()) window.destroy();
  app.exit(process.exitCode || 0);
});
