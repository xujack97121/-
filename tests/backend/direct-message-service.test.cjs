const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { DirectMessageService, MessageLedger, extractMainComments, validateConfig } = require("../../backend/operations/direct-message-service.cjs");
const { createDirectMessageHost } = require("../../backend/operations/direct-message-host.cjs");

const SELF = "65a200000000000000000001";
const AUTHOR = "65a200000000000000000002";
const USER_A = "65a200000000000000000003";
const USER_B = "65a200000000000000000004";
const USER_C = "65a200000000000000000005";
const NOTE_A = { id: "65b200000000000000000001", title: "笔记 A", link: "https://www.xiaohongshu.com/explore/65b200000000000000000001" };
const NOTE_B = { id: "65b200000000000000000002", title: "笔记 B", link: "https://www.xiaohongshu.com/explore/65b200000000000000000002" };
const row = (userId, nickname = "同名用户") => ({ userId, nickname, content: `公开评论 ${userId}`, profileUrl: `https://www.xiaohongshu.com/user/profile/${userId}` });

async function setup(t, options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dm-service-fixture-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const ledger = new MessageLedger(path.join(dir, "ledger.json"));
  const locked = new Set();
  const sent = [];
  const progress = [];
  const host = {
    sender: SELF,
    validateNote: (note) => note,
    lock: (id) => { if (locked.has(id)) throw new Error("已有任务"); locked.add(id); },
    unlock: (id) => locked.delete(id),
    self: async () => host.sender,
    collect: async (_id, _note, _stop, onProgress) => {
      onProgress(5);
      return { authorId: AUTHOR, rows: [row(SELF), row(AUTHOR), row(USER_A), row(USER_A), row(USER_B), row(USER_C)] };
    },
    stopCollection() {},
    send: async (accountId, recipient, message, hooks) => {
      await hooks.beforeClick();
      sent.push({ accountId, userId: recipient.userId, message });
      return { status: "sent", attempted: true };
    },
    ...options,
  };
  const service = new DirectMessageService({ ledger, host, onProgress: (state) => progress.push(state) });
  return { service, ledger, host, locked, sent, progress, dir };
}

async function collected(service, account = "account-a", notes = [NOTE_A, NOTE_B]) {
  await service.collect(account, notes);
  await service.state(account).job;
  return service.snapshot(account);
}

test("主评论网络提取不遍历回复、不接受其他笔记、使用完整用户身份", () => {
  const url = `https://www.xiaohongshu.com/api/sns/web/v2/comment/page?note_id=${NOTE_A.id}`;
  const input = { data: { comments: [
    { id: "main-a", content: "主评论", user_info: { user_id: USER_A, nickname: "同名" }, sub_comments: [{ id: "reply", content: "回复", user_info: { user_id: USER_B } }] },
    { id: "reply-shaped", parent_comment_id: "main-a", content: "回复", user_info: { user_id: USER_B } },
    { id: "foreign", note_id: NOTE_B.id, content: "其他笔记", user_info: { user_id: USER_B } },
    { id: "masked", content: "未知身份", user_info: { user_id: "65a2••••003" } },
  ] } };
  const result = extractMainComments(url, input, NOTE_A.id);
  assert.equal(result.length, 1);
  assert.equal(result[0].userId, USER_A);
  assert.deepEqual(extractMainComments(url.replace("/comment/page", "/comment/sub/page"), input, NOTE_A.id), []);
  assert.deepEqual(extractMainComments(url, input, NOTE_B.id), []);
});

test("楼主、自身、跨笔记重复排除，同名不同身份保留，前端不接收真实 ID", async (t) => {
  const { service } = await setup(t);
  const state = await collected(service);
  assert.equal(state.phase, "ready");
  assert.equal(state.candidates.length, 3);
  assert.deepEqual(state.candidates.map((candidate) => candidate.sources.length), [2, 2, 2]);
  assert.ok(state.candidates.every((candidate) => candidate.nickname === "同名用户"));
  for (const candidate of state.candidates) {
    assert.equal(Object.hasOwn(candidate, "userId"), false);
    assert.equal(Object.hasOwn(candidate, "profileUrl"), false);
  }
  const serialized = JSON.stringify(state);
  // Comment content is public; opaque recipient IDs are not the source IDs.
  assert.ok(state.candidates.every((candidate) => ![USER_A, USER_B, USER_C].includes(candidate.token)));
  assert.equal(serialized.includes('"senderId"'), false);
});

test("确认后按名单顺序和人数上限固定轮换消息，后台不接受伪造收件人", async (t) => {
  const { service, sent } = await setup(t);
  const state = await collected(service);
  const review = await service.review("account-a", {
    tokens: state.candidates.map((candidate) => candidate.token).reverse().concat("fake-token"),
    messages: ["第一段\n原样内容", "第二段"], limit: 2, intervalSeconds: 1,
  });
  assert.deepEqual(review.assignments.map((assignment) => assignment.message), ["第一段\n原样内容", "第二段"]);
  assert.deepEqual(review.assignments.map((assignment) => assignment.token), state.candidates.slice(0, 2).map((candidate) => candidate.token));
  await assert.rejects(service.start("account-b", review.reviewId), /失效/);
  await service.start("account-a", review.reviewId);
  await service.state("account-a").job;
  assert.deepEqual(sent.map((value) => value.message), ["第一段\n原样内容", "第二段"]);
  assert.deepEqual(sent.map((value) => value.userId), [USER_A, USER_B]);
  await assert.rejects(service.start("account-a", review.reviewId), /失效/);
});

test("持久化跨任务去重、账号隔离、登录身份变化阻止发送", async (t) => {
  const { service, ledger, host, dir } = await setup(t);
  const initial = await collected(service);
  const review = await service.review("account-a", { tokens: [initial.candidates[0].token], messages: ["内容"], limit: 1 });
  await service.start("account-a", review.reviewId);
  await service.state("account-a").job;
  const next = await collected(service);
  assert.equal(next.candidates[0].status, "sent");
  const other = await collected(service, "account-b");
  assert.equal(other.candidates[0].status, "ready");
  const fresh = new MessageLedger(ledger.filePath);
  await fresh.load();
  assert.equal(fresh.status("account-a", SELF, USER_A), "sent");
  assert.equal(fresh.status("account-b", SELF, USER_A), "");
  const persisted = await fs.readFile(path.join(dir, "ledger.json"), "utf8");
  assert.equal(persisted.includes(USER_A), false);
  assert.equal(persisted.includes("内容"), false);
  host.sender = USER_C;
  await assert.rejects(service.review("account-a", { tokens: [next.candidates[1].token], messages: ["内容"] }), /身份已变化/);
});

test("发送前落盘，未知结果暂停后续且不自动重发", async (t) => {
  let checked = false;
  const fixture = await setup(t, {
    send: async (account, recipient, _message, hooks) => {
      await hooks.beforeClick();
      assert.equal(fixture.ledger.status(account, SELF, recipient.userId), "sending");
      const stored = JSON.parse(await fs.readFile(fixture.ledger.filePath, "utf8"));
      assert.ok(Object.values(stored.records).some((record) => record.status === "sending"));
      checked = true;
      throw new Error("提交后页面崩溃");
    },
  });
  const state = await collected(fixture.service);
  const review = await fixture.service.review("account-a", { tokens: state.candidates.map((row) => row.token), messages: ["内容"] });
  await fixture.service.start("account-a", review.reviewId);
  await fixture.service.state("account-a").job;
  const result = fixture.service.snapshot("account-a");
  assert.ok(checked);
  assert.equal(result.phase, "paused");
  assert.equal(result.completed, 1);
  assert.deepEqual(result.candidates.map((candidate) => candidate.status), ["unconfirmed", "ready", "ready"]);
  const next = await collected(fixture.service);
  assert.equal(next.candidates[0].status, "unconfirmed");
});

test("异常退出的 sending 记录恢复为待确认，损坏记录禁止发送", async (t) => {
  const { ledger } = await setup(t);
  await ledger.set("account-a", SELF, USER_A, "sending");
  const restarted = new MessageLedger(ledger.filePath);
  await restarted.load();
  assert.equal(restarted.status("account-a", SELF, USER_A), "unconfirmed");
  assert.ok(Object.values(JSON.parse(await fs.readFile(ledger.filePath, "utf8")).records).every((row) => row.status !== "sending"));
  await fs.writeFile(ledger.filePath, "broken");
  await assert.rejects(new MessageLedger(ledger.filePath).load(), /禁止发送/);
});

test("停止等待立即生效，不开始下一位用户；运行互斥", async (t) => {
  const { service, sent, locked } = await setup(t);
  const state = await collected(service);
  const review = await service.review("account-a", { tokens: state.candidates.map((row) => row.token), messages: ["内容"], intervalSeconds: 60 });
  await service.start("account-a", review.reviewId);
  await assert.rejects(service.collect("account-a", [NOTE_A]), /已有私信任务/);
  while (service.snapshot("account-a").completed === 0) await new Promise((resolve) => setTimeout(resolve, 5));
  const start = Date.now();
  service.stop("account-a");
  await service.state("account-a").job;
  assert.ok(Date.now() - start < 500);
  assert.equal(sent.length, 1);
  assert.equal(service.snapshot("account-a").phase, "stopped");
  assert.equal(locked.size, 0);
});

test("无法确认楼主不生成候选人，采集限制暂停并保留已有结果", async (t) => {
  const fixture = await setup(t, {
    collect: async (_account, note) => note.id === NOTE_A.id
      ? { authorId: "", rows: [row(USER_A)] }
      : { authorId: AUTHOR, rows: [row(USER_B)], blocked: true, reason: "需要验证" },
  });
  const state = await collected(fixture.service);
  assert.equal(state.candidates.length, 1);
  assert.equal(state.candidates[0].sources[0].noteId, NOTE_B.id);
  assert.equal(state.phase, "paused");
  assert.match(state.notes[0].status, /无法确认楼主/);
});

test("停止采集保留已采集用户，无发送权限跳过、平台限制暂停", async (t) => {
  let fixture;
  fixture = await setup(t, {
    collect: async () => {
      fixture.service.stop("account-a");
      return { authorId: AUTHOR, rows: [row(USER_A), row(USER_B), row(USER_C)] };
    },
    send: async (_account, recipient) => recipient.userId === USER_A
      ? { status: "skipped", reason: "无权限", attempted: false }
      : { status: "paused", reason: "登录失效", attempted: false },
  });
  const state = await collected(fixture.service);
  assert.equal(state.notes.length, 2);
  assert.equal(state.notes[1].status, "待采集");
  assert.equal(state.candidates.length, 3);
  const review = await fixture.service.review("account-a", { tokens: state.candidates.map((row) => row.token), messages: ["内容"], intervalSeconds: 1 });
  await fixture.service.start("account-a", review.reviewId);
  await fixture.service.state("account-a").job;
  assert.equal(fixture.service.snapshot("account-a").phase, "paused");
  assert.equal(fixture.ledger.status("account-a", SELF, USER_B), "");
});

test("主机锁拒绝采集、其他自动化和抖音；链接守卫保留导航参数", () => {
  const context = { platform: "xhs", capture: { active: true }, operation: { active: false }, view: { webContents: { setBackgroundThrottling() {} } } };
  const host = createDirectMessageHost({ requireContext: () => context, publishAccount() {} });
  assert.throws(() => host.lock("account-a"), /正在采集/);
  context.capture.active = false;
  context.operation.active = true;
  assert.throws(() => host.lock("account-a"), /自动化/);
  context.platform = "douyin";
  assert.throws(() => host.lock("account-a"), /小红书/);
  assert.throws(() => host.validateNote({ link: "https://evil.example/explore/" + NOTE_A.id }), /有效/);
  const note = host.validateNote({ link: NOTE_A.link + "?xsec_token=fixture-token" });
  assert.ok(note.link.includes("xsec_token=fixture-token"));
});

test("配置验证拒绝空消息、超长消息、无限或无效上限和间隔", () => {
  assert.equal(validateConfig({ messages: ["原样"] }).intervalSeconds, 60);
  for (const config of [
    { messages: [] }, { messages: [" "] }, { messages: ["好".repeat(2001)] },
    { messages: ["内容"], limit: 0 }, { messages: ["内容"], limit: 1.5 }, { messages: ["内容"], limit: 501 },
    { messages: ["内容"], intervalSeconds: 0 }, { messages: ["内容"], intervalSeconds: Infinity },
  ]) assert.throws(() => validateConfig(config));
});
