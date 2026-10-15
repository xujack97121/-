const { randomUUID } = require("node:crypto");
const { platformNavigationUrl } = require("../platform/content-platforms.cjs");
const page = require("./direct-message-page.cjs");
const { validUserId } = require("./direct-message-service.cjs");

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function createDirectMessageHost({ requireContext, findContext, startTask, stopAutoScroll, publishAccount }) {
  const checkedContext = (accountId) => {
    const context = requireContext(accountId);
    if (context.platform !== "xhs") throw new Error("评论区私信仅支持小红书桌面账号");
    return context;
  };
  return {
    validateNote(note) {
      const link = platformNavigationUrl(note?.link, "xhs");
      const id = link && new URL(link).pathname.match(/^\/(?:explore|discovery\/item)\/([a-f\d]{24})\/?$/i)?.[1];
      if (!id || note?.id && note.id !== id) throw new Error("请输入有效的小红书笔记链接");
      return { id, link, title: String(note?.title || "手动添加的笔记").slice(0, 200) };
    },
    lock(accountId) {
      const context = checkedContext(accountId);
      if (context.capture.active || context.capture.pendingStartRunId || context.operation.active) throw new Error("该账号正在采集或执行自动化，请先停止当前任务");
      context.operation = { active: true, kind: "direct-message", runId: randomUUID(), startedAt: Date.now() };
      context.view.webContents.setBackgroundThrottling(false);
      publishAccount(context);
    },
    unlock(accountId) {
      const context = findContext(accountId);
      if (!context || context.disposed || context.operation.kind !== "direct-message") return;
      stopAutoScroll(context);
      context.operation = { active: false, runId: "", startedAt: 0 };
      if (!context.view.webContents.isDestroyed()) context.view.webContents.setBackgroundThrottling(true);
      publishAccount(context);
    },
    async self(accountId) {
      const context = checkedContext(accountId);
      const result = await context.view.webContents.executeJavaScript(page.identityPageScript());
      if (result?.blocked) throw new Error(result.blocked);
      return result?.userId || "";
    },
    async collect(accountId, note, shouldStop, onProgress) {
      const context = checkedContext(accountId);
      if (shouldStop()) return { rows: [], authorId: "", reason: "已停止" };
      try { await startTask(context, { kind: "comments", url: note.link, target: 500 }, { directMessage: true }); }
      catch (error) {
        if (!shouldStop() || context.capture.purpose !== "direct-message" || context.disposed) throw error;
      }
      const state = context.capture;
      const deadline = Date.now() + 10 * 60 * 1000;
      let lastCount = -1;
      while (state.active && !shouldStop() && !context.disposed) {
        if (lastCount !== state.dmRows.size) { lastCount = state.dmRows.size; onProgress(lastCount); }
        if (Date.now() >= deadline) { stopAutoScroll(context, "采集时间已到，已保留当前结果"); break; }
        await sleep(150);
      }
      if (state.active && shouldStop()) stopAutoScroll(context, "用户已停止主评论采集");
      onProgress(state.dmRows.size);
      return {
        rows: [...state.dmRows.values()], authorId: state.dmAuthorConflict ? "" : state.dmAuthorId,
        reason: state.error || (shouldStop() ? "已停止" : state.dmRows.size >= 500 ? "已达到 500 条主评论上限" : "采集结束，已保留可见主评论"),
        blocked: Boolean(state.error),
      };
    },
    stopCollection(accountId) {
      const context = findContext(accountId);
      if (context?.capture.purpose !== "direct-message" || !context.capture.active) return;
      stopAutoScroll(context, "用户已停止主评论采集");
      if (!context.view.webContents.isDestroyed() && context.view.webContents.isLoading()) context.view.webContents.stop();
    },
    async send(accountId, recipient, message, { shouldStop, beforeClick, senderId }) {
      const context = checkedContext(accountId);
      const contents = context.view.webContents;
      const profileUrl = platformNavigationUrl(recipient.profileUrl, "xhs");
      if (!profileUrl || !validUserId(recipient.userId)
        || new URL(profileUrl).pathname.replace(/\/$/, "") !== `/user/profile/${recipient.userId}`) return { status: "paused", reason: "收件人链接无法验证，未发送", attempted: false };
      if (shouldStop()) return { status: "not-sent", reason: "已停止，未提交", attempted: false };
      const sender = await this.self(accountId);
      if (sender !== senderId) return { status: "paused", reason: "发送账号身份已变化，未发送", attempted: false };
      await contents.loadURL(profileUrl);
      if (shouldStop()) return { status: "not-sent", reason: "已停止，未提交", attempted: false };
      let opened;
      for (let attempt = 0; attempt < 20 && !shouldStop(); attempt += 1) {
        opened = await contents.executeJavaScript(page.openConversationScript({ userId: recipient.userId }), true);
        if (opened.status !== "skipped") break;
        await sleep(250);
      }
      if (shouldStop()) return { status: "not-sent", reason: "已停止，未提交", attempted: false };
      if (opened?.status !== "opened") return opened || { status: "paused", reason: "私信入口不可用", attempted: false };
      let prepared;
      for (let attempt = 0; attempt < 30 && !shouldStop(); attempt += 1) {
        prepared = await contents.executeJavaScript(page.prepareMessageScript({ userId: recipient.userId, message }), true);
        if (prepared.status !== "waiting") break;
        await sleep(250);
      }
      if (shouldStop()) return { status: "not-sent", reason: "已停止，未提交", attempted: false };
      if (prepared?.status !== "prepared") return prepared?.status === "waiting"
        ? { status: "paused", reason: prepared.reason, attempted: false } : prepared;
      await beforeClick();
      if (shouldStop()) return { status: "not-sent", reason: "已停止，未提交", attempted: false };
      return contents.executeJavaScript(page.submitMessageScript({ userId: recipient.userId, senderId: sender, message }), true);
    },
  };
}

module.exports = { createDirectMessageHost };
