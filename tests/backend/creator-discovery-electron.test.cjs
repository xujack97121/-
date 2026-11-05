const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow, session } = require("electron");
const { createCreatorDiscovery } = require("../../backend/creators/creator-discovery.cjs");
const { createCreatorWorkerFactory } = require("../../backend/creators/creator-worker.cjs");
const { platformNavigationUrl } = require("../../backend/platform/content-platforms.cjs");
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
const USER_F = "65a200000000000000000008";
const USER_G = "65a200000000000000000009";
const USER_H = "65a200000000000000000010";
const WRONG_USER = "65a200000000000000000099";
const ORIGIN = "https://www.xiaohongshu.com";
const API = "/api/sns/web/v1/search/notes";
const requests = [];
const publications = [];
const workers = [];
const insecureRequests = [];
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
let releaseProfile;
let profileRequested = false;

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
  return `<article class="note-item" style="min-height:100px;border-bottom:1px solid #ccc">
    <a href="/explore/65b200000000000000000001" class="title">家居好物关键词命中</a>
    <div class="author-wrapper"><a class="user-name" href="/user/profile/${id}?xsec_token=dom-token-${id}&xsec_source=pc_search">${nickname}</a></div>
    ${extra}</article>`;
}

function profileNotes(userId, titles) {
  return titles.map((title, index) => `<article class="note-item" data-author-id="${userId}">
    <a href="/explore/65b2000000000000000000${String(index + 1).padStart(2, "0")}"><span class="title">${title}</span></a>
    <div class="note-desc">${title}的公开内容摘要</div></article>`).join("");
}

async function response(request) {
  // Electron's HTTPS protocol handler can retain the pre-upgrade request URL.
  const rawUrl = new URL(request.url);
  const url = new URL(platformNavigationUrl(rawUrl.href, "xhs") || rawUrl.href);
  requests.push({ url: rawUrl.href, method: request.method, handler: "https" });
  if (url.origin !== ORIGIN) return new Response("", { status: 403 });
  if (url.pathname === "/fixture-submitted") { submissions += 1; return new Response("{}"); }
  if (url.pathname === "/fixture-editor-written") { editorWrites += 1; return new Response("{}"); }
  if (url.pathname === "/api/sns/web/v1/user_posted") return new Response("{}", { status: 429, headers: { "Content-Type": "application/json" } });
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
    const users = !keyword || keyword === "穿搭" ? [{ user_id: WRONG_USER, nickname: "错关键词污染用户" }]
      : url.searchParams.get("page") === "2" ? [{ userId: USER_E, nickname: "翻页家居达人" }]
        : [
          { user_id: USER_A, nickname: "API 家居达人", desc: "公开家居内容", xsec_token: "public-api-token", private_phone: "never-export" },
          { userId: USER_B, nickname: "小粉丝家居作者" },
        ];
    return new Response(JSON.stringify({ success: true, data: { items: users.map((user, index) => ({
      id: `65b2000000000000000000${String(index + 10).padStart(2, "0")}`, model_type: "note",
      note_card: { display_title: "家居搜索命中标题，仅供候选不能评分", user },
    })) } }), { headers: { "Content-Type": "application/json" } });
  }
  let html = "<h1>Fixture home</h1>";
  if (url.pathname === "/fixture-foreground") html = '<main><input id="manual-filter" value="人工浏览保持不变"><div style="height:2400px">人工浏览内容</div></main>';
  if (url.pathname === "/search_result/") {
    const keyword = url.searchParams.get("keyword") || "";
    const slow = keyword === "slow-search";
    if (keyword === "limited-search") return new Response("<h1>后台公开搜索访问受限</h1>", { status: 429, headers: { "Content-Type": "text/html" } });
    html = `<main><div data-search-users>
      ${slow ? "" : card(USER_A, "DOM 家居达人", null)}
      ${slow ? "" : card(USER_C, "未知粉丝达人", null)}
      ${slow ? "" : card(USER_D, "仅一篇家居的健身作者", null)}
      ${slow ? "" : card(USER_F, "家居昵称但非家居行业", null)}
      ${slow ? "" : card(USER_G, "错误主页身份", null)}
      ${slow ? "" : card(USER_H, "仅收藏家居内容", null)}
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
    if (scenario === "upgrade-profile" && !url.searchParams.has("upgraded")) {
      const destination = new URL(url);
      destination.protocol = "http:";
      destination.searchParams.set("upgraded", "1");
      return new Response("", { status: 302, headers: { Location: destination.href } });
    }
    if (scenario === "slow-profile") {
      profileRequested = true;
      await new Promise((resolve) => { releaseProfile = resolve; });
    }
    if (scenario === "http-limited-profile") return new Response("<h1>访问暂受限</h1>", { status: 429, headers: { "Content-Type": "text/html" } });
    const home = [USER_A, USER_B, USER_C, USER_E].includes(target);
    const titles = home ? ["家居收纳与客厅布局", "卧室软装与家居搭配", "家居装修与室内设计"]
      : target === USER_H ? ["家居收纳", "家居软装", "家居装修"] : ["今天买了一个家居摆件", "健身力量训练计划", "增肌运动健身教学"];
    const fans = target === USER_A ? '<div class="user-interactions">200关注<div><span class="count">1.2万</span><span class="shows">粉丝</span></div>3万获赞与收藏</div>'
      : target === USER_B ? '<div class="fans">粉丝 500</div>' : target === USER_C ? "粉丝未知" : '<div class="fans">3万粉丝</div>';
    html = `<aside class="sidebar"><div class="user-info"><span class="user-desc">侧栏登录账号美妆简介不可作目标证据</span><div>999万粉丝</div></div></aside>
      <section data-profile-user="${target === USER_G ? WRONG_USER : target}" class="user-info">
      <h1 class="user-name">公开达人主页</h1>
      <div class="user-desc">${home ? "专注家居软装、室内设计与收纳分享" : "专注健身增肌训练"}${target === USER_C ? "，目标是1万粉丝" : ""}</div>
      <div class="user-tags"><span class="tag-item">${home ? "家居" : "健身"}</span></div>
      ${fans}<button id="open-chat">私信</button></section>
      ${scenario === "blocked-profile" ? '<div data-captcha="true" style="height:20px">平台验证</div>' : ""}
      <div class="reds-tab-item active">${target === USER_H ? "收藏" : "笔记"}</div>
      <div data-user-posted-feeds>
        ${profileNotes(target, titles)}
        <div data-recommended>${profileNotes(WRONG_USER, ["家居装修推荐", "家居软装推荐"])}</div>
        <article class="note-item" data-pinned="true"><a href="/explore/65b200000000000000000099"><span class="title">家居旧置顶不算样本</span></a></article>
      </div>
      <script>
        ${scenario === "api-limited-profile" ? `fetch('/api/sns/web/v1/user_posted?user_id=${target}');` : ""}
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
  console.log("Creator fixture: starting isolated two-channel coverage");
  const fixtureSession = session.fromPartition(`creator-fixture-${Date.now()}`);
  await fixtureSession.protocol.handle("https", response);
  await fixtureSession.protocol.handle("http", (request) => { insecureRequests.push(request.url); return new Response("", { status: 403 }); });
  fixtureSession.webRequest.onBeforeRequest({ urls: ["http://xiaohongshu.com/*", "http://*.xiaohongshu.com/*"] }, (details, callback) => {
    if (details.resourceType !== "mainFrame") { callback({}); return; }
    const target = platformNavigationUrl(details.url, "xhs");
    callback(target ? { redirectURL: target } : { cancel: true });
  });
  window = new BrowserWindow({
    show: false, width: 1000, height: 720,
    webPreferences: { session: fixtureSession, sandbox: true, contextIsolation: true, backgroundThrottling: false },
  });
  const contents = window.webContents;
  context = {
    id: "creator-fixture-account", platform: "xhs", disposed: false,
    session: fixtureSession, capture: { active: false, pendingStartRunId: "" },
    operation: { active: false }, foregroundOperation: { active: false }, view: { webContents: contents },
  };
  await contents.loadURL(`${ORIGIN}/fixture-foreground`);
  await contents.executeJavaScript("scrollTo(0, 620); document.querySelector('#manual-filter').focus()");
  const foregroundBefore = await contents.executeJavaScript("({url:location.href,scrollY,value:document.querySelector('#manual-filter').value,active:document.activeElement.id})");
  const factory = createCreatorWorkerFactory({ BrowserWindow });
  service = createCreatorDiscovery({
    requireContext: (id) => { assert.equal(id, context.id); return context; },
    createSearchWorker: (accountContext) => {
      const worker = factory(accountContext);
      workers.push(worker);
      return worker;
    },
    publishAccount: () => {},
    onProgress: (snapshot) => publications.push(snapshot),
    pollIntervalMs: 25, scrollIntervalMs: 100, initialWaitMs: 800,
    searchTimeoutMs: 4000, navigationTimeoutMs: 8000, conversationTimeoutMs: 500, maxScrolls: 12,
    profileIntervalMs: 25, profileSettleMs: 60, profileTimeoutMs: 180, verificationTimeoutMs: 8000,
  });

  const account = context.id;
  await service.search(account, { keyword: "家居", minFollowers: 1000, maxFollowers: 50000, limit: 30 });
  assert.equal(context.operation.kind, "creator-search");
  const worker = workers[0];
  assert.notEqual(worker.contents, contents);
  assert.equal(worker.contents.session, fixtureSession);
  assert.equal(BrowserWindow.fromWebContents(worker.contents).isVisible(), false, "Background tasks never automatically show their window");
  await waitFor(() => service.getState(account).creators.length > 0 && service.getState(account).active);
  assert.deepEqual(await contents.executeJavaScript("({url:location.href,scrollY,value:document.querySelector('#manual-filter').value,active:document.activeElement.id})"), foregroundBefore, "Worker search preserves foreground URL, scroll, input and focus");
  const firstCard = service.getState(account).creators[0];
  const activeRunId = service.getState(account).runId;
  const parallel = await service.openConversation(account, firstCard);
  assert.equal(parallel.status, "opened", "A verified card opens chat while background work continues");
  assert.equal(service.getState(account).active, true);
  assert.equal(service.getState(account).runId, activeRunId);
  assert.equal(context.foregroundOperation.active, false);
  const chatUrl = contents.getURL();
  await service.waitForIdle(account);
  let state = service.getState(account);
  if (state.phase !== "completed") console.error("Creator fixture diagnostics", {
    url: worker.contents.getURL(), loading: worker.contents.isLoading(), requests, state,
  });
  assert.equal(state.phase, "completed", state.message);
  assert.equal(context.operation.active, false);
  assert.deepEqual(new Set(state.creators.map((creator) => creator.userId)), new Set([USER_A, USER_E]));
  assert.equal(state.creators.find((creator) => creator.userId === USER_A).followers, 12000, "Public profile follower count does not mix with likes or following");
  assert.equal(state.creators.some((creator) => creator.userId === USER_C), false, "Unknown fans excluded under numeric bounds");
  assert.equal(state.creators.some((creator) => creator.userId === WRONG_USER), false, "Wrong/missing POST keywords cannot pollute results");
  assert.equal(state.creators.some((creator) => [USER_D, USER_F, USER_G, USER_H].includes(creator.userId)), false, "One-off, wrong-profile and favorites-only evidence do not count as industry creators");
  assert.equal(state.candidates, 8);
  assert.equal(state.checked, 8);
  assert.equal(state.stage, "done");
  assert.equal(contents.getURL(), chatUrl, "Remaining background profile visits do not navigate the foreground chat");
  assert.ok(publications.some((snapshot) => snapshot.active && snapshot.creators.length > 0), "Verified cards stream before the search completes");
  assert.ok(state.creators.every((creator) => creator.relevance.version === 2 && creator.relevance.status === "matched" && creator.relevance.matchedNotes >= 2));
  assert.ok(publications.some((snapshot) => snapshot.stage === "collecting" && snapshot.candidates > 0 && snapshot.creators.length === 0), "Candidate search hits do not enter result cards");
  assert.ok(publications.some((snapshot) => snapshot.stage === "checking"), "Profile verification stage is reported");
  assert.ok(scrollRequests >= 1, "Normal page scrolling loads additional public users");
  assert.equal(JSON.stringify(state).includes("never-export"), false, "Never return arbitrary private fields");
  const creator = state.creators.find((creator) => creator.userId === USER_A);
  assert.ok(new URL(creator.profileUrl).searchParams.get("xsec_token"), "Public user navigation token retained");
  assert.ok(publications.every((snapshot) => snapshot.accountId === account));
  assert.equal(worker.contents.debugger.listenerCount("message"), 0, "Worker task listeners removed after completion");
  assert.equal(service.getState("another-account").creators.length, 0, "Public findings remain account-scoped");
  console.log("Creator fixture: streamed results and parallel chat passed");

  for (const kind of ["capture", "pending", "operation"]) {
    if (kind === "capture") context.capture.active = true;
    if (kind === "pending") context.capture.pendingStartRunId = "pending-fixture";
    if (kind === "operation") context.operation = { active: true, kind: "direct-message" };
    await assert.rejects(service.search(account, { keyword: "家居" }), /正在采集或执行/);
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
  console.log("Creator fixture: manual peer validation passed");
  assert.equal(submissions, 0);
  const foregroundChatBeforeStop = contents.getURL();

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
  assert.equal(worker.contents.debugger.listenerCount("message"), 0);
  assert.equal(contents.getURL(), foregroundChatBeforeStop, "Stopping a worker search does not stop or replace the foreground page");
  console.log("Creator fixture: worker-only cancellation passed");
  scenario = "slow-profile";
  await service.search(account, { keyword: "家居", minFollowers: 1000 });
  await waitFor(() => profileRequested);
  assert.equal(service.getState(account).stage, "checking");
  service.stop(account);
  await service.waitForIdle(account);
  releaseProfile?.();
  await pause(100);
  assert.equal(service.getState(account).phase, "stopped");
  assert.equal(service.getState(account).creators.length, 0, "Late profile response cannot become verified results after stop");
  assert.equal(context.operation.active, false);
  scenario = "blocked-profile";
  await service.search(account, { keyword: "家居" });
  await service.waitForIdle(account);
  assert.equal(service.getState(account).phase, "paused", "Platform verification pauses public profile checking conservatively");
  assert.equal(context.operation.active, false);
  const taskUrl = worker.contents.getURL();
  console.log("Creator fixture: profile cancellation and DOM verification pause passed");
  assert.equal((await service.openTaskPage(account)).status, "opened");
  const taskWindow = BrowserWindow.fromWebContents(worker.contents);
  assert.equal(taskWindow.isVisible(), true);
  taskWindow.close();
  assert.equal(taskWindow.isVisible(), false);
  assert.equal(taskWindow.isDestroyed(), false);
  assert.equal(worker.contents.getURL(), taskUrl, "Closing the task inspection window preserves the original verification page");
  console.log("Creator fixture: task inspection hide passed");
  scenario = "http-limited-profile";
  const beforeLimitedProfiles = profileNavigations.length;
  await service.search(account, { keyword: "家居" });
  await service.waitForIdle(account);
  assert.equal(service.getState(account).phase, "paused", "HTTP429 without a known DOM notice must stop verification");
  assert.equal(profileNavigations.length - beforeLimitedProfiles, 1, "Do not continue checking profiles after a platform restriction");
  assert.equal(context.operation.active, false);
  assert.equal(worker.contents.isDestroyed(), true, "A new explicit search replaces a previously inspected worker");
  const replacementWorker = workers.at(-1);
  console.log("Creator fixture: inspected worker replacement and document limit passed");
  scenario = "api-limited-profile";
  const beforeLimitedApi = profileNavigations.length;
  await service.search(account, { keyword: "家居" });
  await service.waitForIdle(account);
  assert.equal(service.getState(account).phase, "paused", "A profile API HTTP429 pauses checking even if its document is HTTP200");
  assert.equal(profileNavigations.length - beforeLimitedApi, 1);
  console.log("Creator fixture: profile API limit passed");
  scenario = "normal";
  await service.search(account, { keyword: "limited-search" });
  await service.waitForIdle(account);
  assert.equal(service.getState(account).phase, "paused", "Search-level HTTP429 without API or DOM hints pauses the worker");
  console.log("Creator fixture: search document limit passed");
  scenario = "upgrade-profile";
  await service.search(account, { keyword: "家居", limit: 1 });
  await service.waitForIdle(account);
  assert.equal(service.getState(account).phase, "completed", service.getState(account).message);
  assert.equal(service.getState(account).creators.length, 1);
  assert.equal(service.getState(account).creators[0].userId, USER_A, "The first matching profile survives its HTTP redirect through the shared HTTPS upgrader");
  assert.equal(new URL(replacementWorker.contents.getURL()).pathname, `/user/profile/${USER_A}`);
  assert.equal(new URL(replacementWorker.contents.getURL()).protocol, "https:");
  assert.equal(insecureRequests.length, 0, "Shared hardened session upgrades same-platform HTTP redirects before any plaintext request");
  scenario = "normal";
  slowRequested = false;
  await service.search(account, { keyword: "slow-search" });
  await waitFor(() => slowRequested);
  console.log("Creator fixture: beginning worker termination regression");
  BrowserWindow.fromWebContents(replacementWorker.contents).destroy();
  await service.waitForIdle(account);
  assert.equal(service.getState(account).phase, "paused", "Worker termination pauses only the background task");
  assert.equal(context.operation.active, false);
  assert.equal(contents.getURL(), foregroundChatBeforeStop);
  releaseSlow?.();
  await service.search(account, { keyword: "家居", limit: 1 });
  await service.waitForIdle(account);
  assert.equal(service.getState(account).phase, "completed", service.getState(account).message);
  assert.equal(workers.length, 3, "A terminated worker is replaced rather than reused");
  assert.equal(replacementWorker.contents.isDestroyed(), true);
  assert.ok(requests.every((request) => request.handler === "https" && new URL(platformNavigationUrl(request.url, "xhs")).origin === ORIGIN), "All requests reach the local HTTPS fixture; no real accounts or external platform requests");
  assert.equal(submissions, 0);
  assert.equal(editorWrites, 0);
  context.disposed = true;
  await service.dispose(account);
  assert.ok(workers.every((host) => host.isDestroyed()), "Account disposal closes all workers without clearing its shared session");
  console.log("PASS: isolated Electron independent same-session worker, streamed verified creators, parallel foreground chat and browsing state preservation, worker-only stop, task-window hide, worker termination/replacement, HTTPS redirect upgrade, scoped public evidence, range/unknown filtering, cancellation and zero message writes/sends");
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
}).finally(async () => {
  releaseSlow?.();
  releaseProfile?.();
  if (context) context.disposed = true;
  if (service && context) await service.dispose(context.id).catch(() => {});
  await pause(100);
  if (window && !window.isDestroyed()) window.destroy();
  app.exit(process.exitCode || 0);
});
