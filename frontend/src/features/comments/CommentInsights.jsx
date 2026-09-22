import { useEffect, useMemo, useRef, useState } from "react";
import { IconBrain, IconMessageCircle, IconPlayerStop, IconThumbUp } from "@tabler/icons-react";
import { readAiReportCache, writeAiReportCache } from "../analytics/ai-analysis.js";
import { buildNoteAnalysis, COMMENT_SENTIMENTS, materializeNoteInsights, rankCommentExamples } from "./comment-insights.js";

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
  const requestRef = useRef(null);
  const fingerprintRef = useRef("");
  const analysis = useMemo(() => buildNoteAnalysis(accountId, group), [accountId, group.id, group.title, group.comments]);
  const ranks = useMemo(() => rankCommentExamples(group.comments), [group.comments]);
  fingerprintRef.current = analysis.dataset.fingerprint;
  const configured = Boolean((settings?.hasApiKey || settings?.apiKeyRequired === false) && settings?.baseUrl && settings?.model);
  const busy = phase === "running" || phase === "stopping";
  const current = insights?.fingerprint === analysis.dataset.fingerprint ? insights : null;
  const cacheOptions = useMemo(() => ({
    fingerprint: analysis.dataset.fingerprint,
    baseUrl: settings?.baseUrl || "", model: settings?.model || "",
    wireApi: settings?.wireApi || "", reasoningEffort: settings?.reasoningEffort || "", promptVersion: settings?.promptVersion || "",
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
    setMessage(progress.message || `分析进度 ${progress.analyzedRecords || 0} / ${analysis.dataset.records.length}`);
  }), [api, analysis.dataset.records.length]);

  const run = async () => {
    if (busy || requestRef.current || collecting) return;
    if (!configured) { onConfigure?.(); return; }
    if (!api?.analyze) return;
    const count = analysis.dataset.coverage.commentCount;
    let origin = settings.baseUrl;
    try { origin = new URL(origin).origin; } catch { /* Show the configured destination verbatim. */ }
    if (!window.confirm(`将本笔记的标题和 ${count} 条评论文本（含时间、地区）发送至 ${origin} 进行 AI 分析，可能产生模型调用费用。不附带昵称、用户 ID 或登录信息。是否继续？`)) return;
    const request = { id: `comment-${crypto.randomUUID()}`, fingerprint: analysis.dataset.fingerprint };
    requestRef.current = request;
    setPhase("running");
    setMessage("正在分析本笔记评论");
    try {
      const raw = await api.analyze({
        requestId: request.id, scopeLabel: "单篇笔记评论分析",
        fingerprint: request.fingerprint, records: analysis.dataset.records,
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
    <section className="comment-sentiment" aria-label="评论情绪分析">
      <div className="comment-section-heading"><h3>评论情绪</h3><div className="comment-insight-actions">
        {busy ? <button className="button compact" type="button" disabled={phase === "stopping"} onClick={cancel}><IconPlayerStop size={14} />停止分析</button>
          : <button className="button compact primary" type="button" disabled={!api?.analyze || !group.comments.length || collecting} title={collecting ? "请先停止采集再分析" : "分析本篇笔记的全部已采集评论"} onClick={run}><IconBrain size={14} />{configured ? current ? "重新分析" : "分析评论" : "前往设置"}</button>}
      </div></div>
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
      {message && <p className={`comment-analysis-status ${phase === "error" ? "is-error" : ""}`} role="status">{message}</p>}
      {current && <p className="comment-muted">AI 判断仅供参考；反讽、梗和上下文可能影响结论。</p>}
    </section>
    <Examples title="高讨论评论" items={ranks.discussion} coverage={ranks.knownReplies} total={ranks.total} metric="replies" insights={current} />
    <Examples title="高点赞评论" items={ranks.liked} coverage={ranks.knownLikes} total={ranks.total} metric="likes" insights={current} />
  </div>;
}
