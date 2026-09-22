import { useEffect, useRef, useState } from "react";
import { IconAlertCircle, IconCircleCheck, IconLoader2, IconRefresh, IconSearch, IconSettings, IconShieldLock, IconTestPipe, IconTrash, IconX } from "@tabler/icons-react";
import "../analytics/analytics.css";
import "./settings.css";
import { AppUpdatesSettings } from "./AppUpdates.jsx";
const formatNumber = (value) => new Intl.NumberFormat("zh-CN").format(Number(value));
function aiSettingsConfigured(settings) {
  return Boolean(settings?.baseUrl && settings?.model && (settings?.hasApiKey || settings?.apiKeyRequired === false));
}

function aiErrorMessage(error, fallback = "AI 分析暂时无法完成") {
  return String(error?.message || error || fallback)
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^(?:AiServiceError|Error):\s*/i, "");
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

function AiSettingsModal({ settings, draft, setDraft, busy, result, error, modelCatalog, modelQuery, setModelQuery, onClose, onSave, onTest, onLoadModels, initialTab, accountName, muted, onMuted, available, loading, loadFailed, updates }) {
  const [tab, setTab] = useState(initialTab);
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
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
  const canTestDraft = Boolean(draft.baseUrl.trim() && draft.model.trim()
    && !draft.clearApiKey
    && (draft.apiKey.trim() || (settings?.hasApiKey && !endpointOriginChanged) || (settings?.apiKeyRequired === false && !endpointOriginChanged)));
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

  const close = () => {
    if (modalBusy) return;
    if (dirty && !window.confirm("AI 设置尚未保存，放弃修改并关闭？")) return;
    onClose();
  };
  closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = dialogRef.current;
    const backdrop = dialog.parentElement;
    const background = [...backdrop.parentElement.children].filter((element) => element !== backdrop);
    const previousInert = background.map((element) => element.inert);
    background.forEach((element) => { element.inert = true; });
    dialog.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
      if (event.key !== "Tab") return;
      const controls = [...dialog.querySelectorAll('button, input, select, [tabindex="0"]')]
        .filter((element) => !element.disabled && element.getClientRects().length && !element.closest('[hidden], fieldset:disabled'));
      const first = controls[0], last = controls.at(-1);
      if (!first) { event.preventDefault(); dialog.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    dialog.addEventListener("keydown", onKeyDown);
    return () => {
      dialog.removeEventListener("keydown", onKeyDown);
      background.forEach((element, index) => { element.inert = previousInert[index]; });
      if (previous?.isConnected) previous.focus();
      else document.querySelector('.account-manage')?.focus();
    };
  }, []);

  return (
    <div className="ai-settings-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section ref={dialogRef} tabIndex={-1} className="ai-settings-modal app-settings-modal" role="dialog" aria-modal="true" aria-labelledby="ai-settings-title">
        <header>
          <h2 id="ai-settings-title"><IconSettings size={18} />设置</h2>
          <button className="icon-button" type="button" onClick={close} disabled={modalBusy} aria-label="关闭设置" title="关闭"><IconX size={18} /></button>
        </header>
        <div className="settings-tabs" role="tablist" aria-label="设置分类" onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === "Home" ? "general" : event.key === "End" ? "ai" : tab === "ai" ? "general" : "ai";
          setTab(next);
          dialogRef.current.querySelector(`#settings-tab-${next}`)?.focus();
        }}>
          {[{ id: "general", label: "通用" }, { id: "ai", label: "AI 服务" }].map((item) => <button key={item.id} id={`settings-tab-${item.id}`} type="button" role="tab" aria-selected={tab === item.id} aria-controls={`settings-panel-${item.id}`} tabIndex={tab === item.id ? 0 : -1} onClick={() => setTab(item.id)}>{item.label}</button>)}
        </div>
        <div id="settings-panel-general" role="tabpanel" aria-labelledby="settings-tab-general" hidden={tab !== "general"} className="settings-general">
          <div className="settings-row"><div><strong>网页静音</strong><small>{accountName || "当前账号"}</small></div><input aria-label="网页静音" type="checkbox" role="switch" checked={muted} onChange={(event) => onMuted(event.target.checked)} /></div>
          <AppUpdatesSettings updates={updates} />
        </div>
        <div id="settings-panel-ai" role="tabpanel" aria-labelledby="settings-tab-ai" hidden={tab !== "ai"}>
        {!available && <p className="settings-unavailable" role="status">AI 服务配置仅在桌面版可用。</p>}
        {loading && <p className="settings-unavailable" role="status">正在读取设置…</p>}
        <fieldset className="ai-settings-body" disabled={!available || loadFailed || loading || modalBusy}>
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
                <div><strong>可用模型</strong><span>{modelCatalog?.busy ? "读取中" : modelCatalog?.error ? "未获取" : `${formatNumber(availableModels.length, "0")} 个`}</span></div>
                {availableModels.length > 6 && (
                  <label className="ai-model-search" aria-label="搜索模型">
                    <IconSearch size={14} />
                    <input value={modelQuery} onChange={(event) => setModelQuery(event.target.value)} placeholder="搜索模型" autoComplete="off" />
                  </label>
                )}
              </header>
              {modelCatalog?.error && <div className="ai-model-catalog-error"><IconAlertCircle size={14} /><div>{modelCatalog.error}<small className="ai-model-catalog-hint">模型列表不可用不代表 API 不可用；已填写的模型仍可保存并测试。</small></div></div>}
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
        </fieldset>
        </div>
        {tab === "ai" && (error || result) && <div className="settings-feedback">
          {error && <div className="ai-settings-error" role="alert"><IconAlertCircle size={15} />{error}</div>}
          {result && <div className="ai-settings-success" role="status"><IconCircleCheck size={15} />{result}</div>}
        </div>}
        {tab === "ai" && <footer>
          <span>{dirty ? "有尚未保存的修改" : configured ? "配置已保存" : "等待完整配置"}</span>
          <button className="button" type="button" onClick={() => onTest(dirty)} disabled={!available || loadFailed || loading || modalBusy || !canTestDraft} title={dirty ? "保存当前修改后测试连接" : "测试已保存的配置"}>
            {busy === "test" ? <IconLoader2 className="spin" size={15} /> : <IconTestPipe size={15} />}{busy === "test" ? "正在测试" : dirty ? "保存并测试" : "测试连接"}
          </button>
          <button className="button primary" type="button" onClick={onSave} disabled={!available || loadFailed || loading || modalBusy || !draft.baseUrl.trim() || !draft.model.trim()}>
            {busy === "save" ? <IconLoader2 className="spin" size={15} /> : <IconCircleCheck size={15} />}保存设置
          </button>
        </footer>}
      </section>
    </div>
  );
}


export function SettingsDialog({ onClose, onSaved, accountName, muted, onMuted, initialTab = "ai", updates }) {
  const aiApi = globalThis.collectorDesktop?.ai;
  const [aiSettings, setAiSettings] = useState(null);
  const [aiSettingsDraft, setAiSettingsDraft] = useState(() => settingsDraftOf());
  const [aiSettingsBusy, setAiSettingsBusy] = useState("");
  const [aiSettingsResult, setAiSettingsResult] = useState("");
  const [aiSettingsError, setAiSettingsError] = useState("");
  const [aiModelCatalog, setAiModelCatalog] = useState(() => emptyAiModelCatalog());
  const [aiModelQuery, setAiModelQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => aiApi?.getSettings?.()).then((settings) => {
      if (!active) return;
      setAiSettings(settings || {});
      setAiSettingsDraft(settingsDraftOf(settings));
    }).catch((error) => { if (active) { setLoadFailed(true); setAiSettingsError(aiErrorMessage(error)); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [aiApi]);
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
  const persistAiSettings = async () => {
    if (!aiApi?.saveSettings) {
      throw new Error("当前桌面程序暂未提供 AI 设置能力。");
    }
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
    const { apiKey: _apiKey, ...publicPayload } = payload;
    const nextSettings = saved || { ...aiSettings, ...publicPayload, hasApiKey: fallbackHasApiKey };
    setAiSettings(nextSettings);
    setAiSettingsDraft(settingsDraftOf(nextSettings));
    if (catalogSourceChanged) {
      setAiModelCatalog(emptyAiModelCatalog());
      setAiModelQuery("");
    }
    if (Object.hasOwn(payload, "apiKey") && !payload.apiKey) setAiSettingsResult("设置已保存，API Key 已清除。");
    else if (nextSettings.hasApiKey) setAiSettingsResult("设置已保存，API Key 已加密保留，关闭或重启后仍会继续使用。");
    else setAiSettingsResult("设置已保存，当前未配置 API Key。");
    onSaved?.();
    return nextSettings;
  };
  const saveAiSettings = async () => {
    setAiSettingsBusy("save");
    setAiSettingsError("");
    setAiSettingsResult("");
    try {
      await persistAiSettings();
    } catch (error) {
      setAiSettingsError(aiErrorMessage(error, "AI 设置保存失败"));
    } finally {
      setAiSettingsBusy("");
    }
  };
  const testAiConnection = async (saveFirst = false) => {
    if (!aiApi?.testConnection) {
      setAiSettingsError("当前桌面程序暂未提供连接测试能力。");
      return;
    }
    setAiSettingsBusy("test");
    setAiSettingsError("");
    setAiSettingsResult("");
    let savedBeforeTest = false;
    try {
      if (saveFirst) {
        const saved = await persistAiSettings();
        savedBeforeTest = true;
        setAiSettingsResult("");
        if (!aiSettingsConfigured(saved)) throw new Error("请填写当前服务的 API Key。");
      }
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
      setAiSettingsError(`${savedBeforeTest ? "设置已保存，但连接测试未通过：" : ""}${aiErrorMessage(error, "连接测试失败")}`);
    } finally {
      setAiSettingsBusy("");
    }
  };

  return (
      <AiSettingsModal
        updates={updates}
        initialTab={initialTab}
        accountName={accountName}
        muted={muted}
        onMuted={onMuted}
        available={Boolean(aiApi?.getSettings && aiApi?.saveSettings)}
        loading={loading}
        loadFailed={loadFailed}
        settings={aiSettings}
        draft={aiSettingsDraft}
        setDraft={(update) => {
          setAiSettingsDraft(update);
          setAiSettingsError("");
          setAiSettingsResult("");
        }}
        busy={aiSettingsBusy}
        result={aiSettingsResult}
        error={aiSettingsError}
        modelCatalog={aiModelCatalog}
        modelQuery={aiModelQuery}
        setModelQuery={setAiModelQuery}
        onClose={onClose}
        onSave={saveAiSettings}
        onTest={testAiConnection}
        onLoadModels={loadAiModels}
      />
  );
}
