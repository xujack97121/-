import { useEffect, useMemo, useRef, useState } from "react";
import { IconBrain, IconLoader2, IconMessageCircle, IconPlayerStop, IconSparkles, IconThumbUp } from "@tabler/icons-react";
import { readAiReportCache, writeAiReportCache } from "../analytics/ai-analysis.js";
import { buildNoteAnalysis, COMMENT_SENTIMENTS, materializeNoteInsights, rankCommentExamples } from "./comment-insights.js";

const OPINION_LABELS = { overall: "整体判断", positives: "认可与共鸣", concerns: "争议与顾虑", demands: "用户诉求", response: "回应建议" };
const ANALYSIS_STAGES = ["解读评论", "归纳观点", "舆情总结", "校验结果"];

function AnalysisProgress({ progress, stopping, message, hasPrevious, containerRef }) {
  const stage = progress.phase === "opinion_synthesis" ? 2 : progress.phase === "finalizing" || progress.phase === "completed" ? 3
    : ["topic_merge", "need_merge", "recommendation_synthesis"].includes(progress.phase) ? 1 : 0;
  const seconds = Math.max(0, Math.floor((Number(progress.elapsedMs) || 0) / 1000));
  return <div ref={containerRef} className="comment-ai-progress" role="status" aria-label="AI 分析进度">
    <div className="comment-ai-progress-heading"><IconLoader2 className="comment-ai-spinner" size={22} aria-hidden="true" />
      <strong>{stopping ? "正在停止分析" : "AI 正在分析评论"}</strong>
      <span>{seconds >= 60 ? `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒` : `${seconds} 秒`}</span>
    </div>
    <div className="comment-ai-activity" aria-hidden="true"><i /></div>
    <ol className="comment-ai-stages">{ANALYSIS_STAGES.map((label, index) => <li key={label} className={index === stage ? "is-active" : index < stage ? "is-done" : ""} aria-current={index === stage ? "step" : undefined}>{label}</li>)}</ol>
    <p>{message}</p>
    <small>{Number(progress.totalRecords) > 0 ? `已处理 ${Math.min(progress.analyzedRecords || 0, progress.totalRecords)} / ${progress.totalRecords} 条文本` : "正在准备评论文本"}
      {Number(progress.totalBatches) > 0 ? ` · 已完成 ${progress.completedBatches || 0} / ${progress.totalBatches} 批` : ""}</small>
    {hasPrevious && <small>下方保留上次完整结果，完成后更新</small>}
  </div>;
}

function OpinionSummary({ insights, analysis, comments }) {
  const opinion = insights?.report.publicOpinion;
  if (!insights) return null;
  return <section className="comment-opinion" aria-label="评论舆情总结">
    <div className="comment-section-heading"><h3><IconSparkles size={16} aria-hidden="true" />舆情总结</h3><span>AI 判断</span></div>
    {opinion?.status === "complete" ? <>
      {opinion.sections.map((section) => <div key={section.kind} className={`comment-opinion-section is-${section.kind}`}>
        <h4>{OPINION_LABELS[section.kind]}</h4><p>{section.summary}</p>
        <details><summary>评论依据 · {section.sourceIds.length} 条</summary>
          {section.sourceIds.map((id) => <blockquote key={id}>{comments[analysis.sourceIndexes.get(id)]?.content || "（无文本内容）"}</blockquote>)}
        </details>
      </div>)}
      <p className="comment-muted">基于已采评论的有限摘录和主题归纳，不代表全部用户；未判断传播趋势或事实真伪。</p>
    </> : <p className="comment-muted">舆情总结未生成，已有情绪分析仍可查看。可重新分析后重试。</p>}
  </section>;
}

function Examples({ title, items, coverage, total, metric, insights }) {
  return <section className="comment-examples" aria-label={title}>
    <div className="comment-section-heading"><h3>{title}</h3><span>{coverage} / {total} 条有指标</span></div>
    <p className="comment-muted">{metric === "replies" ? "按已采回复数排序" : "按已采点赞数排序"} · 前 3 条</p>
    {!items.length && <p className="comment-muted">{coverage ? "暂无非零指标评论" : "尚未采集该指标"}</p>}
    <ol>{items.map((item, position) => {
      const result = insights?.byIndex.get(item.index);
      const label = COMMENT_SENTIMENTS.find((entry) => entry.key === result?.label)?.label;
      return <li key={item.index}>
        <div className="comment-example-heading"><strong>#{position + 1} {item.comment.nickname || "匿名用户"}</strong>
          {label && <span className={`comment-sentiment-tag is-${result.label}`}>{label}</span>}
        </div>
        <blockquote>{item.comment.content || "（无文本内容）"}</blockquote>
        <div className="comment-engagement">
          <span><IconThumbUp size={14} />点赞 {item.likes == null ? "未采集" : item.likes.toLocaleString()}</span>
          <span><IconMessageCircle size={14} />回复 {item.replies == null ? "未采集" : item.replies.toLocaleString()}</span>
        </div>
        <p className="comment-example-reason"><b>分析：</b>{result?.reason || (insights ? "该条评论尚无有效分类。" : "尚未运行 AI 分析。")}{result?.mixed ? "（正负并存，归入中性）" : ""}</p>
        {result?.topic && <p className="comment-muted">讨论主题：{result.topic}</p>}
      </li>;
    })}</ol>
  </section>;
}

export function CommentInsights({ accountId, group, collecting, onConfigure, active, settingsRevision = 0 }) {
  const api = globalThis.collectorDesktop?.ai;
  const [settings, setSettings] = useState(null);
  const [phase, setPhase] = useState("idle");
  const [message, setMessage] = useState("");
  const [insights, setInsights] = useState(null);
  const [progress, setProgress] = useState({});
  const requestRef = useRef(null);
  const progressRef = useRef(null);
  const fingerprintRef = useRef("");
  const analysis = useMemo(() => buildNoteAnalysis(accountId, group), [accountId, group.id, group.title, group.comments]);
  const ranks = useMemo(() => rankCommentExamples(group.comments), [group.comments]);
  fingerprintRef.current = analysis.dataset.fingerprint;
  const configured = Boolean((settings?.hasApiKey || settings?.apiKeyRequired === false) && settings?.baseUrl && settings?.model);
  const busy = phase === "running" || phase === "stopping";
  const current = insights?.fingerprint === analysis.dataset.fingerprint ? insights : null;
  useEffect(() => {
    if (!busy) return;
    const frame = requestAnimationFrame(() => progressRef.current?.scrollIntoView({ block: "nearest" }));
    return () => cancelAnimationFrame(frame);
  }, [busy]);
  const cacheOptions = useMemo(() => ({
    fingerprint: analysis.dataset.fingerprint,
    baseUrl: settings?.baseUrl || "", model: settings?.model || "",
    wireApi: settings?.wireApi || "", reasoningEffort: settings?.reasoningEffort || "", promptVersion: `${settings?.promptVersion || ""}:comment-opinion-v1`,
  }), [analysis.dataset.fingerprint, settings]);

  useEffect(() => {
    let mounted = true;
    if (api?.getSettings) Promise.resolve(api.getSettings()).then((value) => {
      if (mounted) setSettings(value || {});
    }).catch((error) => { if (mounted) setMessage(error.message || "无法读取 AI 设置"); });
    return () => { mounted = false; };
  }, [api, settingsRevision]);

  useEffect(() => {
    setInsights(null);
    setPhase("idle");
    setMessage("");
    setProgress({});
    if (configured) {
      const cached = readAiReportCache(globalThis.localStorage, cacheOptions);
      if (cached) {
        try { setInsights(materializeNoteInsights(cached, analysis)); } catch { /* Discard incompatible local reports. */ }
      }
    }
    return () => {
      const request = requestRef.current;
      requestRef.current = null;
      if (request && api?.cancel) Promise.resolve(api.cancel(request.id)).catch(() => {});
    };
  }, [analysis.dataset.fingerprint, api, cacheOptions, configured]);

  useEffect(() => {
    if (!active && requestRef.current) {
      const request = requestRef.current;
      requestRef.current = null;
      if (api?.cancel) Promise.resolve(api.cancel(request.id)).catch(() => {});
      setPhase("idle");
      setMessage("分析已取消");
    }
  }, [active, api]);

  useEffect(() => api?.onProgress?.((progress) => {
    if (!requestRef.current || progress.requestId !== requestRef.current.id) return;
    setProgress((previous) => ({
      phase: progress.phase || previous.phase,
      elapsedMs: progress.elapsedMs ?? previous.elapsedMs,
      totalRecords: progress.totalRecords ?? previous.totalRecords,
      analyzedRecords: progress.analyzedRecords ?? previous.analyzedRecords,
      totalBatches: progress.totalBatches ?? previous.totalBatches,
      completedBatches: progress.completedBatches ?? previous.completedBatches,
    }));
    setMessage(progress.message || `分析进度 ${progress.analyzedRecords || 0} / ${analysis.dataset.records.length}`);
  }), [api, analysis.dataset.records.length]);

  const run = async () => {
    if (busy || requestRef.current || collecting) return;
    if (!configured) { onConfigure?.(); return; }
    if (!api?.analyze) return;
    const count = analysis.dataset.coverage.commentCount;
    let origin = settings.baseUrl;
    try { origin = new URL(origin).origin; } catch { /* Show the configured destination verbatim. */ }
    if (!window.confirm(`将本笔记的标题和 ${count} 条评论的关键文本发送至 ${origin}，分析情绪并额外生成舆情总结，可能产生模型调用费用。不附带昵称、用户 ID、时间、地区或登录信息。是否继续？`)) return;
    const request = { id: `comment-${crypto.randomUUID()}`, fingerprint: analysis.dataset.fingerprint };
    requestRef.current = request;
    setPhase("running");
    setProgress({ phase: "preparing", totalRecords: analysis.dataset.records.length, analyzedRecords: 0, elapsedMs: 0 });
    setMessage("正在分析本笔记评论");
    try {
      const raw = await api.analyze({
        requestId: request.id, scopeLabel: "单篇笔记评论分析",
        fingerprint: request.fingerprint, records: analysis.dataset.records,
        includePublicOpinion: true,
      });
      if (requestRef.current !== request || fingerprintRef.current !== request.fingerprint) return;
      const result = materializeNoteInsights(raw, analysis);
      setInsights(result);
      setPhase("complete");
      setMessage(result.unknown ? `${result.unknown} 条未明确判定，未计入三类比例` : "分析完成");
      writeAiReportCache(globalThis.localStorage, cacheOptions, result.report);
    } catch (error) {
      if (requestRef.current !== request) return;
      setPhase("error");
      setMessage(error.message || "分析失败，请重试");
    } finally {
      if (requestRef.current === request) requestRef.current = null;
    }
  };
  const cancel = async () => {
    const request = requestRef.current;
    if (!request) return;
    setPhase("stopping");
    try {
      const response = await api.cancel(request.id);
      if (requestRef.current !== request) return;
      if (response?.cancelled) {
        requestRef.current = null;
        setPhase("idle");
        setMessage("分析已取消");
      } else { setPhase("running"); setMessage("分析正在收尾"); }
    } catch (error) {
      if (requestRef.current === request) { setPhase("running"); setMessage(error.message || "停止失败，请重试"); }
    }
  };

  return <div className="comment-insights">
    <div className="comment-ai-toolbar">
      <div className="comment-ai-title"><IconBrain size={20} aria-hidden="true" /><strong>AI 评论洞察</strong></div>
      {busy ? <button className="button comment-ai-stop" type="button" disabled={phase === "stopping"} onClick={cancel}><IconPlayerStop size={16} aria-hidden="true" />停止分析</button>
        : <button className="button primary comment-ai-run" type="button" disabled={!api?.analyze || !group.comments.length || collecting} title={collecting ? "请先停止采集再分析" : "分析本篇笔记的全部已采集评论及舆情"} onClick={run}><IconSparkles size={18} aria-hidden="true" />{configured ? current ? "重新分析" : "分析评论" : "前往设置"}</button>}
    </div>
    {busy && <AnalysisProgress containerRef={progressRef} progress={progress} stopping={phase === "stopping"} message={message} hasPrevious={Boolean(current)} />}
    {!busy && message && <p className={`comment-analysis-status ${phase === "error" ? "is-error" : ""}`} role="status">{message}</p>}
    <section className="comment-sentiment" aria-label="评论情绪分析">
      <div className="comment-section-heading"><h3>评论情绪</h3></div>
      <div className="comment-sentiment-grid">{COMMENT_SENTIMENTS.map((item) => {
        const count = current?.counts[item.key];
        const share = current?.classified ? count / current.classified * 100 : 0;
        return <div key={item.key} className={`comment-sentiment-stat is-${item.key}`}>
          <span>{item.label}</span><strong>{current ? count : "—"}<small>条</small></strong>
          <span>{current?.classified ? `${share.toFixed(1)}%` : "—"}</span>
          <span className="comment-sentiment-track"><i style={{ width: `${share}%` }} /></span>
        </div>;
      })}</div>
      <p className="comment-muted">{current ? `已判定 ${current.classified} / ${group.comments.length} 条 · 比例按已判定评论计算` : api ? "尚未分析" : "网页预览 · AI 分析需桌面版"}</p>
      {!!current?.mixed && <p className="comment-muted">中性包含 {current.mixed} 条正负并存评论</p>}
      {!!current?.unknown && <p className="comment-muted">{current.unknown} 条未明确判定，不归入中性</p>}
      {current && <p className="comment-muted">AI 判断仅供参考；反讽、梗和上下文可能影响结论。</p>}
    </section>
    <OpinionSummary insights={current} analysis={analysis} comments={group.comments} />
    <Examples title="高讨论评论" items={ranks.discussion} coverage={ranks.knownReplies} total={ranks.total} metric="replies" insights={current} />
    <Examples title="高点赞评论" items={ranks.liked} coverage={ranks.knownLikes} total={ranks.total} metric="likes" insights={current} />
  </div>;
}
