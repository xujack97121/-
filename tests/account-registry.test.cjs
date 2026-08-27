const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  AccountRegistry,
  DEFAULT_MAX_ACCOUNTS,
  isAccountId,
  normalizeAccountName,
  partitionForAccount,
} = require("../electron/account-registry.cjs");

const ACCOUNT_A = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_B = "22222222-2222-4222-8222-222222222222";
const ACCOUNT_C = "33333333-3333-4333-8333-333333333333";

async function main() {
  assert.equal(DEFAULT_MAX_ACCOUNTS, 8);
  assert.equal(isAccountId(ACCOUNT_A), true);
  assert.equal(isAccountId(ACCOUNT_A.toUpperCase()), true);
  for (const invalid of ["", "account-1", `${ACCOUNT_A}/../other`, ACCOUNT_A.slice(1), `${ACCOUNT_A} `]) {
    assert.equal(isAccountId(invalid), false);
    assert.throws(() => partitionForAccount(invalid), /账号 ID 无效/);
  }
  assert.equal(partitionForAccount(ACCOUNT_A.toUpperCase()), `persist:xhs-multi-account-${ACCOUNT_A}`);
  assert.equal(partitionForAccount(ACCOUNT_A), partitionForAccount(ACCOUNT_A.toUpperCase()));

  assert.equal(normalizeAccountName("  主账号\n  华东  "), "主账号 华东");
  assert.equal(normalizeAccountName("", "备用账号"), "备用账号");
  assert.equal(normalizeAccountName("x".repeat(35)).length, 30);
  assert.throws(() => new AccountRegistry({ filePath: "relative/accounts.json" }), /绝对路径/);

  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "xhs-account-registry-"));
  try {
    const filePath = path.join(temporaryRoot, "primary", "accounts.json");
    const ids = [ACCOUNT_A, ACCOUNT_B];
    let timestamp = 1000;
    const registry = new AccountRegistry({
      filePath,
      maxAccounts: 2,
      idFactory: () => ids.shift(),
      now: () => timestamp,
    });

    assert.deepEqual(await registry.load(), []);
    const first = await registry.ensureDefault();
    assert.equal(first.id, ACCOUNT_A);
    assert.equal(first.name, "账号 1");
    assert.equal(first.partition, partitionForAccount(ACCOUNT_A));
    assert.equal((await registry.ensureDefault()).id, ACCOUNT_A);

    timestamp = 2000;
    const second = await registry.add("  运营\n账号  ");
    assert.equal(second.id, ACCOUNT_B);
    assert.equal(second.name, "运营 账号");
    await assert.rejects(registry.add("超出上限"), /最多可同时保留 2 个账号/);

    const publicList = registry.list();
    assert.equal(publicList.length, 2);
    assert.equal(Object.hasOwn(publicList[0], "partition"), false);
    assert.equal(registry.get(ACCOUNT_A.toUpperCase()).partition, partitionForAccount(ACCOUNT_A));

    const originalPartition = registry.get(ACCOUNT_A).partition;
    timestamp = 3000;
    await registry.rename(ACCOUNT_A, "  新名称  ");
    assert.equal(registry.get(ACCOUNT_A).name, "新名称");
    assert.equal(registry.get(ACCOUNT_A).partition, originalPartition);
    await registry.rename(ACCOUNT_A, "   ");
    assert.equal(registry.get(ACCOUNT_A).name, "新名称");

    timestamp = 4000;
    await registry.setActive(ACCOUNT_B.toUpperCase());
    assert.equal(registry.get(ACCOUNT_B).lastActiveAt, 4000);
    await assert.rejects(registry.rename(ACCOUNT_C, "不存在"), /账号不存在/);
    await assert.rejects(registry.setActive(ACCOUNT_C), /账号不存在/);

    const persisted = JSON.parse(await fs.readFile(filePath, "utf8"));
    assert.equal(persisted.version, 1);
    assert.equal(persisted.activeAccountId, ACCOUNT_B);
    assert.deepEqual(persisted.accounts.map((account) => account.id), [ACCOUNT_A, ACCOUNT_B]);
    assert.equal(persisted.accounts.some((account) => Object.hasOwn(account, "partition")), false);
    if (process.platform !== "win32") assert.equal((await fs.stat(filePath)).mode & 0o777, 0o600);

    const restored = new AccountRegistry({ filePath, now: () => 9999 });
    await restored.load();
    assert.equal(restored.activeAccountId, ACCOUNT_B);
    assert.equal(restored.get(ACCOUNT_A).name, "新名称");
    assert.equal(restored.get(ACCOUNT_A).partition, originalPartition);

    const removed = await restored.remove(ACCOUNT_B);
    assert.equal(removed.id, ACCOUNT_B);
    assert.equal(restored.activeAccountId, ACCOUNT_A);
    await assert.rejects(restored.remove(ACCOUNT_A), /至少保留一个账号槽位/);

    const normalizationPath = path.join(temporaryRoot, "normalization", "accounts.json");
    await fs.mkdir(path.dirname(normalizationPath), { recursive: true });
    await fs.writeFile(normalizationPath, JSON.stringify({
      version: 999,
      activeAccountId: ACCOUNT_B.toUpperCase(),
      accounts: [
        { id: "invalid", name: "不应恢复" },
        { id: ACCOUNT_A.toUpperCase(), name: "  华东\n 主账号 ", createdAt: "bad", updatedAt: 5, lastActiveAt: "bad" },
        { id: ACCOUNT_B, name: "  ", createdAt: 100, updatedAt: 50, lastActiveAt: -1 },
        { id: ACCOUNT_C, name: "超过上限" },
      ],
    }), "utf8");

    const normalized = new AccountRegistry({ filePath: normalizationPath, maxAccounts: 2, now: () => 9000 });
    const normalizedList = await normalized.load();
    assert.deepEqual(normalizedList.map((account) => account.id), [ACCOUNT_A, ACCOUNT_B]);
    assert.equal(normalizedList[0].name, "华东 主账号");
    assert.equal(normalizedList[0].createdAt, 9000);
    assert.equal(normalizedList[0].updatedAt, 9000);
    assert.equal(normalizedList[0].lastActiveAt, 0);
    assert.equal(normalizedList[1].name, "账号 2");
    assert.equal(normalizedList[1].createdAt, 100);
    assert.equal(normalizedList[1].updatedAt, 100);
    assert.equal(normalizedList[1].lastActiveAt, 0);
    assert.equal(normalized.activeAccountId, ACCOUNT_B);
    assert.equal(normalized.get(ACCOUNT_A).partition, partitionForAccount(ACCOUNT_A));
    await normalized.persist();
    const normalizedOnDisk = JSON.parse(await fs.readFile(normalizationPath, "utf8"));
    assert.equal(normalizedOnDisk.accounts.length, 2);
    assert.equal(normalizedOnDisk.accounts[0].name, "华东 主账号");

    const damagedPath = path.join(temporaryRoot, "damaged", "accounts.json");
    await fs.mkdir(path.dirname(damagedPath), { recursive: true });
    await fs.writeFile(damagedPath, "{not-json", "utf8");
    const damaged = new AccountRegistry({ filePath: damagedPath, idFactory: () => ACCOUNT_C, now: () => 7000 });
    assert.deepEqual(await damaged.load(), []);
    assert.equal((await damaged.ensureDefault()).id, ACCOUNT_C);
    assert.equal(JSON.parse(await fs.readFile(damagedPath, "utf8")).accounts.length, 1);
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }

  console.log("account registry isolation and persistence: passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
