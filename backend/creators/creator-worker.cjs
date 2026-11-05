const { platformNavigationUrl } = require("../platform/content-platforms.cjs");
const isTaskUrl = (rawUrl) => Boolean(platformNavigationUrl(rawUrl, "xhs"));

function createCreatorWorkerFactory({ BrowserWindow }) {
  if (typeof BrowserWindow !== "function") throw new TypeError("BrowserWindow is required");
  return (context) => {
    if (context.disposed || !context.session) throw new Error("账号会话已关闭，无法创建后台任务页面");
    const window = new BrowserWindow({
      show: false, width: 1100, height: 800, minWidth: 800, minHeight: 600,
      title: "达人搜索任务页", autoHideMenuBar: true, skipTaskbar: true,
      webPreferences: {
        session: context.session, sandbox: true, contextIsolation: true, nodeIntegration: false,
        webSecurity: true, allowRunningInsecureContent: false, backgroundThrottling: false,
        spellcheck: false,
      },
    });
    const contents = window.webContents;
    let closed = false;
    let crashed = false;
    let inspected = false;
    const rendererGone = () => { crashed = true; };
    const guard = (event, legacyUrl, _legacyInPlace, legacyMainFrame = true) => {
      if ((event?.isMainFrame ?? legacyMainFrame) === false) return;
      const url = event?.url || legacyUrl || "";
      if (!isTaskUrl(url)) event.preventDefault();
    };
    const hide = () => {
      if (!closed && !window.isDestroyed()) {
        if (window.isVisible()) window.hide();
        window.setSkipTaskbar(true);
      }
    };
    let ready;
    try {
      window.setMenu(null);
      contents.setAudioMuted(true);
      const userAgent = context.view?.webContents?.getUserAgent?.();
      if (userAgent) contents.setUserAgent(userAgent);
      contents.setWindowOpenHandler(() => ({ action: "deny" }));
      contents.on("will-navigate", guard);
      contents.on("will-redirect", guard);
      contents.on("render-process-gone", rendererGone);
      window.on("close", (event) => {
        if (!closed) { event.preventDefault(); hide(); }
      });
      // Initialize the renderer before attaching its per-webContents debugger.
      ready = Promise.resolve(contents.loadURL("about:blank"));
    } catch (error) {
      if (!window.isDestroyed()) window.destroy();
      throw error;
    }
    ready.catch(() => {});
    return {
      contents, ready, hide,
      isDestroyed: () => closed || crashed || window.isDestroyed() || contents.isDestroyed(),
      canReuse: () => !inspected,
      show() {
        if (closed || crashed || window.isDestroyed() || contents.isDestroyed()) throw new Error("后台任务页面已关闭，请重新搜索");
        window.setSkipTaskbar(false);
        inspected = true;
        window.show();
        window.focus();
      },
      close() {
        if (closed) return;
        closed = true;
        contents.removeListener("will-navigate", guard);
        contents.removeListener("will-redirect", guard);
        contents.removeListener("render-process-gone", rendererGone);
        if (!window.isDestroyed()) window.destroy();
      },
    };
  };
}

module.exports = { createCreatorWorkerFactory, isTaskUrl };
