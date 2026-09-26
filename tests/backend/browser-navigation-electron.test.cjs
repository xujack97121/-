const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const electron = require("electron");
const { app, BrowserWindow, session } = electron;
const VIDEO = "7520000000000000001";
const NOTE = "65a200000000000000000001";
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

function fixtureResponse(request, origin, platform, label) {
  const url = new URL(request.url);
  if (url.origin === "https://embedded.example")
    return new Response("<script>parent.postMessage('fixture-embedded-ready', '*')</script>", { headers: { "Content-Type": "text/html" } });
  if (url.origin !== origin) return new Response("", { status: 403 });
  if (url.pathname === "/embedded-redirect")
    return new Response("", { status: 302, headers: { Location: "https://embedded.example/ready?token=fixture-private" } });
  if (url.pathname === "/external-main-redirect")
    return new Response("", { status: 302, headers: { Location: "https://outside.example/login?token=fixture-private" } });
  if (platform === "xhs" && url.pathname === "/search_result") {
    const target = new URL(request.url);
    target.protocol = "http:";
    target.pathname = "/search_result/";
    return new Response("", { status: 301, headers: { Location: target.href } });
  }
  if (platform === "xhs" && url.pathname === "/search_result/" && url.searchParams.get("keyword") === "home")
    return new Response("", { status: 302, headers: { Location: `${origin}/` } });
  if (platform === "xhs" && url.pathname === "/search_result/" && url.searchParams.get("keyword") === "loop") {
    const target = new URL(request.url);
    target.protocol = "http:";
    return new Response("", { status: 301, headers: { Location: target.href } });
  }
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/aweme/")) {
    if (url.searchParams.get("restricted") === "1") return new Response(JSON.stringify({ success: false }), { status: 403, headers: { "Content-Type": "application/json" } });
    const body = platform === "xhs" ? {
      data: url.pathname.includes("/comment/") ? { comments: [{
        comment_id: "fixture-comment", note_id: NOTE, content: "Public comment fixture", user: { nickname: label },
        like_count: 12, sub_comment_count: 2,
      }] } : { items: [{ id: NOTE, note_card: {
        display_title: "Public navigation fixture", user: { nickname: label }, interact_info: { liked_count: 20 },
      } }] },
    } : {
      status_code: 0, comments: [{ cid: "7530000000000000001", aweme_id: VIDEO, text: "Public fixture comment", user: { nickname: "Fixture user" } }],
    };
    return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
  }
  if (url.pathname !== "/" && !url.searchParams.has("loaded")) {
    const target = new URL(request.url);
    target.searchParams.set("loaded", "1");
    if (platform === "xhs" && (url.searchParams.get("keyword") === "upgrade" || url.pathname.startsWith("/user/") || url.pathname.startsWith("/explore/")))
      target.protocol = "http:";
    return new Response("", { status: 302, headers: { Location: target.href } });
  }
  const endpoint = platform === "xhs" ? url.pathname.startsWith("/user/")
    ? `/api/sns/web/v1/user_posted?user_id=${NOTE}`
    : url.pathname.startsWith("/explore/") ? `/api/sns/web/v2/comment/page?note_id=${NOTE}`
      : `/api/sns/web/v1/search/notes?restricted=${url.searchParams.get("keyword") === "restricted" ? "1" : "0"}`
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
  const visitedPartitions = [];
  for (const [platform, label] of [["xhs", "Fresh account A"], ["xhs", "Fresh account B"], ["douyin", "Fresh Douyin account"]]) {
    // No real account, cookies or platform requests: all HTTPS traffic stays in this disposable partition.
    const partition = `navigation-fixture-${platform}-${Date.now()}-${visitedPartitions.length}`;
    const accountId = `navigation-${platform}-${visitedPartitions.length}`;
    const origin = platform === "xhs" ? "https://www.xiaohongshu.com" : "https://www.douyin.com";
    const accountSession = session.fromPartition(partition);
    const requests = [];
    const insecureRequests = [];
    accountSession.protocol.handle("https", (request) => {
      requests.push(request.url);
      return fixtureResponse(request, origin, platform, label);
    });
    accountSession.protocol.handle("http", (request) => {
      insecureRequests.push(request.url);
      return new Response("Plaintext requests must not reach the fixture", { status: 500 });
    });
    visitedPartitions.push(accountSession);
    if (platform === "xhs") {
      await accountSession.cookies.set({ url: origin, name: "web_session", value: `synthetic-session-${visitedPartitions.length}` });
      assert.equal((await accountSession.cookies.get({ url: origin, name: "web_session" })).length, 1);
      if (visitedPartitions.length > 1) assert.notEqual(accountSession, visitedPartitions[0]);
    }
    context = api.createAccountContext({ id: accountId, partition, platform });
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
    assert.equal(payload.accountId, accountId);
    if (platform === "xhs") {
      assert.equal(payload.notes[0].author, label);
      assert.equal(requests.some((value) => new URL(value).pathname === "/search_result"), false, "Even an old bare search link is canonicalized before loading");
      for (const [kind, target] of [
        ["notes", `${origin}/search_result/?keyword=upgrade&xsec_token=fixture-private`],
        ["author", `${origin}/user/profile/${NOTE}?xsec_token=fixture-private`],
        ["comments", `${origin}/explore/${NOTE}?xsec_token=fixture-private`],
      ]) {
        const before = messages.length;
        const result = await api.startTask(context, { kind, url: target, target: 100 });
        const targetRun = result.runId;
        await waitFor(() => messages.slice(before).some((item) => item.channel === "collector:capture" && item.payload.runId === targetRun));
        assert.equal(context.capture.active, true, `${label}: ${kind} must survive a same-platform HTTP redirect`);
        assert.equal(context.capture.runId, targetRun);
        assert.equal(new URL(contents.getURL()).protocol, "https:");
        assert.equal(new URL(contents.getURL()).searchParams.get("xsec_token"), "fixture-private");
        const captured = messages.slice(before).find((item) => item.channel === "collector:capture" && item.payload.runId === targetRun).payload;
        assert.equal(captured.accountId, accountId);
        if (kind === "comments") {
          assert.equal(captured.comments[0].noteId, NOTE);
          assert.equal(captured.comments[0].nickname, label);
          assert.equal(captured.comments[0].likes, 12);
        } else assert.equal(captured.notes[0].author, label);
      }
      assert.ok(redirects.some((item) => item.url.startsWith("http://www.xiaohongshu.com/") && item.mainFrame && !item.prevented));
      assert.equal(insecureRequests.length, 0, "HTTP redirects are upgraded before any plaintext request");
      for (const keyword of ["home", "loop"]) {
        const before = messages.length;
        await assert.rejects(api.startTask(context, {
          kind: "notes", url: `${origin}/search_result/?keyword=${keyword}&xsec_token=fixture-private`, target: 100,
        }), keyword === "home" ? /未进入指定/ : /反复重定向/);
        assert.equal(context.capture.active, false);
        assert.equal(context.capture.pendingStartRunId, "");
        assert.equal(messages.slice(before).some((item) => item.channel === "collector:capture"), false);
        assert.equal(messages.slice(before).some((item) => String(item.payload.message || "").includes("fixture-private")), false);
      }
      const before = messages.length;
      await api.startTask(context, { kind: "notes", url: `${origin}/search_result/?keyword=restricted`, target: 100 }).catch(() => {});
      await waitFor(() => !context.capture.active);
      assert.ok(messages.slice(before).some((item) => item.channel === "collector:status" && item.payload.phase === "error" && /限制/.test(item.payload.message)));
      assert.equal(messages.slice(before).some((item) => item.channel === "collector:capture"), false);
      await api.startTask(context, { kind: "notes", url: `${origin}/search_result/?keyword=fixture`, target: 100 });
    }
    await contents.executeJavaScript("location.href='/external-main-redirect'; void 0");
    await waitFor(() => context.capture.active === false);
    assert.ok(redirects.some((item) => item.mainFrame === true && item.url.startsWith("https://outside.example/") && item.prevented === true));
    const stopped = messages.find((item) => item.channel === "collector:status" && item.payload.accountId === context.id && item.payload.phase === "error" && /outside\.example/.test(item.payload.message));
    assert.match(stopped.payload.message, /outside\.example/);
    assert.equal(stopped.payload.message.includes("fixture-private"), false);
    assert.ok(contents.getURL().startsWith(origin), "An external main-frame redirect must not enter the account page");
    await api.disposeAccountContext(context);
    context = undefined;
    console.log(`Electron ${label}: canonical search, HTTPS upgrade, scoped capture, iframe redirects, restrictions and external guard passed`);
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
