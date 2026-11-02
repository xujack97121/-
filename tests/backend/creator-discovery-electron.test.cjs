const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow, session } = require("electron");
const { createCreatorDiscovery } = require("../../backend/creators/creator-discovery.cjs");
const creatorPage = require("../../backend/creators/creator-page.cjs");
const directMessagePage = require("../../backend/operations/direct-message-page.cjs");

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "creator-electron-fixture-"));
app.setPath("userData", TEMP);
app.disableHardwareAcceleration();
const USER_A = "65a200000000000000000003";
const USER_B = "65a200000000000000000004";
const USER_C = "65a200000000000000000005";
const USER_D = "65a200000000000000000006";
const USER_E = "65a200000000000000000007";
const WRONG_USER = "65a200000000000000000099";
const ORIGIN = "https://www.xiaohongshu.com";
const API = "/api/sns/web/v1/search/usersearch";
const requests = [];
const publications = [];
let window;
let service;
let context;
let scenario = "normal";
let submissions = 0;
let editorWrites = 0;
let scrollRequests = 0;
let releaseSlow;
let slowRequested = false;
let profileNavigations = [];

const pause = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(predicate, timeout = 8000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await predicate()) return;
    await pause(20);
  }
  throw new Error("Timed out in isolated creator fixture");
}

function card(id, nickname, fans, extra = "") {
  return `<article data-search-user style="min-height:100px;border-bottom:1px solid #ccc">
    <a class="user-name" href="/user/profile/${id}?xsec_token=dom-token-${id}&xsec_source=pc_search">${nickname}</a>
    ${fans === null ? "" : `<div class="fans"><span>粉丝</span><span>${fans}</span></div>`}
    <div class="user-desc">公开领域简介</div>${extra}</article>`;
}

async function response(request) {
  const url = new URL(request.url);
  requests.push({ url: url.href, method: request.method });
  if (url.origin !== ORIGIN) return new Response("", { status: 403 });
  if (url.pathname === "/fixture-submitted") { submissions += 1; return new Response("{}"); }
  if (url.pathname === "/fixture-editor-written") { editorWrites += 1; return new Response("{}"); }
  if (url.pathname === API) {
    let body = {};
    if (request.method === "POST") {
      try { body = JSON.parse(await request.text()); } catch { /* Fixture deliberately tests malformed requests. */ }
    }
    const keyword = url.searchParams.get("keyword") || body.keyword || "";
    if (keyword === "slow-search") {
      slowRequested = true;
      await new Promise((resolve) => { releaseSlow = resolve; });
    }
    if (url.searchParams.get("page") === "2") scrollRequests += 1;
    const users = !keyword || keyword === "穿搭" ? [{ user_info: { user_id: WRONG_USER, nickname: "错关键词污染用户" }, fans: 999999 }]
      : url.searchParams.get("page") === "2" ? [{ userInfo: { userId: USER_E, nickname: "翻页美妆达人" }, fansCount: 30000 }]
        : [
          { user_info: { user_id: USER_A, nickname: "API 美妆达人", desc: "公开护肤内容", xsec_token: "public-api-token", private_phone: "never-export" }, fans: "1.2万" },
          { userInfo: { userId: USER_B, nickname: "小粉丝美妆作者", fansCount: 500 } },
        ];
    return new Response(JSON.stringify({ success: true, data: { users } }), { headers: { "Content-Type": "application/json" } });
  }
  let html = "<h1>Fixture home</h1>";
  if (url.pathname === "/search_result/") {
    const keyword = url.searchParams.get("keyword") || "";
    const slow = keyword === "slow-search";
    html = `<main><div data-search-users>
      ${slow ? "" : card(USER_A, "DOM 美妆达人", null)}
      ${slow ? "" : card(USER_C, "未知粉丝达人", null)}
      ${slow ? "" : card(USER_D, "DOM 公开美妆作者", "2,000")}
      <div style="height:1700px"></div>
      </div></main>
      <script>
        fetch('${API}', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ keyword: ${JSON.stringify(keyword)}, page: 1 }) });
        ${slow ? "" : `fetch('${API}', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ keyword:'穿搭' }) });
        fetch('${API}', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ page:1 }) });`}
        let requestedNext = false;
        addEventListener('scroll', () => {
          if (requestedNext || ${JSON.stringify(slow)}) return;
          requestedNext = true;
          fetch('${API}?keyword=' + encodeURIComponent(${JSON.stringify(keyword)}) + '&page=2');
        });
      </script>`;
  }
  if (url.pathname.startsWith("/user/profile/")) {
    const target = url.pathname.split("/").pop();
    profileNavigations.push(url.href);
    html = `<section data-profile-user><h1>公开达人主页</h1><button id="open-chat">私信</button></section>
      <script>
        const expectedId = ${JSON.stringify(target)};
        const scenario = ${JSON.stringify(scenario)};
        document.querySelector('#open-chat').onclick = () => {
          if (scenario === 'no-chat') return;
          const root = document.createElement('section');
          root.className = 'chat-container';
          root.dataset.chatUserId = scenario === 'wrong-peer' ? '${WRONG_USER}' : expectedId;
          root.innerHTML = '<div class="chat-header"><a href="/user/profile/' + root.dataset.chatUserId + '">私信收件人</a></div><textarea placeholder="请输入消息"></textarea><button>发送</button>';
          document.body.append(root);
          const editor = root.querySelector('textarea');
          editor.addEventListener('input', () => fetch('/fixture-editor-written'));
          editor.addEventListener('change', () => fetch('/fixture-editor-written'));
          root.querySelector('button').onclick = () => fetch('/fixture-submitted');
        };
      </script>`;
  }
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><style>body{font:16px sans-serif}a,button,textarea{display:block;min-height:24px}.chat-container{min-height:200px}</style></head><body>${html}</body></html>`, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

async function main() {
  await app.whenReady();
  const fixtureSession = session.fromPartition(`creator-fixture-${Date.now()}`);
  await fixtureSession.protocol.handle("https", response);
  await fixtureSession.protocol.handle("http", () => new Response("", { status: 403 }));
  window = new BrowserWindow({
    show: false, width: 1000, height: 720,
    webPreferences: { session: fixtureSession, sandbox: true, contextIsolation: true, backgroundThrottling: false },
  });
  const contents = window.webContents;
  context = {
    id: "creator-fixture-account", platform: "xhs", disposed: false,
    capture: { active: false, pendingStartRunId: "" }, operation: { active: false }, view: { webContents: contents },
  };
  await contents.loadURL(`${ORIGIN}/`);
  service = createCreatorDiscovery({
    requireContext: (id) => { assert.equal(id, context.id); return context; },
    publishAccount: () => {},
    onProgress: (snapshot) => publications.push(snapshot),
    pollIntervalMs: 60, scrollIntervalMs: 100, initialWaitMs: 800,
    searchTimeoutMs: 4000, navigationTimeoutMs: 8000, conversationTimeoutMs: 500, maxScrolls: 12,
  });

  const account = context.id;
  await service.search(account, { keyword: "美妆", minFollowers: 1000, maxFollowers: 50000, limit: 30 });
  assert.equal(context.operation.kind, "creator-search");
  await assert.rejects(service.openConversation(account, { userId: USER_A, profileUrl: `${ORIGIN}/user/profile/${USER_A}` }), /先停止/);
  await service.waitForIdle(account);
  let state = service.getState(account);
  if (state.phase !== "completed") console.error("Creator fixture diagnostics", {
    url: contents.getURL(), loading: contents.isLoading(), requests, state,
  });
  assert.equal(state.phase, "completed", state.message);
  assert.equal(context.operation.active, false);
  assert.deepEqual(new Set(state.creators.map((creator) => creator.userId)), new Set([USER_A, USER_D, USER_E]));
  assert.equal(state.creators.find((creator) => creator.userId === USER_A).followers, 12000, "Public network count enriches unknown DOM count");
  assert.equal(state.creators.find((creator) => creator.userId === USER_D).followers, 2000, "DOM labeled count supported");
  assert.equal(state.creators.some((creator) => creator.userId === USER_C), false, "Unknown fans excluded under numeric bounds");
  assert.equal(state.creators.some((creator) => creator.userId === WRONG_USER), false, "Wrong/missing POST keywords cannot pollute results");
  assert.ok(scrollRequests >= 1, "Normal page scrolling loads additional public users");
  assert.equal(JSON.stringify(state).includes("never-export"), false, "Never return arbitrary private fields");
  const creator = state.creators.find((creator) => creator.userId === USER_A);
  assert.ok(new URL(creator.profileUrl).searchParams.get("xsec_token"), "Public user navigation token retained");
  assert.ok(publications.every((snapshot) => snapshot.accountId === account));
  assert.equal(contents.debugger.listenerCount("message"), 0, "Task listeners removed after completion");

  for (const kind of ["capture", "pending", "operation"]) {
    if (kind === "capture") context.capture.active = true;
    if (kind === "pending") context.capture.pendingStartRunId = "pending-fixture";
    if (kind === "operation") context.operation = { active: true, kind: "direct-message" };
    await assert.rejects(service.search(account, { keyword: "美妆" }), /正在采集或执行/);
    context.capture.active = false;
    context.capture.pendingStartRunId = "";
    context.operation = { active: false };
  }

  scenario = "normal";
  const opened = await service.openConversation(account, creator);
  assert.equal(opened.status, "opened");
  assert.equal(opened.userId, USER_A);
  assert.ok(profileNavigations.some((url) => new URL(url).searchParams.has("xsec_token")), "Safe public token reaches matching profile");
  const editor = await contents.executeJavaScript(`({value:document.querySelector('textarea').value,focused:document.activeElement===document.querySelector('textarea')})`);
  assert.equal(editor.value, "");
  assert.equal(editor.focused, false, "Opening does not fill or focus the message editor");
  assert.equal(editorWrites, 0);
  assert.equal(submissions, 0);

  scenario = "wrong-peer";
  await assert.rejects(service.openConversation(account, creator), /未能确认/);
  assert.equal(context.operation.active, false);
  const wrong = await contents.executeJavaScript(creatorPage.confirmConversationScript({ userId: USER_A }));
  assert.equal(wrong.status, "waiting");
  const wrongOpen = await contents.executeJavaScript(directMessagePage.openConversationScript({ userId: USER_B }));
  assert.equal(wrongOpen.status, "paused", "A different expected profile cannot click private-message entry");
  scenario = "no-chat";
  await assert.rejects(service.openConversation(account, creator), /未能确认/);
  assert.equal(submissions, 0);
  assert.equal(editorWrites, 0);

  await service.search(account, { keyword: "slow-search", limit: 30 });
  await waitFor(() => slowRequested);
  await pause(250);
  assert.equal(service.getState(account).active, true, "In-flight public search remains active while response is delayed");
  service.stop(account);
  await service.waitForIdle(account);
  assert.equal(service.getState(account).phase, "stopped");
  assert.equal(context.operation.active, false);
  releaseSlow?.();
  await pause(150);
  assert.equal(service.getState(account).creators.length, 0, "Late response after stop cannot leak into results");
  assert.equal(contents.debugger.listenerCount("message"), 0);
  assert.ok(requests.every((request) => request.url.startsWith(ORIGIN)), "All test requests intercepted; no real accounts, platform requests or external URLs");
  assert.equal(submissions, 0);
  assert.equal(editorWrites, 0);
  context.disposed = true;
  await service.dispose(account);
  console.log("PASS: isolated Electron public keyword/POST + DOM discovery, public-token navigation, range/unknown filtering, normal scroll, cancellation, account mutex, peer-verified manual chat, zero editor writes/sends or private account access");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  releaseSlow?.();
  if (context) context.disposed = true;
  if (service && context) await service.dispose(context.id).catch(() => {});
  if (window && !window.isDestroyed()) window.destroy();
  app.exit(process.exitCode || 0);
});
