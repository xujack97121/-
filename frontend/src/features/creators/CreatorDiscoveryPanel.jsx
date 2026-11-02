import { useCallback, useEffect, useRef, useState } from "react";
import { IconAlertCircle, IconLoader2, IconMessageCircle, IconPlayerStop, IconSearch, IconUserCircle, IconUsers } from "@tabler/icons-react";
import { CREATOR_FOLLOWER_PRESETS, EMPTY_CREATOR_SNAPSHOT, creatorCountLabel, mergeCreatorSnapshot, normalizeCreatorState, validateCreatorSearch } from "./creator-discovery.js";
import "./creator-discovery.css";

export function CreatorDiscoveryPanel({ accountId, desktopMode, state, setState, busy = false, notify, onOpenConversation, onActive }) {
  const api = globalThis.collectorDesktop?.creators;
  const config = normalizeCreatorState(state);
  const snapshot = config.snapshot.accountId === accountId ? config.snapshot : { ...EMPTY_CREATOR_SNAPSHOT, accountId };
  const [pending, setPending] = useState("");
  const [failure, setFailure] = useState(null);
  const [opening, setOpening] = useState("");
  const accountRef = useRef(accountId);
  const setterRef = useRef(setState);
  const snapshotRef = useRef(snapshot);
  const generation = useRef(0);
  const retiredRuns = useRef(new Set());
  const pendingSearch = useRef(false);
  const actionLock = useRef(false);
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
    const requestGeneration = ++generation.current;
    retiredRuns.current.clear();
    pendingSearch.current = false;
    actionLock.current = false;
    setPending("");
    setOpening("");
    setFailure(null);
    const receive = (next) => { if (!disposed && next?.accountId === accountId) accept(next); };
    const unsubscribe = api?.onProgress?.(receive);
    api?.getState?.(accountId).then((next) => {
      if (!disposed && requestGeneration === generation.current) accept(next, true);
    }).catch((error) => {
      if (!disposed && requestGeneration === generation.current) setFailure({ message: error.message || "读取达人搜索状态失败" });
    });
    return () => { disposed = true; unsubscribe?.(); };
  }, [accountId, api, accept]);

  const active = snapshot.phase === "searching";
  const locked = active || Boolean(pending) || Boolean(opening) || busy;
  useEffect(() => { onActive?.(active); }, [active, onActive]);
  const errorMessage = failure?.message || (["error", "paused"].includes(snapshot.phase) ? snapshot.message : "");
  const supported = desktopMode && typeof api?.search === "function";
  const fieldErrorId = `creator-field-error-${accountId}`;

  const search = async (event) => {
    event.preventDefault();
    if (locked || actionLock.current) return;
    const validation = validateCreatorSearch(config);
    if (!validation.ok) {
      setFailure(validation);
      fields.current[validation.field]?.focus();
      return;
    }
    if (!supported) { setFailure({ message: "找达人需要使用新版桌面软件" }); return; }
    const owner = accountId;
    const requestGeneration = ++generation.current;
    actionLock.current = true;
    pendingSearch.current = true;
    if (snapshotRef.current.runId) retiredRuns.current.add(snapshotRef.current.runId);
    const initial = { ...EMPTY_CREATOR_SNAPSHOT, accountId: owner, phase: "searching", active: true, keyword: validation.query.keyword, message: "正在查找相关达人" };
    snapshotRef.current = initial;
    setState((previous) => ({ ...normalizeCreatorState(previous), keyword: validation.query.keyword, snapshot: initial }));
    setFailure(null);
    setPending("search");
    try {
      const next = await api.search(owner, validation.query);
      if (owner === accountRef.current && requestGeneration === generation.current) accept(next, true);
    } catch (error) {
      if (owner === accountRef.current && requestGeneration === generation.current) {
        pendingSearch.current = false;
        const message = error.message || "查找失败，请重试";
        const next = { ...snapshotRef.current, phase: "error", active: false, message };
        snapshotRef.current = next;
        setState((previous) => ({ ...normalizeCreatorState(previous), snapshot: next }));
        setFailure({ message });
        notify?.(message, "error");
      }
    } finally {
      if (owner === accountRef.current && requestGeneration === generation.current) {
        actionLock.current = false;
        setPending("");
      }
    }
  };
  const stop = async () => {
    if (actionLock.current || typeof api?.stop !== "function") return;
    const owner = accountId;
    actionLock.current = true;
    setPending("stop");
    setFailure(null);
    try { const next = await api.stop(owner); if (owner === accountRef.current) accept(next); }
    catch (error) { if (owner === accountRef.current) { setFailure({ message: error.message || "停止查找失败，请重试" }); notify?.(error.message, "error"); } }
    finally { if (owner === accountRef.current) { actionLock.current = false; setPending(""); } }
  };
  const openConversation = async (creator) => {
    if (locked || actionLock.current) return;
    const owner = accountId;
    actionLock.current = true;
    setOpening(creator.userId);
    setFailure(null);
    try {
      if (onOpenConversation) await onOpenConversation(owner, creator);
      else if (typeof api?.openConversation === "function") await api.openConversation(owner, creator);
      else throw new Error("当前桌面版本不支持打开达人私信");
    } catch (error) {
      if (owner === accountRef.current) { setFailure({ message: error.message || "打开私信失败，请重试" }); notify?.(error.message, "error"); }
    } finally { if (owner === accountRef.current) { actionLock.current = false; setOpening(""); } }
  };
  const invalid = (field) => failure?.field === field ? { "aria-invalid": true, "aria-describedby": fieldErrorId } : {};
  const emptyLabel = active ? "正在查找相关达人"
    : snapshot.phase === "completed" ? "没有找到符合条件的达人"
      : snapshot.phase === "stopped" ? "本次查找已停止"
        : ["error", "paused"].includes(snapshot.phase) ? "本次查找未完成" : "暂无达人";

  return (
    <section className="panel-body creator-panel" aria-label="找达人">
      <form className="creator-controls" onSubmit={search} noValidate>
        <fieldset disabled={locked}>
          <legend>查找达人</legend>
          <div className="creator-query-row">
            <label className="creator-keyword">行业关键词<input aria-label="行业关键词" ref={(node) => { fields.current.keyword = node; }} value={config.keyword} maxLength={160} onChange={(event) => change({ keyword: event.target.value })} {...invalid("keyword")} /></label>
            <label>最多 <select aria-label="搜索达人数" ref={(node) => { fields.current.limit = node; }} value={config.limit} onChange={(event) => change({ limit: event.target.value })} {...invalid("limit")}>{[20, 30, 50, 100].map((limit) => <option value={limit} key={limit}>{limit} 人</option>)}</select></label>
            {!active && <button className="button primary" type="submit" disabled={locked || !supported}><IconSearch size={16} aria-hidden="true" />查找达人</button>}
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
        <div className="creator-result-count"><IconUsers size={17} aria-hidden="true" /><strong>{snapshot.creators.length} 位达人</strong>{snapshot.scanned > 0 && <span>已查看 {snapshot.scanned} 位</span>}</div>
        {active && <button className="button" type="button" disabled={Boolean(pending)} onClick={stop}><IconPlayerStop size={15} aria-hidden="true" />{pending === "stop" ? "正在停止" : "停止查找"}</button>}
        <div className={`creator-run-status${errorMessage ? " is-error" : ""}`} role={errorMessage && !failure?.field ? "alert" : "status"}>
          {errorMessage && !failure?.field ? <><IconAlertCircle size={15} aria-hidden="true" />{errorMessage}</>
            : !desktopMode ? "请在桌面软件中使用找达人"
              : busy && !active ? "当前账号正在执行其他任务"
                : snapshot.message && !["error", "paused"].includes(snapshot.phase) ? <>{active && <IconLoader2 size={15} className="creator-spinner" aria-hidden="true" />}{snapshot.message}</> : null}
        </div>
      </div>
      <ul className="creator-list" aria-label="达人列表" aria-busy={active}>
        {snapshot.creators.map((creator) => <li className="creator-card" key={creator.userId}>
          <div className="creator-avatar"><IconUserCircle size={36} aria-hidden="true" />{creator.avatarUrl && <img src={creator.avatarUrl} alt="" width="44" height="44" loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.hidden = true; }} />}</div>
          <div className="creator-card-content">
            <div className="creator-card-heading"><h2>{creator.nickname}</h2><div className="creator-followers"><strong>{creatorCountLabel(creator.followers, creator.followerLabel)}</strong><span>粉丝</span></div></div>
            <div className="creator-identity"><span>小红书号：{creator.redId || creator.userId}</span>{creator.location && <span>{creator.location}</span>}</div>
            <p className="creator-description">{creator.description || "暂无公开简介"}</p>
            {(creator.likes !== null || creator.noteCount !== null) && <div className="creator-stats">{creator.likes !== null && <span>获赞 {creatorCountLabel(creator.likes)}</span>}{creator.noteCount !== null && <span>笔记 {creatorCountLabel(creator.noteCount)}</span>}</div>}
          </div>
          <button className="button creator-message-button" type="button" aria-label={`私信达人 ${creator.nickname}`} disabled={locked || !desktopMode} onClick={() => openConversation(creator)}>{opening === creator.userId ? <IconLoader2 size={16} className="creator-spinner" aria-hidden="true" /> : <IconMessageCircle size={16} aria-hidden="true" />}{opening === creator.userId ? "打开中" : "私信"}</button>
        </li>)}
        {!snapshot.creators.length && <li className="creator-empty">{active ? <IconLoader2 size={28} className="creator-spinner" aria-hidden="true" /> : <IconUsers size={28} aria-hidden="true" />}<strong>{emptyLabel}</strong></li>}
      </ul>
    </section>
  );
}
