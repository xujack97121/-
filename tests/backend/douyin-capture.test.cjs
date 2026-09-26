const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { EventEmitter } = require("node:events");
const { AccountRegistry, partitionForAccount } = require("../../backend/accounts/account-registry.cjs");
const { platformHome, douyinVideoId, douyinVideoUrl, isPlatformPage, douyinResponseScope } = require("../../backend/platform/content-platforms.cjs");
const { normalizeDouyinCapture, DOUYIN_PAGE_STATE_SCRIPT, DOUYIN_COMMENT_SCROLL_SCRIPT } = require("../../backend/capture/douyin-capture.cjs");

const VIDEO = "7520000000000000001";
const OTHER = "7520000000000000002";
const URL_VIDEO = `https://www.douyin.com/video/${VIDEO}`;
const COMMENTS_URL = `https://www.douyin.com/aweme/v1/web/comment/list/?aweme_id=${VIDEO}`;
const row = (id, extra = {}) => ({
  cid: id, aweme_id: VIDEO, text: "测试公开评论", user: { uid: "1234567890123456789", nickname: "测试用户" },
  create_time: 1720000000, digg_count: 18, reply_comment_total: 3, ip_label: "IP属地：上海", ...extra,
});

test("Douyin URLs are canonical, exact-platform and preserve long IDs", () => {
  assert.equal(platformHome("douyin"), "https://www.douyin.com/");
  assert.equal(douyinVideoId(URL_VIDEO), VIDEO);
  assert.equal(douyinVideoUrl(`https://www.douyin.com/user/test?modal_id=${VIDEO}`), URL_VIDEO);
  assert.equal(douyinVideoUrl(`https://www.douyin.com/?modal_id=${VIDEO}`), URL_VIDEO);
  for (const url of [
    `http://www.douyin.com/video/${VIDEO}`, `https://www.douyin.com.evil.test/video/${VIDEO}`,
    `https://www.douyin.com@evil.test/video/${VIDEO}`, `https://user@www.douyin.com/video/${VIDEO}`,
    `https://www.douyin.com:444/video/${VIDEO}`, `https://www.douyin.com/video/${VIDEO}?modal_id=${OTHER}`,
    `https://www.douyin.com/search/test?modal_id=${VIDEO}`, "https://v.douyin.com/example/",
  ]) assert.equal(douyinVideoId(url), "", url);
  assert.equal(isPlatformPage(URL_VIDEO, "xhs"), false);
  assert.equal(isPlatformPage(`https://www.xiaohongshu.com/explore/${VIDEO}`, "douyin"), false);
  assert.equal(isPlatformPage("https://login.douyin.com/", "douyin"), true);
  assert.equal(isPlatformPage("https://douyin.com.evil.test/", "douyin"), false);
});

test("Only responses belonging to the selected video or known parent are admitted", () => {
  assert.equal(douyinResponseScope(COMMENTS_URL, VIDEO), "comments");
  assert.equal(douyinResponseScope(COMMENTS_URL, OTHER), "");
  assert.equal(douyinResponseScope(COMMENTS_URL.replace("/comment/list/", "/feed/"), VIDEO), "");
  const reply = "https://www.douyin.com/aweme/v1/web/comment/list/reply/?comment_id=123";
  assert.equal(douyinResponseScope(reply, VIDEO), "");
  assert.equal(douyinResponseScope(reply, VIDEO, new Set(["123"])), "replies");
  assert.equal(douyinResponseScope(`${reply}&aweme_id=${OTHER}`, VIDEO, new Set(["123"])), "");
});

test("Normalize public comments, replies and metrics without losing precision or fabricating values", () => {
  const child = row("7530000000000000002", { digg_count: undefined, reply_comment_total: null });
  const capture = normalizeDouyinCapture(COMMENTS_URL, { comments: [
    row("7530000000000000001", { reply_comment: [child] }),
    row("7530000000000000001"), row("7530000000000000003", { aweme_id: OTHER }),
    row(Number("7530000000000000004")), row("7530000000000000005", { create_time: 1e30, text: "", image_list: [{}] }),
  ] }, VIDEO);
  assert.equal(capture.comments.length, 3);
  assert.equal(capture.comments[0].id, "7530000000000000001");
  assert.equal(capture.comments[0].platform, "douyin");
  assert.equal(capture.comments[0].authorId, "1234••••789");
  assert.equal(capture.comments[0].region, "上海");
  assert.equal(capture.comments[0].likes, 18);
  assert.equal(capture.comments[1].parentId, "7530000000000000001");
  assert.equal(capture.comments[1].likes, null);
  assert.equal(capture.comments[1].replyCount, null);
  assert.equal(capture.comments[2].time, "");
  assert.equal(capture.comments[2].content, "");
  assert.equal(normalizeDouyinCapture(COMMENTS_URL, { status_code: 8, comments: [row("123")] }, VIDEO).comments.length, 0);
  assert.ok(normalizeDouyinCapture(COMMENTS_URL, { status_code: 8 }, VIDEO).blocked);
  const url = `https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=${VIDEO}`;
  assert.equal(normalizeDouyinCapture(url, { aweme_detail: { aweme_id: OTHER } }, VIDEO).notes.length, 0);
  const video = normalizeDouyinCapture(url, { aweme_detail: { aweme_id: VIDEO, desc: "测试视频", create_time: 1e30 } }, VIDEO).notes[0];
  assert.equal(video.title, "测试视频");
  assert.equal(video.time, "");
  assert.equal(video.link, URL_VIDEO);
});

test("Old XHS sessions stay unchanged; new Douyin sessions persist independently", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "douyin-accounts-test-"));
  const id = "11111111-1111-4111-8111-111111111111";
  const second = "22222222-2222-4222-8222-222222222222";
  try {
    const filePath = path.join(root, "accounts.json");
    fs.writeFileSync(filePath, JSON.stringify({ accounts: [{ id, name: "原账号" }], activeAccountId: id }));
    const registry = new AccountRegistry({ filePath, idFactory: () => second });
    await registry.load();
    assert.equal(registry.get(id).platform, "xhs");
    assert.equal(registry.get(id).partition, `persist:xhs-multi-account-${id}`);
    await assert.rejects(registry.add("无效平台", "unknown"));
    await registry.add("抖音账号", "douyin");
    await registry.rename(second, "重命名抖音");
    assert.equal(registry.get(second).partition, partitionForAccount(second, "douyin"));
    const restored = new AccountRegistry({ filePath });
    await restored.load();
    assert.equal(restored.get(second).platform, "douyin");
    assert.notEqual(restored.get(second).partition, restored.get(id).partition);
    assert.equal(JSON.stringify(restored.list()).includes("partition"), false);
  } finally {
    assert.ok(root.startsWith(path.join(os.tmpdir(), "douyin-accounts-test-")));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function harness(platform = "douyin") {
  const filename = path.resolve(__dirname, "../../backend/main.cjs");
  const localRequire = createRequire(filename);
  const messages = [];
  const electron = {
    app: { setName() {}, requestSingleInstanceLock: () => false, quit() {}, on() {}, isPackaged: false },
    ipcMain: { handle() {}, on() {} },
  };
  const sandbox = {
    require: (name) => name === "electron" ? electron : localRequire(name),
    __dirname: path.dirname(filename), process, Buffer, URL, Set, Map, console,
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {}, testPlatform: platform,
  };
  vm.createContext(sandbox);
  vm.runInContext(`${fs.readFileSync(filename, "utf8")}
    globalThis.testApi = { startTask, scrollOneStep, wireBrowserEvents, readResponseBody, makeCaptureState, publishCapturePayload, attachNetworkCapture };
    mainWindow = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: (channel, payload) => testMessages.push({ channel, payload }) } };
    accountRegistry = { get: id => ({ id, platform: testPlatform }), list: () => [] };
  `, Object.assign(sandbox, { testMessages: messages }), { filename });
  let url = platformHome(platform);
  const contents = Object.assign(new EventEmitter(), {
    isDestroyed: () => false, getURL: () => url, getTitle: () => "", isLoading: () => false,
    setBackgroundThrottling() {}, setWindowOpenHandler() {},
    loadURL: async (next) => { contents.emit("did-start-loading"); url = next; contents.emit("did-navigate", {}, url); contents.emit("did-finish-load"); },
    executeJavaScript: async (script) => script === DOUYIN_PAGE_STATE_SCRIPT ? { blocked: "" } : { waiting: true },
    debugger: Object.assign(new EventEmitter(), { isAttached: () => true, sendCommand: async () => ({ body: JSON.stringify({ comments: [row("7530000000000000001")] }) }) }),
  });
  const context = {
    id: `mock-${platform}-account`, platform, capture: { ...sandbox.testApi.makeCaptureState(), navigationStarted: true },
    operation: { active: false }, view: { webContents: contents }, navigation: {}, pendingResponses: new Map(),
    identity: { state: "unknown" },
  };
  return { ...sandbox.testApi, context, contents, messages, setUrl: (value) => { url = value; } };
}

test("Embedded redirects do not stop either platform or discard its pending capture responses", () => {
  for (const platform of ["xhs", "douyin"]) {
    for (const modern of [false, true]) {
      const h = harness(platform);
      h.wireBrowserEvents(h.context);
      h.context.capture.active = true;
      h.context.capture.runId = "redirect-fixture";
      h.context.pendingResponses.set("pending", { runId: "redirect-fixture" });
      let prevented = false;
      const event = { preventDefault() { prevented = true; } };
      const url = "https://embedded.example/ready?token=private-fixture";
      if (modern) {
        Object.assign(event, { url, isMainFrame: false });
        h.contents.emit("will-redirect", event);
      } else h.contents.emit("will-redirect", event, url, false, false);
      assert.equal(prevented, false, `${platform}: let the embedded page load normally`);
      assert.equal(h.context.capture.active, true);
      assert.equal(h.context.capture.runId, "redirect-fixture");
      assert.equal(h.context.pendingResponses.has("pending"), true);
      assert.equal(h.messages.some((item) => item.payload.phase === "stopped"), false);
    }
  }
});

test("Main-frame redirects accept both current event details and legacy arguments without weakening platform boundaries", () => {
  for (const platform of ["xhs", "douyin"]) {
    for (const modern of [false, true]) {
      for (const allowed of [false, true]) {
        const h = harness(platform);
        h.wireBrowserEvents(h.context);
        h.context.capture.active = true;
        h.context.capture.runId = "main-redirect-fixture";
        let prevented = false;
        const url = allowed ? `${platformHome(platform)}?fixture=allowed`
          : "https://outside.example/login?token=private-fixture";
        const event = { preventDefault() { prevented = true; } };
        if (modern) {
          Object.assign(event, { url, isMainFrame: true });
          h.contents.emit("will-redirect", event);
        } else h.contents.emit("will-redirect", event, url, false, true);
        assert.equal(prevented, !allowed);
        assert.equal(h.context.capture.active, allowed);
        if (!allowed) {
          const stopped = h.messages.find((item) => item.channel === "collector:status" && item.payload.phase === "error");
          assert.match(stopped.payload.message, /outside\.example/);
          assert.equal(stopped.payload.message.includes("private-fixture"), false, "Do not display URL tokens");
        }
      }
    }
  }
});

test("Unknown frame metadata remains fail-closed for external redirects", () => {
  const h = harness("xhs");
  h.wireBrowserEvents(h.context);
  h.context.capture.active = true;
  h.context.capture.runId = "unknown-frame";
  let prevented = false;
  h.contents.emit("will-redirect", { preventDefault() { prevented = true; } }, "https://outside.example/");
  assert.equal(prevented, true);
  assert.equal(h.context.capture.active, false);
});

test("Navigation starts on the intended video; leaving it stops the run, and stale responses cannot enter a new run", async () => {
  const h = harness();
  h.wireBrowserEvents(h.context);
  await h.startTask(h.context, { kind: "comments", url: URL_VIDEO, target: 2 });
  assert.equal(h.context.capture.active, true, "The old home URL during loading must not cancel the new task");
  const runId = h.context.capture.runId;
  await h.readResponseBody(h.context, "request", { runId, noteId: VIDEO, kind: "comments", url: COMMENTS_URL });
  assert.equal(h.context.capture.seenComments.size, 1);
  assert.equal(h.messages.filter((item) => item.channel === "collector:capture").length, 1);
  await h.startTask(h.context, { kind: "comments", url: URL_VIDEO, target: 2 });
  await h.readResponseBody(h.context, "old", { runId, noteId: VIDEO, kind: "comments", url: COMMENTS_URL });
  assert.equal(h.context.capture.seenComments.size, 0);
  h.setUrl(`https://www.douyin.com/video/${OTHER}`);
  h.contents.emit("did-navigate-in-page", {}, h.contents.getURL(), true);
  assert.equal(h.context.capture.active, false);
  await assert.rejects(h.startTask(h.context, { kind: "notes", url: URL_VIDEO }), /仅支持/);
  await assert.rejects(h.startTask(h.context, { kind: "comments", url: "https://www.xiaohongshu.com/" }), /不匹配/);
});

test("Visible login or verification pauses instead of scrolling; no global video feed scroll is used", async () => {
  const h = harness();
  await h.startTask(h.context, { kind: "comments", url: URL_VIDEO });
  let scrolls = 0;
  h.contents.executeJavaScript = async (script) => {
    if (script === DOUYIN_PAGE_STATE_SCRIPT) return { blocked: "请在左侧完成安全验证" };
    scrolls++;
    return {};
  };
  await h.scrollOneStep(h.context, h.context.capture.runId);
  assert.equal(h.context.capture.active, false);
  assert.equal(scrolls, 0);
  assert.ok(h.messages.some((item) => item.payload.message === "请在左侧完成安全验证"));
  assert.equal(DOUYIN_COMMENT_SCROLL_SCRIPT.includes("document.scrollingElement"), false);
});

test("XHS old search links are canonicalized and network listening is ready before navigation", async () => {
  const h = harness("xhs");
  const events = [];
  h.contents.debugger.sendCommand = async () => { events.push("listening"); };
  h.contents.loadURL = async (url) => { events.push(url); h.setUrl(url); };
  const result = await h.startTask(h.context, { kind: "notes", url: "https://www.xiaohongshu.com/search_result?keyword=fixture" });
  assert.equal(events[0], "listening");
  assert.equal(events[1], "https://www.xiaohongshu.com/search_result/?keyword=fixture");
  assert.equal(result.active, true);
  assert.equal(h.context.capture.navigationStarted, true);
});

test("failure to attach the listener cannot start an unobserved capture", async () => {
  const h = harness("xhs");
  let navigated = false;
  h.contents.debugger.sendCommand = async () => { throw new Error("private diagnostic"); };
  h.contents.loadURL = async () => { navigated = true; };
  await assert.rejects(h.startTask(h.context, { kind: "notes", url: "https://www.xiaohongshu.com/search_result?keyword=fixture" }), /网络监听启动失败/);
  assert.equal(navigated, false);
  assert.equal(h.context.capture.active, false);
  assert.equal(h.messages.some((item) => String(item.payload.message).includes("private")), false);
});

test("a cancelled old navigation cannot stop a newer capture run", async () => {
  const h = harness("xhs");
  let rejectOld;
  h.contents.loadURL = (url) => {
    if (url.includes("keyword=old")) return new Promise((_resolve, reject) => { rejectOld = reject; });
    h.setUrl(url);
    return Promise.resolve();
  };
  const old = h.startTask(h.context, { kind: "notes", url: "https://www.xiaohongshu.com/search_result?keyword=old" }).catch((error) => error);
  for (let i = 0; i < 20 && !rejectOld; i++) await Promise.resolve();
  assert.ok(rejectOld);
  const next = await h.startTask(h.context, { kind: "notes", url: "https://www.xiaohongshu.com/search_result?keyword=new" });
  rejectOld(Object.assign(new Error("private URL token"), { code: "ERR_ABORTED" }));
  assert.match((await old).message, /新任务替换/);
  assert.equal(h.context.capture.active, true);
  assert.equal(h.context.capture.runId, next.runId);
  assert.equal(h.messages.some((item) => item.payload.phase === "error" && item.payload.runId === next.runId), false);
});

test("XHS pending requests cannot move from an old run or unrelated feed into a new run", async () => {
  const h = harness("xhs");
  const api = "https://edith.xiaohongshu.com/api/sns/web/v1/search/notes";
  const emit = (method, params) => h.contents.debugger.emit("message", {}, method, params);
  await h.startTask(h.context, { kind: "notes", url: "https://www.xiaohongshu.com/search_result?keyword=old" });
  emit("Network.requestWillBeSent", { requestId: "old", request: { url: api } });
  assert.equal(h.context.requestRuns.size, 1);
  await h.startTask(h.context, { kind: "notes", url: "https://www.xiaohongshu.com/search_result?keyword=new" });
  emit("Network.responseReceived", { requestId: "old", response: { url: api, status: 200 } });
  assert.equal(h.context.pendingResponses.size, 0);
  const feed = "https://edith.xiaohongshu.com/api/sns/web/v1/homefeed";
  emit("Network.requestWillBeSent", { requestId: "feed", request: { url: feed } });
  emit("Network.responseReceived", { requestId: "feed", response: { url: feed, status: 200 } });
  assert.equal(h.context.requestRuns.size, 0);
  assert.equal(h.context.pendingResponses.size, 0);
  emit("Network.requestWillBeSent", { requestId: "new", request: { url: api } });
  emit("Network.responseReceived", { requestId: "new", response: { url: api, status: 200 } });
  assert.equal(h.context.pendingResponses.get("new").runId, h.context.capture.runId);
});
