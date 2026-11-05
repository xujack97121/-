import { useCallback, useEffect, useRef, useState } from "react";
import { IconAlertCircle, IconCircleCheck, IconExternalLink, IconLoader2, IconMessageCircle, IconPlayerStop, IconSearch, IconUserCircle, IconUsers } from "@tabler/icons-react";
import { CREATOR_FOLLOWER_PRESETS, EMPTY_CREATOR_SNAPSHOT, creatorCountLabel, mergeCreatorSnapshot, normalizeCreatorState, validateCreatorSearch } from "./creator-discovery.js";
import "./creator-discovery.css";

const EVIDENCE_LABELS = { profile: "简介", tag: "公开标签", note: "内容样本" };
function CreatorEvidence({ relevance }) {
  const renderEvidence = (entries) => entries.map((entry, index) => <div className="creator-evidence-row" key={`${entry.kind}-${index}`}>
    <dt>{EVIDENCE_LABELS[entry.kind]}</dt><dd><p>{entry.text}</p><small>命中：{entry.terms.join("、")}</small></dd>
  </div>);
  return <div className="creator-relevance" aria-label="领域匹配依据">
    <div className="creator-relevance-summary"><strong><IconCircleCheck size={15} aria-hidden="true" />{relevance.label}</strong>{relevance.totalNotes > 0 && <span>公开内容样本 {relevance.matchedNotes} / {relevance.totalNotes} 篇相关</span>}</div>
    {relevance.tags.length > 0 && <p className="creator-public-tags">公开标签：{relevance.tags.join("、")}</p>}
    <dl className="creator-evidence">{renderEvidence(relevance.evidence.slice(0, 3))}</dl>
    {relevance.evidence.length > 3 && <details className="creator-more-evidence"><summary>更多匹配依据（{relevance.evidence.length - 3}）</summary><dl className="creator-evidence">{renderEvidence(relevance.evidence.slice(3))}</dl></details>}
  </div>;
}

export function CreatorDiscoveryPanel({ accountId, desktopMode, state, setState, busy = false, navigationBusy = busy, notify, onOpenProfile, onOpenConversation, onOpenTaskPage, onActive }) {
  const api = globalThis.collectorDesktop?.creators;
  const config = normalizeCreatorState(state);
  const snapshot = config.snapshot.accountId === accountId ? config.snapshot : { ...EMPTY_CREATOR_SNAPSHOT, accountId };
  const [pending, setPending] = useState("");
  const [failure, setFailure] = useState(null);
  const [navigationFailure, setNavigationFailure] = useState("");
  const [opening, setOpening] = useState("");
  const accountRef = useRef(accountId);
  const setterRef = useRef(setState);
  const snapshotRef = useRef(snapshot);
  const generation = useRef(0);
  const retiredRuns = useRef(new Set());
  const pendingSearch = useRef(false);
  const searchLock = useRef(false);
  const navigationLock = useRef(false);
  const navigationGeneration = useRef(0);
  const mounted = useRef(false);
  const fields = useRef({});
  accountRef.current = accountId;
  setterRef.current = setState;
  snapshotRef.current = snapshot;

  const change = (patch) => {
    setFailure(null);
    setState((previous) => ({ ...normalizeCreatorState(previous), ...patch }));
  };
  const accept = useCallback((raw, allowNewRun = false) => {
    if (raw?.accountId !== accountRef.current || retiredRuns.current.has(raw.runId)) return;
    const mayStart = allowNewRun || (pendingSearch.current && Boolean(raw.runId));
    const next = mergeCreatorSnapshot(snapshotRef.current, raw, { accountId: accountRef.current, allowNewRun: mayStart });
    if (next === snapshotRef.current) return;
    if (next.runId) pendingSearch.current = false;
    snapshotRef.current = next;
    setterRef.current((previous) => ({ ...normalizeCreatorState(previous), snapshot: next }));
  }, []);

  useEffect(() => {
    let disposed = false;
    mounted.current = true;
    const requestGeneration = ++generation.current;
    navigationGeneration.current += 1;
    retiredRuns.current.clear();
    pendingSearch.current = false;
    searchLock.current = false;
    navigationLock.current = false;
    setPending("");
    setOpening("");
    setFailure(null);
    setNavigationFailure("");
    const receive = (next) => { if (!disposed && next?.accountId === accountId) accept(next); };
    const unsubscribe = api?.onProgress?.(receive);
    api?.getState?.(accountId).then((next) => {
      if (!disposed && requestGeneration === generation.current) accept(next, true);
    }).catch((error) => {
      if (!disposed && requestGeneration === generation.current) setFailure({ message: error.message || "读取达人搜索状态失败" });
    });
    return () => { disposed = true; mounted.current = false; navigationGeneration.current += 1; unsubscribe?.(); };
  }, [accountId, api, accept]);

  const active = snapshot.phase === "searching";
  const searchLocked = active || Boolean(pending) || Boolean(opening) || busy || navigationBusy;
  const navigationLocked = Boolean(opening) || navigationBusy;
  useEffect(() => { onActive?.(active); }, [active, onActive]);
  const errorMessage = failure?.message || (["error", "paused"].includes(snapshot.phase) ? snapshot.message : "");
  const supported = desktopMode && typeof api?.search === "function";
  const fieldErrorId = `creator-field-error-${accountId}`;

  const search = async (event) => {
    event.preventDefault();
    if (searchLocked || searchLock.current) return;
    const validation = validateCreatorSearch(config);
    if (!validation.ok) {
      setFailure(validation);
      fields.current[validation.field]?.focus();
      return;
    }
    if (!supported) { setFailure({ message: "找达人需要使用新版桌面软件" }); return; }
    const owner = accountId;
    const requestGeneration = ++generation.current;
    searchLock.current = true;
    pendingSearch.current = true;
    if (snapshotRef.current.runId) retiredRuns.current.add(snapshotRef.current.runId);
    const initial = { ...EMPTY_CREATOR_SNAPSHOT, accountId: owner, phase: "searching", active: true, stage: "collecting", keyword: validation.query.keyword, message: "正在发现候选作者" };
    snapshotRef.current = initial;
    setState((previous) => ({ ...normalizeCreatorState(previous), keyword: validation.query.keyword, snapshot: initial }));
    setFailure(null);
    setNavigationFailure("");
    setPending("search");
    try {
      const next = await api.search(owner, validation.query);
      if (mounted.current && owner === accountRef.current && requestGeneration === generation.current) accept(next, true);
    } catch (error) {
      if (mounted.current && owner === accountRef.current && requestGeneration === generation.current) {
        pendingSearch.current = false;
        const message = error.message || "查找失败，请重试";
        const next = { ...snapshotRef.current, phase: "error", active: false, message };
        snapshotRef.current = next;
        setState((previous) => ({ ...normalizeCreatorState(previous), snapshot: next }));
        setFailure({ message });
        notify?.(message, "error");
      }
    } finally {
      if (mounted.current && owner === accountRef.current && requestGeneration === generation.current) {
        searchLock.current = false;
        setPending("");
      }
    }
  };
  const stop = async () => {
    if (searchLock.current || typeof api?.stop !== "function") return;
    const owner = accountId;
    searchLock.current = true;
    setPending("stop");
    setFailure(null);
    try { const next = await api.stop(owner); if (mounted.current && owner === accountRef.current) accept(next); }
    catch (error) { if (mounted.current && owner === accountRef.current) { setFailure({ message: error.message || "停止查找失败，请重试" }); notify?.(error.message, "error"); } }
    finally { if (mounted.current && owner === accountRef.current) { searchLock.current = false; setPending(""); } }
  };
  const openPage = async (kind, creator) => {
    if (navigationLocked || navigationLock.current || !desktopMode) return;
    const owner = accountId;
    const requestGeneration = navigationGeneration.current;
    const callbacks = { profile: onOpenProfile, conversation: onOpenConversation, task: onOpenTaskPage };
    const methods = { profile: "openProfile", conversation: "openConversation", task: "openTaskPage" };
    const labels = { profile: "达人主页", conversation: "达人私信", task: "任务页面" };
    navigationLock.current = true;
    setOpening(`${kind}:${creator?.userId || ""}`);
    setNavigationFailure("");
    try {
      if (callbacks[kind]) await callbacks[kind](owner, creator);
      else if (typeof api?.[methods[kind]] === "function") {
        const result = await api[methods[kind]](owner, creator);
        if (result?.status !== "opened") throw new Error(result?.message || result?.reason || `尚未确认打开${labels[kind]}`);
      } else throw new Error(`当前桌面版本不支持打开${labels[kind]}`);
    } catch (error) {
      if (mounted.current && owner === accountRef.current && requestGeneration === navigationGeneration.current) {
        const message = error.message || `打开${labels[kind]}失败，请重试`;
        setNavigationFailure(message);
        notify?.(message, "error");
      }
    } finally {
      if (mounted.current && owner === accountRef.current && requestGeneration === navigationGeneration.current) {
        navigationLock.current = false;
        setOpening("");
      }
    }
  };
  const invalid = (field) => failure?.field === field ? { "aria-invalid": true, "aria-describedby": fieldErrorId } : {};
  const stageLabel = snapshot.stage === "checking" ? "核验公开主页与内容" : "发现候选作者";
  const emptyLabel = snapshot.needsRecheck ? "历史结果需要重新核验"
    : active ? snapshot.stage === "checking" ? "正在核验候选作者，尚无已核验匹配达人" : "正在发现候选作者"
    : snapshot.phase === "completed" ? snapshot.candidates === 0 ? "没有发现候选作者"
      : snapshot.insufficient > 0 && snapshot.checked === snapshot.insufficient ? "公开证据不足，尚无法确认行业匹配"
        : "没有通过领域核验且符合粉丝条件的达人"
      : snapshot.phase === "stopped" ? "本次查找已停止"
        : ["error", "paused"].includes(snapshot.phase) ? "本次查找未完成" : "暂无达人";

  return (
    <section className="panel-body creator-panel" aria-label="找达人">
      <form className="creator-controls" onSubmit={search} noValidate>
        <fieldset disabled={searchLocked}>
          <legend>查找达人</legend>
          <div className="creator-query-row">
            <label className="creator-keyword">行业关键词<input aria-label="行业关键词" ref={(node) => { fields.current.keyword = node; }} value={config.keyword} maxLength={160} onChange={(event) => change({ keyword: event.target.value })} {...invalid("keyword")} /></label>
            <label>最多 <select aria-label="搜索达人数" ref={(node) => { fields.current.limit = node; }} value={config.limit} onChange={(event) => change({ limit: event.target.value })} {...invalid("limit")}>{[20, 30, 50, 100].map((limit) => <option value={limit} key={limit}>{limit} 人</option>)}</select></label>
            {!active && <button className="button primary" type="submit" disabled={searchLocked || !supported}><IconSearch size={16} aria-hidden="true" />查找达人</button>}
          </div>
          <div className="creator-filter-row">
            <label>粉丝量 <select aria-label="达人粉丝量范围" value={config.preset} onChange={(event) => change({ preset: event.target.value })}>{CREATOR_FOLLOWER_PRESETS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
            {config.preset === "custom" && <div className="creator-custom-range">
              <label>最低 <input aria-label="最低粉丝量" ref={(node) => { fields.current.minFollowers = node; }} type="number" inputMode="numeric" min="0" step="1" value={config.minFollowers} onChange={(event) => change({ minFollowers: event.target.value })} {...invalid("minFollowers")} /></label>
              <span aria-hidden="true">至</span>
              <label>最高 <input aria-label="最高粉丝量" ref={(node) => { fields.current.maxFollowers = node; }} type="number" inputMode="numeric" min="0" step="1" value={config.maxFollowers} onChange={(event) => change({ maxFollowers: event.target.value })} {...invalid("maxFollowers")} /></label>
            </div>}
          </div>
        </fieldset>
        {failure?.field && <p className="creator-error" id={fieldErrorId} role="alert"><IconAlertCircle size={16} aria-hidden="true" />{failure.message}</p>}
      </form>
      <div className="creator-results-heading">
        <div className="creator-result-count"><IconUsers size={17} aria-hidden="true" /><strong>已核验匹配 {snapshot.creators.length} 位达人</strong></div>
        {active && <button className="button" type="button" disabled={Boolean(pending)} onClick={stop}><IconPlayerStop size={15} aria-hidden="true" />{pending === "stop" ? "正在停止" : "停止查找"}</button>}
        {snapshot.phase === "paused" && desktopMode && <button className="button" type="button" disabled={navigationLocked} onClick={() => openPage("task")}><IconExternalLink size={15} aria-hidden="true" />{opening === "task:" ? "打开中" : "检查任务页面"}</button>}
        {(active || snapshot.candidates > 0 || snapshot.checked > 0) && <div className="creator-verification-progress" aria-label="达人核验进度">
          {active && <strong>{stageLabel}</strong>}<span>候选 {snapshot.candidates} 位</span><span>已核验 {snapshot.checked} 位</span><span>不符合条件 {snapshot.rejected} 位</span><span>证据不足 {snapshot.insufficient} 位</span>
        </div>}
        <div className={`creator-run-status${errorMessage ? " is-error" : ""}`} role={errorMessage && !failure?.field ? "alert" : "status"}>
          {errorMessage && !failure?.field ? <><IconAlertCircle size={15} aria-hidden="true" />{errorMessage}</>
            : !desktopMode ? "请在桌面软件中使用找达人"
              : snapshot.message && !["error", "paused"].includes(snapshot.phase) ? <>{active && <IconLoader2 size={15} className="creator-spinner" aria-hidden="true" />}{snapshot.message}</>
                : busy && !active ? "当前账号正在执行其他任务" : null}
        </div>
        {navigationFailure && <p className="creator-error creator-navigation-error" role="alert" aria-label="达人页面打开失败"><IconAlertCircle size={16} aria-hidden="true" />{navigationFailure}</p>}
      </div>
      <ul className="creator-list" aria-label="达人列表">
        {snapshot.creators.map((creator) => <li className="creator-card" key={creator.userId}>
          <div className="creator-avatar"><IconUserCircle size={36} aria-hidden="true" />{creator.avatarUrl && <img src={creator.avatarUrl} alt="" width="44" height="44" loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.hidden = true; }} />}</div>
          <div className="creator-card-content">
            <div className="creator-card-heading"><h2>{creator.nickname}</h2><div className="creator-followers"><strong>{creatorCountLabel(creator.followers, creator.followerLabel)}</strong><span>粉丝</span></div></div>
            <div className="creator-identity"><span>小红书号：{creator.redId || creator.userId}</span>{creator.location && <span>{creator.location}</span>}</div>
            <p className="creator-description">{creator.description || "暂无公开简介"}</p>
            <CreatorEvidence relevance={creator.relevance} />
            {(creator.likes !== null || creator.noteCount !== null) && <div className="creator-stats">{creator.likes !== null && <span>获赞 {creatorCountLabel(creator.likes)}</span>}{creator.noteCount !== null && <span>笔记 {creatorCountLabel(creator.noteCount)}</span>}</div>}
          </div>
          <div className="creator-card-actions">
            <button className="button creator-profile-button" type="button" aria-label={`打开达人主页 ${creator.nickname}`} disabled={navigationLocked || !desktopMode} onClick={() => openPage("profile", creator)}>{opening === `profile:${creator.userId}` ? <IconLoader2 size={16} className="creator-spinner" aria-hidden="true" /> : <IconExternalLink size={16} aria-hidden="true" />}{opening === `profile:${creator.userId}` ? "打开中" : "主页"}</button>
            <button className="button creator-message-button" type="button" aria-label={`私信达人 ${creator.nickname}`} disabled={navigationLocked || !desktopMode} onClick={() => openPage("conversation", creator)}>{opening === `conversation:${creator.userId}` ? <IconLoader2 size={16} className="creator-spinner" aria-hidden="true" /> : <IconMessageCircle size={16} aria-hidden="true" />}{opening === `conversation:${creator.userId}` ? "打开中" : "私信"}</button>
          </div>
        </li>)}
        {!snapshot.creators.length && <li className="creator-empty">{active ? <IconLoader2 size={28} className="creator-spinner" aria-hidden="true" /> : <IconUsers size={28} aria-hidden="true" />}<strong>{emptyLabel}</strong></li>}
      </ul>
    </section>
  );
}
