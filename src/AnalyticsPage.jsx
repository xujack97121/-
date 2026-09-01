import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconAlertCircle,
  IconArrowLeft,
  IconArrowRight,
  IconBrain,
  IconBulb,
  IconChartBar,
  IconCircleCheck,
  IconExternalLink,
  IconFileAnalytics,
  IconLink,
  IconLoader2,
  IconMessageCircle,
  IconMoodSmile,
  IconNotes,
  IconPlayerPlay,
  IconPlayerStop,
  IconRefresh,
  IconRoute,
  IconSearch,
  IconSettings,
  IconShieldLock,
  IconTags,
  IconTargetArrow,
  IconTestPipe,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { buildAnalyticsModel } from "./analytics.js";
import { buildAiDataset, materializeAiReport, readAiReportCache, writeAiReportCache } from "./ai-analysis.js";
import "./analytics.css";

const numberFormatter = new Intl.NumberFormat("zh-CN");

const kindLabels = {
  account: "账号",
  workspace: "数据空间",
  note: "笔记",
  comment: "评论",
  "comment-task": "评论采集任务",
  "operation-task": "自动化任务",
};

function formatNumber(value, fallback = "—") {
  const number = Number(value);
  return Number.isFinite(number) ? numberFormatter.format(number) : fallback;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "暂无更新时间";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function percent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${(number * 100).toFixed(number >= 0.1 ? 1 : 2)}%` : "—";
}

function metricValue(metric, mode = "number") {
  if (!metric) return "—";
  if (mode === "time") return formatDateTime(metric.value);
  return formatNumber(metric.value);
}

function evidenceTitle(entry) {
  const data = entry?.data || {};
  return data.title || data.content || data.name || data.nickname || data.accountId || entry?.entityId || "未命名来源";
}

function evidenceSubtitle(entry) {
  const data = entry?.data || {};
  if (entry?.kind === "note") return `${data.author || "未知作者"} · ${formatNumber(data.likes, "点赞未知")} 点赞`;
  if (entry?.kind === "comment") return `${data.nickname || data.authorId || "未知用户"} · ${data.region || "地区未知"}`;
  if (entry?.kind === "operation-task" || entry?.kind === "comment-task") return data.status || "状态未知";
  if (entry?.kind === "workspace") return `采集响应 ${formatNumber(data.stats?.captures || 0)} 批`;
  return data.loginPhase || data.id || "";
}

const sentimentLabels = {
  positive: "正向",
  neutral: "中性",
  negative: "负向",
  mixed: "复杂",
  unclear: "无法判断",
};

const aiRows = (value) => Array.isArray(value) ? value : [];
const aiEvidenceRefs = (row) => Array.isArray(row?.evidenceRefs) ? row.evidenceRefs : [];

function aiSettingsConfigured(settings) {
  return Boolean(settings?.baseUrl && settings?.model && (settings?.hasApiKey || settings?.apiKeyRequired === false));
}

function aiDatasetCounts(dataset) {
  const records = aiRows(dataset?.records);
  return {
    notes: records.filter((record) => record?.kind === "note").length,
    comments: records.filter((record) => record?.kind === "comment").length,
    total: records.length,
  };
}

function aiReportCollections(report) {
  return {
    sentiments: aiRows(report?.sentimentSummary || report?.sentiments || report?.sentiment),
    topics: aiRows(report?.topics || report?.topicClusters),
    needs: aiRows(report?.needs || report?.userNeeds),
    recommendations: aiRows(report?.recommendations || report?.operations),
  };
}

function aiReportGeneratedAt(report) {
  return report?.generatedAt || report?.completedAt || report?.createdAt || null;
}

function aiCoverageText(report, fallbackCounts) {
  const coverage = report?.coverage || {};
  const notes = Number(coverage.noteAnalyzed ?? coverage.analyzedNotes ?? coverage.noteCount);
  const comments = Number(coverage.commentAnalyzed ?? coverage.analyzedComments ?? coverage.commentCount);
  return `文本输入 ${formatNumber(Number.isFinite(notes) ? notes : fallbackCounts.notes)} 条笔记 / ${formatNumber(Number.isFinite(comments) ? comments : fallbackCounts.comments)} 条评论`;
}

function aiRowCount(row) {
  const value = Number(row?.count ?? row?.sourceCount ?? row?.recordCount ?? row?.noteCount ?? row?.commentCount);
  return Number.isFinite(value) ? formatNumber(value) : "—";
}

function aiRowShare(row) {
  const value = Number(row?.share);
  return Number.isFinite(value) ? percent(value) : "—";
}

function aiRowLabel(row, fallback) {
  const sentiment = row?.key || row?.sentiment || row?.label;
  return sentimentLabels[sentiment] || row?.label || row?.title || row?.name || fallback;
}

function aiErrorMessage(error, fallback = "AI 分析暂时无法完成") {
  return String(error?.message || error || fallback)
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^(?:AiServiceError|Error):\s*/i, "");
}

function formatElapsedTime(value) {
  const totalSeconds = Math.max(0, Math.floor((Number(value) || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function decodeAiStreamValue(value) {
  try { return JSON.parse(`"${value}"`); }
  catch { return String(value || "").replace(/\\n/g, " ").replace(/\\"/g, "\"").replace(/\\\\/g, "\\"); }
}

function aiStreamPreview(text) {
  const source = String(text || "");
  if (!source) return "";
  const values = [];
  const complete = /"(?:label|summary|reason|title|action|rationale)"\s*:\s*"((?:\\.|[^"\\])*)"/g;
  for (const match of source.matchAll(complete)) {
    const value = decodeAiStreamValue(match[1]).trim();
    if (value && values.at(-1) !== value) values.push(value);
  }
  const partial = source.match(/"(?:label|summary|reason|title|action|rationale)"\s*:\s*"((?:\\.|[^"\\])*)$/);
  if (partial) {
    const value = decodeAiStreamValue(partial[1]).trim();
    if (value && values.at(-1) !== value) values.push(value);
  }
  return values.slice(-6).join(" · ");
}

const aiProgressPhaseLabels = {
  preparing: "准备数据",
  batch_analysis: "文本批次分析",
  analyzing: "文本批次分析",
  topic_merge: "归并内容主题",
  need_merge: "归并用户需求",
  recommendation_synthesis: "生成运营建议",
  merging: "归并语义结果",
  finalizing: "本地校验与统计",
  completed: "分析完成",
};

function aiProgressPhaseLabel(phase) {
  return aiProgressPhaseLabels[phase] || "处理中";
}

function makeAiRequestId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `ai-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function settingsDraftOf(settings = {}) {
  const source = settings || {};
  return {
    baseUrl: source.baseUrl || "",
    model: source.model || "",
    wireApi: source.wireApi === "responses" ? "responses" : "chat_completions",
    reasoningEffort: source.reasoningEffort || "",
    apiKey: "",
    replaceApiKey: false,
    clearApiKey: false,
  };
}

function providerOriginOf(baseUrl) {
  try {
    return new URL(String(baseUrl || "").trim()).origin;
  } catch {
    return "";
  }
}

function emptyAiModelCatalog() {
  return { models: [], busy: false, loaded: false, error: "", endpointUrl: "" };
}

function aiEndpointPreview(baseUrl, wireApi) {
  try {
    const url = new URL(String(baseUrl || "").trim());
    let pathname = url.pathname.replace(/\/+$/, "");
    if (!pathname || pathname === "/") pathname = "/v1";
    if (wireApi === "responses") {
      if (/\/chat\/completions$/i.test(pathname)) pathname = pathname.replace(/\/chat\/completions$/i, "/responses");
      else if (!/\/responses$/i.test(pathname)) pathname = `${pathname}/responses`;
    } else {
      if (/\/responses$/i.test(pathname)) pathname = pathname.replace(/\/responses$/i, "/chat/completions");
      else if (!/\/chat\/completions$/i.test(pathname)) pathname = `${pathname}/chat/completions`;
    }
    url.pathname = pathname;
    return url.href;
  } catch {
    return "地址有效后显示最终请求地址";
  }
}

function MetricCard({ label, value, detail, formula, refs, onOpen }) {
  return (
    <button className="analytics-metric" type="button" onClick={() => onOpen({ title: label, refs, formula })}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
      <em><IconLink size={13} stroke={1.8} />{formatNumber(refs?.length || 0)} 条依据</em>
    </button>
  );
}

function EvidenceButton({ label = "查看依据", refs, onOpen, title, formula, limitations, origin = "statistics" }) {
  return (
    <button
      className="evidence-button"
      type="button"
      disabled={!refs?.length}
      onClick={() => onOpen({ title, refs, formula, limitations, origin })}
    >
      <IconLink size={13} stroke={1.8} />
      {label} {formatNumber(refs?.length || 0)}
    </button>
  );
}

function AiSettingsModal({ open, settings, draft, setDraft, busy, result, error, modelCatalog, modelQuery, setModelQuery, onClose, onSave, onTest, onLoadModels }) {
  if (!open) return null;
  const modalBusy = Boolean(busy || modelCatalog?.busy);
  const dirty = draft.baseUrl.trim() !== String(settings?.baseUrl || "").trim()
    || draft.model.trim() !== String(settings?.model || "").trim()
    || draft.wireApi !== (settings?.wireApi === "responses" ? "responses" : "chat_completions")
    || draft.reasoningEffort !== String(settings?.reasoningEffort || "")
    || Boolean(draft.apiKey.trim())
    || draft.clearApiKey;
  const providerDirty = draft.baseUrl.trim() !== String(settings?.baseUrl || "").trim()
    || draft.wireApi !== (settings?.wireApi === "responses" ? "responses" : "chat_completions")
    || Boolean(draft.apiKey.trim())
    || draft.clearApiKey;
  const configured = aiSettingsConfigured(settings);
  const endpointPreview = aiEndpointPreview(draft.baseUrl, draft.wireApi);
  const savedProviderOrigin = providerOriginOf(settings?.baseUrl);
  const draftProviderOrigin = providerOriginOf(draft.baseUrl);
  const endpointOriginChanged = Boolean(settings?.hasApiKey && savedProviderOrigin && draftProviderOrigin && savedProviderOrigin !== draftProviderOrigin);
  let keyStatusKind = "empty";
  let keyStatusText = settings?.apiKeyRequired === false ? "未配置（可选）" : "未配置";
  if (draft.clearApiKey) {
    keyStatusKind = "warning";
    keyStatusText = "保存后清除";
  } else if (draft.apiKey.trim()) {
    keyStatusKind = "pending";
    keyStatusText = settings?.hasApiKey ? "新 Key 待保存" : "Key 待保存";
  } else if (endpointOriginChanged) {
    keyStatusKind = "warning";
    keyStatusText = "更换站点后需重填";
  } else if (settings?.hasApiKey) {
    keyStatusKind = "saved";
    keyStatusText = "已安全保存";
  }
  const normalizedQuery = modelQuery.trim().toLowerCase();
  const availableModels = Array.isArray(modelCatalog?.models) ? modelCatalog.models : [];
  const filteredModels = normalizedQuery
    ? availableModels.filter((entry) => `${entry?.id || ""} ${entry?.ownedBy || ""}`.toLowerCase().includes(normalizedQuery))
    : availableModels;
  const visibleModels = filteredModels.slice(0, 300);
  const canLoadModels = Boolean(settings?.baseUrl && (settings?.hasApiKey || settings?.apiKeyRequired === false) && !providerDirty && !busy && !modelCatalog?.busy);
  const loadModelsTitle = providerDirty
    ? "请先保存服务地址、接口协议或 API Key 的修改"
    : !settings?.baseUrl
      ? "请先保存服务地址"
      : settings?.apiKeyRequired !== false && !settings?.hasApiKey
        ? "请先保存 API Key"
        : "从已保存的中转站获取模型列表";

  return (
    <div className="ai-settings-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget && !modalBusy) onClose(); }}>
      <section className="ai-settings-modal" role="dialog" aria-modal="true" aria-labelledby="ai-settings-title">
        <header>
          <div><span><IconSettings size={14} />AI 服务设置</span><h2 id="ai-settings-title">连接 OpenAI 兼容中转站</h2></div>
          <button className="icon-button" type="button" onClick={onClose} disabled={modalBusy} aria-label="关闭 AI 设置" title="关闭"><IconX size={18} /></button>
        </header>
        <div className="ai-settings-body">
          <label className="ai-setting-field">
            <span>服务地址 / 中转地址</span>
            <input value={draft.baseUrl} onChange={(event) => setDraft((current) => ({ ...current, baseUrl: event.target.value }))} placeholder="https://api.example.com" autoComplete="off" />
            <small>可填写根域名、/v1 地址或完整接口地址；根域名会自动补全 /v1。</small>
          </label>
          <fieldset className="ai-wire-api-field">
            <legend>接口协议</legend>
            <div className="ai-wire-api-options">
              <button className={draft.wireApi === "responses" ? "active" : ""} type="button" onClick={() => setDraft((current) => ({ ...current, wireApi: "responses" }))}>Responses API</button>
              <button className={draft.wireApi === "chat_completions" ? "active" : ""} type="button" onClick={() => setDraft((current) => ({ ...current, wireApi: "chat_completions" }))}>Chat Completions</button>
            </div>
            <small>按中转站提供的 wire_api 选择；wire_api = responses 时选择 Responses API。</small>
          </fieldset>
          <div className="ai-endpoint-preview"><span>实际请求地址</span><output>{endpointPreview}</output></div>
          <div className="ai-setting-field ai-model-setting-field">
            <div className="ai-setting-label-row">
              <label htmlFor="ai-model-name">模型</label>
              <button className="ai-fetch-models" type="button" onClick={onLoadModels} disabled={!canLoadModels} title={loadModelsTitle}>
                {modelCatalog?.busy ? <IconLoader2 className="spin" size={14} /> : <IconRefresh size={14} />}
                {modelCatalog?.busy ? "正在获取" : "获取模型列表"}
              </button>
            </div>
            <input id="ai-model-name" value={draft.model} onChange={(event) => setDraft((current) => ({ ...current, model: event.target.value }))} placeholder="填写服务商提供的模型名称" autoComplete="off" />
            <small>保留手动输入；模型列表使用已保存的中转地址和 API Key 获取。</small>
          </div>
          {(modelCatalog?.busy || modelCatalog?.loaded || modelCatalog?.error) && (
            <section className="ai-model-catalog" aria-label="中转站模型列表" aria-live="polite">
              <header>
                <div><strong>可用模型</strong><span>{modelCatalog?.busy ? "读取中" : `${formatNumber(availableModels.length, "0")} 个`}</span></div>
                {availableModels.length > 6 && (
                  <label className="ai-model-search" aria-label="搜索模型">
                    <IconSearch size={14} />
                    <input value={modelQuery} onChange={(event) => setModelQuery(event.target.value)} placeholder="搜索模型" autoComplete="off" />
                  </label>
                )}
              </header>
              {modelCatalog?.error && <div className="ai-model-catalog-error"><IconAlertCircle size={14} />{modelCatalog.error}</div>}
              {modelCatalog?.busy && !availableModels.length && <div className="ai-model-catalog-empty"><IconLoader2 className="spin" size={15} />正在读取中转站模型列表…</div>}
              {!modelCatalog?.busy && modelCatalog?.loaded && !modelCatalog?.error && !availableModels.length && <div className="ai-model-catalog-empty">中转站没有返回可选模型，可继续手动填写。</div>}
              {!modelCatalog?.error && availableModels.length > 0 && (
                <div className="ai-model-options" role="radiogroup" aria-label="选择一个模型">
                  {visibleModels.map((entry) => (
                    <label className={`ai-model-option ${draft.model === entry.id ? "active" : ""}`} key={entry.id}>
                      <input
                        type="radio"
                        name="ai-provider-model"
                        value={entry.id}
                        checked={draft.model === entry.id}
                        onChange={() => setDraft((current) => ({ ...current, model: entry.id }))}
                      />
                      <span><strong>{entry.id}</strong>{entry.ownedBy && <small>{entry.ownedBy}</small>}</span>
                    </label>
                  ))}
                  {!filteredModels.length && <div className="ai-model-catalog-empty">没有匹配的模型</div>}
                </div>
              )}
              {filteredModels.length > visibleModels.length && <small className="ai-model-catalog-limit">列表较长，当前显示前 300 个；搜索可定位其余模型。</small>}
              {modelCatalog?.endpointUrl && <small className="ai-model-catalog-source">来源：{modelCatalog.endpointUrl}</small>}
            </section>
          )}
          <label className="ai-setting-field">
            <span>推理强度</span>
            <select value={draft.reasoningEffort} onChange={(event) => setDraft((current) => ({ ...current, reasoningEffort: event.target.value }))}>
              <option value="">跟随模型默认值</option>
              <option value="minimal">Minimal</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="xhigh">XHigh</option>
            </select>
            <small>对应 model_reasoning_effort；强度越高通常耗时越长。</small>
          </label>
          <div className="ai-setting-field ai-api-key-field">
            <div className="ai-setting-label-row">
              <label htmlFor="ai-api-key">API Key</label>
              <span className={"ai-key-status " + keyStatusKind}>
                {keyStatusKind === "saved" ? <IconCircleCheck size={13} /> : keyStatusKind === "warning" ? <IconAlertCircle size={13} /> : <IconShieldLock size={13} />}
                {keyStatusText}
              </span>
            </div>
            {settings?.hasApiKey && !draft.replaceApiKey && !draft.clearApiKey ? (
              <div className="ai-key-control">
                <input id="ai-api-key" className="ai-key-masked" type="text" value="••••••••••••••••" readOnly aria-label="已安全保存的 API Key" />
                <button className="ai-key-action" type="button" onClick={() => setDraft((current) => ({ ...current, replaceApiKey: true, apiKey: "", clearApiKey: false }))}>
                  <IconRefresh size={14} />更换 Key
                </button>
              </div>
            ) : (
              <div className="ai-key-control">
                <input
                  id="ai-api-key"
                  type="password"
                  value={draft.apiKey}
                  onChange={(event) => setDraft((current) => ({ ...current, apiKey: event.target.value, replaceApiKey: true, clearApiKey: false }))}
                  placeholder={settings?.hasApiKey ? "输入新的 API Key" : settings?.apiKeyRequired === false ? "本机服务可留空" : "输入 API Key"}
                  autoComplete="new-password"
                />
                {settings?.hasApiKey && !draft.clearApiKey && (
                  <button className="ai-key-action" type="button" onClick={() => setDraft((current) => ({ ...current, replaceApiKey: false, apiKey: "", clearApiKey: false }))}>
                    <IconX size={14} />取消更换
                  </button>
                )}
              </div>
            )}
            <small>
              {draft.clearApiKey
                ? "点击保存设置后才会清除；直接关闭窗口不会删除密钥。"
                : draft.replaceApiKey && settings?.hasApiKey
                  ? "输入新 Key 并保存后会覆盖原密钥；取消更换则继续使用原密钥。"
                  : settings?.hasApiKey
                    ? "为保护密钥，已保存内容不会回显；关闭窗口或重启程序后仍会继续使用。"
                    : settings?.apiKeyRequired === false
                      ? "本机回环服务不强制要求密钥；如服务自身要求认证，可在此填写。"
                      : "密钥加密保存于本机，只交给桌面主进程，不会返回分析页面。"}
            </small>
          </div>
          {endpointOriginChanged && !draft.apiKey.trim() && !draft.clearApiKey && (
            <div className="ai-settings-warning"><IconAlertCircle size={15} />中转站的域名、协议或端口已改变。为避免把旧 Key 发送给其他站点，保存时会清除旧 Key；请先点击“更换 Key”并输入新密钥。</div>
          )}
          {settings?.hasApiKey && (
            <label className="ai-clear-key">
              <input type="checkbox" checked={draft.clearApiKey} onChange={(event) => setDraft((current) => ({ ...current, clearApiKey: event.target.checked, replaceApiKey: false, apiKey: "" }))} />
              <IconTrash size={14} />保存设置时清除已保存的 API Key
            </label>
          )}
          <div className="ai-privacy-note">
            <IconShieldLock size={19} stroke={1.6} />
            <p><strong>发送范围与作用边界</strong>运行分析时会向所配置服务商发送笔记标题和评论正文。账号 ID、用户 ID、昵称、原始链接和本地 evidenceRef 不会发送；{draft.wireApi === "responses" ? "Responses API 请求固定携带 store = false。" : "Chat Completions 没有统一的关闭存储参数，服务端留存策略以中转站为准。"}AI 结果只进入辅助洞察区，不会回写基础统计与图表。</p>
          </div>
          {settings?.encryptionAvailable === false && <div className="ai-settings-warning"><IconAlertCircle size={15} />当前系统无法使用安全密钥存储，桌面端不会明文保存 API Key。</div>}
          {error && <div className="ai-settings-error"><IconAlertCircle size={15} />{error}</div>}
          {result && <div className="ai-settings-success"><IconCircleCheck size={15} />{result}</div>}
        </div>
        <footer>
          <span>{dirty ? "有尚未保存的修改" : configured ? "配置已保存" : "等待完整配置"}</span>
          <button className="button" type="button" onClick={onTest} disabled={modalBusy || dirty || !configured} title={dirty ? "请先保存当前修改" : "测试已保存的配置"}>
            {busy === "test" ? <IconLoader2 className="spin" size={15} /> : <IconTestPipe size={15} />}测试连接
          </button>
          <button className="button primary" type="button" onClick={onSave} disabled={modalBusy || !draft.baseUrl.trim() || !draft.model.trim()}>
            {busy === "save" ? <IconLoader2 className="spin" size={15} /> : <IconCircleCheck size={15} />}保存设置
          </button>
        </footer>
      </section>
    </div>
  );
}

function AiPanelEmpty({ children }) {
  return <div className="ai-panel-empty">{children}</div>;
}

function AiSentimentPanel({ rows, commentCount, streaming = false, onOpen }) {
  return (
    <article className="ai-result-panel sentiment-result-panel">
      <div className="ai-panel-heading"><div><IconMoodSmile size={16} /><span>AI 评论情绪归类</span></div><small>AI 分类，本地按有效评论复核计数</small></div>
      {!commentCount ? <AiPanelEmpty>当前范围没有评论数据，采集评论后才能判断情绪。</AiPanelEmpty> : !rows.length ? <AiPanelEmpty>{streaming ? "正在等待首批已校验的评论情绪结果。" : "运行 AI 分析后显示评论情绪分布。"}</AiPanelEmpty> : (
        <div className="ai-sentiment-list">
          {rows.map((row, index) => {
            const key = row.key || row.sentiment || row.label || `sentiment-${index}`;
            const share = Number(row.share);
            return (
              <div className={`ai-sentiment-row sentiment-${key}`} key={key}>
                <div className="ai-sentiment-label"><strong>{aiRowLabel(row, `情绪 ${index + 1}`)}</strong><span>{aiRowCount(row)} 条 · {aiRowShare(row)}</span></div>
                <div className="ai-sentiment-track"><i style={{ width: `${Number.isFinite(share) && share > 0 ? Math.max(2, Math.min(100, share * 100)) : 0}%` }} /></div>
                <EvidenceButton title={`AI 评论情绪：${aiRowLabel(row, key)}`} refs={aiEvidenceRefs(row)} formula="AI 逐条标注评论情绪；本地仅接受当前数据集中的有效评论引用，并据此重新计算条数与比例。" limitations={row.limitations} origin="ai" onOpen={onOpen} />
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}

function AiClusterPanel({ kind, rows, emptyText, onOpen }) {
  const [expanded, setExpanded] = useState(false);
  const isTopic = kind === "topic";
  const Icon = isTopic ? IconTags : IconBulb;
  const heading = isTopic ? "AI 内容主题聚类" : "AI 用户需求归纳";
  const orderedRows = [...rows].sort((left, right) => Number(right?.count || 0) - Number(left?.count || 0));
  const visibleRows = expanded ? orderedRows : orderedRows.slice(0, 10);
  const formula = isTopic
    ? "AI 提出主题标签并选择候选来源；本地校验、去重有效引用后重新计算该 AI 分组的条数、占比与顺序。"
    : "AI 提出需求标签并选择候选评论；本地校验、去重有效评论引用后重新计算该 AI 分组的条数、占比与顺序。";
  return (
    <article className={`ai-result-panel ai-cluster-panel ${isTopic ? "topic-result-panel" : "need-result-panel"}`}>
      <div className="ai-panel-heading"><div><Icon size={16} /><span>{heading}</span></div><small>{isTopic ? "只分析已采集标题和评论" : "只代表已采集评论样本"}</small></div>
      {!rows.length ? <AiPanelEmpty>{emptyText}</AiPanelEmpty> : (
        <div className="ai-cluster-list">
          {visibleRows.map((row, index) => {
            const label = aiRowLabel(row, `${isTopic ? "主题" : "需求"} ${index + 1}`);
            return (
              <div className="ai-cluster-row" key={row.id || row.key || `${kind}-${index}`}>
                <span className="ai-cluster-rank">{String(index + 1).padStart(2, "0")}</span>
                <div className="ai-cluster-copy"><strong>{label}</strong><p>{row.summary || row.description || "该分类由当前采集样本的语义特征归纳。"}</p><small>AI 分组 {aiRowCount(row)} 条{Number.isFinite(Number(row.share)) ? ` · ${aiRowShare(row)}` : ""}</small></div>
                <EvidenceButton title={`${heading}：${label}`} refs={aiEvidenceRefs(row)} formula={formula} limitations={row.limitations} origin="ai" onOpen={onOpen} />
              </div>
            );
          })}
          {orderedRows.length > 10 && (
            <button className="ai-show-all" type="button" onClick={() => setExpanded((current) => !current)}>
              {expanded ? "收起" : `查看全部 ${formatNumber(orderedRows.length)} 项`}
            </button>
          )}
        </div>
      )}
    </article>
  );
}

function AiRecommendationPanel({ rows, streaming = false, onOpen }) {
  const [expanded, setExpanded] = useState(false);
  const orderedRows = [...rows].sort((left, right) => Number(right?.count || 0) - Number(left?.count || 0));
  const visibleRows = expanded ? orderedRows : orderedRows.slice(0, 8);
  return (
    <article className="ai-result-panel recommendation-result-panel">
      <div className="ai-panel-heading"><div><IconTargetArrow size={16} /><span>AI 运营试验建议</span></div><small>用于提出待验证假设，不承诺效果</small></div>
      {!rows.length ? <AiPanelEmpty>{streaming ? "正在等待首批有原始依据的运营建议。" : "运行 AI 分析后显示有原始依据的运营建议。"}</AiPanelEmpty> : (
        <div className="ai-recommendation-list">
          {visibleRows.map((row, index) => {
            const title = aiRowLabel(row, `建议 ${index + 1}`);
            return (
              <div className="ai-recommendation-row" key={row.id || `recommendation-${index}`}>
                <span className={`ai-priority priority-${row.priority || "medium"}`}>{row.priority === "high" ? "优先" : row.priority === "low" ? "观察" : "建议"}</span>
                <div><strong>{title}</strong><p>{row.action || row.text || row.summary || row.description}</p>{(row.rationale || row.limitations?.[0]) && <small>{row.rationale || row.limitations[0]}</small>}</div>
                <EvidenceButton title={`AI 运营试验建议：${title}`} refs={aiEvidenceRefs(row)} formula="AI 基于其提名且经本地校验的原始笔记或评论提出待验证建议；该建议不改变基础统计、图表或排序。" limitations={row.limitations} origin="ai" onOpen={onOpen} />
              </div>
            );
          })}
          {orderedRows.length > 8 && (
            <button className="ai-show-all" type="button" onClick={() => setExpanded((current) => !current)}>
              {expanded ? "收起" : `查看全部 ${formatNumber(orderedRows.length)} 项`}
            </button>
          )}
        </div>
      )}
    </article>
  );
}

function TrendChart({ rows, onOpen }) {
  const maxCount = Math.max(1, ...rows.map((row) => row.noteCount));
  const visibleRows = rows.slice(-18);
  return (
    <div className="analytics-chart-scroll" aria-label="笔记发布时间趋势图">
      <div className="trend-chart" style={{ "--trend-columns": visibleRows.length || 1 }}>
        {visibleRows.map((row) => (
          <button
            key={row.period}
            className="trend-column"
            type="button"
            onClick={() => onOpen({
              title: `${row.label} 发布趋势`,
              refs: row.evidenceRefs,
              formula: "按笔记发布时间归入自然月；无法识别时间的记录归入“时间未知”。",
            })}
            title={`${row.label}：${row.noteCount} 条，点赞中位数 ${formatNumber(row.medianLikes)}`}
          >
            <span className="trend-value">{row.noteCount}</span>
            <span className="trend-bar-track"><span style={{ height: `${Math.max(4, row.noteCount / maxCount * 100)}%` }} /></span>
            <strong>{row.label}</strong>
            <small>中位 {formatNumber(row.medianLikes)}</small>
          </button>
        ))}
        {!visibleRows.length && <div className="analytics-chart-empty">暂无可绘制的发布时间数据</div>}
      </div>
    </div>
  );
}

function RankedBars({ rows, valueKey, valueLabel, onOpen, formula, limit = 8 }) {
  const visibleRows = rows.slice(0, limit);
  const maxValue = Math.max(1, ...visibleRows.map((row) => Number(row[valueKey]) || 0));
  return (
    <div className="ranked-bars">
      {visibleRows.map((row, index) => (
        <button
          className="ranked-bar"
          type="button"
          key={row.key || row.label}
          onClick={() => onOpen({ title: row.label, refs: row.evidenceRefs, formula })}
        >
          <span className="ranked-index">{index + 1}</span>
          <span className="ranked-copy"><strong title={row.label}>{row.label}</strong><span><i style={{ width: `${Math.max(3, (Number(row[valueKey]) || 0) / maxValue * 100)}%` }} /></span></span>
          <span className="ranked-value">{formatNumber(row[valueKey])}<small>{valueLabel}</small></span>
        </button>
      ))}
      {!visibleRows.length && <div className="analytics-list-empty">暂无数据</div>}
    </div>
  );
}

function EvidenceDrawer({ request, model, accountsById, onClose, onOpenNote }) {
  const [kind, setKind] = useState("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    setKind("all");
    setQuery("");
  }, [request]);

  useEffect(() => {
    if (!request) return undefined;
    const onKeyDown = (event) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, request]);

  if (!request) return null;
  const allEntries = (request.refs || []).map((ref) => model.evidenceIndex[ref]).filter(Boolean);
  const kinds = Array.from(new Set(allEntries.map((entry) => entry.kind)));
  const normalizedQuery = query.trim().toLowerCase();
  const entries = allEntries.filter((entry) => {
    if (kind !== "all" && entry.kind !== kind) return false;
    if (!normalizedQuery) return true;
    const haystack = `${evidenceTitle(entry)} ${evidenceSubtitle(entry)} ${entry.accountId} ${entry.entityId} ${entry.noteId || ""}`.toLowerCase();
    return haystack.includes(normalizedQuery);
  });

  return (
    <div className="evidence-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="evidence-drawer" role="dialog" aria-modal="true" aria-labelledby="evidence-title">
        <header>
          <div><span>{request.origin === "ai" ? "AI 洞察引用来源" : "本地统计计算依据"}</span><h2 id="evidence-title">{request.title}</h2></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭来源明细" title="关闭"><IconX size={18} /></button>
        </header>
        {(request.formula || request.limitations?.length) && (
          <div className="evidence-method">
            {request.formula && <p><strong>{request.origin === "ai" ? "AI 生成与本地复核" : "数学统计口径"}</strong>{request.formula}</p>}
            {request.limitations?.map((item) => <p key={item}><strong>边界</strong>{item}</p>)}
          </div>
        )}
        <div className="evidence-tools">
          <label><IconSearch size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、账号或 ID" /></label>
          <select value={kind} onChange={(event) => setKind(event.target.value)} aria-label="来源类型">
            <option value="all">全部来源</option>
            {kinds.map((item) => <option key={item} value={item}>{kindLabels[item] || item}</option>)}
          </select>
        </div>
        <div className="evidence-count">显示 {formatNumber(entries.length)} / {formatNumber(allEntries.length)} 条来源</div>
        <div className="evidence-list">
          {entries.slice(0, 300).map((entry) => {
            const data = entry.data || {};
            const linkedNote = entry.noteRef ? model.evidenceIndex[entry.noteRef] : null;
            const noteData = entry.kind === "note" ? data : linkedNote?.data;
            return (
              <article className="evidence-row" key={entry.ref}>
                <div className="evidence-row-head">
                  <span className={`evidence-kind kind-${entry.kind}`}>{kindLabels[entry.kind] || entry.kind}</span>
                  <small>{accountsById[entry.accountId]?.name || entry.accountId}</small>
                </div>
                <strong title={evidenceTitle(entry)}>{evidenceTitle(entry)}</strong>
                <p>{evidenceSubtitle(entry)}</p>
                <code>{entry.kind === "comment" ? `commentId: ${entry.entityId}` : entry.kind.includes("task") ? `taskKey: ${entry.entityId}` : `id: ${entry.entityId}`}</code>
                {entry.noteId && entry.kind !== "note" && <code>noteId: {entry.noteId}</code>}
                {noteData?.link && (
                  <button className="source-open" type="button" onClick={() => onOpenNote(entry.accountId, noteData)}>
                    <IconExternalLink size={14} />打开原笔记
                  </button>
                )}
              </article>
            );
          })}
          {!entries.length && <div className="analytics-list-empty">当前筛选没有来源记录</div>}
          {entries.length > 300 && <div className="evidence-overflow">为保持页面流畅，当前显示前 300 条；可用搜索继续定位。</div>}
        </div>
      </aside>
    </div>
  );
}

export function AnalyticsPage({ accounts, workspaces, initialAccountId, onBack, onOpenAccount, onOpenNote }) {
  const [scopeAccountId, setScopeAccountId] = useState(initialAccountId || "");
  const [evidenceRequest, setEvidenceRequest] = useState(null);
  const [selectedNoteRef, setSelectedNoteRef] = useState("");
  const [aiSettings, setAiSettings] = useState(null);
  const [aiSettingsLoaded, setAiSettingsLoaded] = useState(false);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [aiSettingsDraft, setAiSettingsDraft] = useState(() => settingsDraftOf());
  const [aiSettingsBusy, setAiSettingsBusy] = useState("");
  const [aiSettingsResult, setAiSettingsResult] = useState("");
  const [aiSettingsError, setAiSettingsError] = useState("");
  const [aiModelCatalog, setAiModelCatalog] = useState(() => emptyAiModelCatalog());
  const [aiModelQuery, setAiModelQuery] = useState("");
  const [aiPhase, setAiPhase] = useState("idle");
  const [aiReport, setAiReport] = useState(null);
  const [aiReportMeta, setAiReportMeta] = useState({ fingerprint: "", generatedAt: null, baseUrl: "", model: "", wireApi: "", reasoningEffort: "", promptVersion: "" });
  const [aiError, setAiError] = useState("");
  const [aiLiveText, setAiLiveText] = useState("");
  const [aiStreamMeta, setAiStreamMeta] = useState({ streamId: 0, characters: 0, phase: "" });
  const [aiProgress, setAiProgress] = useState({
    phase: "",
    completedBatches: 0,
    totalBatches: 0,
    analyzedRecords: 0,
    totalRecords: 0,
    currentBatch: 0,
    currentBatchRecords: 0,
    providerCalls: 0,
    elapsedMs: 0,
    stageElapsedMs: 0,
    waitingMs: 0,
    timestamp: 0,
    heartbeat: false,
    message: "",
  });
  const aiRequestRef = useRef("");
  const aiActiveContextRef = useRef(null);
  const aiPartialRevisionRef = useRef(0);
  const aiScopeRef = useRef("");
  const accountsById = useMemo(() => Object.fromEntries(accounts.map((account) => [account.id, account])), [accounts]);
  const model = useMemo(() => buildAnalyticsModel({ accounts, workspaces, scopeAccountId, now: Date.now() }), [accounts, scopeAccountId, workspaces]);
  const aiDatasetState = useMemo(() => {
    try { return { dataset: buildAiDataset(model), error: "" }; }
    catch (error) { return { dataset: null, error: aiErrorMessage(error, "无法准备 AI 分析数据") }; }
  }, [model]);
  const aiDataset = aiDatasetState.dataset;
  const aiCounts = useMemo(() => aiDatasetCounts(aiDataset), [aiDataset]);
  const selectedNote = model.topNotes.find((note) => note.noteRef === selectedNoteRef) || model.topNotes[0] || null;
  const selectedRelation = selectedNote ? model.lineage.byNoteRef[selectedNote.noteRef] : null;
  const hasData = model.summaryById.noteCount.value || model.summaryById.commentCount.value || model.summaryById.commentTaskCount.value || model.summaryById.operationTaskCount.value;
  const currentScopeName = scopeAccountId ? accountsById[scopeAccountId]?.name || "当前账号" : "全部账号";
  const aiScopeKey = scopeAccountId || "all";
  const aiApi = globalThis.collectorDesktop?.ai;
  const aiConfigured = aiSettingsConfigured(aiSettings);
  const aiReportStale = Boolean(aiReport && (
    (aiReportMeta.fingerprint && aiDataset?.fingerprint && aiReportMeta.fingerprint !== aiDataset.fingerprint)
    || (aiReportMeta.baseUrl && aiSettings?.baseUrl && aiReportMeta.baseUrl !== aiSettings.baseUrl)
    || (aiReportMeta.model && aiSettings?.model && aiReportMeta.model !== aiSettings.model)
    || (aiReportMeta.wireApi && aiSettings?.wireApi && aiReportMeta.wireApi !== aiSettings.wireApi)
    || (aiReportMeta.reasoningEffort !== undefined && aiReportMeta.reasoningEffort !== (aiSettings?.reasoningEffort || ""))
    || (aiReportMeta.promptVersion && aiSettings?.promptVersion && aiReportMeta.promptVersion !== aiSettings.promptVersion)
  ));
  const aiCollections = aiReportCollections(aiReport);
  const aiBusy = aiPhase === "running" || aiPhase === "stopping";
  const aiDisplayStatus = aiPhase === "running" ? "running"
    : aiPhase === "stopping" ? "stopping"
    : aiPhase === "error" ? "error"
      : aiPhase === "cancelled" ? "cancelled"
        : !aiApi ? "unavailable"
          : !aiSettingsLoaded ? "loading"
            : !aiConfigured ? "unconfigured"
              : aiReportStale ? "stale"
                : aiReport ? "complete"
                  : aiDatasetState.error ? "error"
                    : "idle";

  useEffect(() => {
    if (initialAccountId === null || initialAccountId === undefined || aiBusy) return;
    setScopeAccountId(initialAccountId);
  }, [aiBusy, initialAccountId]);

  useEffect(() => {
    if (!selectedNoteRef && model.topNotes[0]) setSelectedNoteRef(model.topNotes[0].noteRef);
    else if (selectedNoteRef && !model.topNotes.some((note) => note.noteRef === selectedNoteRef)) setSelectedNoteRef(model.topNotes[0]?.noteRef || "");
  }, [model.topNotes, selectedNoteRef]);

  useEffect(() => {
    let active = true;
    if (!aiApi?.getSettings) {
      setAiSettingsLoaded(true);
      return undefined;
    }
    Promise.resolve(aiApi.getSettings()).then((settings) => {
      if (!active) return;
      setAiSettings(settings || {});
      setAiSettingsDraft(settingsDraftOf(settings));
      setAiSettingsLoaded(true);
    }).catch((error) => {
      if (!active) return;
      setAiSettingsLoaded(true);
      setAiPhase("error");
      setAiError(aiErrorMessage(error, "无法读取 AI 服务设置"));
    });
    return () => { active = false; };
  }, [aiApi]);

  useEffect(() => {
    if (!aiApi?.onProgress) return undefined;
    return aiApi.onProgress((progress = {}) => {
      if (progress.requestId && aiRequestRef.current && progress.requestId !== aiRequestRef.current) return;
      const {
        streamReset,
        streamDelta,
        partialResult,
        partialRevision,
        ...progressState
      } = progress;
      setAiProgress((current) => ({ ...current, ...progressState }));
      if (streamReset) {
        setAiLiveText("");
        setAiStreamMeta({ streamId: Number(progress.streamId) || 0, characters: 0, phase: progress.phase || "" });
      }
      if (typeof streamDelta === "string" && streamDelta) {
        setAiLiveText((current) => `${current}${streamDelta}`.slice(-24_000));
        setAiStreamMeta({ streamId: Number(progress.streamId) || 0, characters: Number(progress.streamCharacters) || 0, phase: progress.phase || "" });
      }
      const revision = Number(partialRevision) || 0;
      const context = aiActiveContextRef.current;
      if (partialResult && context?.requestId === progress.requestId && revision > aiPartialRevisionRef.current) {
        aiPartialRevisionRef.current = revision;
        const materialized = materializeAiReport(partialResult, context.dataset, context.model);
        context.partialApplied = true;
        setAiReport(materialized);
        setAiReportMeta({
          fingerprint: context.dataset.fingerprint,
          generatedAt: aiReportGeneratedAt(materialized) || Date.now(),
          baseUrl: materialized.provider?.baseUrl || context.settings.baseUrl,
          model: materialized.provider?.model || context.settings.model,
          wireApi: materialized.provider?.wireApi || context.settings.wireApi,
          reasoningEffort: materialized.provider?.reasoningEffort || context.settings.reasoningEffort || "",
          promptVersion: materialized.promptVersion || context.settings.promptVersion || "",
        });
      }
    });
  }, [aiApi]);

  useEffect(() => () => {
    const requestId = aiRequestRef.current;
    aiRequestRef.current = "";
    if (requestId && aiApi?.cancel) Promise.resolve(aiApi.cancel(requestId)).catch(() => {});
  }, [aiApi]);

  useEffect(() => {
    if (!aiDataset?.fingerprint) return;
    if (aiScopeRef.current && aiScopeRef.current !== aiScopeKey) {
      setAiReport(null);
      setAiReportMeta({ fingerprint: "", generatedAt: null, baseUrl: "", model: "", wireApi: "", reasoningEffort: "", promptVersion: "" });
      setAiPhase("idle");
      setAiError("");
    }
    aiScopeRef.current = aiScopeKey;
  }, [aiDataset?.fingerprint, aiScopeKey]);

  useEffect(() => {
    if (!aiDataset?.fingerprint || !aiSettings?.baseUrl || !aiSettings?.model) return;
    if (aiRequestRef.current) return;
    const cached = readAiReportCache(globalThis.localStorage, {
      fingerprint: aiDataset.fingerprint,
      baseUrl: aiSettings.baseUrl,
      model: aiSettings.model,
      wireApi: aiSettings.wireApi,
      reasoningEffort: aiSettings.reasoningEffort || "",
      promptVersion: aiSettings.promptVersion || "",
      dataset: aiDataset,
      analyticsModel: model,
    });
    if (!cached) return;
    setAiReport(cached);
    setAiReportMeta({
      fingerprint: cached.fingerprint || aiDataset.fingerprint,
      generatedAt: aiReportGeneratedAt(cached),
      baseUrl: cached.provider?.baseUrl || aiSettings.baseUrl,
      model: cached.provider?.model || aiSettings.model,
      wireApi: cached.provider?.wireApi || aiSettings.wireApi,
      reasoningEffort: cached.provider?.reasoningEffort || aiSettings.reasoningEffort || "",
      promptVersion: cached.promptVersion || aiSettings.promptVersion || "",
    });
    setAiPhase("complete");
    setAiError("");
  }, [aiDataset, aiSettings?.baseUrl, aiSettings?.model, aiSettings?.promptVersion, aiSettings?.reasoningEffort, aiSettings?.wireApi, model]);

  useEffect(() => {
    if (!aiSettingsOpen || aiSettingsBusy || aiModelCatalog.busy) return undefined;
    const onKeyDown = (event) => { if (event.key === "Escape") setAiSettingsOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [aiModelCatalog.busy, aiSettingsBusy, aiSettingsOpen]);

  const openEvidence = (request) => setEvidenceRequest({ ...request, refs: Array.from(new Set(request.refs || [])) });
  const openAiSettings = () => {
    setAiSettingsDraft(settingsDraftOf(aiSettings));
    setAiSettingsResult("");
    setAiSettingsError("");
    setAiModelCatalog(emptyAiModelCatalog());
    setAiModelQuery("");
    setAiSettingsOpen(true);
  };
  const loadAiModels = async () => {
    if (!aiApi?.listModels) {
      setAiModelCatalog({ ...emptyAiModelCatalog(), loaded: true, error: "当前桌面程序暂未提供模型列表能力，可继续手动填写模型名称。" });
      return;
    }
    setAiSettingsResult("");
    setAiSettingsError("");
    setAiModelQuery("");
    setAiModelCatalog({ ...emptyAiModelCatalog(), busy: true });
    try {
      const response = await aiApi.listModels();
      const models = Array.isArray(response?.models)
        ? response.models.filter((entry) => entry && typeof entry.id === "string" && entry.id.trim())
        : [];
      setAiModelCatalog({
        models,
        busy: false,
        loaded: true,
        error: "",
        endpointUrl: typeof response?.endpointUrl === "string" ? response.endpointUrl : "",
      });
    } catch (error) {
      setAiModelCatalog({ ...emptyAiModelCatalog(), loaded: true, error: aiErrorMessage(error, "获取模型列表失败") });
    }
  };
  const saveAiSettings = async () => {
    if (!aiApi?.saveSettings) {
      setAiSettingsError("当前桌面程序暂未提供 AI 设置能力。");
      return;
    }
    setAiSettingsBusy("save");
    setAiSettingsError("");
    setAiSettingsResult("");
    try {
      const payload = {
        baseUrl: aiSettingsDraft.baseUrl.trim(),
        model: aiSettingsDraft.model.trim(),
        wireApi: aiSettingsDraft.wireApi,
        reasoningEffort: aiSettingsDraft.reasoningEffort,
      };
      if (aiSettingsDraft.clearApiKey) payload.apiKey = "";
      else if (aiSettingsDraft.apiKey.trim()) payload.apiKey = aiSettingsDraft.apiKey.trim();
      const catalogSourceChanged = payload.baseUrl !== String(aiSettings?.baseUrl || "").trim()
        || payload.wireApi !== (aiSettings?.wireApi === "responses" ? "responses" : "chat_completions")
        || Object.hasOwn(payload, "apiKey");
      const saved = await aiApi.saveSettings(payload);
      const originChanged = Boolean(providerOriginOf(payload.baseUrl) && providerOriginOf(aiSettings?.baseUrl) && providerOriginOf(payload.baseUrl) !== providerOriginOf(aiSettings?.baseUrl));
      const fallbackHasApiKey = Object.hasOwn(payload, "apiKey") ? Boolean(payload.apiKey) : originChanged ? false : Boolean(aiSettings?.hasApiKey);
      const nextSettings = saved || { ...aiSettings, ...payload, hasApiKey: fallbackHasApiKey };
      setAiSettings(nextSettings);
      setAiSettingsDraft(settingsDraftOf(nextSettings));
      if (catalogSourceChanged) {
        setAiModelCatalog(emptyAiModelCatalog());
        setAiModelQuery("");
      }
      if (Object.hasOwn(payload, "apiKey") && !payload.apiKey) setAiSettingsResult("设置已保存，API Key 已清除。");
      else if (nextSettings.hasApiKey) setAiSettingsResult("设置已保存，API Key 已加密保留，关闭或重启后仍会继续使用。");
      else setAiSettingsResult("设置已保存，当前未配置 API Key。");
      if (aiPhase === "error") {
        setAiPhase("idle");
        setAiError("");
      }
    } catch (error) {
      setAiSettingsError(aiErrorMessage(error, "AI 设置保存失败"));
    } finally {
      setAiSettingsBusy("");
    }
  };
  const testAiConnection = async () => {
    if (!aiApi?.testConnection) {
      setAiSettingsError("当前桌面程序暂未提供连接测试能力。");
      return;
    }
    setAiSettingsBusy("test");
    setAiSettingsError("");
    setAiSettingsResult("");
    try {
      const result = await aiApi.testConnection();
      if (result?.recommendedWireApi && result.recommendedWireApi !== aiSettingsDraft.wireApi) {
        const workingProtocol = result.recommendedWireApi === "responses" ? "Responses API" : "Chat Completions";
        const requestedProtocol = result.requestedWireApi === "responses" ? "Responses API" : "Chat Completions";
        setAiSettingsDraft((current) => ({ ...current, wireApi: result.recommendedWireApi }));
        setAiSettingsResult(`${requestedProtocol} 转发失败，但 ${workingProtocol} 已实测连接成功。协议已切换，请保存设置。`);
        return;
      }
      const protocol = result?.wireApi === "responses" ? "Responses API" : "Chat Completions";
      setAiSettingsResult(`连接成功，当前使用 ${protocol}${Number.isFinite(Number(result?.latencyMs)) ? `，耗时 ${formatNumber(result.latencyMs)} 毫秒` : ""}。`);
    } catch (error) {
      setAiSettingsError(aiErrorMessage(error, "连接测试失败"));
    } finally {
      setAiSettingsBusy("");
    }
  };
  const runAiAnalysis = async () => {
    if (aiBusy) return;
    if (!aiApi?.analyze) {
      setAiPhase("error");
      setAiError("当前桌面程序暂未提供 AI 分析能力。");
      return;
    }
    if (!aiConfigured) {
      openAiSettings();
      return;
    }
    if (!aiDataset || aiDatasetState.error) {
      setAiPhase("error");
      setAiError(aiDatasetState.error || "无法准备 AI 分析数据。");
      return;
    }
    if (!aiCounts.total) {
      setAiPhase("error");
      setAiError("当前范围没有可发送给 AI 的笔记标题或评论正文。");
      return;
    }

    const requestId = makeAiRequestId();
    aiRequestRef.current = requestId;
    aiPartialRevisionRef.current = 0;
    aiActiveContextRef.current = {
      requestId,
      dataset: aiDataset,
      model,
      settings: { ...aiSettings },
      previousReport: aiReport,
      previousReportMeta: aiReportMeta,
      partialApplied: false,
    };
    setAiPhase("running");
    setAiError("");
    setAiLiveText("");
    setAiStreamMeta({ streamId: 0, characters: 0, phase: "preparing" });
    setAiProgress({
      phase: "preparing",
      completedBatches: 0,
      totalBatches: 0,
      analyzedRecords: 0,
      totalRecords: aiCounts.total,
      currentBatch: 0,
      currentBatchRecords: 0,
      providerCalls: 0,
      elapsedMs: 0,
      stageElapsedMs: 0,
      waitingMs: 0,
      timestamp: Date.now(),
      heartbeat: false,
      message: "正在准备匿名化数据",
    });
    try {
      const raw = await aiApi.analyze({
        requestId,
        scopeLabel: scopeAccountId ? "当前账号数据范围" : "全部账号数据范围",
        fingerprint: aiDataset.fingerprint,
        records: aiDataset.records,
      });
      if (aiRequestRef.current !== requestId) return;
      const materialized = materializeAiReport(raw, aiDataset, model);
      setAiReport(materialized);
      setAiReportMeta({
        fingerprint: aiDataset.fingerprint,
        generatedAt: aiReportGeneratedAt(materialized) || Date.now(),
        baseUrl: materialized.provider?.baseUrl || aiSettings.baseUrl,
        model: materialized.provider?.model || aiSettings.model,
        wireApi: materialized.provider?.wireApi || aiSettings.wireApi,
        reasoningEffort: materialized.provider?.reasoningEffort || aiSettings.reasoningEffort || "",
        promptVersion: materialized.promptVersion || aiSettings.promptVersion || "",
      });
      setAiPhase("complete");
      writeAiReportCache(globalThis.localStorage, {
        fingerprint: aiDataset.fingerprint,
        baseUrl: aiSettings.baseUrl,
        model: aiSettings.model,
        wireApi: aiSettings.wireApi,
        reasoningEffort: aiSettings.reasoningEffort || "",
        promptVersion: aiSettings.promptVersion || materialized.promptVersion || "",
      }, materialized);
    } catch (error) {
      if (aiRequestRef.current !== requestId) return;
      const context = aiActiveContextRef.current;
      if (context?.requestId === requestId && context.partialApplied) {
        setAiReport(context.previousReport || null);
        setAiReportMeta(context.previousReportMeta || { fingerprint: "", generatedAt: null, baseUrl: "", model: "", wireApi: "", reasoningEffort: "", promptVersion: "" });
      }
      if (/取消|cancel|abort/i.test(String(error?.message || error))) {
        setAiPhase("cancelled");
        setAiError("");
      } else {
        setAiPhase("error");
        setAiError(aiErrorMessage(error));
      }
    } finally {
      if (aiRequestRef.current === requestId) {
        aiRequestRef.current = "";
        aiActiveContextRef.current = null;
      }
    }
  };
  const cancelAiAnalysis = async () => {
    const requestId = aiRequestRef.current;
    if (!requestId || !aiApi?.cancel) return;
    setAiPhase("stopping");
    setAiProgress((current) => ({ ...current, message: "正在停止模型请求并等待任务收尾" }));
    try {
      const result = await aiApi.cancel(requestId);
      if (aiRequestRef.current !== requestId) return;
      if (!result?.cancelled) {
        setAiPhase("running");
        setAiProgress((current) => ({ ...current, message: "任务已进入收尾阶段，正在读取最终状态" }));
      }
    }
    catch (error) {
      if (aiRequestRef.current !== requestId) return;
      setAiPhase("running");
      setAiProgress((current) => ({ ...current, message: aiErrorMessage(error, "取消请求失败，可再次停止") }));
    }
  };
  const relationGroups = selectedRelation ? [
    { label: "已采评论", count: selectedRelation.commentRefs.length, refs: selectedRelation.commentRefs, icon: IconMessageCircle },
    { label: "评论队列", count: selectedRelation.commentTaskRefs.length, refs: selectedRelation.commentTaskRefs, icon: IconNotes },
    { label: "操作任务", count: selectedRelation.operationTaskRefs.length, refs: selectedRelation.operationTaskRefs, icon: IconRoute },
  ] : [];

  const metricCards = [
    { key: "noteCount", detail: "当前范围保存的笔记记录" },
    { key: "commentCount", detail: "当前范围保存的评论记录" },
    { key: "linkedCommentCount", detail: "可按同账号 noteId 回连" },
    { key: "totalLikes", detail: "有效点赞观测值的累计" },
    { key: "medianLikes", detail: "有效点赞观测的中位数" },
    { key: "completedOperationTaskCount", detail: "队列中带已完成状态的任务" },
  ];
  const aiProgressTotal = Number(aiProgress.totalRecords) || aiCounts.total;
  const aiProgressDone = Number(aiProgress.analyzedRecords) || 0;
  const aiProgressCompletedBatches = Math.max(0, Number(aiProgress.completedBatches) || 0);
  const aiProgressTotalBatches = Math.max(0, Number(aiProgress.totalBatches) || 0);
  const aiProgressIsBatch = aiProgress.phase === "batch_analysis" || aiProgress.phase === "analyzing";
  const aiProgressIsCompleted = aiProgress.phase === "completed";
  const aiProgressPercent = aiProgressTotalBatches
    ? Math.max(0, Math.min(100, aiProgressCompletedBatches / aiProgressTotalBatches * 100))
    : aiProgressTotal
      ? Math.max(0, Math.min(100, aiProgressDone / aiProgressTotal * 100))
      : 0;
  const aiProgressStage = aiProgressPhaseLabel(aiProgress.phase);
  const aiCurrentBatch = Math.max(0, Number(aiProgress.currentBatch) || 0);
  const aiCurrentBatchRecords = Math.max(0, Number(aiProgress.currentBatchRecords) || 0);
  const aiProviderCalls = Math.max(0, Number(aiProgress.providerCalls) || 0);
  const aiLivePreview = aiStreamPreview(aiLiveText);
  const aiProgressText = aiProgressIsBatch && aiCurrentBatch
    ? `正在处理第 ${formatNumber(aiCurrentBatch)} / ${formatNumber(aiProgressTotalBatches || aiCurrentBatch)} 批${aiCurrentBatchRecords ? `，本批 ${formatNumber(aiCurrentBatchRecords)} 条` : ""}`
    : aiProgressStage;
  const aiStatusCopy = {
    loading: { title: "正在读取 AI 设置", text: "分析不会自动开始，也不会产生模型调用费用。" },
    unavailable: { title: "当前版本未连接 AI 辅助服务", text: "数学统计主报告可独立使用，不受 AI 配置影响。" },
    unconfigured: { title: "尚未配置 AI 辅助服务", text: `AI 是可选辅助层；配置后可提炼 ${formatNumber(aiCounts.notes)} 条笔记与 ${formatNumber(aiCounts.comments)} 条评论的文本语义。` },
    idle: { title: "AI 辅助洞察已就绪", text: `AI 只提炼文本语义和策略假设；基础指标、图表与排序不会交给模型计算。` },
    running: { title: `正在生成 AI 辅助洞察 · ${aiProgressStage}`, text: aiProgress.message || aiProgressText || `正在处理 ${formatNumber(aiProgressDone)} / ${formatNumber(aiProgressTotal)} 条匿名化记录；已校验内容会持续更新到下方。` },
    stopping: { title: "正在停止 AI 辅助分析", text: aiProgress.message || "正在等待当前模型请求安全结束。" },
    complete: { title: "AI 辅助洞察已生成", text: `${aiCoverageText(aiReport, aiCounts)}；生成于 ${formatDateTime(aiReportMeta.generatedAt)}。` },
    stale: { title: "采集数据已变化，AI 洞察待更新", text: "保留上一批完整洞察；更新后才会纳入新文本。" },
    error: { title: "AI 辅助洞察没有完成", text: aiError || aiDatasetState.error || "请检查服务设置和网络连接后重试。" },
    cancelled: { title: "AI 辅助分析已取消", text: aiReport ? "上一次完整洞察仍保留，未写入本次未完成结果。" : "未写入未完成结果，可稍后重新开始。" },
  }[aiDisplayStatus];
  const AiStatusIcon = aiDisplayStatus === "running" || aiDisplayStatus === "stopping" || aiDisplayStatus === "loading" ? IconLoader2
    : aiDisplayStatus === "complete" ? IconCircleCheck
      : aiDisplayStatus === "error" || aiDisplayStatus === "unavailable" ? IconAlertCircle
        : IconBrain;

  return (
    <section className="analytics-page" aria-labelledby="analytics-title">
      <header className="analytics-header">
        <button className="analytics-back" type="button" onClick={onBack} aria-label="返回全部账号总看板" title="返回总看板"><IconArrowLeft size={19} /></button>
        <div className="analytics-heading-copy">
          <span><IconFileAnalytics size={15} />数据分析中心</span>
          <h1 id="analytics-title">{currentScopeName} · 采集数据洞察</h1>
          <p>主报告的数值、比例和图表均由本地数学统计模型计算；AI 辅助洞察在末尾独立展示。</p>
        </div>
        <div className="analytics-header-actions">
          <div className="analytics-scope">
            <label>数据范围
              <select value={scopeAccountId} onChange={(event) => setScopeAccountId(event.target.value)} disabled={aiBusy}>
                <option value="">全部账号</option>
                {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
              </select>
            </label>
            <span><IconRefresh size={13} />报告生成于 {formatDateTime(model.generatedAt)}</span>
            <small>最近数据更新 {metricValue(model.summaryById.updatedAt, "time")}</small>
          </div>
        </div>
      </header>

      <div className="analytics-scroll">
        <section className="analysis-layer-heading statistical-layer-heading" aria-labelledby="statistical-analysis-title">
          <div className="analysis-layer-copy">
            <span><IconChartBar size={16} />本地统计 · 可复算</span>
            <h2 id="statistical-analysis-title">基础信息处理与图表数据分析</h2>
            <p>所有数值均来自当前采集记录，由确定性的数学统计方法计算。</p>
          </div>
          <div className="statistical-method-meta">
            <strong>{model.statisticalModel.name}</strong>
            <small>{model.statisticalModel.methods.join(" · ")}</small>
          </div>
        </section>

        <section className="analytics-metrics" aria-label="核心指标">
          {metricCards.map(({ key, detail }) => {
            const metric = model.summaryById[key];
            return <MetricCard key={key} label={metric.label} value={metricValue(metric)} detail={detail} formula={metric.formula} refs={metric.evidenceRefs} onOpen={openEvidence} />;
          })}
        </section>

        {!hasData ? (
          <div className="analytics-empty">
            <IconChartBar size={38} stroke={1.4} />
            <strong>还没有可分析的数据</strong>
            <span>完成笔记或评论采集后，这里会自动生成可溯源报告。</span>
            {scopeAccountId && <button className="button primary" type="button" onClick={() => onOpenAccount(scopeAccountId, "search")}>返回采集</button>}
          </div>
        ) : (
          <>
            <section className="analytics-band report-band" aria-labelledby="report-title">
              <div className="analytics-section-heading">
                <div><span><IconChartBar size={15} />描述性统计</span><h2 id="report-title">样本统计结论</h2></div>
                <small>数学统计模型计算 · 只描述当前样本</small>
              </div>
              <div className="insight-list">
                {model.insights.map((insight, index) => (
                  <article className="insight-row" key={insight.id}>
                    <span className="insight-index">{String(index + 1).padStart(2, "0")}</span>
                    <div><strong>{insight.title}</strong><p>{insight.text}</p>{insight.limitations?.[0] && <small>{insight.limitations[0]}</small>}</div>
                    <EvidenceButton title={insight.title} refs={insight.evidenceRefs} formula={insight.metric?.formula} limitations={insight.limitations} onOpen={openEvidence} />
                  </article>
                ))}
              </div>
            </section>

            <section className="analytics-grid analytics-grid-wide">
              <article className="analytics-panel trend-panel">
                <div className="analytics-section-heading"><div><span>内容趋势</span><h2>笔记发布时间分布</h2></div><small>柱高为笔记数，底部为点赞中位数</small></div>
                <TrendChart rows={model.trend} onOpen={openEvidence} />
              </article>
              <article className="analytics-panel type-panel">
                <div className="analytics-section-heading"><div><span>内容结构</span><h2>笔记类型对比</h2></div><small>按记录数量排序</small></div>
                <RankedBars rows={model.types} valueKey="noteCount" valueLabel="条" onOpen={openEvidence} formula="按笔记类型分组统计记录数，并保留组内全部笔记作为依据。" limit={6} />
                <div className="type-median-list">
                  {model.types.slice(0, 4).map((row) => <span key={row.label}><strong>{row.label}</strong>点赞中位数 {formatNumber(row.medianLikes)}</span>)}
                </div>
              </article>
            </section>

            <section className="analytics-grid analytics-grid-three">
              <article className="analytics-panel">
                <div className="analytics-section-heading"><div><span>作者</span><h2>收录作者表现</h2></div><small>累计观测点赞</small></div>
                <RankedBars rows={model.authors} valueKey="totalLikes" valueLabel="赞" onOpen={openEvidence} formula="按作者公开标识或名称分组，累计当前保存笔记的点赞观测值。" />
              </article>
              <article className="analytics-panel">
                <div className="analytics-section-heading"><div><span>主题</span><h2>标题高频词</h2></div><small>同一标题内去重</small></div>
                <div className="keyword-cloud">
                  {model.keywords.slice(0, 18).map((row, index) => (
                    <button className={`keyword keyword-level-${Math.min(4, Math.floor(index / 4))}`} type="button" key={row.key} onClick={() => openEvidence({ title: `标题关键词：${row.label}`, refs: row.evidenceRefs, formula: "对标题分词并在单条笔记内去重后计数。" })}>
                      <strong>{row.label}</strong><span>{row.noteCount} 条 · 中位赞 {formatNumber(row.medianLikes)}</span>
                    </button>
                  ))}
                  {!model.keywords.length && <div className="analytics-list-empty">暂无足够标题文本</div>}
                </div>
              </article>
              <article className="analytics-panel">
                <div className="analytics-section-heading"><div><span>评论</span><h2>地区分布</h2></div><small>仅代表已采集评论</small></div>
                <RankedBars rows={model.regions} valueKey="commentCount" valueLabel="条" onOpen={openEvidence} formula="按评论地区字段分组；地区为空的记录单列为未知。" />
                {model.regions[0] && <p className="region-note">首位地区占全部评论 {percent(model.regions[0].share)}</p>}
              </article>
            </section>

            <section className="analytics-band lineage-band" aria-labelledby="lineage-title">
              <div className="analytics-section-heading">
                <div><span><IconRoute size={15} />关联链路</span><h2 id="lineage-title">笔记、评论与任务溯源</h2></div>
                <small>点击任一节点展开原始记录</small>
              </div>
              <div className="lineage-layout">
                <div className="top-note-list" role="listbox" aria-label="高赞笔记">
                  {model.topNotes.slice(0, 12).map((note, index) => (
                    <button className={note.noteRef === selectedNote?.noteRef ? "active" : ""} type="button" key={note.noteRef} onClick={() => setSelectedNoteRef(note.noteRef)} role="option" aria-selected={note.noteRef === selectedNote?.noteRef}>
                      <span>{index + 1}</span><strong title={note.title}>{note.title}</strong><small>{formatNumber(note.likes)} 赞</small>
                    </button>
                  ))}
                </div>
                {selectedNote && (
                  <div className="lineage-map">
                    <button className="lineage-node account-node" type="button" onClick={() => openEvidence({ title: "来源账号", refs: model.lineage.byAccountId[selectedNote.accountId]?.evidenceRefs.slice(0, 2), formula: "该笔记所在的本地独立账号与数据空间。" })}>
                      <span>来源账号</span><strong>{accountsById[selectedNote.accountId]?.name || selectedNote.accountId}</strong>
                    </button>
                    <IconArrowRight className="lineage-arrow" size={22} stroke={1.5} />
                    <button className="lineage-node note-node" type="button" onClick={() => openEvidence({ title: selectedNote.title, refs: selectedNote.evidenceRefs, formula: "以同账号 noteId 为中心，关联评论和任务记录。" })}>
                      <span>{selectedNote.type} · {selectedNote.source}</span><strong>{selectedNote.title}</strong><small>{selectedNote.author} · {formatNumber(selectedNote.likes)} 赞</small>
                    </button>
                    <IconArrowRight className="lineage-arrow" size={22} stroke={1.5} />
                    <div className="lineage-relations">
                      {relationGroups.map(({ label, count, refs, icon: Icon }) => (
                        <button type="button" key={label} disabled={!count} onClick={() => openEvidence({ title: `${selectedNote.title} · ${label}`, refs, formula: "通过同一账号下的 noteId 回连到该笔记。" })}>
                          <Icon size={16} /><span>{label}</span><strong>{count}</strong>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>

            <section className="analytics-band coverage-band">
              <div className="analytics-section-heading"><div><span>数学统计口径</span><h2>统计口径与数据完整性</h2></div><small>主报告到此结束</small></div>
              <div className="coverage-grid">
                <p><strong>{formatNumber(model.summaryById.knownNoteTimeCount.value)} / {formatNumber(model.summaryById.noteCount.value)}</strong>条笔记有可识别发布时间；未知时间不会混入月份趋势。</p>
                <p><strong>{formatNumber(model.summaryById.knownLikesCount.value)} / {formatNumber(model.summaryById.noteCount.value)}</strong>条笔记有有效点赞观测；缺失值不按 0 处理，也不会进入累计值或中位数。</p>
                <p><strong>{formatNumber(model.summaryById.linkedCommentCount.value)} / {formatNumber(model.summaryById.commentCount.value)}</strong>条评论可关联到同账号已存笔记；孤立评论仍保留为可核对来源。</p>
                <p><strong>{formatNumber(model.summaryById.captureBatchCount.value)}</strong>个采集响应批次已记录；旧数据未保存逐条采集批次，因此实体可追溯、历史网络响应不可完全还原。</p>
                <p><strong>点赞为单点观测</strong>当前数据没有点赞历史序列，报告不会计算增长率，也不会把关键词、类型与点赞描述为因果关系。</p>
              </div>
            </section>

            <section className="analytics-band ai-analysis-band" aria-labelledby="ai-analysis-title">
              <div className="analytics-section-heading ai-section-heading">
                <div><span><IconBrain size={15} />AI 辅助洞察</span><h2 id="ai-analysis-title">文本语义解读与运营假设</h2></div>
                <div className="ai-section-actions">
                  <div className="ai-report-meta">
                    <div className="ai-model-display" aria-label={`当前 AI 模型：${aiSettings?.model || "未配置"}`} title={aiSettings?.model || "未配置"}>
                      <span>模型：</span><strong>{aiSettings?.model || "未配置"}</strong>
                    </div>
                    {aiReport && <small>{aiCoverageText(aiReport, aiCounts)}</small>}
                  </div>
                  <button className="analytics-ai-settings" type="button" onClick={openAiSettings} disabled={aiBusy} aria-label="AI 服务设置" title="AI 服务设置"><IconSettings size={17} /></button>
                </div>
              </div>

              <div className="ai-boundary-note">
                <IconShieldLock size={18} stroke={1.7} />
                <p><strong>辅助层边界</strong>AI 负责语义标签、分组和候选引用；本地校验并按有效引用重算 AI 分组内的条数、占比与顺序。基础指标、统计结论和图表完全不读取 AI 结果。</p>
              </div>

              <div className={`ai-status-strip status-${aiDisplayStatus}`}>
                <AiStatusIcon className={aiDisplayStatus === "running" || aiDisplayStatus === "stopping" || aiDisplayStatus === "loading" ? "spin" : ""} size={20} stroke={1.7} />
                <div className="ai-status-copy"><strong>{aiStatusCopy.title}</strong><span>{aiStatusCopy.text}</span></div>
                {(aiDisplayStatus === "running" || aiDisplayStatus === "stopping") && (
                  <div className="ai-progress-block">
                    <div
                      className={`ai-progress ${aiProgressIsBatch || aiProgressIsCompleted ? "is-determinate" : "is-indeterminate"}`}
                      aria-label={aiProgressIsBatch || aiProgressIsCompleted
                        ? `文本批次进度 ${Math.round(aiProgressIsCompleted ? 100 : aiProgressPercent)}%`
                        : `当前阶段：${aiProgressStage}`}
                    >
                      <span><i style={aiProgressIsBatch || aiProgressIsCompleted ? { width: `${aiProgressIsCompleted ? 100 : aiProgressPercent}%` } : undefined} /></span>
                      <small>{aiProgressIsBatch
                        ? `${formatNumber(aiProgressCompletedBatches)} / ${formatNumber(aiProgressTotalBatches)} 批`
                        : aiProgressIsCompleted ? "已完成" : aiProgressStage}</small>
                    </div>
                    <div className="ai-progress-meta" aria-label="AI 分析实时状态">
                      <span>已用时 <strong>{formatElapsedTime(aiProgress.elapsedMs)}</strong></span>
                      {Number(aiProgress.waitingMs) > 0 && <span>本次等待 <strong>{formatElapsedTime(aiProgress.waitingMs)}</strong></span>}
                      <span>调用 <strong>{formatNumber(aiProviderCalls)}</strong> 次</span>
                    </div>
                  </div>
                )}
                <div className="ai-status-actions">
                  {aiDisplayStatus === "running" ? (
                    <button className="button ai-stop-button" type="button" onClick={cancelAiAnalysis}><IconPlayerStop size={15} />停止</button>
                  ) : aiDisplayStatus === "stopping" ? (
                    <button className="button ai-stop-button" type="button" disabled><IconLoader2 className="spin" size={15} />停止中</button>
                  ) : aiDisplayStatus === "unconfigured" ? (
                    <button className="button primary" type="button" onClick={openAiSettings}><IconSettings size={15} />配置 AI 辅助</button>
                  ) : aiDisplayStatus !== "unavailable" && (
                    <button className="button primary" type="button" onClick={runAiAnalysis} disabled={!aiCounts.total}><IconPlayerPlay size={15} />{aiDisplayStatus === "stale" ? "更新洞察" : aiReport ? "重新生成" : "生成洞察"}</button>
                  )}
                </div>
              </div>

              {aiBusy && (
                <div className="ai-live-output" aria-live="polite" aria-label="AI 实时生成内容">
                  <div className="ai-live-output-head">
                    <span><IconBrain size={15} />实时生成内容</span>
                    <small>{aiStreamMeta.characters > 0 ? `当前响应已接收 ${formatNumber(aiStreamMeta.characters)} 字` : "正在等待模型首段输出"}</small>
                  </div>
                  <p>{aiLivePreview || "模型正在组织结构化结果；首个可读片段到达后会在这里逐步显示。"}<i aria-hidden="true" /></p>
                  <small>上方为流式生成预览；下方只展示已经完成解析、通过本地来源校验并可回查原始笔记或评论的内容。</small>
                </div>
              )}

              <div className={`ai-results-grid ${aiBusy ? "is-streaming" : ""}`} aria-busy={aiBusy}>
                <AiSentimentPanel rows={aiCollections.sentiments} commentCount={aiCounts.comments} streaming={aiBusy} onOpen={openEvidence} />
                <AiClusterPanel kind="topic" rows={aiCollections.topics} emptyText={aiBusy ? "正在等待首批已校验的内容主题。" : aiReport ? "当前洞察没有形成可验证的主题簇。" : "生成 AI 辅助洞察后显示内容主题。"} onOpen={openEvidence} />
                <AiClusterPanel kind="need" rows={aiCollections.needs} emptyText={!aiCounts.comments ? "当前范围没有评论数据，无法归纳用户需求。" : aiBusy ? "正在等待首批已校验的用户需求。" : aiReport ? "当前评论样本没有形成可验证的需求结论。" : "生成 AI 辅助洞察后显示评论中的用户需求。"} onOpen={openEvidence} />
                <AiRecommendationPanel rows={aiCollections.recommendations} streaming={aiBusy} onOpen={openEvidence} />
              </div>

              {aiReport?.limitations?.length > 0 && (
                <div className="ai-report-limitations"><strong>AI 辅助边界</strong>{aiReport.limitations.map((item) => <span key={item}>{item}</span>)}</div>
              )}
            </section>
          </>
        )}
      </div>

      <AiSettingsModal
        open={aiSettingsOpen}
        settings={aiSettings}
        draft={aiSettingsDraft}
        setDraft={setAiSettingsDraft}
        busy={aiSettingsBusy}
        result={aiSettingsResult}
        error={aiSettingsError}
        modelCatalog={aiModelCatalog}
        modelQuery={aiModelQuery}
        setModelQuery={setAiModelQuery}
        onClose={() => setAiSettingsOpen(false)}
        onSave={saveAiSettings}
        onTest={testAiConnection}
        onLoadModels={loadAiModels}
      />
      <EvidenceDrawer request={evidenceRequest} model={model} accountsById={accountsById} onClose={() => setEvidenceRequest(null)} onOpenNote={onOpenNote} />
    </section>
  );
}
