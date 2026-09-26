const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { accountPlatform } = require("../platform/content-platforms.cjs");

const ACCOUNT_ID_PATTERN = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const DEFAULT_MAX_ACCOUNTS = 8;

function normalizeAccountName(value, fallback = "新账号") {
  const name = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 30);
  return name || fallback;
}

function isAccountId(value) {
  return ACCOUNT_ID_PATTERN.test(String(value || ""));
}

function partitionForAccount(accountId, platform = "xhs") {
  if (!isAccountId(accountId)) throw new Error("账号 ID 无效");
  return `persist:${accountPlatform(platform) === "douyin" ? "douyin" : "xhs"}-multi-account-${accountId.toLowerCase()}`;
}

function publicMetadata(record) {
  return {
    id: record.id,
    name: record.name,
    platform: record.platform,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastActiveAt: record.lastActiveAt,
  };
}

class AccountRegistry {
  constructor({ filePath, maxAccounts = DEFAULT_MAX_ACCOUNTS, idFactory = randomUUID, now = () => Date.now() }) {
    if (!path.isAbsolute(filePath)) throw new Error("账号配置路径必须是绝对路径");
    this.filePath = filePath;
    this.maxAccounts = Math.max(1, Math.floor(Number(maxAccounts) || DEFAULT_MAX_ACCOUNTS));
    this.idFactory = idFactory;
    this.now = now;
    this.records = new Map();
    this.activeAccountId = "";
    this.writeQueue = Promise.resolve();
  }

  async load() {
    let parsed = null;
    try {
      parsed = JSON.parse(await fs.readFile(this.filePath, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }

    this.records.clear();
    for (const candidate of Array.isArray(parsed?.accounts) ? parsed.accounts : []) {
      if (!isAccountId(candidate?.id) || this.records.size >= this.maxAccounts) continue;
      const createdAt = Math.max(0, Number(candidate.createdAt) || this.now());
      const record = {
        id: String(candidate.id).toLowerCase(),
        name: normalizeAccountName(candidate.name, `账号 ${this.records.size + 1}`),
        platform: candidate.platform === "douyin" ? "douyin" : "xhs",
        partition: partitionForAccount(candidate.id, candidate.platform === "douyin" ? "douyin" : "xhs"),
        createdAt,
        updatedAt: Math.max(createdAt, Number(candidate.updatedAt) || createdAt),
        lastActiveAt: Math.max(0, Number(candidate.lastActiveAt) || 0),
      };
      this.records.set(record.id, record);
    }

    const requestedActiveId = String(parsed?.activeAccountId || "").toLowerCase();
    this.activeAccountId = this.records.has(requestedActiveId) ? requestedActiveId : (this.records.keys().next().value || "");
    return this.list();
  }

  async ensureDefault() {
    if (this.records.size) return this.get(this.activeAccountId || this.records.keys().next().value);
    return this.add("账号 1");
  }

  list() {
    return Array.from(this.records.values()).map(publicMetadata);
  }

  get(accountId) {
    const id = String(accountId || "").toLowerCase();
    const record = this.records.get(id);
    if (!record) throw new Error("账号不存在或已被删除");
    return record;
  }

  async add(name, platform = "xhs") {
    accountPlatform(platform);
    if (this.records.size >= this.maxAccounts) throw new Error(`最多可同时保留 ${this.maxAccounts} 个账号`);
    const id = String(this.idFactory()).toLowerCase();
    if (!isAccountId(id) || this.records.has(id)) throw new Error("无法生成唯一账号 ID");
    const timestamp = this.now();
    const record = {
      id,
      name: normalizeAccountName(name, `账号 ${this.records.size + 1}`),
      platform,
      partition: partitionForAccount(id, platform),
      createdAt: timestamp,
      updatedAt: timestamp,
      lastActiveAt: timestamp,
    };
    this.records.set(id, record);
    if (!this.activeAccountId) this.activeAccountId = id;
    await this.persist();
    return record;
  }

  async rename(accountId, name) {
    const record = this.get(accountId);
    record.name = normalizeAccountName(name, record.name);
    record.updatedAt = this.now();
    await this.persist();
    return record;
  }

  async setActive(accountId) {
    const record = this.get(accountId);
    this.activeAccountId = record.id;
    record.lastActiveAt = this.now();
    record.updatedAt = Math.max(record.updatedAt, record.lastActiveAt);
    await this.persist();
    return record;
  }

  async remove(accountId) {
    const record = this.get(accountId);
    if (this.records.size <= 1) throw new Error("至少保留一个账号槽位");
    this.records.delete(record.id);
    if (this.activeAccountId === record.id) this.activeAccountId = this.records.keys().next().value || "";
    await this.persist();
    return record;
  }

  persist() {
    const snapshot = JSON.stringify({
      version: 1,
      activeAccountId: this.activeAccountId,
      accounts: Array.from(this.records.values()).map(publicMetadata),
    }, null, 2);
    const directory = path.dirname(this.filePath);
    const temporaryPath = `${this.filePath}.tmp`;
    const writeSnapshot = async () => {
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(temporaryPath, snapshot, { encoding: "utf8", mode: 0o600 });
      await fs.rename(temporaryPath, this.filePath);
    };
    this.writeQueue = this.writeQueue.then(writeSnapshot, writeSnapshot);
    return this.writeQueue;
  }
}

module.exports = {
  AccountRegistry,
  DEFAULT_MAX_ACCOUNTS,
  isAccountId,
  normalizeAccountName,
  partitionForAccount,
};
