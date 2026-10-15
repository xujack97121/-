function pageTools() {
  const visible = (element) => {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  };
  const text = (element) => String(element?.innerText || element?.textContent || "").trim();
  const userId = (href) => {
    try {
      const url = new URL(href, location.href);
      return url.protocol === "https:" && ["www.xiaohongshu.com", "xiaohongshu.com"].includes(url.hostname)
        && !url.username && !url.password && !url.port
        ? url.pathname.match(/^\/user\/profile\/([a-f\d]{24})\/?$/i)?.[1] || "" : "";
    } catch { return ""; }
  };
  const first = (root, selector) => [...root.querySelectorAll(selector)].find(visible);
  const blocked = () => {
    if (first(document, '[data-login-required="true"],.login-container,.login-modal,.login-dialog')) return "登录已失效，请先登录";
    if (first(document, '#captcha,.captcha-container,.verify-container,[data-captcha]')) return "需要完成验证，队列已暂停";
    const alerts = [...document.querySelectorAll('[role="alert"],.toast,.notification,.error-message,[data-platform-notice]')].filter(visible).map(text).join("\n");
    if (/频繁|操作过快|稍后再试|访问受限|账号异常|账号限制|今日.*上限|发送.*上限/.test(alerts)) return "平台限制了当前操作，队列已暂停";
    return "";
  };
  const selfId = () => {
    const links = [...document.querySelectorAll('.side-bar a[href*="/user/profile/"],.sidebar a[href*="/user/profile/"],nav a[href*="/user/profile/"],a[data-self-profile]')]
      .filter(visible).filter((link) => link.hasAttribute("data-self-profile") || /^(我|我的|我的主页|个人主页)$/.test(text(link)));
    const ids = [...new Set(links.map((link) => userId(link.href)).filter(Boolean))];
    return ids.length === 1 ? ids[0] : "";
  };
  const conversation = (expectedId) => {
    const roots = [...document.querySelectorAll('[data-chat-user-id],.chat-container,.chat-window,.conversation-panel,.chat-panel')].filter(visible);
    for (const root of roots) {
      const header = first(root, '[data-conversation-user-id],.chat-header,.conversation-header,.chat-title');
      const ids = [root.getAttribute("data-chat-user-id"), header?.getAttribute("data-conversation-user-id"),
        ...[...(header?.querySelectorAll('a[href*="/user/profile/"]') || [])].map((link) => userId(link.href))].filter(Boolean);
      if (!ids.length || !ids.every((id) => id === expectedId)) continue;
      return root;
    }
    return null;
  };
  const outgoing = (root) => [...root.querySelectorAll('[data-message-direction="outgoing"],.message-item.self,.message-item.sent,.chat-message.is-self,.message-item.right')];
  const messageText = (element) => text(element.querySelector('[data-message-text],.message-content,.bubble-content,.text-content') || element);
  const confirmed = (element) => /^(sent|success|delivered|read)$/.test(element.getAttribute("data-message-status") || "")
    || /(^|\s)(send-success|sent-success|delivered|is-delivered)(\s|$)/.test(String(element.className))
    || [...element.querySelectorAll('.message-status,[data-delivery-status]')].some((status) => /^(已发送|已送达|已读)$/.test(text(status)));
  return { visible, text, userId, first, blocked, selfId, conversation, outgoing, messageText, confirmed };
}

function collectPage(tools) {
  const { visible, text, userId, blocked, selfId } = tools;
  const noteId = location.pathname.match(/^\/(?:explore|discovery\/item)\/([a-f\d]{24})\/?$/i)?.[1] || "";
  const authorLinks = [...document.querySelectorAll('#noteContainer .author-container a[href*="/user/profile/"],.note-detail-mask .author-container a[href*="/user/profile/"],#noteContainer .author-wrapper > a[href*="/user/profile/"],[data-note-author] a[href*="/user/profile/"]')]
    .filter(visible).filter((link) => !link.closest(".comment-item"));
  const authorIds = [...new Set(authorLinks.map((link) => userId(link.href)).filter(Boolean))];
  const items = [...document.querySelectorAll('#noteContainer .comment-item,.note-detail-mask .comment-item,[data-main-comments] .comment-item')].filter(visible)
    .filter((item) => !item.parentElement?.closest('.comment-item,.reply-container,.sub-comments,.sub-comment-container,[data-comment-level="reply"]')
      && item.getAttribute("data-comment-level") !== "reply");
  const rows = items.slice(0, 500).map((item) => {
    const own = (element) => element.closest(".comment-item") === item && !element.closest(".reply-container,.sub-comments,.sub-comment-container");
    const links = [...item.querySelectorAll('a[href*="/user/profile/"]')].filter(own).filter(visible);
    const ids = [...new Set(links.map((link) => userId(link.href)).filter(Boolean))];
    if (ids.length !== 1) return null;
    const profile = links.find((link) => text(link)) || links[0];
    const content = [...item.querySelectorAll(".comment-content,.content,[data-comment-content]")].filter(own)
      .find((element) => visible(element) && !element.querySelector('a[href*="/user/profile/"]'));
    if (!content || !text(content)) return null;
    return {
      id: item.getAttribute("data-comment-id") || item.getAttribute("data-id") || `${ids[0]}\0${text(content)}`,
      userId: ids[0], nickname: text(profile).slice(0, 100) || "未知用户",
      content: text(content).slice(0, 2000), profileUrl: profile.href,
    };
  }).filter(Boolean);
  return { noteId, authorId: authorIds.length === 1 ? authorIds[0] : "", selfId: selfId(), blocked: blocked(), rows };
}

function identityPage(tools) {
  return { userId: tools.selfId(), blocked: tools.blocked() };
}

function openConversation(tools, options) {
  const blocked = tools.blocked();
  if (blocked) return { status: "paused", reason: blocked, attempted: false };
  if (tools.userId(location.href) !== options.userId) return { status: "paused", reason: "用户主页身份不匹配，未发送", attempted: false };
  const root = tools.first(document, '#userPage .user-info,.user-page .user-info,[data-profile-user],.user-info,.userInfo') || document;
  const button = [...root.querySelectorAll('button,[role="button"],a')].find((element) => tools.visible(element) && /^(私信|发私信|发消息|发送消息)$/.test(tools.text(element)));
  if (!button) return { status: "skipped", reason: "该用户没有可用的私信入口", attempted: false };
  if (button.disabled || button.getAttribute("aria-disabled") === "true") return { status: "skipped", reason: "该用户不允许私信", attempted: false };
  button.click();
  return { status: "opened", attempted: false };
}

function prepareMessage(tools, options) {
  const blocked = tools.blocked();
  if (blocked) return { status: "paused", reason: blocked, attempted: false };
  const root = tools.conversation(options.userId);
  if (!root) return { status: "waiting", reason: "尚未确认私信收件人", attempted: false };
  const notice = [...root.querySelectorAll('[role="alert"],.permission-notice,.chat-notice,[data-chat-restriction]')].filter(tools.visible).map(tools.text).join("\n");
  if (/不允许|无法.*私信|不能.*发送|仅.*关注|互关|拒收/.test(notice)) return { status: "skipped", reason: "该用户限制了私信权限", attempted: false };
  const editor = tools.first(root, 'textarea,[contenteditable="true"]');
  const submit = [...root.querySelectorAll('button,[role="button"]')].find((element) => tools.visible(element) && tools.text(element) === "发送");
  if (!editor || !submit) return { status: "waiting", reason: "尚未找到可用的私信输入框和发送按钮", attempted: false };
  editor.focus();
  if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
    const prototype = editor instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(editor, options.message);
  } else {
    const selection = getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand("insertText", false, options.message);
  }
  editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: options.message }));
  editor.dispatchEvent(new Event("change", { bubbles: true }));
  return { status: "prepared", attempted: false };
}

async function submitMessage(tools, options) {
  const failure = (reason) => ({ status: "paused", reason, attempted: false });
  const blocked = tools.blocked();
  if (blocked) return failure(blocked);
  if (tools.selfId() !== options.senderId) return failure("当前登录身份已变化，未发送");
  const root = tools.conversation(options.userId);
  if (!root) return failure("会话收件人身份无法确认，未发送");
  const editor = tools.first(root, 'textarea,[contenteditable="true"]');
  const submit = [...root.querySelectorAll('button,[role="button"]')].find((element) => tools.visible(element) && tools.text(element) === "发送");
  const actual = editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement ? editor.value : editor?.textContent;
  if (!submit || !editor || actual !== options.message || submit.disabled || submit.getAttribute("aria-disabled") === "true") return failure("消息内容或发送按钮状态已变化，未发送");
  // Confirm a new acknowledged outgoing bubble, never an old identical message.
  const baseline = new Set(tools.outgoing(root));
  const beforeCount = [...baseline].filter((element) => tools.messageText(element) === options.message.trim()).length;
  const baselineIds = new Set([...baseline].map((element) => element.getAttribute("data-message-id")).filter(Boolean));
  submit.click();
  const deadline = Date.now() + (options.confirmTimeoutMs || 8000);
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const blockedNow = tools.blocked();
    if (blockedNow) return { status: "unconfirmed", reason: blockedNow, attempted: true };
    const current = tools.conversation(options.userId);
    if (!current || current !== root || tools.selfId() !== options.senderId) return { status: "unconfirmed", reason: "提交后会话或登录身份变化，结果待确认", attempted: true };
    const matching = tools.outgoing(root).filter((element) => tools.messageText(element) === options.message.trim());
    const newMessage = matching.find((element) => {
      const id = element.getAttribute("data-message-id");
      return tools.confirmed(element) && !baseline.has(element) && matching.length > beforeCount
        && (!id || !baselineIds.has(id));
    });
    if (newMessage) return { status: "sent", reason: "本次新增消息已确认发送", attempted: true };
    if (tools.first(root, '.send-error,[data-message-status="failed"],.message-error')) return { status: "unconfirmed", reason: "页面提示提交异常，结果待确认", attempted: true };
  }
  return { status: "unconfirmed", reason: "未确认本次新增消息发送成功，不自动重发", attempted: true };
}

function scrollComments(tools) {
  const root = tools.first(document, '#noteContainer .comments-container,.note-detail-mask .comments-container,[data-main-comments]');
  if (!root) return { moved: false, atBottom: true };
  const candidates = [root, root.parentElement, ...root.querySelectorAll("*")].filter((element) => element && element.scrollHeight > element.clientHeight + 20
    && /auto|scroll/.test(getComputedStyle(element).overflowY));
  const scroller = candidates[0];
  if (!scroller) return { moved: false, atBottom: true };
  const before = scroller.scrollTop;
  scroller.scrollBy({ top: Math.max(300, scroller.clientHeight * 0.8), behavior: "instant" });
  return { moved: scroller.scrollTop > before, atBottom: scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 8 };
}

const script = (fn, options = {}) => `(${fn.toString()})((${pageTools.toString()})(), ${JSON.stringify(options)})`;
module.exports = {
  collectPageScript: () => script(collectPage),
  identityPageScript: () => script(identityPage),
  openConversationScript: (options) => script(openConversation, options),
  prepareMessageScript: (options) => script(prepareMessage, options),
  submitMessageScript: (options) => script(submitMessage, options),
  scrollCommentsScript: () => script(scrollComments),
};
