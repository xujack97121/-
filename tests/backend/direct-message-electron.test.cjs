const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const electron = require("electron");
const { app, BrowserWindow, session } = electron;
const dmPage = require("../../backend/operations/direct-message-page.cjs");
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "dm-electron-fixture-"));
app.setPath("userData", TEMP);
app.disableHardwareAcceleration();
const SELF = "65a200000000000000000001";
const AUTHOR = "65a200000000000000000002";
const USER = "65a200000000000000000003";
const REPLY = "65a200000000000000000004";
const NOTE = "65b200000000000000000001";
const ORIGIN = "https://www.xiaohongshu.com";
let window;
let api;
let context;
let scenario = "sent";
let actualSubmissions = 0;
let replyRequests = 0;
const requests = [];
const messages = [];

async function waitFor(predicate, timeout = 12000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out in isolated DM fixture");
}

function response(request) {
  const url = new URL(request.url);
  requests.push(url.href);
  if (url.origin !== ORIGIN) return new Response("", { status: 403 });
  if (url.pathname === "/fixture-submitted") { actualSubmissions += 1; return new Response("{}"); }
  if (url.pathname.includes("/comment/sub/")) { replyRequests += 1; return new Response("{}"); }
  if (url.pathname.includes("/comment/page")) return new Response(JSON.stringify({
    success: true, data: { comments: [
      { id: "root-comment", content: "主评论", user_info: { user_id: USER, nickname: "公开用户" }, sub_comments: [{ id: "reply", content: "楼中楼", user_info: { user_id: REPLY } }] },
      { id: "author-comment", content: "作者评论", user_info: { user_id: AUTHOR, nickname: "楼主" } },
      { id: "self-comment", content: "自己评论", user_info: { user_id: SELF, nickname: "自己" } },
    ] },
  }), { headers: { "Content-Type": "application/json" } });
  const sidebar = `<nav><a data-self-profile href="${ORIGIN}/user/profile/${SELF}">我</a></nav>`;
  let body = "<h1>Fixture home</h1>";
  if (url.pathname.startsWith("/explore/")) body = `<div id="noteContainer">
    <div class="author-container"><a href="/user/profile/${AUTHOR}">楼主</a></div>
    <div class="comments-container" style="height:150px;overflow:auto">
      <div class="comment-item" data-comment-id="root-comment"><a href="/user/profile/${USER}">公开用户</a><div class="content">主评论</div>
        <div class="reply-container"><div class="comment-item"><a href="/user/profile/${REPLY}">回复用户</a><div class="content">楼中楼</div></div></div>
      </div>
      <div class="comment-item"><a href="/user/profile/${AUTHOR}">楼主</a><div class="content">作者评论</div></div>
      <div class="comment-item"><a href="/user/profile/${SELF}">自己</a><div class="content">自己评论</div></div>
      <button onclick="fetch('/api/sns/web/v2/comment/sub/page?note_id=${NOTE}')">展开 1 条回复</button>
    </div></div><script>fetch('/api/sns/web/v2/comment/page?note_id=${NOTE}')</script>`;
  if (url.pathname.startsWith("/user/profile/")) body = `<div data-profile-user><button id="open-chat">私信</button></div>
    <script>
      document.querySelector('#open-chat').onclick = () => {
        const chat = document.createElement('div'); chat.className = 'chat-container'; chat.dataset.chatUserId = '${USER}';
        chat.innerHTML = '<div class="chat-header"><a href="/user/profile/${USER}">公开用户</a></div><div class="message-item self" data-message-id="old" data-message-status="sent"><span data-message-text>测试消息</span></div><textarea></textarea><button>发送</button>';
        document.body.append(chat);
        chat.querySelector('button').onclick = () => {
          fetch('/fixture-submitted');
          const text = chat.querySelector('textarea').value;
          chat.querySelector('textarea').value = '';
          const scenario = ${JSON.stringify(scenario)};
          if (scenario === 'no-new-message') return;
          const bubble = document.createElement('div'); bubble.className = 'message-item self';
          bubble.dataset.messageId = 'new-' + Date.now(); bubble.dataset.messageStatus = scenario === 'optimistic' ? 'pending' : 'sent';
          const content = document.createElement('span'); content.dataset.messageText = ''; content.textContent = text;
          bubble.append(content); chat.append(bubble);
          if (scenario === 'wrong-peer') chat.dataset.chatUserId = '${REPLY}';
        };
      };
    </script>`;
  return new Response(`<!doctype html><html><head><meta charset="utf-8"></head><body>${sidebar}${body}</body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

async function main() {
  await app.whenReady();
  window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  const filename = path.resolve(__dirname, "../../backend/main.cjs");
  const localRequire = createRequire(filename);
  const sandbox = {
    require: (name) => name === "electron" ? {
      ...electron, app: { setName() {}, requestSingleInstanceLock: () => false, quit() {}, on() {}, isPackaged: false },
      ipcMain: { handle() {}, on() {} },
    } : localRequire(name),
    __dirname: path.dirname(filename), process, Buffer, URL, Set, Map, console,
    setTimeout: (callback, delay) => setTimeout(callback, Math.min(delay, 80)), clearTimeout,
    setInterval: (callback, delay) => setInterval(callback, Math.min(delay, 80)), clearInterval,
    testWindow: window, testMessages: messages, testLedgerPath: path.join(TEMP, "fixture-ledger.json"),
  };
  vm.createContext(sandbox);
  vm.runInContext(`${fs.readFileSync(filename, "utf8")}
    mainWindow = testWindow;
    sendToRenderer = (channel, payload) => testMessages.push({ channel, payload });
    accountRegistry = { get: id => ({ id, name: 'fixture' }), list: () => [] };
    directMessages = new DirectMessageService({
      ledger: new MessageLedger(testLedgerPath),
      host: createDirectMessageHost({
        requireContext, findContext: id => accountContexts.get(id), startTask, stopAutoScroll,
        publishAccount: publishAccountStatus,
      }),
      onProgress: state => sendToRenderer('direct-messages:progress', state),
    });
    globalThis.testApi = { createAccountContext, disposeAccountContext, operateNote, startTask, directMessages };
  `, sandbox, { filename });
  api = sandbox.testApi;
  const partition = `dm-fixture-${Date.now()}`;
  const fixtureSession = session.fromPartition(partition);
  await fixtureSession.protocol.handle("https", response);
  const rejectedHttp = [];
  await fixtureSession.protocol.handle("http", (request) => { rejectedHttp.push(request.url); return new Response("", { status: 403 }); });
  context = api.createAccountContext({ id: "dm-fixture-account", name: "Fixture account", platform: "xhs", partition });
  context.view.setBounds({ x: 0, y: 0, width: 1024, height: 768 });
  context.view.setVisible(true);
  await waitFor(() => !context.view.webContents.isLoading());
  const service = api.directMessages;
  const account = context.id;
  await service.collect(account, [{ id: NOTE, title: "模拟笔记", link: `${ORIGIN}/explore/${NOTE}?xsec_token=fixture-token` }]);
  await assert.rejects(api.operateNote(context, { actions: { like: true } }), /已有笔记操作/);
  await assert.rejects(api.startTask(context, { kind: "comments", url: `${ORIGIN}/explore/${NOTE}` }), /正在执行/);
  await service.state(account).job;
  let state = service.snapshot(account);
  assert.equal(state.phase, "ready", state.message);
  assert.equal(state.candidates.length, 1);
  assert.equal(state.candidates[0].nickname, "公开用户");
  assert.equal(replyRequests, 0, "Never expand or request nested replies");
  assert.equal(messages.some((message) => message.channel === "collector:capture"), false, "Unmasked identities never enter the public capture stream");
  const review = await service.review(account, { tokens: [state.candidates[0].token], messages: ["测试消息"], limit: 1, intervalSeconds: 1 });
  await service.start(account, review.reviewId);
  await service.state(account).job;
  state = service.snapshot(account);
  if (state.phase !== "completed") console.error("Fixture diagnostics", await context.view.webContents.executeJavaScript(`({
    url: location.href, view: [innerWidth, innerHeight], buttons: [...document.querySelectorAll('button')].map(el => el.textContent),
    chats: [...document.querySelectorAll('.chat-container')].map(el => ({
      peer: el.getAttribute('data-chat-user-id'), rect: [el.getBoundingClientRect().width, el.getBoundingClientRect().height],
      header: el.querySelector('.chat-header')?.outerHTML
    }))
  })`));
  assert.equal(state.phase, "completed", state.message);
  assert.equal(state.candidates[0].status, "sent");
  await waitFor(() => actualSubmissions === 1);
  assert.equal(service.ledger.status(account, SELF, USER), "sent");

  for (const mode of ["no-new-message", "optimistic", "wrong-peer", "sent"]) {
    scenario = mode;
    await context.view.webContents.loadURL(`${ORIGIN}/user/profile/${USER}`);
    const tools = context.view.webContents;
    const opened = await tools.executeJavaScript(dmPage.openConversationScript({ userId: USER }), true);
    assert.equal(opened.status, "opened");
    const wrongRecipient = await tools.executeJavaScript(dmPage.prepareMessageScript({ userId: REPLY, message: "测试消息" }), true);
    assert.equal(wrongRecipient.status, "waiting");
    const prepared = await tools.executeJavaScript(dmPage.prepareMessageScript({ userId: USER, message: "测试消息" }), true);
    assert.equal(prepared.status, "prepared");
    const beforeWrongSender = actualSubmissions;
    const wrongSender = await tools.executeJavaScript(dmPage.submitMessageScript({ userId: USER, senderId: AUTHOR, message: "测试消息", confirmTimeoutMs: 350 }), true);
    assert.equal(wrongSender.status, "paused");
    assert.equal(wrongSender.attempted, false);
    assert.equal(actualSubmissions, beforeWrongSender);
    const result = await tools.executeJavaScript(dmPage.submitMessageScript({ userId: USER, senderId: SELF, message: "测试消息", confirmTimeoutMs: 350 }), true);
    assert.equal(result.status, mode === "sent" ? "sent" : "unconfirmed", mode);
  }

  await context.view.webContents.loadURL(`${ORIGIN}/user/profile/${USER}`);
  await context.view.webContents.executeJavaScript(`document.body.insertAdjacentHTML('beforeend', '<div role="alert">操作频繁，请稍后再试</div>')`);
  const limited = await context.view.webContents.executeJavaScript(dmPage.openConversationScript({ userId: USER }));
  assert.equal(limited.status, "paused");
  assert.equal(limited.attempted, false);
  assert.deepEqual(rejectedHttp, []);
  assert.ok(requests.every((url) => url.startsWith(ORIGIN)), "All fixture requests remain intercepted, no real platform access");
  console.log("PASS: isolated Electron main-comment capture, author/self/reply exclusion, operation mutex, durable send, new-acknowledged-bubble confirmation, wrong peer, optimistic message, rate-limit and zero private account access");
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (context && api) await api.disposeAccountContext(context).catch(() => {});
  if (window && !window.isDestroyed()) window.destroy();
  app.exit(process.exitCode || 0);
});
