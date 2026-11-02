const { randomUUID } = require("node:crypto");
const data = require("./creator-data.cjs");
const page = require("./creator-page.cjs");
const { openConversationScript } = require("../operations/direct-message-page.cjs");

const BODY_LIMIT = 2 * 1024 * 1024;
const CANCELLED = Symbol("creator-task-cancelled");

function createCreatorDiscovery({
  requireContext, publishAccount = () => {}, onProgress = () => {}, ensureNetworkCapture,
  pollIntervalMs = 400, searchTimeoutMs = 45000, navigationTimeoutMs = 20000,
  conversationTimeoutMs = 12000, initialWaitMs = 6000, scrollIntervalMs = 2200, maxScrolls = 24,
}) {
  const states = new Map();
  const notifyAccount = (context) => { try { publishAccount(context); } catch { /* UI notification cannot retain an operation lock. */ } };
  const checkedContext = (accountId) => {
    const context = requireContext(accountId);
    if (context.platform !== "xhs") throw new Error("找达人目前仅支持小红书账号");
    if (context.disposed || !context.view?.webContents || context.view.webContents.isDestroyed()) throw new Error("账号页面已关闭，请重新打开账号");
    return context;
  };
  const state = (accountId) => {
    if (!states.has(accountId)) states.set(accountId, {
      accountId, runId: "", revision: 0, phase: "idle", active: false, keyword: "",
      minFollowers: null, maxFollowers: null, limit: 30, creators: new Map(), scanned: 0, message: "",
    });
    return states.get(accountId);
  };
  const snapshot = (accountId) => {
    const current = state(accountId);
    const matched = [...current.creators.values()].filter((creator) => data.matchesFollowers(creator, current));
    return {
      accountId, runId: current.runId, revision: current.revision, phase: current.phase, active: current.active,
      keyword: current.keyword, minFollowers: current.minFollowers, maxFollowers: current.maxFollowers, limit: current.limit,
      scanned: current.scanned, matched: matched.length,
      creators: matched.slice(0, current.limit).map((creator) => ({ ...creator })), message: current.message,
    };
  };
  const publish = (current) => {
    current.revision += 1;
    try { onProgress(snapshot(current.accountId)); } catch { /* Preserve task lifecycle when the renderer closes. */ }
  };
  const alive = (run) => !run.cancelled && !run.context.disposed && !run.contents.isDestroyed()
    && states.get(run.accountId) === run.state && run.state.run === run && run.context.operation === run.operation;
  const check = (run) => { if (!alive(run)) throw CANCELLED; };
  const step = async (run, promise, timeoutMs = navigationTimeoutMs) => {
    check(run);
    let timer;
    try {
      const result = await Promise.race([
        Promise.resolve(promise),
        run.cancelPromise.then(() => { throw CANCELLED; }),
        new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error("页面响应超时，请检查账号页面后重试")), timeoutMs); }),
      ]);
      check(run);
      return result;
    } finally { clearTimeout(timer); }
  };
  const delay = async (run, milliseconds = pollIntervalMs) => {
    let timer;
    try {
      await Promise.race([
        new Promise((resolve) => { timer = setTimeout(resolve, milliseconds); }),
        run.cancelPromise,
      ]);
      check(run);
    } finally { clearTimeout(timer); }
  };
  const lock = (context, kind) => {
    if (context.capture?.active || context.capture?.pendingStartRunId || context.operation?.active) throw new Error("该账号正在采集或执行其他操作，请先停止当前任务");
    const operation = { active: true, kind, runId: randomUUID(), startedAt: Date.now() };
    context.operation = operation;
    try { context.view.webContents.setBackgroundThrottling(false); } catch (error) {
      if (context.operation === operation) context.operation = { active: false, runId: "", startedAt: 0 };
      throw error;
    }
    notifyAccount(context);
    return operation;
  };
  const unlock = (run) => {
    const { context, contents } = run;
    if (context.operation !== run.operation) return;
    context.operation = { active: false, runId: "", startedAt: 0 };
    if (!context.disposed && !contents.isDestroyed()) {
      try { contents.setBackgroundThrottling(true); } catch { /* Account may close between checks. */ }
      notifyAccount(context);
    }
  };
  const makeRun = (current, context, operation) => {
    let cancel;
    const run = {
      accountId: current.accountId, state: current, context, contents: context.view.webContents,
      operation, cancelled: false, cancelPromise: new Promise((resolve) => { cancel = resolve; }),
      cleanup: [], requests: new Map(), responses: new Map(), pendingBodies: new Set(),
      mainFrameId: "", documentLoaderId: "", navigating: false, documentReady: false,
    };
    run.cancel = () => { run.cancelled = true; cancel(); };
    return run;
  };
  const ingest = (run, rows) => {
    if (!alive(run)) return 0;
    const current = run.state;
    let changed = false;
    for (const row of rows) {
      const creator = data.normalizeCreator(row);
      if (!creator || current.creators.size >= 1000 && !current.creators.has(creator.userId)) continue;
      const previous = current.creators.get(creator.userId);
      const merged = data.mergeCreator(previous, creator);
      if (!previous || JSON.stringify(previous) !== JSON.stringify(merged)) {
        current.creators.set(creator.userId, merged);
        changed = true;
      }
    }
    current.scanned = current.creators.size;
    if (changed) {
      current.message = `已检查 ${current.scanned} 位公开用户，找到 ${snapshot(current.accountId).matched} 位符合条件的达人`;
      publish(current);
    }
    return changed ? 1 : 0;
  };
  const failRun = (run, message) => {
    if (!alive(run)) return;
    run.failure = message;
    run.cancel();
  };
  const onNetworkMessage = (run, method, params) => {
    if (!alive(run) || !run.navigating) return;
    if (method === "Network.requestWillBeSent") {
      if (params.type === "Document" && params.frameId === run.mainFrameId) {
        run.requests.clear();
        run.responses.clear();
        run.documentLoaderId = data.isCreatorSearchPage(params.request?.url, run.state.keyword) ? params.loaderId || "" : "";
        return;
      }
      if (!run.documentLoaderId || params.frameId !== run.mainFrameId || params.loaderId !== run.documentLoaderId
        || !data.isCreatorSearchPage(params.documentURL, run.state.keyword)
        || !data.isCreatorSearchRequest(params.request, run.state.keyword)) return;
      run.requests.set(params.requestId, { url: params.request.url, loaderId: run.documentLoaderId });
    }
    if (method === "Network.responseReceived") {
      const request = run.requests.get(params.requestId);
      if (!request || request.loaderId !== run.documentLoaderId || params.loaderId !== request.loaderId
        || params.frameId !== run.mainFrameId || !data.isCreatorSearchPage(run.contents.getURL(), run.state.keyword)
        || params.response?.url !== request.url) return;
      if ([401, 403, 429].includes(params.response.status)) {
        failRun(run, "平台限制了达人搜索，请在账号页面检查登录、验证或访问限制后重试");
        return;
      }
      if (params.response.status < 200 || params.response.status >= 300
        || !/json/i.test(params.response.mimeType || "") || params.response.encodedDataLength > BODY_LIMIT) return;
      run.responses.set(params.requestId, request);
    }
    if (method === "Network.loadingFinished") {
      run.requests.delete(params.requestId);
      const request = run.responses.get(params.requestId);
      run.responses.delete(params.requestId);
      if (!request || params.encodedDataLength > BODY_LIMIT) return;
      const pending = (async () => {
        const result = await step(run, run.contents.debugger.sendCommand("Network.getResponseBody", { requestId: params.requestId }), 5000);
        if (request.loaderId !== run.documentLoaderId || !data.isCreatorSearchPage(run.contents.getURL(), run.state.keyword)) return;
        if (typeof result.body !== "string" || result.body.length > BODY_LIMIT * 1.4) return;
        const body = result.base64Encoded ? Buffer.from(result.body, "base64").toString("utf8") : result.body;
        if (Buffer.byteLength(body, "utf8") > BODY_LIMIT) return;
        let json;
        try { json = JSON.parse(body); } catch { return; }
        if (json?.success === false || json?.code && Number(json.code) !== 0 && Number(json.code) !== 200) {
          failRun(run, "平台未返回可用的达人搜索结果，请在账号页面检查访问提示后重试");
          return;
        }
        ingest(run, data.extractCreators(json));
      })().catch((error) => {
        if (error !== CANCELLED && alive(run)) run.networkError = true;
      }).finally(() => run.pendingBodies.delete(pending));
      run.pendingBodies.add(pending);
    }
    if (method === "Network.loadingFailed") {
      run.requests.delete(params.requestId);
      run.responses.delete(params.requestId);
    }
  };
  const listen = (run) => {
    const network = (_event, method, params) => onNetworkMessage(run, method, params || {});
    run.contents.debugger.on("message", network);
    run.cleanup.push(() => run.contents.debugger.removeListener("message", network));
    const navigated = (event, legacyUrl, legacyMainFrame = true) => {
      if ((event?.isMainFrame ?? legacyMainFrame) === false || !alive(run) || !run.navigating) return;
      const url = event?.url ?? legacyUrl ?? run.contents.getURL();
      if (!data.isCreatorSearchPage(url, run.state.keyword)) failRun(run, "已离开本次达人搜索页面，搜索已停止");
    };
    const documentNavigated = (_event, url) => navigated({ isMainFrame: true }, url);
    run.contents.on("did-navigate", documentNavigated);
    run.contents.on("did-navigate-in-page", navigated);
    run.cleanup.push(() => run.contents.removeListener("did-navigate", documentNavigated));
    run.cleanup.push(() => run.contents.removeListener("did-navigate-in-page", navigated));
    const detached = () => failRun(run, "页面监听已断开，已保留当前达人结果，请重新搜索");
    run.contents.debugger.on("detach", detached);
    run.cleanup.push(() => run.contents.debugger.removeListener("detach", detached));
  };
  const cleanup = (run) => {
    for (const remove of run.cleanup.splice(0)) { try { remove(); } catch { /* Host may already be disposed. */ } }
    run.requests.clear();
    run.responses.clear();
    unlock(run);
  };
  async function runSearch(run) {
    const current = run.state;
    try {
      if (ensureNetworkCapture) await step(run, ensureNetworkCapture(run.context));
      else {
        if (!run.contents.debugger.isAttached()) run.contents.debugger.attach("1.3");
        await step(run, run.contents.debugger.sendCommand("Network.enable", { maxTotalBufferSize: 8 * BODY_LIMIT, maxResourceBufferSize: BODY_LIMIT }));
      }
      try {
        const tree = await step(run, run.contents.debugger.sendCommand("Page.getFrameTree"), 3000);
        run.mainFrameId = tree?.frameTree?.frame?.id || "";
      } catch (error) { if (error === CANCELLED) throw error; }
      listen(run);
      run.navigating = true;
      await step(run, run.contents.loadURL(data.searchUrl(current.keyword)));
      if (!data.isCreatorSearchPage(run.contents.getURL(), current.keyword)) throw new Error("未进入达人搜索页面，请检查账号登录或平台验证");
      run.documentReady = true;
      let stalls = 0;
      let scrolls = 0;
      let lastScrollAt = 0;
      const startedAt = Date.now();
      const until = startedAt + searchTimeoutMs;
      let previousSize = -1;
      while (Date.now() < until) {
        check(run);
        if (!data.isCreatorSearchPage(run.contents.getURL(), current.keyword)) throw new Error("已离开本次达人搜索页面，搜索已停止");
        const visible = await step(run, run.contents.executeJavaScript(page.readCreatorSearchScript({ keyword: current.keyword })), 5000);
        if (!visible?.pageMatches) throw new Error("搜索页面已变化，请重新搜索");
        if (visible.blocked) throw new Error(visible.blocked);
        ingest(run, Array.isArray(visible.rows) ? visible.rows : []);
        if (snapshot(current.accountId).creators.length >= current.limit || current.scanned >= 1000) break;
        const changed = current.scanned !== previousSize;
        previousSize = current.scanned;
        const waiting = run.requests.size || run.responses.size || run.pendingBodies.size;
        stalls = changed || waiting ? 0 : stalls + 1;
        if (!waiting && Date.now() - startedAt >= initialWaitMs
          && (visible.empty || stalls >= 7 || scrolls >= maxScrolls && stalls >= 3)) break;
        if (scrolls < maxScrolls && Date.now() - lastScrollAt >= scrollIntervalMs) {
          await step(run, run.contents.executeJavaScript(page.scrollCreatorSearchScript({ keyword: current.keyword })), 5000);
          scrolls += 1;
          lastScrollAt = Date.now();
        }
        await delay(run);
      }
      check(run);
      current.phase = "completed";
      const count = snapshot(current.accountId).creators.length;
      current.message = count ? `已找到 ${count} 位达人；结果来自平台公开用户搜索` : current.scanned
        ? "当前已加载的公开用户中没有符合粉丝范围的达人，可调整条件后重试"
        : "未读取到公开达人结果，请检查账号页面中的搜索结果或更换关键词";
    } catch (error) {
      current.phase = error === CANCELLED && !run.failure ? "stopped" : "paused";
      current.message = run.failure || (error === CANCELLED ? "搜索已停止，已保留当前达人结果" : error.message || "达人搜索失败，请重试");
    } finally {
      cleanup(run);
      if (states.get(run.accountId) === current && current.run === run) {
        current.active = false;
        current.run = null;
        publish(current);
      }
    }
  }
  async function search(accountId, input) {
    const settings = data.validateSearch(input);
    const context = checkedContext(accountId);
    const current = state(accountId);
    if (current.active) throw new Error("该账号正在查找达人，请先停止当前搜索");
    const operation = lock(context, "creator-search");
    Object.assign(current, settings, {
      runId: operation.runId, phase: "searching", active: true, creators: new Map(), scanned: 0,
      message: "正在打开平台用户搜索并读取公开达人资料",
    });
    const run = makeRun(current, context, operation);
    current.run = run;
    publish(current);
    current.job = runSearch(run);
    return snapshot(accountId);
  }
  function stop(accountId) {
    const current = state(accountId);
    const run = current.run;
    if (run && current.active) {
      run.cancel();
      if (!run.context.disposed && !run.contents.isDestroyed() && run.contents.isLoading()) {
        try { run.contents.stop(); } catch { /* Closing page is already cancelled. */ }
      }
      current.message = run.operation.kind === "creator-conversation" ? "正在停止打开私信" : "正在停止达人搜索";
      publish(current);
    }
    return snapshot(accountId);
  }
  async function openConversation(accountId, input) {
    const creator = data.validateCreator(input);
    const context = checkedContext(accountId);
    const current = state(accountId);
    if (current.active) throw new Error("请先停止达人搜索后再打开私信");
    const operation = lock(context, "creator-conversation");
    const run = makeRun(current, context, operation);
    current.run = run;
    current.active = true;
    const job = (async () => {
      try {
        await step(run, run.contents.loadURL(creator.profileUrl));
        if (data.profileId(run.contents.getURL()) !== creator.userId) throw new Error("达人主页身份不匹配，未打开私信");
        const until = Date.now() + conversationTimeoutMs;
        let clicked = false;
        while (Date.now() < until) {
          check(run);
          if (!clicked) {
            if (data.profileId(run.contents.getURL()) !== creator.userId) throw new Error("达人主页身份已变化，未打开私信");
            const opened = await step(run, run.contents.executeJavaScript(openConversationScript({ userId: creator.userId }), true), 5000);
            if (opened?.status === "paused") throw new Error(opened.reason || "私信入口不可用");
            clicked = opened?.status === "opened";
          }
          if (clicked) {
            const confirmed = await step(run, run.contents.executeJavaScript(page.confirmConversationScript({ userId: creator.userId })), 5000);
            if (confirmed?.status === "opened" && confirmed.userId === creator.userId) return { status: "opened", ...creator, url: run.contents.getURL() };
            if (confirmed?.status === "paused") throw new Error(confirmed.reason || "私信入口不可用");
          }
          await delay(run, Math.min(250, pollIntervalMs));
        }
        throw new Error(clicked ? "未能确认该达人的私信会话，请在账号页面检查私信权限" : "该达人没有可用的私信入口，请在账号页面检查");
      } catch (error) {
        throw new Error(error === CANCELLED ? "打开私信已取消" : error.message || "打开达人私信失败");
      } finally {
        cleanup(run);
        if (current.run === run) {
          current.active = false;
          current.run = null;
          publish(current);
        }
      }
    })();
    current.job = job;
    return job;
  }
  async function dispose(accountId) {
    const current = states.get(accountId);
    if (!current) return;
    stop(accountId);
    await current.job?.catch(() => {});
    if (states.get(accountId) === current) states.delete(accountId);
  }
  return { search, stop, getState: snapshot, openConversation, dispose, waitForIdle: (accountId) => states.get(accountId)?.job || Promise.resolve() };
}

module.exports = { createCreatorDiscovery };
