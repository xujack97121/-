import { useEffect, useRef, useState } from "react";
import { IconDownload, IconExternalLink, IconRefresh, IconRotateClockwise } from "@tabler/icons-react";

export function useAppUpdates() {
  const api = globalThis.collectorDesktop?.updates;
  const [state, setState] = useState({ currentVersion: __APP_VERSION__, mode: "development", status: "idle", autoCheck: true, progress: 0 });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const locked = useRef(false);
  useEffect(() => {
    if (!api) return;
    let active = true;
    let receivedEvent = false;
    const unsubscribe = api.onState((next) => { receivedEvent = true; if (active) setState(next); });
    api.getState().then((next) => { if (active && !receivedEvent) setState(next); })
      .catch(() => { if (active) setError("无法读取更新状态，请重新打开软件。"); });
    return () => { active = false; unsubscribe?.(); };
  }, [api]);
  const invoke = async (action, value) => {
    if (!api?.[action] || locked.current) return;
    locked.current = true;
    setPending(true);
    setError("");
    try {
      const next = await api[action](value);
      if (next) setState(next);
    } catch {
      setError("更新操作未完成，请重试。");
    } finally {
      locked.current = false;
      setPending(false);
    }
  };
  return { state, pending, error, invoke };
}

export function AppUpdatesSettings({ updates }) {
  if (!updates) return null;
  const { state, pending, error, invoke } = updates;
  const { status, mode } = state;
  const busy = pending || ["checking", "downloading", "installing"].includes(status);
  const enabled = mode !== "development";
  const message = !enabled ? "在线更新仅在桌面安装版可用"
    : ({
      idle: "尚未检查",
      checking: "正在检查更新",
      current: "已是最新版本",
      available: `发现新版本 v${state.latestVersion}`,
      downloading: `正在下载 v${state.latestVersion}`,
      downloaded: `v${state.latestVersion} 已下载，等待安装`,
      installing: "正在启动安装程序",
      error: "更新未完成",
    }[status] || "尚未检查");
  return (
    <section className="settings-updates" aria-labelledby="settings-updates-heading">
      <div className="settings-row">
        <div><strong id="settings-updates-heading">软件更新</strong><small>当前版本 v{state.currentVersion}</small></div>
        <button className="button" type="button" disabled={!enabled || busy || status === "downloaded"} onClick={() => invoke("check")}>
          <IconRefresh size={15} className={status === "checking" ? "spin" : ""} />{status === "checking" ? "检查中" : "检查更新"}
        </button>
      </div>
      <p className="settings-update-status" role="status">{message}</p>
      {status === "downloading" && <div className="settings-update-progress">
        <progress aria-label="更新下载进度" value={state.progress} max={100} /><span>{Math.floor(state.progress || 0)}%</span>
      </div>}
      {(state.error || error) && <p className="settings-update-error" role="alert">{state.error || error}</p>}
      <div className="settings-update-actions">
        {status === "available" && mode === "automatic" && <button className="button primary" type="button" disabled={busy} onClick={() => invoke("download")}><IconDownload size={15} />下载更新</button>}
        {status === "downloaded" && <button className="button primary" type="button" disabled={busy} onClick={() => invoke("install")}><IconRotateClockwise size={15} />安装并重启</button>}
        {enabled && <button className="button" type="button" disabled={pending} onClick={() => invoke("openRelease")}><IconExternalLink size={15} />{mode === "manual" ? "前往下载新版" : "GitHub 发布页"}</button>}
      </div>
      {mode === "manual" && <p className="settings-update-status">当前平台使用安装包更新。</p>}
      <label className="settings-row">
        <strong>自动检查更新</strong>
        <input type="checkbox" role="switch" aria-label="自动检查更新" disabled={!enabled || pending} checked={Boolean(state.autoCheck)} onChange={(event) => invoke("setPreferences", { autoCheck: event.target.checked })} />
      </label>
    </section>
  );
}
