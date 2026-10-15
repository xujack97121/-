import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconPlus, IconTrash, IconPlayerPlay, IconPlayerStop, IconMessageCircle, IconX } from "@tabler/icons-react";
import { DEFAULT_DM_CONFIG, DM_STATUS_LABELS, isDmSelectable, previewMessages } from "./direct-messages.js";
import "./direct-messages.css";

const EMPTY = { phase: "idle", active: false, sessionId: "", candidates: [], notes: [], message: "", completed: 0, total: 0, revision: 0 };

export function DirectMessagePanel({ accountId, config = DEFAULT_DM_CONFIG, setConfig, tasks, setTasks, desktopMode, otherBusy, notify, onActive }) {
  const api = globalThis.collectorDesktop?.directMessages;
  const [status, setStatus] = useState(EMPTY);
  const [selection, setSelection] = useState({ sessionId: "", tokens: new Set() });
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [review, setReview] = useState(null);
  const [noteListOpen, setNoteListOpen] = useState(true);
  const [messagesOpen, setMessagesOpen] = useState(true);
  const dialogRef = useRef(null);
  const openerRef = useRef(null);
  const accountRef = useRef(accountId);
  accountRef.current = accountId;
  const acceptSnapshot = useCallback((next) => {
    if (next.accountId !== accountRef.current) return;
    setStatus((current) => current.accountId === next.accountId && Number(current.revision) > Number(next.revision) ? current : next);
  }, []);
  const active = Boolean(status.active);
  const locked = active || busy || Boolean(review) || otherBusy;
  const messages = config.messages ?? [""];
  const selectedNotes = tasks.filter((task) => task.selected);
  const candidates = status.candidates || [];
  const eligible = candidates.filter(isDmSelectable);
  const selected = selection.tokens;
  const preview = useMemo(() => previewMessages(candidates, selected, messages, config.limit), [candidates, selected, messages, config.limit]);
  const assignments = new Map(preview.map((row) => [row.token, row.message]));

  useEffect(() => {
    let disposed = false;
    setStatus({ ...EMPTY, accountId });
    setSelection({ sessionId: "", tokens: new Set() });
    setReview(null);
    setError("");
    setBusy(false);
    setUrl("");
    const receive = (next) => {
      if (disposed || next.accountId !== accountId) return;
      acceptSnapshot(next);
    };
    api?.getState(accountId).then(receive).catch((failure) => { if (!disposed) setError(failure.message); });
    const unsubscribe = api?.onProgress(receive);
    return () => { disposed = true; unsubscribe?.(); };
  }, [accountId, api, acceptSnapshot]);

  useEffect(() => {
    onActive?.(active);
    setSelection((current) => {
      if (current.sessionId !== status.sessionId) return { sessionId: status.sessionId, tokens: new Set(candidates.filter(isDmSelectable).map((row) => row.token)) };
      if (status.phase !== "collecting") return current;
      return { ...current, tokens: new Set([...current.tokens, ...candidates.filter(isDmSelectable).map((row) => row.token)]) };
    });
  }, [status.sessionId, status.phase, status.candidates, active, onActive]);

  useEffect(() => {
    if (!review) return;
    dialogRef.current?.querySelector("button")?.focus();
    return () => openerRef.current?.focus();
  }, [review]);

  const invoke = async (action) => {
    if (!desktopMode || !api) { setError("评论区私信仅支持新版桌面软件"); return; }
    setBusy(true);
    setError("");
    try { await action(); } catch (failure) {
      if (accountRef.current === accountId) { setError(failure.message); notify(failure.message, "error"); }
    } finally { if (accountRef.current === accountId) setBusy(false); }
  };
  const addNote = () => {
    try {
      const link = new URL(url.trim());
      const id = link.pathname.match(/^\/(?:explore|discovery\/item)\/([a-f\d]{24})\/?$/i)?.[1];
      if (!id || link.protocol !== "https:" || !["www.xiaohongshu.com", "xiaohongshu.com"].includes(link.hostname)
        || link.username || link.password || link.port) throw new Error("请输入完整的小红书笔记链接");
      setTasks((previous) => previous.some((task) => task.id === id)
        ? previous.map((task) => task.id === id ? { ...task, link: link.href, selected: true } : task)
        : [...previous, { id, link: link.href, title: "手动添加的笔记", selected: true, status: "待执行" }]);
      setUrl("");
      setError("");
    } catch (failure) { setError(failure.message); }
  };
  const collect = () => invoke(async () => {
    setReview(null);
    acceptSnapshot(await api.collect(accountId, selectedNotes.map(({ id, title, link }) => ({ id, title, link }))));
  });
  const toggle = (token, checked) => setSelection((current) => {
    const tokens = new Set(current.tokens);
    if (checked) tokens.add(token); else tokens.delete(token);
    return { ...current, tokens };
  });
  const openReview = () => invoke(async () => {
    openerRef.current = document.activeElement;
    const result = await api.review(accountId, { tokens: [...selected], messages, limit: config.limit, intervalSeconds: config.intervalSeconds });
    if (accountRef.current === accountId) setReview(result);
  });
  const send = () => invoke(async () => {
    const result = await api.start(accountId, review.reviewId);
    acceptSnapshot(result);
    if (accountRef.current === accountId) setReview(null);
  });
  const trapFocus = (event) => {
    if (event.key === "Escape" && !busy) { event.stopPropagation(); setReview(null); }
    if (event.key !== "Tab") return;
    const focusable = [...dialogRef.current.querySelectorAll("button:not(:disabled)")];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  return (
    <div className="panel-body dm-panel">
      <div className="dm-settings">
        <fieldset>
          <legend>目标笔记</legend>
          <div className="inline-form"><input aria-label="私信目标笔记链接" value={url} disabled={locked} onChange={(event) => setUrl(event.target.value)} /><button className="button" type="button" disabled={locked} onClick={addNote}><IconPlus size={16} aria-hidden="true" />添加链接</button></div>
          <div className="dm-section-toolbar"><button className="button quiet" type="button" aria-expanded={noteListOpen} onClick={() => setNoteListOpen(!noteListOpen)}>目标笔记 {selectedNotes.length} / {tasks.length}</button><span className="spacer" /><button className="button quiet" type="button" disabled={locked || !tasks.length} onClick={() => setTasks((previous) => previous.map((task) => ({ ...task, selected: selectedNotes.length !== tasks.length })))}>{selectedNotes.length === tasks.length && tasks.length ? "取消全选" : "全选"}</button></div>
          {noteListOpen && <div className="dm-note-list">{tasks.map((task, index) => {
            const progress = status.notes.find((note) => note.id === task.id);
            return <div className="dm-note-row" key={task.id || task.link}><label><input aria-label={`选择私信笔记 ${index + 1}`} type="checkbox" checked={Boolean(task.selected)} disabled={locked} onChange={(event) => setTasks((previous) => previous.map((row) => row.id === task.id ? { ...row, selected: event.target.checked } : row))} /><span title={task.link}>{task.title}</span></label><span title={progress?.status}>{progress ? `${progress.collected} 条 · ${progress.status}` : "待采集"}</span><button className="icon-button" type="button" aria-label={`移除私信笔记 ${index + 1}`} title="移除笔记" disabled={locked} onClick={() => setTasks((previous) => previous.filter((row) => row !== task))}><IconTrash size={14} aria-hidden="true" /></button></div>;
          })}{!tasks.length && <div className="empty-task">暂无目标笔记</div>}</div>}
        </fieldset>
        <fieldset>
          <legend>私信配置</legend>
          <div className="dm-limit-row"><label>每次上限 <input className="short" aria-label="私信发送人数上限" type="number" min="1" max="500" step="1" value={config.limit} disabled={locked} onChange={(event) => setConfig({ limit: event.target.value })} /> 人</label><label>间隔 <input className="short" aria-label="私信发送间隔秒数" type="number" min="1" max="36000" step="0.1" value={config.intervalSeconds} disabled={locked} onChange={(event) => setConfig({ intervalSeconds: event.target.value })} /> 秒</label></div>
          <div className="dm-section-toolbar"><button className="button quiet" type="button" aria-expanded={messagesOpen} onClick={() => setMessagesOpen(!messagesOpen)}>消息内容 {messages.length} 段</button><span className="spacer" /><button className="icon-button" type="button" title="添加消息" aria-label="添加私信消息" disabled={locked || messages.length >= 50} onClick={() => setConfig({ messages: [...messages, ""] })}><IconPlus size={16} aria-hidden="true" /></button></div>
          {messagesOpen && <div className="dm-message-list">{messages.map((message, index) => <div className="dm-message-editor" key={index}><label htmlFor={`dm-message-${accountId}-${index}`}>消息 {index + 1}</label><textarea id={`dm-message-${accountId}-${index}`} aria-label={`私信消息 ${index + 1}`} maxLength={4000} value={message} disabled={locked} onChange={(event) => setConfig({ messages: messages.map((text, position) => position === index ? event.target.value : text) })} /><button className="icon-button" type="button" title="删除消息" aria-label={`删除私信消息 ${index + 1}`} disabled={locked || messages.length === 1} onClick={() => setConfig({ messages: messages.filter((_, position) => position !== index) })}><IconTrash size={15} aria-hidden="true" /></button></div>)}</div>}
        </fieldset>
      </div>
      <div className="dm-progress">
        <div className="action-row"><strong>{candidates.length} 位用户</strong><span className="selection-count">本次 {preview.length} 人</span><span className="spacer" />
          {active ? <button className="button primary" type="button" disabled={busy} onClick={() => invoke(async () => acceptSnapshot(await api.stop(accountId)))}><IconPlayerStop size={16} aria-hidden="true" />停止任务</button> : <>
            <button className="button" type="button" disabled={locked || !selectedNotes.length || !desktopMode || !api} onClick={collect}><IconPlayerPlay size={16} aria-hidden="true" />采集用户</button>
            <button className="button primary" type="button" disabled={locked || !preview.length || !desktopMode || !api} onClick={openReview}><IconMessageCircle size={16} aria-hidden="true" />确认发送</button>
          </>}
        </div>
        {error && <div className="dm-error" role="alert">{error}</div>}
        {status.message && <div className={`dm-run-status ${status.phase === "paused" ? "dm-error" : ""}`} role="status"><span>{status.message}</span><span>{status.completed} / {status.total}</span>{active && <progress aria-label="私信任务进度" max={Math.max(1, status.total)} value={status.completed} />}</div>}
      </div>
      <div className="table-wrap dm-candidates"><table><thead><tr><th className="check"><input type="checkbox" aria-label="全选私信用户" disabled={locked || !eligible.length} checked={eligible.length > 0 && eligible.every((row) => selected.has(row.token))} onChange={(event) => setSelection({ sessionId: status.sessionId, tokens: new Set(event.target.checked ? eligible.map((row) => row.token) : []) })} /></th><th className="dm-user-col">用户</th><th>来源 / 评论</th><th>分配消息</th><th className="dm-status-col">状态</th></tr></thead><tbody>
        {candidates.map((candidate) => <tr key={candidate.token} className={selected.has(candidate.token) && isDmSelectable(candidate) ? "selected" : ""}><td className="check"><input type="checkbox" aria-label={`选择私信用户 ${candidate.nickname}`} checked={selected.has(candidate.token) && isDmSelectable(candidate)} disabled={locked || !isDmSelectable(candidate)} onChange={(event) => toggle(candidate.token, event.target.checked)} /></td><td title={candidate.nickname}>{candidate.nickname}</td><td><div className="dm-cell-content" title={candidate.sources.map((source) => `${source.title}\n${source.content}`).join("\n\n")}>{candidate.sources[0]?.title}<small>{candidate.sources[0]?.content}</small>{candidate.sources.length > 1 && <small>来自 {candidate.sources.length} 条笔记</small>}</div></td><td><div className="dm-cell-content" title={assignments.get(candidate.token) || candidate.message || ""}>{assignments.get(candidate.token) || candidate.message || "未分配"}</div></td><td className={candidate.status === "unconfirmed" ? "dm-error" : ""}><div className="dm-cell-content" title={candidate.reason}>{DM_STATUS_LABELS[candidate.status] || candidate.status}{candidate.reason && <small>{candidate.reason}</small>}</div></td></tr>)}
        {!candidates.length && <tr><td colSpan="5" className="empty">{status.phase === "collecting" ? "正在采集主评论用户" : "暂无收件人"}</td></tr>}
      </tbody></table></div>
      {review && <div className="dm-dialog-backdrop"><div className="dm-confirm-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="dm-confirm-title" tabIndex={-1} onKeyDown={trapFocus}>
        <div className="dm-dialog-heading"><h2 id="dm-confirm-title">确认发送 {review.assignments.length} 人</h2><button className="icon-button" type="button" title="关闭确认" aria-label="关闭私信确认" disabled={busy} onClick={() => setReview(null)}><IconX size={18} aria-hidden="true" /></button></div>
        <div className="dm-confirm-summary">间隔 {review.intervalSeconds} 秒<span className="spacer" />已剔除楼主、自己和历史已处理用户</div>
        <div className="dm-confirm-list">{review.assignments.map((row, index) => <div key={row.token}><strong>{index + 1}. {row.nickname}</strong><p>{row.message}</p></div>)}</div>
        {error && <div role="alert" className="dm-error">{error}</div>}
        <div className="dm-dialog-footer"><button className="button" type="button" disabled={busy} onClick={() => setReview(null)}>取消</button><button className="button primary" type="button" disabled={busy} onClick={send}><IconPlayerPlay size={16} aria-hidden="true" />{busy ? "正在启动" : "开始发送"}</button></div>
      </div></div>}
    </div>
  );
}
