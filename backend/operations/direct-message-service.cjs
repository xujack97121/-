const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");

const BLOCKED_HISTORY = new Set(["sending", "sent", "unconfirmed"]);
const digest = (...values) => createHash("sha256").update(values.join("\0")).digest("hex");

function validUserId(value) {
  return /^[a-f\d]{24}$/i.test(String(value || ""));
}

function validateConfig(config = {}) {
  const messages = config.messages;
  if (!Array.isArray(messages) || !messages.length || messages.length > 50
    || messages.some((text) => typeof text !== "string" || !text.trim() || Array.from(text).length > 2000)) {
    throw new Error("请填写 1 至 50 段消息，每段不超过 2000 字，且不能为空");
  }
  const limit = Number(config.limit ?? 20);
  const intervalSeconds = Number(config.intervalSeconds ?? 60);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("发送上限须为 1 至 500 人");
  if (!Number.isFinite(intervalSeconds) || intervalSeconds < 1 || intervalSeconds > 36000) throw new Error("发送间隔须为 1 至 36000 秒");
  return { messages: [...messages], limit, intervalSeconds };
}

function extractMainComments(sourceUrl, json, expectedNoteId) {
  let url;
  try { url = new URL(sourceUrl); } catch { return []; }
  if (!/^\/api\/sns\/web\/v\d+\/comment\/page\/?$/.test(url.pathname)
    || url.searchParams.get("note_id") !== expectedNoteId) return [];
  const rows = json?.data?.comments;
  if (!Array.isArray(rows)) return [];
  return rows.filter((row) => !row.parent_comment_id && !row.root_comment_id && !row.target_comment
    && (!row.note_id || row.note_id === expectedNoteId))
    .map((row) => {
      const userId = String(row.user_info?.user_id || row.user?.user_id || "");
      return {
        id: String(row.id || row.comment_id || ""),
        userId,
        nickname: String(row.user_info?.nickname || row.user?.nickname || "未知用户").slice(0, 100),
        content: String(row.content || "").slice(0, 2000),
        profileUrl: validUserId(userId) ? `https://www.xiaohongshu.com/user/profile/${userId}` : "",
      };
    }).filter((row) => row.id && validUserId(row.userId) && row.content);
}

class MessageLedger {
  constructor(filePath) {
    this.filePath = filePath;
    this.records = {};
    this.queue = Promise.resolve();
    this.ready = null;
  }

  load() {
    this.ready ||= (async () => {
      let recovered = false;
      try {
        const parsed = JSON.parse(await fs.readFile(this.filePath, "utf8"));
        if (parsed.version !== 1 || !parsed.records || typeof parsed.records !== "object" || Array.isArray(parsed.records)) {
          throw new Error("私信去重记录格式异常");
        }
        for (const [key, record] of Object.entries(parsed.records)) {
          if (!/^[a-f\d]{64}$/.test(key) || !BLOCKED_HISTORY.has(record?.status)) throw new Error("私信去重记录格式异常");
          this.records[key] = { status: record.status === "sending" ? "unconfirmed" : record.status, updatedAt: record.updatedAt };
          if (record.status === "sending") recovered = true;
        }
      } catch (error) {
        if (error.code !== "ENOENT") throw new Error("私信去重记录无法读取，已禁止发送以避免重复触达");
      }
      if (recovered) await this.write();
    })();
    return this.ready;
  }

  key(accountId, senderId, userId) { return digest(accountId, senderId, userId); }
  status(accountId, senderId, userId) { return this.records[this.key(accountId, senderId, userId)]?.status || ""; }

  async set(accountId, senderId, userId, status) {
    await this.load();
    const key = this.key(accountId, senderId, userId);
    if (status) this.records[key] = { status, updatedAt: Date.now() };
    else delete this.records[key];
    await this.write();
  }

  write() {
    const serialized = JSON.stringify({ version: 1, records: this.records });
    const task = this.queue.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const temp = `${this.filePath}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temp, serialized, { mode: 0o600 });
        await fs.rename(temp, this.filePath);
      } finally { await fs.rm(temp, { force: true }).catch(() => {}); }
    });
    this.queue = task;
    return task;
  }
}

class DirectMessageService {
  constructor({ ledger, host, onProgress = () => {} }) {
    this.ledger = ledger;
    this.host = host;
    this.onProgress = onProgress;
    this.states = new Map();
  }

  state(accountId) {
    if (!this.states.has(accountId)) this.states.set(accountId, {
      accountId, sessionId: "", senderId: "", phase: "idle", active: false, stop: false,
      candidates: new Map(), notes: [], message: "", completed: 0, total: 0, review: null,
      revision: 0,
    });
    return this.states.get(accountId);
  }

  snapshot(accountId) {
    const state = this.state(accountId);
    return {
      accountId, sessionId: state.sessionId, phase: state.phase, active: state.active,
      revision: state.revision,
      message: state.message, completed: state.completed, total: state.total,
      notes: state.notes.map((note) => ({ ...note })),
      candidates: [...state.candidates.values()].map(({ token, nickname, sources, status, reason, message }) => ({
        token, nickname, sources: sources.map(({ noteId, title, content }) => ({ noteId, title, content })),
        status, reason: reason || "", message: message || "",
      })),
    };
  }

  publish(state) { state.revision += 1; this.onProgress(this.snapshot(state.accountId)); }

  async collect(accountId, notes) {
    await this.ledger.load();
    const state = this.state(accountId);
    if (state.active) throw new Error("该账号已有私信任务正在进行");
    if (!Array.isArray(notes) || !notes.length || notes.length > 100) throw new Error("请勾选 1 至 100 条笔记");
    const cleanNotes = [...new Map(notes.map((note) => {
      const clean = this.host.validateNote(note);
      return [clean.id, clean];
    })).values()];
    this.host.lock(accountId);
    Object.assign(state, {
      sessionId: randomUUID(), senderId: "", phase: "collecting", active: true, stop: false,
      candidates: new Map(), notes: cleanNotes.map((note) => ({ id: note.id, title: note.title, status: "待采集", collected: 0 })),
      message: "正在采集主评论用户", completed: 0, total: cleanNotes.length, review: null,
    });
    this.publish(state);
    state.job = this.runCollect(state, cleanNotes);
    return this.snapshot(accountId);
  }

  async runCollect(state, notes) {
    try {
      const self = await this.host.self(state.accountId);
      if (!validUserId(self)) throw new Error("无法确认当前发送账号身份，请先在左侧确认登录和自己的主页入口");
      state.senderId = self;
      for (let index = 0; index < notes.length && !state.stop; index += 1) {
        const task = state.notes[index];
        task.status = "采集中";
        this.publish(state);
        const result = await this.host.collect(state.accountId, notes[index], () => state.stop, (count) => {
          task.collected = count;
          this.publish(state);
        });
        task.collected = result.rows.length;
        task.status = result.reason || "采集结束";
        if (!validUserId(result.authorId)) task.status = "无法确认楼主，已排除该笔记";
        else {
          for (const row of result.rows) {
            if (!validUserId(row.userId) || row.userId === result.authorId || row.userId === state.senderId) continue;
            const key = digest(row.userId);
            let candidate = state.candidates.get(key);
            if (!candidate) {
              const history = this.ledger.status(state.accountId, state.senderId, row.userId);
              candidate = {
                token: randomUUID(), userId: row.userId, profileUrl: row.profileUrl,
                nickname: row.nickname, sources: [], status: history === "sent" ? "sent" : history ? "unconfirmed" : "ready",
                reason: history === "sent" ? "该账号已发送，跨任务跳过" : history ? "历史发送结果待确认，不自动重发" : "",
              };
              state.candidates.set(key, candidate);
            }
            if (!candidate.sources.some((source) => source.noteId === notes[index].id)) candidate.sources.push({
              noteId: notes[index].id, title: notes[index].title, content: row.content,
            });
          }
        }
        state.completed = index + 1;
        this.publish(state);
        if (result.blocked) throw new Error(result.reason || "平台限制，采集已暂停");
      }
      state.phase = "ready";
      state.message = state.stop ? "采集已停止，可审核已采集名单" : "采集结束，请审核名单";
    } catch (error) {
      state.phase = "paused";
      state.message = error.message;
    } finally {
      state.active = false;
      this.host.unlock(state.accountId);
      this.publish(state);
    }
  }

  async review(accountId, config) {
    await this.ledger.load();
    const state = this.state(accountId);
    if (state.active || !state.sessionId) throw new Error("请先完成评论用户采集");
    if (!validUserId(state.senderId) || await this.host.self(accountId) !== state.senderId) throw new Error("发送账号身份已变化，请重新采集");
    const settings = validateConfig(config);
    if (!Array.isArray(config.tokens) || !config.tokens.length) throw new Error("请勾选收件人");
    const requested = new Set(config.tokens);
    const candidates = [...state.candidates.values()].filter((candidate) => requested.has(candidate.token)
      && ["ready", "skipped", "not-sent"].includes(candidate.status)
      && !this.ledger.status(accountId, state.senderId, candidate.userId)).slice(0, settings.limit);
    if (!candidates.length) throw new Error("所选用户已发送或结果待确认，没有可发送的用户");
    const assignments = candidates.map((candidate, index) => ({ token: candidate.token, message: settings.messages[index % settings.messages.length] }));
    state.review = { id: randomUUID(), sessionId: state.sessionId, ...settings, assignments };
    return {
      reviewId: state.review.id, sessionId: state.sessionId, intervalSeconds: settings.intervalSeconds,
      assignments: assignments.map((assignment) => ({
        ...assignment, nickname: candidates.find((candidate) => candidate.token === assignment.token).nickname,
      })),
    };
  }

  async start(accountId, reviewId) {
    const state = this.state(accountId);
    const review = state.review;
    if (state.active || !review || review.id !== reviewId || review.sessionId !== state.sessionId) throw new Error("确认名单已失效，请重新预览");
    this.host.lock(accountId);
    try {
      if (await this.host.self(accountId) !== state.senderId) throw new Error("发送账号身份已变化，请重新采集");
      if (review.assignments.some((assignment) => {
        const candidate = [...state.candidates.values()].find((row) => row.token === assignment.token);
        return !candidate || this.ledger.status(accountId, state.senderId, candidate.userId);
      })) throw new Error("发送记录已变化，请重新确认名单");
      Object.assign(state, { phase: "sending", active: true, stop: false, message: "正在发送", completed: 0, total: review.assignments.length, review: null });
      for (const assignment of review.assignments) {
        const candidate = [...state.candidates.values()].find((row) => row.token === assignment.token);
        candidate.message = assignment.message;
        candidate.status = "queued";
        candidate.reason = "";
      }
      this.publish(state);
      state.job = this.runSend(state, review);
      return this.snapshot(accountId);
    } catch (error) { this.host.unlock(accountId); throw error; }
  }

  async runSend(state, review) {
    try {
      for (const assignment of review.assignments) {
        if (state.stop) break;
        if (await this.host.self(state.accountId) !== state.senderId) throw new Error("发送账号身份已变化，队列已暂停");
        if (state.stop) break;
        const candidate = [...state.candidates.values()].find((row) => row.token === assignment.token);
        candidate.status = "sending";
        this.publish(state);
        let marked = false;
        let result;
        try {
          result = await this.host.send(state.accountId, candidate, assignment.message, {
            senderId: state.senderId,
            shouldStop: () => state.stop,
            beforeClick: async () => {
              await this.ledger.set(state.accountId, state.senderId, candidate.userId, "sending");
              marked = true;
            },
          });
        } catch (error) {
          result = { status: marked ? "unconfirmed" : "paused", reason: marked ? "提交状态不明，未自动重发" : "私信页面不可用，队列已暂停" };
        }
        if (result.status === "sent") {
          if (!marked) throw new Error("发送确认缺少持久化记录，队列已暂停");
          await this.ledger.set(state.accountId, state.senderId, candidate.userId, "sent");
        } else if (marked) {
          await this.ledger.set(state.accountId, state.senderId, candidate.userId, result.attempted === false ? "" : "unconfirmed");
        }
        candidate.status = result.status === "paused" ? "not-sent" : result.status;
        candidate.reason = result.reason || "";
        state.completed += 1;
        this.publish(state);
        if (["unconfirmed", "paused"].includes(result.status)) throw new Error(result.reason || "发送结果待确认，队列已暂停");
        if (!state.stop && state.completed < state.total) {
          state.message = `等待 ${review.intervalSeconds} 秒后发送下一人`;
          this.publish(state);
          await new Promise((resolve) => {
            const timer = setTimeout(() => { state.cancelWait = null; resolve(); }, review.intervalSeconds * 1000);
            state.cancelWait = () => { clearTimeout(timer); state.cancelWait = null; resolve(); };
          });
        }
      }
      state.phase = state.stop ? "stopped" : "completed";
      state.message = state.stop ? "已停止发送" : "发送队列结束，请检查逐人状态";
    } catch (error) {
      state.phase = "paused";
      state.message = error.message;
    } finally {
      for (const candidate of state.candidates.values()) {
        if (candidate.status === "queued") candidate.status = "ready";
        if (candidate.status === "sending") candidate.status = "unconfirmed";
      }
      state.active = false;
      this.host.unlock(state.accountId);
      this.publish(state);
    }
  }

  stop(accountId) {
    const state = this.state(accountId);
    state.stop = true;
    state.cancelWait?.();
    if (state.active) this.host.stopCollection(accountId);
    state.message = state.active ? "正在停止；已提交消息将完成结果确认" : state.message;
    this.publish(state);
    return this.snapshot(accountId);
  }
}

module.exports = { DirectMessageService, MessageLedger, validUserId, validateConfig, extractMainComments };
