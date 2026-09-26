const fs = require("node:fs/promises");
const path = require("node:path");

const RELEASE_PAGE = "https://github.com/xujack97121/-/releases/latest";
const RELEASE_API = "https://api.github.com/repos/xujack97121/-/releases/latest";
const FEED = Object.freeze({ provider: "github", owner: "xujack97121", repo: "-", private: false });
const CHECK_TIMEOUT_MS = 8_000;

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
  if (code === "ERR_UPDATE_METADATA") return "未能确认 GitHub 官方版本信息，请重试检查或前往下载新版。";
  if (code === "ERR_UPDATE_RATE_LIMIT") return "GitHub 暂时限制更新检查，请稍后重试或前往下载新版。";
  if (code === "ERR_UPDATE_HTTP") return "GitHub 更新服务暂不可用，请稍后重试或前往下载新版。";
  const details = [code, error?.name, error?.message, error?.cause?.code].join(" ");
  if (/TimeoutError|AbortError|TIMEDOUT|ERR_TIMED_OUT/.test(details)) return "连接更新服务超时，请检查网络或系统代理后重试，也可前往下载新版。";
  if (/ENOTFOUND|EAI_AGAIN|ERR_NAME_NOT_RESOLVED/.test(details)) return "无法解析更新服务地址，请检查网络或 DNS 后重试，也可前往下载新版。";
  if (/PROXY|TUNNEL/.test(details)) return "无法通过系统代理连接更新服务，请检查代理后重试，也可前往下载新版。";
  return "更新请求失败，请检查网络或稍后重试，也可前往 GitHub 下载。";
}

function requestReleaseRedirect(net) {
  return new Promise((resolve, reject) => {
    const request = net.request({ url: RELEASE_PAGE, method: "HEAD", credentials: "omit", useSessionCookies: false, redirect: "manual" });
    let settled = false;
    const finish = (error, response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(response);
      request.abort();
    };
    const timer = setTimeout(() => finish(new DOMException("Release lookup timed out", "TimeoutError")), CHECK_TIMEOUT_MS);
    request.on("redirect", (status, _method, location) => finish(null, { status, location }));
    request.on("response", (response) => {
      response.on("error", (error) => finish(error));
      finish(null, { status: response.statusCode, location: response.headers.location?.[0] || "" });
    });
    request.on("error", (error) => finish(error));
    request.on("abort", () => finish(new DOMException("Release lookup aborted", "AbortError")));
    try {
      request.setHeader("Cache-Control", "no-cache");
      request.end();
    } catch (error) {
      finish(error);
    }
  });
}

function releaseRedirectVersion(response) {
  const invalid = () => { throw Object.assign(new Error("Invalid release redirect"), { code: "ERR_UPDATE_METADATA" }); };
  if (![301, 302, 303, 307, 308].includes(response.status)) invalid();
  const location = response.location;
  if (!location) invalid();
  const url = new URL(location, RELEASE_PAGE);
  if (url.origin !== "https://github.com" || url.username || url.password || url.search || url.hash) invalid();
  return /^\/xujack97121\/-\/releases\/tag\/v(\d{1,6}\.\d{1,6}\.\d{1,6})$/.exec(url.pathname)?.[1] || invalid();
}

class AppUpdates {
  constructor({ version, isPackaged, platform = process.platform, updater, settingsPath, fetchImpl, releaseRedirectImpl, openRelease, beforeInstall, onState = () => {} }) {
    this.updater = updater;
    this.settingsPath = settingsPath;
    this.fetchImpl = fetchImpl;
    this.releaseRedirectImpl = releaseRedirectImpl;
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
      checkSource: "",
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
      this.setState({ status: "checking", checkSource: "", error: "" });
      if (this.state.mode === "automatic") {
        await this.updater.checkForUpdates();
        return;
      }
      const latestVersion = await this.lookupLatestVersion();
      const available = newerVersion(latestVersion, this.state.currentVersion);
      this.setState({ status: available ? "available" : "current", latestVersion: available ? latestVersion : "", checkedAt: Date.now(), error: "" });
    });
  }

  async lookupLatestVersion() {
    this.setState({ checkSource: "api" });
    try {
      const response = await this.fetchImpl(RELEASE_API, {
        headers: { Accept: "application/vnd.github+json" },
        credentials: "omit", cache: "no-store", redirect: "error",
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error("Release lookup failed");
      const release = await response.json();
      if (release.draft || release.prerelease || !/^v\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(release.tag_name || "")) throw new Error("Invalid stable release");
      return release.tag_name.slice(1);
    } catch {
      // GitHub's public latest redirect avoids the API's separate rate limit.
      this.setState({ checkSource: "release-page" });
      const response = await this.releaseRedirectImpl();
      if ([403, 429].includes(response.status)) throw Object.assign(new Error("Release lookup limited"), { code: "ERR_UPDATE_RATE_LIMIT" });
      if (response.status >= 400) throw Object.assign(new Error("Release lookup unavailable"), { code: "ERR_UPDATE_HTTP" });
      return releaseRedirectVersion(response);
    }
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
    try {
      await this.openRelease(RELEASE_PAGE);
    } catch {
      this.setState({ error: "无法打开默认浏览器，请在浏览器中访问 github.com/xujack97121/-/releases/latest 下载新版。" });
    }
    return this.getState();
  }

  dispose() {
    clearTimeout(this.timer);
    this.state.autoCheck = false;
    for (const [name, fn] of this.listeners) this.updater.removeListener(name, fn);
  }
}

module.exports = { AppUpdates, newerVersion, requestReleaseRedirect, RELEASE_PAGE, FEED };
