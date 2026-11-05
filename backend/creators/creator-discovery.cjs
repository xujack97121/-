const { randomUUID } = require("node:crypto");
const data = require("./creator-data.cjs");
const page = require("./creator-page.cjs");
const { assessCreatorRelevance } = require("./creator-relevance.cjs");
const { openConversationScript } = require("../operations/direct-message-page.cjs");

const BODY_LIMIT = 2 * 1024 * 1024;
const CANCELLED = Symbol("creator-task-cancelled");

function createCreatorDiscovery({
  requireContext, createSearchWorker, publishAccount = () => {}, onProgress = () => {},
  pollIntervalMs = 400, searchTimeoutMs = 45000, navigationTimeoutMs = 20000,
  conversationTimeoutMs = 12000, initialWaitMs = 6000, scrollIntervalMs = 2200, maxScrolls = 24,
  profileIntervalMs = 2200, profileSettleMs = 1200, profileTimeoutMs = 7000,
  maxCandidates = 120, verificationTimeoutMs = 8 * 60 * 1000,
}) {
  const states = new Map();
  const workers = new Map();
  const foregroundRuns = new Map();
  const foregroundJobs = new Map();
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
      candidates: new Map(), stage: "idle", checked: 0, rejected: 0, insufficient: 0,
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
      stage: current.stage, candidates: current.candidates.size, checked: current.checked,
      rejected: current.rejected, insufficient: current.insufficient,
      creators: matched.slice(0, current.limit).map((creator) => JSON.parse(JSON.stringify(creator))), message: current.message,
    };
  };
  const publish = (current) => {
    current.revision += 1;
    try { onProgress(snapshot(current.accountId)); } catch { /* Preserve task lifecycle when the renderer closes. */ }
  };
  const ownsRun = (run) => (run.foreground
      ? foregroundRuns.get(run.accountId) === run && run.context.foregroundOperation === run.operation
      : states.get(run.accountId) === run.state && run.state.run === run && run.context.operation === run.operation);
  const alive = (run) => ownsRun(run) && !run.cancelled && !run.context.disposed && !run.contents.isDestroyed();
  const check = (run) => { if (!alive(run)) throw CANCELLED; };
  const step = async (run, promise, timeoutMs = navigationTimeoutMs) => {
    check(run);
    if (run.verificationDeadline && run.stage === "checking") timeoutMs = Math.max(1, Math.min(timeoutMs, run.verificationDeadline - Date.now()));
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
    if (context.capture?.active || context.capture?.pendingStartRunId || context.operation?.active
      || context.foregroundOperation?.active) throw new Error("该账号正在采集或执行其他操作，请先停止当前任务");
    const operation = { active: true, kind, target: "background", runId: randomUUID(), startedAt: Date.now() };
    context.operation = operation;
    notifyAccount(context);
    return operation;
  };
  const lockForeground = (context, kind) => {
    if (context.capture?.active || context.capture?.pendingStartRunId || context.foregroundOperation?.active
      || context.operation?.active && context.operation.kind !== "creator-search") {
      throw new Error("该账号正在采集或执行其他操作，请稍后重试");
    }
    const operation = { active: true, kind, target: "foreground", runId: randomUUID(), startedAt: Date.now() };
    context.foregroundOperation = operation;
    notifyAccount(context);
    return operation;
  };
  const unlock = (run) => {
    const { context } = run;
    const key = run.foreground ? "foregroundOperation" : "operation";
    if (context[key] !== run.operation) return;
    context[key] = { active: false, kind: "", runId: "", startedAt: 0 };
    if (!context.disposed) notifyAccount(context);
  };
  const makeRun = (current, context, operation, contents, foreground = false) => {
    let cancel;
    const run = {
      accountId: context.id, state: current, context, contents, foreground,
      operation, cancelled: false, cancelPromise: new Promise((resolve) => { cancel = resolve; }),
      cleanup: [], requests: new Map(), responses: new Map(), pendingBodies: new Set(),
      mainFrameId: "", documentLoaderId: "", navigating: false, documentReady: false,
      stage: "collecting", currentProfileId: "", navigationEpoch: 0, expectedUrl: "",
    };
    run.cancel = () => { run.cancelled = true; cancel(); };
    return run;
  };
  const getWorker = (context) => {
    const existing = workers.get(context.id);
    if (existing?.context === context && existing.host.canReuse?.() !== false
      && !existing.host.isDestroyed() && !existing.host.contents.isDestroyed()) return existing.host;
    if (existing) { existing.host.close(); workers.delete(context.id); }
    if (typeof createSearchWorker !== "function") throw new Error("后台搜索页面尚未配置");
    const host = createSearchWorker(context);
    if (!context.session || !host?.contents || host.contents === context.view.webContents || host.contents.session !== context.session
      || typeof host.show !== "function" || typeof host.close !== "function" || typeof host.isDestroyed !== "function") {
      host?.close?.();
      throw new Error("后台搜索页面必须使用该账号的独立浏览会话");
    }
    workers.set(context.id, { context, host });
    return host;
  };
  const navigate = async (run, url, stage, userId = "") => {
    check(run);
    run.navigationEpoch += 1;
    run.stage = stage;
    run.currentProfileId = userId;
    run.expectedUrl = url;
    run.documentLoaderId = "";
    run.documentRequestId = "";
    run.requests.clear();
    run.responses.clear();
    await step(run, run.contents.loadURL(url));
    if (!matchesRunPage(run, run.contents.getURL())) throw new Error("后台任务页面身份已变化，请检查任务页面后重试");
  };
  const readPage = async (run, script) => {
    const epoch = run.navigationEpoch;
    const loader = run.documentLoaderId;
    const result = await step(run, run.contents.executeJavaScript(script), 5000);
    if (epoch !== run.navigationEpoch || loader !== run.documentLoaderId || !matchesRunPage(run, run.contents.getURL())) {
      failRun(run, "后台任务页面已变化，已停止使用旧页面内容");
      throw CANCELLED;
    }
    const tree = await step(run, run.contents.debugger.sendCommand("Page.getFrameTree"), 3000);
    const frame = tree?.frameTree?.frame;
    if (frame?.id && frame.id !== run.mainFrameId || frame?.loaderId && loader && frame.loaderId !== loader) {
      failRun(run, "后台页面已重新导航，已停止使用旧页面内容");
      throw CANCELLED;
    }
    return result;
  };
  const ingest = (run, rows) => {
    if (!alive(run) || run.stage !== "collecting") return 0;
    const current = run.state;
    let changed = false;
    for (const row of rows) {
      const creator = data.normalizeCreator(row);
      if (!creator || current.candidates.size >= run.candidateLimit && !current.candidates.has(creator.userId)) continue;
      const previous = current.candidates.get(creator.userId);
      const merged = data.mergeCreator(previous, creator);
      if (!previous || JSON.stringify(previous) !== JSON.stringify(merged)) {
        current.candidates.set(creator.userId, merged);
        changed = true;
      }
    }
    current.scanned = current.candidates.size;
    if (changed) {
      current.message = `已从公开搜索收集 ${current.scanned} 位候选作者，正在等待主页综合核验`;
      publish(current);
    }
    return changed ? 1 : 0;
  };
  const matchesRunPage = (run, url) => run.stage === "collecting"
    ? data.isCreatorSearchPage(url, run.state.keyword) : Boolean(run.currentProfileId) && data.profileId(url) === run.currentProfileId;
  const failRun = (run, message) => {
    if (!ownsRun(run) || run.cancelled) return;
    run.failure = message;
    run.cancel();
  };
  const onNetworkMessage = (run, method, params) => {
    if (!alive(run) || !run.navigating) return;
    if (method === "Network.requestWillBeSent") {
      if (params.type === "Document" && params.frameId === run.mainFrameId) {
        if (matchesRunPage(run, params.request?.url) && (!run.documentRequestId || params.requestId === run.documentRequestId)) {
          run.documentLoaderId = params.loaderId || "";
          run.documentRequestId = params.requestId;
        }
        return;
      }
      if (run.stage !== "collecting" || !run.documentLoaderId || params.frameId !== run.mainFrameId || params.loaderId !== run.documentLoaderId
        || !data.isCreatorSearchPage(params.documentURL, run.state.keyword)
        || !data.isCreatorSearchRequest(params.request, run.state.keyword)) return;
      run.requests.set(params.requestId, { url: params.request.url, loaderId: run.documentLoaderId, epoch: run.navigationEpoch });
    }
    if (method === "Network.responseReceived") {
      if (run.stage === "checking" && params.frameId === run.mainFrameId && params.loaderId === run.documentLoaderId
        && matchesRunPage(run, run.contents.getURL()) && [401, 403, 429].includes(params.response?.status)) {
        let limitedApi = false;
        try {
          const url = new URL(params.response.url);
          limitedApi = url.protocol === "https:" && !url.username && !url.password && !url.port
            && (url.hostname === "xiaohongshu.com" || url.hostname.endsWith(".xiaohongshu.com"))
            && url.pathname.startsWith("/api/");
        } catch { /* Only a scoped platform API can pause profile checking. */ }
        if (limitedApi) {
          failRun(run, "平台限制了公开主页内容访问，已暂停核验，请检查后台任务页面后重试");
          return;
        }
      }
      if (params.type === "Document" && params.frameId === run.mainFrameId
        && params.loaderId === run.documentLoaderId && params.requestId === run.documentRequestId
        && matchesRunPage(run, params.response?.url)
        && [401, 403, 429].includes(params.response?.status)) {
        failRun(run, "平台限制了后台任务访问，已暂停搜索，请检查任务页面中的登录、验证或访问限制后重试");
        return;
      }
      const request = run.requests.get(params.requestId);
      if (run.stage !== "collecting" || !request || request.epoch !== run.navigationEpoch || request.loaderId !== run.documentLoaderId || params.loaderId !== request.loaderId
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
        if (run.stage !== "collecting" || request.epoch !== run.navigationEpoch || request.loaderId !== run.documentLoaderId
          || !data.isCreatorSearchPage(run.contents.getURL(), run.state.keyword)) return;
        if (typeof result.body !== "string" || result.body.length > BODY_LIMIT * 1.4) return;
        const body = result.base64Encoded ? Buffer.from(result.body, "base64").toString("utf8") : result.body;
        if (Buffer.byteLength(body, "utf8") > BODY_LIMIT) return;
        let json;
        try { json = JSON.parse(body); } catch { return; }
        if (json?.success === false || json?.code && Number(json.code) !== 0 && Number(json.code) !== 200) {
          failRun(run, "平台未返回可用的达人搜索结果，请在账号页面检查访问提示后重试");
          return;
        }
        ingest(run, data.extractSearchCandidates(json, request.url));
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
      if (!matchesRunPage(run, url) && !matchesRunPage(run, run.contents.getURL())) {
        failRun(run, "后台任务页已离开本次达人核验页面，搜索已暂停");
      }
    };
    const documentNavigated = (_event, url) => navigated({ isMainFrame: true }, url);
    run.contents.on("did-navigate", documentNavigated);
    run.contents.on("did-navigate-in-page", navigated);
    run.cleanup.push(() => run.contents.removeListener("did-navigate", documentNavigated));
    run.cleanup.push(() => run.contents.removeListener("did-navigate-in-page", navigated));
    const detached = () => failRun(run, "页面监听已断开，已保留当前达人结果，请重新搜索");
    run.contents.debugger.on("detach", detached);
    run.cleanup.push(() => run.contents.debugger.removeListener("detach", detached));
    const destroyed = () => failRun(run, "后台任务页面已关闭，已保留当前达人结果，请重新搜索");
    run.contents.on("destroyed", destroyed);
    run.contents.on("render-process-gone", destroyed);
    run.cleanup.push(() => run.contents.removeListener("destroyed", destroyed));
    run.cleanup.push(() => run.contents.removeListener("render-process-gone", destroyed));
  };
  const cleanup = (run) => {
    for (const remove of run.cleanup.splice(0)) { try { remove(); } catch { /* Host may already be disposed. */ } }
    run.requests.clear();
    run.responses.clear();
    unlock(run);
  };
  async function checkCandidate(run, candidate) {
    check(run);
    await navigate(run, candidate.profileUrl, "checking", candidate.userId);
    if (data.profileId(run.contents.getURL()) !== candidate.userId) throw new Error("候选作者主页身份不匹配");
    const startedAt = Date.now();
    let evidence = null;
    let stableCount = -1;
    let stable = 0;
    while (Date.now() - startedAt < profileTimeoutMs) {
      check(run);
      if (data.profileId(run.contents.getURL()) !== candidate.userId) throw new Error("作者主页身份已变化");
      const result = await readPage(run, page.readCreatorProfileScript({ userId: candidate.userId, maxNotes: 8 }));
      if (result?.blocked) { failRun(run, result.blocked); throw CANCELLED; }
      if (result?.pageMatches === false) throw new Error("公开主页身份无法确认");
      const current = data.normalizeProfileEvidence(result, candidate.userId);
      if (current) {
        evidence = current;
        stable = current.notes.length === stableCount ? stable + 1 : 0;
        stableCount = current.notes.length;
        if (Date.now() - startedAt >= profileSettleMs && (current.notes.length >= 8 || current.notes.length >= 3 && stable >= 2)) break;
      }
      await delay(run);
    }
    check(run);
    return evidence;
  }
  async function verifyCandidates(run) {
    const current = run.state;
    run.stage = "checking";
    current.stage = "checking";
    run.requests.clear();
    run.responses.clear();
    const deadline = Date.now() + verificationTimeoutMs;
    run.verificationDeadline = deadline;
    for (const candidate of current.candidates.values()) {
      check(run);
      if (Date.now() >= deadline || current.creators.size >= current.limit) break;
      if (current.checked) await delay(run, profileIntervalMs);
      if (Date.now() >= deadline) break;
      current.message = `正在核验公开主页 ${current.checked + 1}/${current.candidates.size}，已综合匹配 ${current.creators.size} 位达人`;
      publish(current);
      try {
        const evidence = await checkCandidate(run, candidate);
        check(run);
        if (!evidence) {
          current.insufficient += 1;
        } else {
          const creator = {
            ...data.mergeCreator(candidate, evidence.creator),
            description: evidence.creator.description, tags: [...evidence.creator.tags],
            followers: evidence.creator.followers, followerLabel: evidence.creator.followerLabel,
          };
          const relevance = assessCreatorRelevance({ keyword: current.keyword, creator, notes: evidence.notes });
          if (relevance.status === "matched" && relevance.matched === true && data.matchesFollowers(creator, current)) {
            current.creators.set(creator.userId, { ...creator, relevance });
          } else if (relevance.status === "insufficient") current.insufficient += 1;
          else current.rejected += 1;
        }
      } catch (error) {
        if (error === CANCELLED) throw error;
        check(run);
        current.insufficient += 1;
      }
      current.checked += 1;
      publish(current);
    }
    check(run);
    current.message = `已核验 ${current.checked} 位候选作者，综合匹配 ${current.creators.size} 位达人`
      + (current.checked < current.candidates.size && current.creators.size < current.limit ? "；已达到本次核验时间上限" : "");
  }
  async function runSearch(run) {
    const current = run.state;
    try {
      run.worker.hide?.();
      await step(run, run.worker.ready);
      run.workerReady = true;
      run.contents.setBackgroundThrottling(false);
      if (!run.contents.debugger.isAttached()) run.contents.debugger.attach("1.3");
      await step(run, run.contents.debugger.sendCommand("Network.enable", { maxTotalBufferSize: 8 * BODY_LIMIT, maxResourceBufferSize: BODY_LIMIT }));
      try {
        const tree = await step(run, run.contents.debugger.sendCommand("Page.getFrameTree"), 3000);
        run.mainFrameId = tree?.frameTree?.frame?.id || "";
      } catch (error) { if (error === CANCELLED) throw error; }
      listen(run);
      run.navigating = true;
      await navigate(run, data.searchUrl(current.keyword), "collecting");
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
        const visible = await readPage(run, page.readCreatorSearchScript({ keyword: current.keyword }));
        if (!visible?.pageMatches) throw new Error("搜索页面已变化，请重新搜索");
        if (visible.blocked) throw new Error(visible.blocked);
        ingest(run, Array.isArray(visible.rows) ? visible.rows : []);
        if (current.candidates.size >= run.candidateLimit) break;
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
      await verifyCandidates(run);
      current.phase = "completed";
      current.stage = "done";
      const count = snapshot(current.accountId).creators.length;
      if (!count && !current.scanned) current.message = "未读取到候选作者，请检查账号页面中的公开笔记搜索结果或更换关键词";
      else if (!count) current.message += "；简介、标签或公开内容样本不足的账号未列入结果，可调整关键词或粉丝范围重试";
    } catch (error) {
      current.phase = error === CANCELLED && !run.failure ? "stopped" : "paused";
      current.message = run.failure || (error === CANCELLED ? "搜索已停止，已保留当前达人结果" : error.message || "达人搜索失败，请重试");
    } finally {
      if (!run.failure && !run.cancelled && !run.contents.isDestroyed() && run.contents.isLoading()) {
        try { run.contents.stop(); } catch { /* Only the task worker is stopped here. */ }
      }
      if (!run.contents.isDestroyed()) {
        try { run.contents.setBackgroundThrottling(true); } catch { /* Worker may have crashed during cleanup. */ }
      }
      cleanup(run);
      if (!run.workerReady) {
        const worker = workers.get(run.accountId);
        if (worker?.host === run.worker) {
          workers.delete(run.accountId);
          try { worker.host.close(); } catch { /* Initialization failure must still release the task lock. */ }
        }
      }
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
    let worker;
    try { worker = getWorker(context); } catch (error) {
      unlock({ context, operation, foreground: false });
      throw error;
    }
    Object.assign(current, settings, {
      runId: operation.runId, phase: "searching", active: true, creators: new Map(), candidates: new Map(), scanned: 0,
      stage: "collecting", checked: 0, rejected: 0, insufficient: 0,
      message: "正在通过公开笔记搜索收集候选作者，随后核验简介、标签和公开内容",
    });
    const run = makeRun(current, context, operation, worker.contents);
    run.worker = worker;
    run.candidateLimit = Math.max(1, Math.min(maxCandidates, Math.max(30, current.limit * 3)));
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
      if (!run.contents.isDestroyed() && run.contents.isLoading()) {
        try { run.contents.stop(); } catch { /* Closing page is already cancelled. */ }
      }
      current.message = "正在停止达人搜索";
      publish(current);
    }
    return snapshot(accountId);
  }
  function foregroundAction(accountId, input, kind, action) {
    const creator = data.validateCreator(input);
    const context = checkedContext(accountId);
    const operation = lockForeground(context, kind);
    const run = makeRun(null, context, operation, context.view.webContents, true);
    foregroundRuns.set(accountId, run);
    const destroyed = () => failRun(run, "账号页面已关闭");
    run.contents.on("destroyed", destroyed);
    run.contents.on("render-process-gone", destroyed);
    run.cleanup.push(() => run.contents.removeListener("destroyed", destroyed));
    run.cleanup.push(() => run.contents.removeListener("render-process-gone", destroyed));
    const job = (async () => {
      let completed = false;
      try {
        const result = await action(run, creator);
        completed = true;
        return result;
      } catch (error) {
        throw new Error(error === CANCELLED ? "前台打开操作已取消" : error.message || "打开达人页面失败");
      } finally {
        if (!completed && !run.contents.isDestroyed() && run.contents.isLoading()) {
          try { run.contents.stop(); } catch { /* Account teardown may already be underway. */ }
        }
        cleanup(run);
        if (foregroundRuns.get(accountId) === run) foregroundRuns.delete(accountId);
      }
    })();
    foregroundJobs.set(accountId, job);
    const finished = () => { if (foregroundJobs.get(accountId) === job) foregroundJobs.delete(accountId); };
    job.then(finished, finished);
    return job;
  }
  async function openProfile(accountId, input) {
    return foregroundAction(accountId, input, "creator-profile", async (run, creator) => {
      await step(run, run.contents.loadURL(creator.profileUrl));
      if (data.profileId(run.contents.getURL()) !== creator.userId) throw new Error("达人主页身份不匹配，未打开主页");
      return { status: "opened", ...creator, url: run.contents.getURL() };
    });
  }
  async function openConversation(accountId, input) {
    return foregroundAction(accountId, input, "creator-conversation", async (run, creator) => {
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
    });
  }
  async function openTaskPage(accountId) {
    const context = checkedContext(accountId);
    const worker = workers.get(accountId);
    if (worker?.context !== context || worker.host.isDestroyed() || worker.host.contents.isDestroyed()) {
      throw new Error("尚无可检查的后台任务页面，请先开始一次搜索");
    }
    worker.host.show();
    return { status: "opened", url: worker.host.contents.getURL() };
  }
  async function dispose(accountId) {
    const current = states.get(accountId);
    const backgroundRun = current?.run;
    const backgroundJob = current?.job;
    const foreground = foregroundRuns.get(accountId);
    const foregroundJob = foregroundJobs.get(accountId);
    const worker = workers.get(accountId);
    if (current) stop(accountId);
    foreground?.cancel();
    await Promise.all([backgroundJob?.catch(() => {}), foregroundJob?.catch(() => {})]);
    if (current && states.get(accountId) === current && (!current.run || current.run === backgroundRun)) states.delete(accountId);
    if (foregroundRuns.get(accountId) === foreground) foregroundRuns.delete(accountId);
    if (foregroundJobs.get(accountId) === foregroundJob) foregroundJobs.delete(accountId);
    if (worker && workers.get(accountId) === worker) {
      workers.delete(accountId);
      worker.host.close();
    }
  }
  return {
    search, stop, getState: snapshot, openProfile, openConversation, openTaskPage, dispose,
    waitForIdle: (accountId) => states.get(accountId)?.job || Promise.resolve(),
  };
}

module.exports = { createCreatorDiscovery };
