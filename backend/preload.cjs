const { contextBridge, ipcRenderer } = require("electron");

const subscribe = (channel, callback) => {
  if (typeof callback !== "function") throw new TypeError("订阅回调必须是函数");
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

const accountIdOf = (value) => typeof value === "string" ? value : value?.accountId;
const nameOf = (value) => typeof value === "string" ? value : value?.name;

const accounts = Object.freeze({
  list: () => ipcRenderer.invoke("accounts:list"),
  add: (options = {}) => ipcRenderer.invoke("accounts:add", { name: nameOf(options) }),
  switch: (account) => ipcRenderer.invoke("accounts:switch", { accountId: accountIdOf(account) }),
  rename: (account, name) => ipcRenderer.invoke("accounts:rename", {
    accountId: accountIdOf(account),
    name: name ?? (typeof account === "object" ? account?.name : undefined),
  }),
  remove: (account, options = {}) => ipcRenderer.invoke("accounts:remove", {
    accountId: accountIdOf(account),
    clearData: typeof account === "object" && Object.hasOwn(account, "clearData") ? account.clearData : options.clearData,
  }),
  status: (account) => ipcRenderer.invoke("accounts:status", { accountId: accountIdOf(account) }),
  refreshStatus: (account) => ipcRenderer.invoke("accounts:refresh-status", { accountId: accountIdOf(account) }),
  onChanged: (callback) => subscribe("accounts:changed", callback),
  onStatus: (callback) => subscribe("account:status", callback),
});

const ai = Object.freeze({
  getSettings: () => ipcRenderer.invoke("ai:get-settings"),
  saveSettings: (settings = {}) => ipcRenderer.invoke("ai:save-settings", settings),
  testConnection: () => ipcRenderer.invoke("ai:test-connection"),
  listModels: () => ipcRenderer.invoke("ai:list-models"),
  analyze: (request) => ipcRenderer.invoke("ai:analyze", request),
  cancel: (requestId) => ipcRenderer.invoke("ai:cancel", { requestId }),
  onProgress: (callback) => subscribe("ai:progress", callback),
});

contextBridge.exposeInMainWorld("collectorDesktop", {
  isDesktop: true,
  accounts,
  ai,
  listAccounts: accounts.list,
  addAccount: accounts.add,
  createAccount: accounts.add,
  switchAccount: accounts.switch,
  renameAccount: accounts.rename,
  removeAccount: accounts.remove,
  getAccountStatus: accounts.status,
  checkAccountLogin: accounts.refreshStatus,
  onAccountsChanged: accounts.onChanged,
  onAccountStatus: accounts.onStatus,
  navigate: (accountId, url) => ipcRenderer.invoke("browser:navigate", { accountId, url }),
  openNote: (accountId, note) => ipcRenderer.invoke("browser:open-note", { accountId, note }),
  operateNote: (accountId, task) => ipcRenderer.invoke("browser:operate-note", { accountId, task }),
  startTask: (accountId, task) => ipcRenderer.invoke("browser:start-task", { accountId, task }),
  stopTask: (accountId) => ipcRenderer.invoke("browser:stop-task", { accountId }),
  reload: (accountId) => ipcRenderer.invoke("browser:reload", { accountId }),
  home: (accountId) => ipcRenderer.invoke("browser:home", { accountId }),
  setMuted: (accountId, muted) => ipcRenderer.invoke("browser:set-muted", { accountId, muted: Boolean(muted) }),
  setBrowserBounds: (bounds) => ipcRenderer.send("browser:set-bounds", bounds),
  setDataDashboardOpen: (open) => ipcRenderer.send("window:set-data-dashboard-open", Boolean(open)),
  onCapture: (callback) => subscribe("collector:capture", callback),
  onNavigation: (callback) => subscribe("browser:navigation", callback),
  onStatus: (callback) => subscribe("collector:status", callback),
});
