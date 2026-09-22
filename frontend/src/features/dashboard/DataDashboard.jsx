import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconArrowUpRight,
  IconChartBar,
  IconChartDonut,
  IconCircleCheck,
  IconFileText,
  IconHeart,
  IconMessageCircle,
  IconX,
  IconZoomIn,
  IconZoomOut,
  IconRefresh,
} from "@tabler/icons-react";
import { buildAnalyticsModel } from "../analytics/analytics.js";
import "./data-dashboard.css";

const chartColors = ["#d66f5f", "#4f806b", "#6685a0", "#b08a45", "#929b94"];

function formatNumber(value) {
  if (value == null || !Number.isFinite(Number(value))) return "--";
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(Number(value));
}

function formatPercent(value) {
  if (value == null || !Number.isFinite(Number(value))) return "--";
  return `${Math.round(Number(value) * 100)}%`;
}

function updatedAtLabel(value, now = Date.now()) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "等待采集数据";
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60000));
  if (minutes < 1) return "刚刚更新";
  if (minutes < 60) return `${minutes} 分钟前更新`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前更新`;
  return `${Math.floor(hours / 24)} 天前更新`;
}

function donutBackground(rows) {
  const total = rows.reduce((sum, row) => sum + row.noteCount, 0);
  if (!total) return "conic-gradient(#e8ece8 0 100%)";
  let cursor = 0;
  const segments = rows.map((row, index) => {
    const start = cursor;
    cursor += row.noteCount / total * 100;
    return `${chartColors[index % chartColors.length]} ${start}% ${cursor}%`;
  });
  return `conic-gradient(${segments.join(", ")})`;
}

function Metric({ icon: Icon, label, value, detail, tone }) {
  return (
    <article className={`data-metric tone-${tone}`}>
      <span className="data-metric-icon"><Icon size={17} stroke={1.8} /></span>
      <div><small>{label}</small><strong>{value}</strong><span>{detail}</span></div>
    </article>
  );
}

export function DataDashboard({ accounts, workspaces, rows, summary, activeAccountId, onClose, onOpenFullAnalysis }) {
  const panelRef = useRef(null);
  const dragRef = useRef(null);
  const [width, setWidth] = useState(480);
  const [zoom, setZoom] = useState(100);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const maxWidth = Math.min(viewportWidth, Math.max(320, Math.min(1100, viewportWidth > 1560 ? viewportWidth - 720 : viewportWidth)));
  const panelWidth = Math.min(width, maxWidth);
  useEffect(() => {
    const resize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    const shell = panelRef.current?.closest(".app-shell");
    shell?.style.setProperty("--dashboard-width", `${panelWidth}px`);
    return () => shell?.style.removeProperty("--dashboard-width");
  }, [panelWidth]);
  const resizeTo = (value) => setWidth(Math.min(maxWidth, Math.max(Math.min(320, viewportWidth), value)));
  const stopResize = (event) => {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const [scopeAccountId, setScopeAccountId] = useState("");
  const model = useMemo(
    () => buildAnalyticsModel({ accounts, workspaces, scopeAccountId }),
    [accounts, scopeAccountId, workspaces],
  );
  const rowById = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);
  const scopeName = scopeAccountId
    ? accounts.find((account) => account.id === scopeAccountId)?.name || "当前账号"
    : "全部账号";
  const operationTotal = model.summaryById.operationTaskCount.value;
  const operationCompleted = model.summaryById.completedOperationTaskCount.value;
  const operationRate = operationTotal ? operationCompleted / operationTotal : null;
  const trendRows = model.trend.filter((row) => !row.unknown).slice(-8);
  const trendMax = Math.max(1, ...trendRows.map((row) => row.noteCount));
  const typeRows = model.types.slice(0, 5);
  const typeTotal = typeRows.reduce((sum, row) => sum + row.noteCount, 0);
  const accountMax = Math.max(1, ...model.accounts.map((account) => account.noteCount + account.commentCount));
  const hasData = Boolean(model.summaryById.noteCount.value || model.summaryById.commentCount.value);

  return (
    <aside ref={panelRef} className="data-dashboard" id="data-dashboard" aria-labelledby="data-dashboard-title">
      <div className="dashboard-resizer" role="separator" tabIndex={0}
        aria-label="调整数据看板宽度" aria-orientation="vertical"
        aria-valuemin={Math.min(320, viewportWidth)} aria-valuemax={maxWidth} aria-valuenow={Math.round(panelWidth)}
        title="左右拖动调整宽度，双击恢复默认"
        onDoubleClick={() => setWidth(480)}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = { x: event.clientX, width: panelWidth };
        }}
        onPointerMove={(event) => {
          if (dragRef.current) resizeTo(dragRef.current.width + dragRef.current.x - event.clientX);
        }}
        onPointerUp={stopResize} onPointerCancel={stopResize}
        onLostPointerCapture={() => { dragRef.current = null; }}
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          resizeTo(event.key === "Home" ? 320 : event.key === "End" ? maxWidth : panelWidth + (event.key === "ArrowLeft" ? 20 : -20));
        }}
      />
      <header className="data-dashboard-header">
        <div className="data-dashboard-title">
          <h2 id="data-dashboard-title">数据看板</h2>
          <p>{scopeName} · {updatedAtLabel(model.summaryById.updatedAt.value)}</p>
        </div>
        <button className="data-dashboard-close" type="button" onClick={onClose} title="隐藏数据看板" aria-label="隐藏数据看板">
          <IconX size={18} stroke={2} />
        </button>
      </header>

      <div className="data-dashboard-toolbar">
        <label>
          <span>分析范围</span>
          <select value={scopeAccountId} onChange={(event) => setScopeAccountId(event.target.value)}>
            <option value="">全部账号</option>
            {accounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}
          </select>
        </label>
        <span className="data-live-state"><i className={summary.collecting || summary.queueRunning ? "active" : ""} />{summary.collecting || summary.queueRunning ? `${summary.collecting + summary.queueRunning} 个任务运行中` : "数据已就绪"}</span>
      </div>

      <div className="dashboard-zoom" aria-label="看板显示缩放">
        <button type="button" aria-label="缩小看板" title="缩小" disabled={zoom <= 60} onClick={() => setZoom((value) => Math.max(60, value - 10))}><IconZoomOut size={16} /></button>
        <input aria-label="看板缩放比例" type="range" min="60" max="180" step="10" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
        <output aria-live="polite">{zoom}%</output>
        <button type="button" aria-label="放大看板" title="放大" disabled={zoom >= 180} onClick={() => setZoom((value) => Math.min(180, value + 10))}><IconZoomIn size={16} /></button>
        <button type="button" aria-label="恢复默认看板布局" title="恢复默认宽度和缩放" onClick={() => { setWidth(480); setZoom(100); }}><IconRefresh size={15} /></button>
      </div>
      <div className="data-dashboard-scroll">
        <div className="data-dashboard-content" style={{ zoom: zoom / 100 }}>
        <section className="data-metric-grid" aria-label="核心数据指标">
          <Metric icon={IconFileText} label="笔记记录" value={formatNumber(model.summaryById.noteCount.value)} detail={`${formatNumber(model.summaryById.authorCount.value)} 位作者`} tone="coral" />
          <Metric icon={IconMessageCircle} label="评论记录" value={formatNumber(model.summaryById.commentCount.value)} detail={`${formatPercent(model.summaryById.commentCount.value ? model.summaryById.linkedCommentCount.value / model.summaryById.commentCount.value : null)} 可关联`} tone="green" />
          <Metric icon={IconHeart} label="点赞中位数" value={formatNumber(model.summaryById.medianLikes.value)} detail={`累计 ${formatNumber(model.summaryById.totalLikes.value)}`} tone="blue" />
          <Metric icon={IconCircleCheck} label="操作完成率" value={formatPercent(operationRate)} detail={`${formatNumber(operationCompleted)} / ${formatNumber(operationTotal)} 条`} tone="gold" />
        </section>

        {!hasData ? (
          <section className="data-dashboard-empty">
            <IconChartBar size={38} stroke={1.35} />
            <strong>还没有可分析的数据</strong>
          </section>
        ) : (
          <>
            <section className="data-section trend-section" aria-labelledby="data-trend-title">
              <div className="data-section-heading"><div><h3 id="data-trend-title">发布时间分布</h3></div><small>最近 8 个时间段</small></div>
              <div className="data-trend-chart">
                {trendRows.map((row) => (
                  <div className="data-trend-column" key={row.period} title={`${row.label}：${row.noteCount} 条笔记`}>
                    <strong>{row.noteCount}</strong>
                    <span><i style={{ height: `${Math.max(8, row.noteCount / trendMax * 100)}%` }} /></span>
                    <small>{row.label.replace(/^\d{4}-/, "")}</small>
                  </div>
                ))}
                {!trendRows.length && <div className="data-chart-empty">暂无可识别的发布时间</div>}
              </div>
            </section>

            <section className="data-section" aria-labelledby="data-type-title">
              <div className="data-section-heading"><div><h3 id="data-type-title">笔记类型</h3></div><IconChartDonut size={18} stroke={1.6} /></div>
              <div className="data-donut-layout">
                <div className="data-donut" style={{ background: donutBackground(typeRows) }}><span><strong>{formatNumber(model.summaryById.noteCount.value)}</strong><small>笔记</small></span></div>
                <div className="data-donut-legend">
                  {typeRows.map((row, index) => (
                    <div key={row.label}><i style={{ background: chartColors[index % chartColors.length] }} /><span>{row.label}</span><strong>{typeTotal ? Math.round(row.noteCount / typeTotal * 100) : 0}%</strong></div>
                  ))}
                </div>
              </div>
            </section>

            <section className="data-section" aria-labelledby="data-account-title">
              <div className="data-section-heading"><div><h3 id="data-account-title">账号采集量</h3></div><small>{model.accounts.length} 个账号</small></div>
              <div className="data-account-bars">
                {model.accounts.map((account) => {
                  const value = account.noteCount + account.commentCount;
                  const liveRow = rowById.get(account.id);
                  return (
                    <div className={`data-account-row ${account.id === activeAccountId ? "current" : ""}`} key={account.id}>
                      <div><strong title={account.name}>{account.name}</strong><small>{liveRow?.stateLabel || "空闲"}</small></div>
                      <span><i style={{ width: `${value / accountMax * 100}%` }} /></span>
                      <b>{value}</b>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="data-section" aria-labelledby="data-keyword-title">
              <div className="data-section-heading"><div><h3 id="data-keyword-title">标题高频词</h3></div><small>样本内去重</small></div>
              <div className="data-keywords">
                {model.keywords.slice(0, 12).map((row, index) => <span className={`level-${Math.min(3, Math.floor(index / 3))}`} key={row.key}><strong>{row.label}</strong><small>{row.noteCount}</small></span>)}
                {!model.keywords.length && <div className="data-chart-empty">暂无足够的标题文本</div>}
              </div>
            </section>

            {model.insights.length > 0 && (
              <section className="data-section data-insights" aria-labelledby="data-insight-title">
                <div className="data-section-heading"><div><h3 id="data-insight-title">值得关注</h3></div><small>描述性统计</small></div>
                {model.insights.slice(0, 2).map((insight, index) => <article key={insight.id}><span>{String(index + 1).padStart(2, "0")}</span><p><strong>{insight.title}</strong>{insight.text}</p></article>)}
              </section>
            )}
          </>
        )}
      </div>

      </div>
      <footer className="data-dashboard-footer">
        <button type="button" onClick={() => onOpenFullAnalysis(scopeAccountId)}>
          查看完整分析 <IconArrowUpRight size={16} stroke={1.9} />
        </button>
      </footer>
    </aside>
  );
}
