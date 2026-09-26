import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconChartBar, IconChevronLeft, IconChevronRight, IconDownload, IconFilter,
  IconMessageCircle, IconPlayerStop, IconPlus, IconRefresh, IconTrash, IconX,
} from "@tabler/icons-react";
import { filterNoteComments, groupCommentNotes, summarizeNoteComments } from "./comment-notes.js";
import "./comments-panel.css";
import { CommentInsights } from "./CommentInsights.jsx";

const PAGE_SIZE = 50;
const columns = [
  { key: "noteId", label: "笔记ID" }, { key: "time", label: "时间" },
  { key: "nickname", label: "昵称" }, { key: "content", label: "评论内容" },
  { key: "authorId", label: "公开UID（已脱敏）" }, { key: "region", label: "地区" },
  { key: "likes", label: "评论点赞数" }, { key: "replyCount", label: "评论回复数" },
];

function Distribution({ title, rows, total, empty, tone = "" }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return <section className={`comment-distribution ${tone}`}>
    <h3>{title}</h3>
    {rows.length ? <ul>{rows.map((row) => <li key={row.label}>
      <span title={row.label}>{row.label}</span>
      <span className="comment-bar"><i style={{ width: `${row.count / max * 100}%` }} /></span>
      <b>{row.count}<small>{total ? ` · ${Math.round(row.count / total * 100)}%` : ""}</small></b>
    </li>)}</ul> : <p className="comment-muted">{empty}</p>}
  </section>;
}

function CommentDetails({ accountId, group, filters, onClose, onStart, onStop, collecting, starting, busy, onExport, onConfigure, active, settingsRevision }) {
  const entity = group.platform === "douyin" ? "视频" : "笔记";
  const [page, setPage] = useState(1);
  const closeRef = useRef(null);
  const rows = useMemo(() => filterNoteComments(group.comments, filters), [group.comments, filters]);
  const stats = useMemo(() => summarizeNoteComments(group.comments), [group.comments]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  useEffect(() => { setPage(1); }, [group.id, filters.region, filters.contains, filters.timeRange, filters.unique]);
  useEffect(() => { closeRef.current?.focus({ preventScroll: true }); }, []);
  return <aside className="comment-details" aria-label={`${entity}评论统计分析`} onKeyDown={(event) => {
    if (event.key === "Escape") { event.stopPropagation(); onClose(); }
  }}>
    <header className="comment-details-heading">
      <div><span className="comment-eyebrow"><IconChartBar size={15} />评论分析</span><h2>{group.title}</h2><p>{group.author}</p></div>
      <button ref={closeRef} className="icon-button" type="button" title="关闭评论分析" aria-label="关闭评论分析" onClick={onClose}><IconX size={18} /></button>
    </header>
    <div className="comment-details-scroll">
      <dl className="comment-metrics">
        <div><dt>已采集评论</dt><dd>{stats.total.toLocaleString()}</dd></div>
        <div><dt>发言用户</dt><dd>{stats.people.toLocaleString()}</dd></div>
        <div><dt>已知地区</dt><dd>{stats.regionCount.toLocaleString()}</dd></div>
      </dl>
      {!!stats.unknownUsers && <p className="comment-muted">{stats.unknownUsers} 条评论缺少用户信息，未计入用户数</p>}
      <CommentInsights accountId={accountId} group={group} collecting={collecting || starting} onConfigure={onConfigure} active={active} settingsRevision={settingsRevision} />
      <Distribution title="评论地区 · 前 6 项" rows={stats.regions.slice(0, 6)} total={stats.total} empty="暂无地区数据" />
      <Distribution title="评论发布时间 · 最近 7 个日期" rows={stats.days.slice(-7)} empty="暂无时间数据" tone="comment-time-distribution" />
      {!!stats.unknownTimes && <p className="comment-muted">{stats.unknownTimes} 条评论发布时间未知</p>}
      <section className="comment-detail-list">
        <div className="comment-section-heading"><h3>评论明细 <span>{rows.length} / {group.comments.length}</span></h3>
          <button className="icon-button" type="button" title={`导出当前${entity}筛选结果`} aria-label={`导出当前${entity}评论`} disabled={!rows.length} onClick={() => onExport(rows, group.title)}><IconDownload size={16} /></button>
        </div>
        <ol>{rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE).map((row, index) => <li key={`${row.id || ""}-${index}`}>
          <div className="comment-person"><strong>{row.nickname || "匿名用户"}</strong><span>{row.region || "未知地区"}</span></div>
          <p>{row.content || "（无文本内容）"}</p>
          <footer><time>{row.time || "时间未知"}</time>{row.authorId && <span title={row.authorId}>UID {row.authorId}</span>}{row.likes != null && <span>点赞 {row.likes}</span>}{row.replyCount != null && <span>回复 {row.replyCount}</span>}</footer>
        </li>)}</ol>
        {!rows.length && <div className="comment-empty">{group.comments.length ? "没有符合筛选条件的评论" : collecting || starting ? "正在等待评论返回…" : "暂无已采集评论"}</div>}
        {pages > 1 && <div className="comment-pagination">
          <button className="icon-button" type="button" aria-label="上一页评论" title="上一页" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><IconChevronLeft size={16} /></button>
          <span>{currentPage} / {pages}</span>
          <button className="icon-button" type="button" aria-label="下一页评论" title="下一页" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}><IconChevronRight size={16} /></button>
        </div>}
      </section>
    </div>
    <footer className="comment-details-actions">
      <span role="status">{starting ? "正在打开" : collecting ? "采集中" : group.task?.status || "已采集"}</span>
      {collecting ? <button className="button" type="button" onClick={onStop}><IconPlayerStop size={15} />停止采集</button>
        : <button className="button primary" type="button" disabled={starting || busy || !group.link} title={`重新打开${entity}采集，保留已有评论并去重`} onClick={() => onStart(group)}><IconRefresh size={15} />{starting ? "正在打开" : group.comments.length ? "重新采集" : "采集评论"}</button>}
    </footer>
  </aside>;
}

export function CommentsPanel({ accountId, accountName, data, state, setState, tasks, onStart, onStop, onOpen, activeNoteId, starting, notify, downloadCsv, onConfigure, active, settingsRevision, runtimeStatus }) {
  const isDouyin = data.platform === "douyin";
  const entity = isDouyin ? "视频" : "笔记";
  const [deleting, setDeleting] = useState(false);
  const scope = state.scope || "all";
  const openerRef = useRef(null);
  const listRef = useRef(null);
  const groups = useMemo(() => groupCommentNotes(data.notes, data.comments, tasks, data.platform), [data.notes, data.comments, tasks, data.platform]);
  const selected = groups.find((group) => group.id === state.selectedNoteId);
  const rows = useMemo(() => filterNoteComments(data.comments, state), [data.comments, state]);
  const collectedCount = groups.filter((group) => group.comments.length > 0).length;
  const visible = groups.filter((group) => scope === "all" || (scope === "collected" ? group.comments.length > 0 : !group.comments.length));
  const close = () => {
    setState({ selectedNoteId: "" });
    requestAnimationFrame(() => {
      const target = openerRef.current?.isConnected ? openerRef.current : listRef.current;
      target?.focus({ preventScroll: true });
    });
  };
  const exportRows = (items, title = `${entity}评论`) => downloadCsv(`${accountName}-${title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 70)}.csv`, items, isDouyin ? columns.map((column) => column.key === "noteId" ? { ...column, label: "视频ID" } : column) : columns);
  const remove = async (group = null) => {
    if (deleting || starting || (activeNoteId && (!group || activeNoteId === group.id))) return;
    const message = group
      ? `删除“${group.title}”？\n将移除这张卡片及其全部 ${group.comments.length} 条本地评论。`
      : `清空当前账号的全部 ${groups.length} 张卡片和 ${data.comments.length} 条本地评论？`;
    if (!window.confirm(`${message}\n不会删除${isDouyin ? "抖音原视频" : "小红书原笔记"}或平台评论。此操作无法撤销。`)) return;
    setDeleting(true);
    try {
      await data.deleteCommentCard(group?.id ?? null);
      notify(group ? "卡片及其本地评论已删除。" : "全部卡片及本地评论已清空。", "success");
      requestAnimationFrame(() => listRef.current?.focus({ preventScroll: true }));
    } catch (error) { notify(`删除失败：${error.message}`, "error"); }
    finally { setDeleting(false); }
  };
  return <div className="comments-panel">
    <div className="comment-controls">
      <form className="comment-add-form" onSubmit={(event) => { event.preventDefault(); onStart({ link: state.url, title: isDouyin ? "" : "手动添加的笔记", platform: data.platform }); }}>
        <label htmlFor="comment-note-link">评论采集</label>
        <input id="comment-note-link" aria-label={`评论采集${entity}链接`} value={state.url || ""} placeholder={isDouyin ? "https://www.douyin.com/video/视频ID" : "小红书笔记链接"} onChange={(event) => setState({ url: event.target.value })} />
        <button className="button primary" type="submit" disabled={Boolean(starting) || deleting}><IconPlus size={15} />采集评论</button>
      </form>
      {isDouyin && runtimeStatus?.message && <p className={`comment-capture-status ${runtimeStatus.phase === "stopped" || runtimeStatus.phase === "error" ? "is-paused" : ""}`} role="status">{runtimeStatus.message}</p>}
      <details className="comment-filter-controls">
        <summary><IconFilter size={14} />条件筛选{(state.region || state.contains || state.timeRange !== "all" || state.unique) ? " · 已启用" : ""}</summary>
        <div className="comment-filters">
          <label>地区<input value={state.region || ""} onChange={(event) => setState({ region: event.target.value })} /></label>
          <label>评论内容<input value={state.contains || ""} onChange={(event) => setState({ contains: event.target.value })} /></label>
          <label>发布时间<select value={state.timeRange || "all"} onChange={(event) => setState({ timeRange: event.target.value })}><option value="all">不限</option><option value="day">一天内</option><option value="week">一周内</option><option value="month">一月内</option><option value="half-year">半年内</option></select></label>
          <label><input type="checkbox" checked={Boolean(state.unique)} onChange={(event) => setState({ unique: event.target.checked })} />按{entity}去重用户</label>
          <button className="icon-button" type="button" aria-label="重置评论筛选" title="重置筛选" onClick={() => setState({ region: "", contains: "", timeRange: "all", unique: false })}><IconRefresh size={15} /></button>
        </div>
      </details>
      <div className="comment-library-toolbar">
        <div className="comment-scopes" role="group" aria-label={`${entity}范围`}>{[
          ["all", "全部", groups.length], ["collected", "已采集", collectedCount], ["pending", "待采集", groups.length - collectedCount],
        ].map(([id, label, count]) => <button key={id} type="button" aria-pressed={scope === id} onClick={() => setState({ scope: id })}>{label}<span>{count}</span></button>)}</div>
        <span className="spacer" />
        <span className="comment-total">{data.comments.length} 条评论</span>
        {activeNoteId && <button className="icon-button" type="button" aria-label="停止评论采集" title="停止采集" onClick={onStop}><IconPlayerStop size={16} /></button>}
        <button className="icon-button" type="button" aria-label={`导出全部${entity}评论`} title={`导出筛选后的 ${rows.length} 条评论`} disabled={!rows.length} onClick={() => exportRows(rows)}><IconDownload size={16} /></button>
        <button className="icon-button" type="button" aria-label="清空全部卡片" title={activeNoteId || starting ? "请先停止采集" : "清空全部卡片及本地评论"} disabled={!groups.length || Boolean(activeNoteId) || Boolean(starting) || deleting} onClick={() => remove()}><IconTrash size={16} /></button>
      </div>
    </div>
    <div className={`comment-library ${selected ? "has-details" : ""}`}>
      <div ref={listRef} tabIndex={-1} className="comment-card-scroll" aria-label={`${entity}评论卡片`}>
        <div className="comment-note-grid">{visible.map((group) => {
          const collecting = activeNoteId === group.id;
          return <article key={group.id} className={`comment-note-card ${selected?.id === group.id ? "is-selected" : ""}`}>
            <button className="comment-card-open" type="button" aria-label={`查看评论分析：${group.title}`} aria-pressed={selected?.id === group.id} onClick={(event) => {
              openerRef.current = event.currentTarget;
              onOpen(group);
            }}>
              <span className="comment-card-status"><IconMessageCircle size={17} /><span>{collecting ? "采集中" : /失败/.test(group.task?.status || "") ? group.task.status : group.comments.length ? "已采集" : group.task?.status || "待采集"}</span><IconChevronRight size={16} /></span>
              <h3>{group.title}</h3><p className="comment-card-author">{group.author}</p>
              <div className="comment-card-count"><strong>{group.comments.length.toLocaleString()}</strong><span>条评论</span></div>
              <p className="comment-card-excerpt">{group.comments[0]?.content || (collecting ? "等待评论返回…" : "暂无已采集评论")}</p>
            </button>
            <footer className="comment-card-actions">
              <button className="button quiet compact comment-card-delete" type="button" title={collecting || starting ? "请先停止采集再删除" : "删除卡片及其全部本地评论"} aria-label={`删除卡片：${group.title}`} disabled={collecting || Boolean(starting) || deleting} onClick={() => remove(group)}><IconTrash size={14} />删除</button>
              <button className="button quiet compact" type="button" title={`重新打开${entity}采集，保留已有评论并去重`} disabled={collecting || Boolean(starting) || deleting || !group.link} onClick={() => onStart(group)}><IconRefresh size={14} />{starting === group.id ? "正在打开" : collecting ? "采集中" : group.comments.length ? "重新采集" : "采集评论"}</button>
            </footer>
          </article>;
        })}</div>
        {!visible.length && <div className="comment-empty"><IconMessageCircle size={28} /><strong>{scope === "collected" ? `暂无已采集的${entity}` : scope === "pending" ? `没有待采集${entity}` : `暂无${entity}评论`}</strong></div>}
      </div>
      {selected && <CommentDetails key={selected.id} accountId={accountId} group={selected} filters={state} onClose={close} onStart={onStart} onStop={onStop} collecting={activeNoteId === selected.id} starting={Boolean(starting)} busy={deleting} onExport={exportRows} onConfigure={onConfigure} active={active} settingsRevision={settingsRevision} />}
    </div>
  </div>;
}
