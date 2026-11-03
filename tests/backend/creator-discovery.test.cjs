const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const data = require("../../backend/creators/creator-data.cjs");
const { createCreatorDiscovery } = require("../../backend/creators/creator-discovery.cjs");

const USER_A = "65a200000000000000000003";
const USER_B = "65a200000000000000000004";
const USER_C = "65a200000000000000000005";
const ORIGIN = "https://www.xiaohongshu.com";
const API = `${ORIGIN}/api/sns/web/v1/search/usersearch`;
const NOTES_API = `${ORIGIN}/api/sns/web/v1/search/notes`;
const NOTE_A = "65b200000000000000000001";
const row = (userId, fans, extra = {}) => ({ user_info: { user_id: userId, nickname: `公开用户${userId.slice(-1)}` }, fans, ...extra });
const pause = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function fixture(options = {}) {
  const events = [];
  const accountEvents = [];
  const scripts = [];
  const requests = [];
  const contents = new EventEmitter();
  const debuggerApi = new EventEmitter();
  const bodies = new Map();
  let bodyCount = 0;
  let url = `${ORIGIN}/`;
  let loading = false;
  let destroyed = false;
  let attached = true;
  let loader = "";
  debuggerApi.isAttached = () => attached;
  debuggerApi.attach = () => { attached = true; };
  debuggerApi.sendCommand = async (command, params = {}) => {
    requests.push({ command, params });
    if (command === "Page.getFrameTree") return { frameTree: { frame: { id: "main-frame" } } };
    if (command === "Network.getResponseBody") {
      if (options.body) return options.body(params.requestId, bodies);
      return { body: JSON.stringify(bodies.get(params.requestId)), base64Encoded: false };
    }
    return {};
  };
  contents.debugger = debuggerApi;
  contents.isDestroyed = () => destroyed;
  contents.getURL = () => url;
  contents.isLoading = () => loading;
  contents.setBackgroundThrottling = (value) => {
    events.push({ throttle: value });
    if (options.throttleError && !value) throw new Error("throttle failure");
  };
  contents.stop = () => { loading = false; events.push({ stopped: true }); };
  contents.loadURL = async (nextUrl) => {
    loading = true;
    url = nextUrl;
    loader = `loader-${events.length}`;
    events.push({ navigation: nextUrl });
    debuggerApi.emit("message", {}, "Network.requestWillBeSent", {
      type: "Document", frameId: "main-frame", loaderId: loader,
      documentURL: nextUrl, requestId: `document-${loader}`, request: { url: nextUrl },
    });
    if (options.load && (!data.profileId(nextUrl) || options.loadProfiles || api.service.getState(context.id).phase === "idle")) await options.load(nextUrl, api);
    loading = false;
    contents.emit("did-navigate", {}, nextUrl);
  };
  contents.executeJavaScript = async (script) => {
    scripts.push(script);
    if (options.execute) return options.execute(script, api);
    if (script.includes("function readCreatorSearch(")) return { pageMatches: true, rows: options.rows || [], empty: true };
    if (script.includes("function scrollCreatorSearch(")) return { moved: false, atBottom: true };
    if (script.includes("function readCreatorProfile(")) {
      const userId = data.profileId(url);
      if (options.profile) return options.profile(userId, api);
      const candidates = [...(options.rows || []), ...[...bodies.values()].flatMap((body) => data.extractCreators(body))];
      const found = candidates.map(data.normalizeCreator).filter((creator) => creator?.userId === userId)
        .reduce((previous, incoming) => data.mergeCreator(previous, incoming), null);
      return {
        pageMatches: true, profileReady: true, userId, authoredConfirmed: true,
        creator: { ...found, userId, profileUrl: url, description: "专注美妆护肤内容分享", tags: ["美妆"] },
        notes: [1, 2, 3].map((index) => ({
          id: `65b20000000000000000000${index}`, authorId: userId, source: "profile",
          title: `美妆护肤教程${index}`, description: "彩妆与护肤经验",
        })),
      };
    }
    if (script.includes("function confirmConversation(")) return { status: "opened", userId: USER_A };
    if (script.includes("function openConversation(")) return { status: "opened" };
    throw new Error("Unexpected page script");
  };
  const context = { id: "account-a", platform: "xhs", disposed: false, capture: { active: false }, operation: { active: false }, view: { webContents: contents } };
  const api = {
    contents, debuggerApi, context, events, accountEvents, scripts, requests, bodies,
    get loader() { return loader; },
    setUrl(value) { url = value; },
    setDestroyed(value) { destroyed = value; },
    request(request, overrides = {}) {
      const requestId = overrides.requestId || `users-${++bodyCount}`;
      debuggerApi.emit("message", {}, "Network.requestWillBeSent", {
        type: "Fetch", frameId: "main-frame", loaderId: loader,
        documentURL: url, requestId, request, ...overrides,
      });
      return requestId;
    },
    respond(requestId, body, overrides = {}) {
      bodies.set(requestId, body);
      debuggerApi.emit("message", {}, "Network.responseReceived", {
        requestId, frameId: "main-frame", loaderId: loader,
        response: { url: `${API}?keyword=${encodeURIComponent("美妆")}`, status: 200, mimeType: "application/json" }, ...overrides,
      });
      debuggerApi.emit("message", {}, "Network.loadingFinished", { requestId, encodedDataLength: 500 });
    },
    service: null,
  };
  api.service = createCreatorDiscovery({
    requireContext: (id) => {
      if (id !== context.id) throw new Error("No such account");
      return context;
    },
    publishAccount: () => accountEvents.push({ ...context.operation }),
    onProgress: (state) => events.push({ progress: state }),
    pollIntervalMs: 2, searchTimeoutMs: 150, initialWaitMs: 0,
    navigationTimeoutMs: 100, conversationTimeoutMs: 50, scrollIntervalMs: 0, maxScrolls: 4,
    profileIntervalMs: 0, profileSettleMs: 0, profileTimeoutMs: 20, verificationTimeoutMs: 1000,
    ...options.serviceOptions,
  });
  return api;
}

test("粉丝数严格解析公开数字、万亿与未知值，不将缺失值视为零", () => {
  for (const [value, expected] of [
    [0, 0], [1234, 1234], ["1,234", 1234], ["1.2万", 12000], ["粉丝 2.5亿", 250000000],
    ["3千粉丝", 3000], ["1.6w", 16000], ["2.3K", 2300], ["1.5m", 1500000],
    ["约 12.5 万+", 125000], ["粉丝数：0", 0],
  ]) assert.equal(data.parseFollowers(value), expected, String(value));
  for (const value of [null, undefined, "", "未知", "粉丝", "12位", "1.2万+关注30", -1, 1.1, Infinity, true, {}, "9e99", "99999999999999999999"]) {
    assert.equal(data.parseFollowers(value), null, String(value));
  }
});

test("搜索参数规范化、整数边界与未知粉丝过滤", () => {
  assert.deepEqual(data.validateSearch({ keyword: "  美妆  ", minFollowers: "0", maxFollowers: "999", limit: 20 }), {
    keyword: "美妆", minFollowers: 0, maxFollowers: 999, limit: 20,
  });
  assert.equal(data.validateSearch({ keyword: "ＡＩ" }).keyword, "AI");
  assert.equal(data.isCreatorSearchRequest({ url: `${API}?keyword=${encodeURIComponent("ＡＩ")}` }, "AI"), true);
  for (const input of [
    {}, { keyword: "" }, { keyword: "a".repeat(81) }, { keyword: "a\nb" }, { keyword: "a\u200bb" },
    { keyword: "美妆", minFollowers: true }, { keyword: "美妆", minFollowers: -1 },
    { keyword: "美妆", minFollowers: "1.5" }, { keyword: "美妆", minFollowers: 2, maxFollowers: 1 },
    { keyword: "美妆", limit: 101 }, { keyword: "美妆", limit: true },
  ]) assert.throws(() => data.validateSearch(input));
  assert.equal(data.matchesFollowers({ followers: null }, { minFollowers: null, maxFollowers: null }), true);
  assert.equal(data.matchesFollowers({ followers: null }, { minFollowers: 0, maxFollowers: null }), false);
  assert.equal(data.matchesFollowers({ followers: 1000 }, { minFollowers: 1000, maxFollowers: 1000 }), true);
});

test("只接受 HTTPS 平台笔记/用户搜索及完全匹配的 GET/POST 关键词", () => {
  const query = `${API}?keyword=${encodeURIComponent("美妆")}`;
  assert.equal(data.isCreatorSearchRequest({ url: query }, "美妆"), true);
  assert.equal(data.isCreatorSearchRequest({ url: API, method: "POST", postData: '{"keyword":"美妆"}' }, "美妆"), true);
  assert.equal(data.isCreatorSearchRequest({ url: API.replace("www.", "edith."), method: "POST", postData: "keyword=%E7%BE%8E%E5%A6%86" }, "美妆"), true);
  assert.equal(data.isCreatorSearchRequest({ url: query.replace("/usersearch", "/notes") }, "美妆"), true);
  for (const request of [
    { url: API, method: "POST" }, { url: API, method: "POST", hasPostData: true },
    { url: API, method: "POST", postData: '{"page":1}' },
    { url: query, method: "POST", postData: '{"keyword":"穿搭"}' },
    { url: `${query}&keyword=穿搭` }, { url: query.replace("https:", "http:") },
    { url: query.replace("www.xiaohongshu.com", "www.xiaohongshu.com.evil.test") },
    { url: query.replace("/usersearch", "/recommend") }, { url: query, method: "DELETE" },
    { url: query.replace("https://", "https://name:password@") },
    { url: API, method: "POST", postData: '{"keyword":["美妆"]}' },
  ]) assert.equal(data.isCreatorSearchRequest(request, "美妆"), false, JSON.stringify(request));
  const search = data.searchUrl("美妆 & 护肤");
  assert.equal(new URL(search).searchParams.get("type"), "0");
  assert.equal(data.isCreatorSearchPage(search, "美妆 & 护肤"), true);
  assert.equal(data.isCreatorSearchPage(search.replace("type=0", "type=51"), "美妆 & 护肤"), true);
  assert.equal(data.isCreatorSearchPage(search.replace("type=0", "type=1"), "美妆 & 护肤"), false);
  assert.equal(data.isCreatorSearchPage(`${search}&keyword=美妆`, "美妆 & 护肤"), false);
});

test("用户结果仅提取公开字段，兼容 snake/camel 包装并去重", () => {
  const creators = data.extractCreators({ data: { users: [
    row(USER_A, "1.2万", { user_info: { user_id: USER_A, nickname: "美妆达人", avatar: "https://sns-avatar.xhscdn.com/a.jpg", desc: "公开简介", private_phone: "never-export" } }),
    { userInfo: { userId: USER_B, nickName: "穿搭达人", fansCount: 2000, redId: "public-red-id" } },
    row(USER_A, "1.3万"),
    row(USER_C, undefined),
    row("masked-user", 0),
    { model_type: "note", user_info: { user_id: USER_C } },
  ] } });
  assert.equal(creators.length, 3);
  assert.equal(creators[0].followers, 13000);
  assert.equal(creators[0].avatarUrl, "https://sns-avatar.xhscdn.com/a.jpg");
  assert.equal(creators[1].followers, 2000);
  assert.equal(creators[1].redId, "public-red-id");
  assert.equal(creators[2].followers, null);
  assert.equal(JSON.stringify(creators).includes("never-export"), false);
  assert.equal(data.normalizeCreator({ userId: USER_A, profileUrl: `https://www.xiaohongshu.com/user/profile/${USER_B}` }), null);
  assert.equal(data.normalizeCreator({ userId: USER_A, avatarUrl: "https://evil.test/track" }).avatarUrl, "");
  assert.equal(data.normalizeCreator({ userId: USER_A, followers: "粉丝 1.2万", followerLabel: "粉丝 1.2万" }).followerLabel, "1.2万");
  assert.equal(data.normalizeCreator({ userId: USER_A, followers: 12001, followerLabel: "1.2万" }).followerLabel, "12001");
  assert.equal(data.normalizeCreator({ userId: USER_A, official_verify_type: -1 }).verified, false);
  assert.equal(data.normalizeCreator({ userId: USER_A, official_verify_type: 1 }).verified, true);
  assert.match(data.normalizeCreator({ userId: USER_A, xsecToken: "public-token" }).profileUrl, /xsec_token=public-token/);
});

test("主页校验拒绝错人、站外、明文、凭据与任意协议，仅保留公开导航 token", () => {
  const creator = { userId: USER_A, profileUrl: `${ORIGIN}/user/profile/${USER_A}?xsec_token=public-search-token&redirect=https://evil.test`, nickname: "达人" };
  assert.equal(data.validateCreator(creator).profileUrl, `${ORIGIN}/user/profile/${USER_A}?xsec_token=public-search-token&xsec_source=pc_search`);
  for (const profileUrl of [
    `${ORIGIN}/user/profile/${USER_B}`, `http://www.xiaohongshu.com/user/profile/${USER_A}`,
    `https://evil.test/user/profile/${USER_A}`, `${ORIGIN}:8443/user/profile/${USER_A}`,
    `https://user:pass@www.xiaohongshu.com/user/profile/${USER_A}`, "javascript:alert(1)",
    `${ORIGIN}/user/profile/${USER_A}#javascript`,
  ]) assert.throws(() => data.validateCreator({ userId: USER_A, profileUrl }));
});

test("被动搜索网络和 DOM 合并去重，精确范围筛选，释放账号互斥锁", async () => {
  const api = fixture({
    rows: [{ userId: USER_A, nickname: "DOM 达人", followers: null, profileUrl: `${ORIGIN}/user/profile/${USER_A}` }, { userId: USER_C, nickname: "未知粉丝" }],
    load: async (_url, host) => {
      const requestId = host.request({ url: `${API}?keyword=${encodeURIComponent("美妆")}` });
      host.respond(requestId, { data: { users: [row(USER_A, 12000), row(USER_B, 500)] } });
      await pause();
    },
  });
  const started = await api.service.search("account-a", { keyword: "美妆", minFollowers: 1000, maxFollowers: 50000 });
  assert.equal(started.active, true);
  assert.equal(api.context.operation.kind, "creator-search");
  await assert.rejects(api.service.search("account-a", { keyword: "美妆" }), /正在查找/);
  await api.service.waitForIdle("account-a");
  const done = api.service.getState("account-a");
  assert.equal(done.phase, "completed", done.message);
  assert.equal(done.creators.length, 1);
  assert.equal(done.creators[0].followers, 12000);
  assert.equal(done.scanned, 3);
  assert.equal(done.candidates, 3);
  assert.equal(done.checked, 3);
  assert.equal(done.stage, "done");
  assert.equal(done.creators[0].relevance.status, "matched");
  assert.equal(api.context.operation.active, false);
  assert.deepEqual(api.events.filter((event) => "throttle" in event).map((event) => event.throttle), [false, true]);
  assert.equal(api.debuggerApi.listenerCount("message"), 0);
  assert.equal(api.contents.listenerCount("did-navigate"), 0);
  assert.ok(done.revision > started.revision);
  assert.ok(api.events.filter((event) => event.progress).every((event) => event.progress.accountId === "account-a"));
});

test("综合笔记响应只提取作者候选，搜索命中文本和昵称不能代替主页证据", async () => {
  const api = fixture({
    load: async (_url, host) => {
      const requestId = host.request({ url: NOTES_API, method: "POST", postData: '{"keyword":"美妆"}' });
      host.respond(requestId, { data: { items: [
        { id: NOTE_A, model_type: "note", note_card: { display_title: "美妆领域专家", desc: "美妆", user: { user_id: USER_A, nickname: "美妆", desc: "专注美妆", tags: ["美妆"] } } },
        { id: NOTE_A, model_type: "note", note_card: { user: { user_id: USER_A } } },
      ] } }, { response: { url: NOTES_API, status: 200, mimeType: "application/json" } });
      await pause();
    },
    profile: (userId) => ({
      pageMatches: true, profileReady: true, userId, authoredConfirmed: true,
      creator: { userId, profileUrl: data.publicProfileUrl(userId), description: "", tags: [], followers: 5000 },
      notes: [{ id: NOTE_A, title: "偶尔买了一支美妆口红", authorId: userId, source: "profile" }],
    }),
  });
  await api.service.search("account-a", { keyword: "美妆" });
  await api.service.waitForIdle("account-a");
  const done = api.service.getState("account-a");
  assert.equal(done.phase, "completed");
  assert.equal(done.candidates, 1);
  assert.equal(done.checked, 1);
  assert.equal(done.creators.length, 0);
  assert.equal(done.insufficient + done.rejected, 1);
});

test("主页证据严格归属、去重、八条封顶，不接受收藏/未知作者/已置顶样本", () => {
  const value = {
    pageMatches: true, profileReady: true, userId: USER_A, authoredConfirmed: true,
    creator: { userId: USER_A, profileUrl: data.publicProfileUrl(USER_A) },
    notes: [
      { id: NOTE_A, title: "重复笔记", authorId: USER_A, source: "profile" },
      { id: NOTE_A, title: "重复笔记", authorId: USER_A, source: "profile" },
      { id: USER_B, title: "错作者", authorId: USER_B, source: "profile" },
      { id: USER_C, title: "收藏", authorId: USER_A, source: "favorites" },
      { id: "65b200000000000000000099", title: "旧置顶", authorId: USER_A, source: "profile", pinned: true },
      ...Array.from({ length: 12 }, (_value, index) => ({
        id: `65b2000000000000000000${String(index + 10).padStart(2, "0")}`, title: `原创${index}`, authorId: USER_A, source: "profile",
      })),
    ],
  };
  assert.equal(data.normalizeProfileEvidence(value, USER_A).notes.length, 8);
  assert.equal(data.normalizeProfileEvidence({ ...value, authoredConfirmed: false }, USER_A).notes.length, 0);
  assert.equal(data.normalizeProfileEvidence({ ...value, userId: USER_B }, USER_A), null);
  assert.equal(data.normalizeProfileEvidence({ ...value, creator: { userId: USER_B } }, USER_A), null);
});

test("主页未知粉丝与空简介/标签不回退搜索候选，范围筛选不能静默通过", async () => {
  const api = fixture({
    rows: [{ userId: USER_A, followers: 12000, description: "专注美妆", tags: ["美妆"] }],
    profile: (userId) => ({
      pageMatches: true, profileReady: true, userId, authoredConfirmed: true,
      creator: { userId, profileUrl: data.publicProfileUrl(userId), followers: null, description: "", tags: [] },
      notes: ["美妆底妆教程", "美妆口红测评", "彩妆眼妆教程"].map((title, index) => ({
        id: `65b20000000000000000000${index + 1}`, title, authorId: userId, source: "profile",
      })),
    }),
  });
  await api.service.search("account-a", { keyword: "美妆", minFollowers: 1000 });
  await api.service.waitForIdle("account-a");
  const done = api.service.getState("account-a");
  assert.equal(done.creators.length, 0);
  assert.equal(done.checked, 1);
  assert.equal(done.rejected, 1);
});

test("主页核验中可取消，迟到的公开证据不能进入已停止或其他账号结果", async () => {
  const pendingProfile = deferred();
  const requestedProfile = deferred();
  const api = fixture({
    rows: [{ userId: USER_A }],
    profile: async () => { requestedProfile.resolve(); return pendingProfile.promise; },
  });
  await api.service.search("account-a", { keyword: "美妆" });
  await requestedProfile.promise;
  assert.equal(api.service.getState("account-a").stage, "checking");
  api.service.stop("account-a");
  await api.service.waitForIdle("account-a");
  assert.equal(api.context.operation.active, false);
  pendingProfile.resolve({
    pageMatches: true, profileReady: true, userId: USER_A, authoredConfirmed: true,
    creator: { userId: USER_A, description: "美妆", tags: ["美妆"] }, notes: [],
  });
  await pause();
  assert.equal(api.service.getState("account-a").creators.length, 0);
  assert.equal(api.service.getState("account-b").creators.length, 0);
  assert.equal(api.service.getState("account-a").checked, 0);
});

test("POST 请求体关键词校验、错误 frame/loader/页面及旧响应全部排除", async () => {
  const api = fixture({
    load: async (_url, host) => {
      const noKeyword = host.request({ url: API, method: "POST", postData: '{"page":1}' });
      host.respond(noKeyword, { data: { users: [row(USER_B, 9000)] } }, { response: { url: API, status: 200, mimeType: "application/json" } });
      const otherKeyword = host.request({ url: API, method: "POST", postData: '{"keyword":"穿搭"}' });
      host.respond(otherKeyword, { data: { users: [row(USER_B, 9000)] } }, { response: { url: API, status: 200, mimeType: "application/json" } });
      const foreignFrame = host.request({ url: `${API}?keyword=${encodeURIComponent("美妆")}` }, { frameId: "iframe" });
      host.respond(foreignFrame, { data: { users: [row(USER_B, 9000)] } });
      const foreignLoader = host.request({ url: `${API}?keyword=${encodeURIComponent("美妆")}` }, { loaderId: "old-loader" });
      host.respond(foreignLoader, { data: { users: [row(USER_B, 9000)] } });
      const oldDocument = host.request({ url: `${API}?keyword=${encodeURIComponent("美妆")}` }, { documentURL: data.searchUrl("穿搭") });
      host.respond(oldDocument, { data: { users: [row(USER_B, 9000)] } });
      const matching = host.request({ url: API, method: "POST", postData: '{"keyword":"美妆"}' });
      host.respond(matching, { data: { users: [row(USER_A, 1234)] } }, { response: { url: API, status: 200, mimeType: "application/json" } });
      await pause();
    },
  });
  await api.service.search("account-a", { keyword: "美妆" });
  await api.service.waitForIdle("account-a");
  assert.deepEqual(api.service.getState("account-a").creators.map((creator) => creator.userId), [USER_A]);
  assert.equal(api.requests.filter((request) => request.command === "Network.getResponseBody").length, 1);
});

test("慢的正常搜索请求不会被短时间无新 DOM 结果判定结束", async () => {
  const pendingBody = deferred();
  const api = fixture({
    rows: [],
    load: async (_url, host) => {
      const requestId = host.request({ url: `${API}?keyword=${encodeURIComponent("美妆")}` });
      setTimeout(() => {
        host.respond(requestId, { data: { users: [row(USER_A, 2000)] } });
        pendingBody.resolve();
      }, 40);
    },
  });
  await api.service.search("account-a", { keyword: "美妆" });
  await pause(25);
  assert.equal(api.service.getState("account-a").active, true);
  await pendingBody.promise;
  await api.service.waitForIdle("account-a");
  assert.equal(api.service.getState("account-a").creators.length, 1);
});

test("停止加载与慢响应可立即取消、释放锁且不发布陈旧结果", async () => {
  const body = deferred();
  const bodyRequested = deferred();
  const api = fixture({
    body: async () => { bodyRequested.resolve(); return body.promise; },
    load: async (_url, host) => {
      const requestId = host.request({ url: `${API}?keyword=${encodeURIComponent("美妆")}` });
      host.respond(requestId, {});
    },
  });
  await api.service.search("account-a", { keyword: "美妆" });
  await bodyRequested.promise;
  const oldRun = api.service.getState("account-a").runId;
  api.service.stop("account-a");
  await api.service.waitForIdle("account-a");
  assert.equal(api.service.getState("account-a").phase, "stopped");
  assert.equal(api.context.operation.active, false);
  body.resolve({ body: JSON.stringify({ data: { users: [row(USER_B, 9999)] } }) });
  await pause();
  assert.deepEqual(api.service.getState("account-a").creators, []);
  await api.service.search("account-a", { keyword: "美妆" });
  assert.notEqual(api.service.getState("account-a").runId, oldRun);
  api.service.stop("account-a");
  await api.service.waitForIdle("account-a");
  assert.equal(api.debuggerApi.listenerCount("message"), 0);

  const navigation = deferred();
  const hanging = fixture({ load: () => navigation.promise });
  await hanging.service.search("account-a", { keyword: "美妆" });
  await pause();
  hanging.service.stop("account-a");
  await hanging.service.waitForIdle("account-a");
  assert.equal(hanging.context.operation.active, false);
  assert.ok(hanging.events.some((event) => event.stopped));
  navigation.resolve();
});

test("任务初始失败、渲染失败、导航离开和平台限制均释放锁", async () => {
  const cases = [
    { serviceOptions: { ensureNetworkCapture: async () => { throw new Error("attach failed"); } } },
    { load: async () => { throw new Error("navigation failed"); } },
    { execute: async () => { throw new Error("renderer failed"); } },
    { load: async (_url, host) => host.setUrl(data.searchUrl("穿搭")) },
    { load: async (_url, host) => {
      const requestId = host.request({ url: `${API}?keyword=${encodeURIComponent("美妆")}` });
      host.respond(requestId, {}, { response: { url: `${API}?keyword=${encodeURIComponent("美妆")}`, status: 429, mimeType: "application/json" } });
    } },
  ];
  for (const options of cases) {
    const api = fixture(options);
    await api.service.search("account-a", { keyword: "美妆" });
    await api.service.waitForIdle("account-a");
    assert.equal(api.service.getState("account-a").phase, "paused");
    assert.equal(api.context.operation.active, false);
    assert.equal(api.debuggerApi.listenerCount("message"), 0);
  }
  const throttled = fixture({ throttleError: true });
  await assert.rejects(throttled.service.search("account-a", { keyword: "美妆" }), /throttle failure/);
  assert.equal(throttled.context.operation.active, false);
});

test("采集、待开始采集、其他操作互斥且不改写他人的锁", async () => {
  for (const change of [
    (context) => { context.capture.active = true; },
    (context) => { context.capture.pendingStartRunId = "capture"; },
    (context) => { context.operation = { active: true, kind: "direct-message" }; },
  ]) {
    const api = fixture();
    change(api.context);
    const before = api.context.operation;
    await assert.rejects(api.service.search("account-a", { keyword: "美妆" }), /正在采集或执行/);
    assert.equal(api.context.operation, before);
  }
  const api = fixture({ load: async () => pause(20) });
  await api.service.search("account-a", { keyword: "美妆" });
  const replacement = { active: true, kind: "another-operation" };
  api.context.operation = replacement;
  await api.service.waitForIdle("account-a");
  assert.equal(api.context.operation, replacement);
});

test("disposed=true 后也可清理所有后台任务，不重新读取账号上下文", async () => {
  const pending = deferred();
  const api = fixture({ load: () => pending.promise });
  await api.service.search("account-a", { keyword: "美妆" });
  await pause();
  api.context.disposed = true;
  await api.service.dispose("account-a");
  assert.equal(api.context.operation.active, false);
  assert.equal(api.debuggerApi.listenerCount("message"), 0);
  assert.equal(api.service.getState("account-a").phase, "idle");
  pending.resolve();
});

test("私信入口仅打开并确认同一达人会话，允许安全恢复的公开达人卡片", async () => {
  const api = fixture();
  const result = await api.service.openConversation("account-a", { userId: USER_A, nickname: "达人", profileUrl: `${ORIGIN}/user/profile/${USER_A}` });
  assert.equal(result.status, "opened");
  assert.equal(result.url, api.contents.getURL());
  assert.equal(api.context.operation.active, false);
  assert.ok(api.scripts.some((script) => script.includes("function openConversation(")));
  assert.ok(api.scripts.some((script) => script.includes("function confirmConversation(")));
  assert.ok(api.scripts.every((script) => !script.includes("function prepareMessage(") && !script.includes("function submitMessage(")
    && !script.includes('execCommand("insertText"') && !script.includes('dispatchEvent(new InputEvent')));
  assert.equal(api.events.filter((event) => event.navigation).length, 1);
});

test("入口点击成功但错误收件人、限制、错页和取消不报告私信已打开", async () => {
  for (const options of [
    { execute: async (script) => script.includes("function openConversation(") ? { status: "opened" } : { status: "waiting", userId: USER_B } },
    { execute: async () => ({ status: "paused", reason: "平台限制" }) },
    { load: async (_url, host) => host.setUrl(`${ORIGIN}/user/profile/${USER_B}`) },
  ]) {
    const api = fixture(options);
    await assert.rejects(api.service.openConversation("account-a", { userId: USER_A, profileUrl: `${ORIGIN}/user/profile/${USER_A}` }));
    assert.equal(api.context.operation.active, false);
  }
  const waiting = fixture({ execute: async (script) => script.includes("function openConversation(") ? { status: "opened" } : { status: "waiting" } });
  const job = waiting.service.openConversation("account-a", { userId: USER_A, profileUrl: `${ORIGIN}/user/profile/${USER_A}` });
  await pause();
  waiting.service.stop("account-a");
  await assert.rejects(job, /取消/);
  assert.equal(waiting.context.operation.active, false);
});
