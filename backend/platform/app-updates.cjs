const fs = require("node:fs/promises");
const path = require("node:path");

const RELEASE_PAGE = "https://github.com/xujack97121/-/releases/latest";
const RELEASE_API = "https://api.github.com/repos/xujack97121/-/releases/latest";
const FEED = Object.freeze({ provider: "github", owner: "xujack97121", repo: "-", private: false });

function newerVersion(candidate, current) {
  const parse = (value) => /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(String(value || ""))?.slice(1).map(Number);
  const left = parse(candidate), right = parse(current);
  if (!left || !right) return false;
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i];
  return false;
}

function updateError(error) {
  const code = String(error?.code || "");
  if (/SHA512|CHECKSUM|SIGNATURE/.test(code)) return "安装包校验未通过，已停止更新，请重新检查并下载。";
  if (/ENOSPC/.test(code)) return "磁盘空间不足，请清理空间后重试。";
  if (/EACCES|EPERM/.test(code)) return "无法写入更新文件，请检查安装目录权限。";
  return "更新请求失败，请检查网络或稍后重试，也可前往 GitHub 下载。";
}

class AppUpdates {
  constructor({ version, isPackaged, platform = process.platform, updater, settingsPath, fetchImpl, openRelease, beforeInstall, onState = () => {} }) {
    this.updater = updater;
    this.settingsPath = settingsPath;
    this.fetchImpl = fetchImpl;
    this.openRelease = openRelease;
    this.beforeInstall = beforeInstall;
    this.onState = onState;
    this.timer = null;
    this.operation = null;
    this.preferenceWrite = Promise.resolve();
    this.listeners = [];
    this.state = {
      currentVersion: version,
      mode: !isPackaged ? "development" : platform === "win32" ? "automatic" : "manual",
      status: "idle",
      autoCheck: true,
      latestVersion: "",
      progress: 0,
      transferred: 0,
      total: 0,
      checkedAt: null,
      error: "",
    };
    if (this.state.mode === "automatic") {
      updater.autoDownload = false;
      updater.autoInstallOnAppQuit = false;
      updater.allowPrerelease = false;
      updater.allowDowngrade = false;
      updater.setFeedURL(FEED);
      const listen = (name, fn) => { updater.on(name, fn); this.listeners.push([name, fn]); };
      listen("checking-for-update", () => this.setState({ status: "checking", error: "" }));
      listen("update-available", (info) => {
        if (!newerVersion(info?.version, version)) {
          this.setState({ status: "current", latestVersion: "", checkedAt: Date.now() });
          return;
        }
        this.setState({ status: "available", latestVersion: info.version, progress: 0, checkedAt: Date.now(), error: "" });
      });
      listen("update-not-available", () => this.setState({ status: "current", latestVersion: "", checkedAt: Date.now(), error: "" }));
      listen("download-progress", (info) => this.setState({
        status: "downloading",
        progress: Math.min(100, Math.max(0, Number(info.percent) || 0)),
        transferred: Math.max(0, Number(info.transferred) || 0),
        total: Math.max(0, Number(info.total) || 0),
      }));
      listen("update-downloaded", (info) => {
        if (!newerVersion(info?.version, version)) return;
        this.setState({ status: "downloaded", latestVersion: info.version, progress: 100, error: "" });
      });
      listen("error", (error) => this.setState({ status: "error", error: updateError(error) }));
    }
  }

  getState() { return { ...this.state }; }

  setState(patch) {
    this.state = { ...this.state, ...patch };
    this.onState(this.getState());
  }

  async initialize() {
    try {
      const saved = JSON.parse(await fs.readFile(this.settingsPath, "utf8"));
      if (typeof saved.autoCheck === "boolean") this.state.autoCheck = saved.autoCheck;
    } catch { /* first launch or damaged preferences: keep the non-destructive default */ }
    this.schedule(20_000);
    return this.getState();
  }

  schedule(delay = 6 * 60 * 60 * 1000) {
    clearTimeout(this.timer);
    if (!this.state.autoCheck || this.state.mode === "development") return;
    this.timer = setTimeout(async () => {
      await this.check();
      this.schedule();
    }, delay);
    this.timer.unref?.();
  }

  async setPreferences(payload) {
    if (typeof payload?.autoCheck !== "boolean") throw new Error("自动检查设置无效");
    const save = async () => {
      await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });
      const temporary = `${this.settingsPath}.tmp`;
      await fs.writeFile(temporary, JSON.stringify({ autoCheck: payload.autoCheck }), { mode: 0o600 });
      await fs.rename(temporary, this.settingsPath);
      this.setState({ autoCheck: payload.autoCheck });
      this.schedule(20_000);
      return this.getState();
    };
    this.preferenceWrite = this.preferenceWrite.then(save, save);
    return this.preferenceWrite;
  }

  async run(work) {
    if (this.operation) return this.getState();
    this.operation = Promise.resolve().then(work).catch((error) => {
      this.setState({ status: "error", error: updateError(error) });
    }).finally(() => { this.operation = null; });
    await this.operation;
    return this.getState();
  }

  async check() {
    if (this.state.mode === "development" || ["downloading", "downloaded", "installing"].includes(this.state.status)) return this.getState();
    return this.run(async () => {
      this.setState({ status: "checking", error: "" });
      if (this.state.mode === "automatic") {
        await this.updater.checkForUpdates();
        return;
      }
      const response = await this.fetchImpl(RELEASE_API, {
        headers: { Accept: "application/vnd.github+json" },
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error("Release lookup failed");
      const release = await response.json();
      if (release.draft || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(release.tag_name || "")) throw new Error("Invalid stable release");
      const available = newerVersion(release.tag_name, this.state.currentVersion);
      this.setState({ status: available ? "available" : "current", latestVersion: available ? release.tag_name.slice(1) : "", checkedAt: Date.now(), error: "" });
    });
  }

  async download() {
    if (this.state.mode !== "automatic" || this.state.status !== "available") return this.getState();
    return this.run(async () => {
      this.setState({ status: "downloading", progress: 0, error: "" });
      await this.updater.downloadUpdate();
    });
  }

  async install() {
    if (this.state.mode !== "automatic" || this.state.status !== "downloaded") return this.getState();
    return this.run(async () => {
      try {
        if (!await this.beforeInstall()) return;
      } catch (error) {
        this.setState({ error: error?.message || "请先停止正在运行的任务。" });
        return;
      }
      this.setState({ status: "installing", error: "" });
      this.updater.quitAndInstall(false, true);
    });
  }

  async openDownloadPage() {
    await this.openRelease(RELEASE_PAGE);
    return this.getState();
  }

  dispose() {
    clearTimeout(this.timer);
    this.state.autoCheck = false;
    for (const [name, fn] of this.listeners) this.updater.removeListener(name, fn);
  }
}

module.exports = { AppUpdates, newerVersion, RELEASE_PAGE, FEED };
