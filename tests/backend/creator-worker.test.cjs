const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createCreatorWorkerFactory, isTaskUrl } = require("../../backend/creators/creator-worker.cjs");

function fixture(options = {}) {
  const windows = [];
  class MockWindow extends EventEmitter {
    constructor(settings) {
      super();
      this.settings = settings;
      this.destroyed = false;
      this.visible = false;
      this.focusCount = 0;
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, {
        session: settings.webPreferences.session,
        isDestroyed: () => this.destroyed,
        getURL: () => this.url,
        setAudioMuted: (value) => { this.muted = value; },
        setUserAgent: (value) => { this.userAgent = value; },
        setWindowOpenHandler: (handler) => { this.openHandler = handler; },
        loadURL: (url) => {
          this.url = url;
          if (options.initializationError) throw new Error("initialization failed");
          return options.ready || Promise.resolve();
        },
      });
      windows.push(this);
    }
    setMenu(value) { this.menu = value; }
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    setSkipTaskbar(value) { this.skipTaskbar = value; }
    show() { this.visible = true; }
    focus() { this.focusCount += 1; }
    hide() { this.visible = false; }
    destroy() { this.destroyed = true; this.webContents.emit("destroyed"); }
  }
  const context = { id: "isolated-account", session: {}, disposed: false, view: { webContents: { getUserAgent: () => "fixture-user-agent" } } };
  const factory = createCreatorWorkerFactory({ BrowserWindow: MockWindow });
  return { factory, context, windows };
}

test("worker 使用账号原 session 但独立隐藏 BrowserWindow，硬化偏好且不接触前台 contents", async () => {
  const { factory, context, windows } = fixture();
  const worker = factory(context);
  await worker.ready;
  const window = windows[0];
  assert.equal(window.settings.show, false);
  assert.equal(window.settings.webPreferences.session, context.session);
  assert.notEqual(worker.contents, context.view.webContents);
  assert.equal(window.settings.webPreferences.sandbox, true);
  assert.equal(window.settings.webPreferences.contextIsolation, true);
  assert.equal(window.settings.webPreferences.nodeIntegration, false);
  assert.equal(window.settings.webPreferences.backgroundThrottling, false);
  assert.equal(window.settings.webPreferences.webSecurity, true);
  assert.equal(window.muted, true);
  assert.equal(window.userAgent, "fixture-user-agent");
  assert.equal(window.url, "about:blank");
  assert.equal(window.visible, false);
  assert.equal(window.focusCount, 0);
  assert.equal(worker.canReuse(), true);
  assert.deepEqual(window.openHandler({ url: "https://evil.test" }), { action: "deny" });
  worker.close();
});

test("任务检查窗口只在显式show时显示，关闭按钮隐藏保留原页面，dispose才销毁", () => {
  const { factory, context, windows } = fixture();
  const worker = factory(context);
  const window = windows[0];
  window.url = "https://www.xiaohongshu.com/search_result/?keyword=test";
  worker.show();
  assert.equal(worker.canReuse(), false, "A future explicit search replaces an inspected window so native background rendering remains enabled");
  assert.equal(window.visible, true);
  assert.equal(window.focusCount, 1);
  let prevented = false;
  window.emit("close", { preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(window.visible, false);
  assert.equal(worker.isDestroyed(), false);
  assert.equal(window.url, "https://www.xiaohongshu.com/search_result/?keyword=test");
  worker.show();
  worker.hide();
  assert.equal(window.visible, false);
  worker.close();
  worker.close();
  assert.equal(worker.isDestroyed(), true);
  assert.equal(worker.contents.listenerCount("will-navigate"), 0);
  assert.equal(worker.contents.listenerCount("will-redirect"), 0);
  assert.throws(() => worker.show(), /已关闭/);
});

test("worker采用账号session的HTTPS升级导航约定，拒绝站外重定向但不干预子frame", () => {
  for (const value of ["https://www.xiaohongshu.com/", "http://www.xiaohongshu.com/", "https://xiaohongshu.com/", "https://edith.xiaohongshu.com/path"]) {
    assert.equal(isTaskUrl(value), true);
  }
  for (const value of ["https://www.xiaohongshu.com.evil.test/", "https://user:pass@www.xiaohongshu.com/", "https://www.xiaohongshu.com:8443/", "file:///tmp/secret", "javascript:alert(1)", "about:blank"]) {
    assert.equal(isTaskUrl(value), false);
  }
  const { factory, context } = fixture();
  const worker = factory(context);
  for (const type of ["will-navigate", "will-redirect"]) {
    for (const url of ["https://www.xiaohongshu.com/", "https://evil.test/"]) {
      let prevented = false;
      worker.contents.emit(type, { isMainFrame: true, url, preventDefault() { prevented = true; } });
      assert.equal(prevented, url.includes("evil.test"));
    }
  }
  let prevented = false;
  worker.contents.emit("will-redirect", { isMainFrame: false, url: "https://evil.test/", preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
  worker.contents.emit("will-redirect", { preventDefault() { prevented = true; } }, "https://evil.test/", false, false);
  assert.equal(prevented, false);
  worker.close();
});

test("worker创建校验session/disposed，并在同步初始化失败后销毁新窗口", () => {
  assert.throws(() => createCreatorWorkerFactory({}), /BrowserWindow/);
  const normal = fixture();
  assert.throws(() => normal.factory({ disposed: true, session: {} }), /已关闭/);
  assert.throws(() => normal.factory({ disposed: false }), /已关闭/);
  assert.equal(normal.windows.length, 0);
  const broken = fixture({ initializationError: true });
  assert.throws(() => broken.factory(broken.context), /initialization failed/);
  assert.equal(broken.windows[0].destroyed, true);
});

test("worker renderer崩溃后不复用为正常任务或检查页", () => {
  const { factory, context } = fixture();
  const worker = factory(context);
  worker.contents.emit("render-process-gone", {}, { reason: "crashed" });
  assert.equal(worker.isDestroyed(), true);
  assert.throws(() => worker.show(), /已关闭/);
  worker.close();
  assert.equal(worker.contents.listenerCount("render-process-gone"), 0);
});
