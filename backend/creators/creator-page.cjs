function creatorPageTools() {
  const visible = (element) => {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  };
  const text = (element) => String(element?.innerText || element?.textContent || "").trim();
  const first = (root, selector) => [...root.querySelectorAll(selector)].find(visible);
  const profileId = (href) => {
    try {
      const url = new URL(href, location.href);
      return url.protocol === "https:" && ["www.xiaohongshu.com", "xiaohongshu.com"].includes(url.hostname)
        && !url.username && !url.password && !url.port
        ? url.pathname.match(/^\/user\/profile\/([a-f\d]{24})\/?$/i)?.[1].toLowerCase() || "" : "";
    } catch { return ""; }
  };
  const blocked = () => {
    if (first(document, '[data-login-required="true"],.login-container,.login-modal,.login-dialog')) return "请先在账号页面登录，再搜索达人";
    if (first(document, '#captcha,.captcha-container,.verify-container,[data-captcha]')) return "需要完成平台验证，达人搜索已暂停";
    const notices = [...document.querySelectorAll('[role="alert"],.toast,.notification,.error-message,[data-platform-notice]')]
      .filter(visible).map(text).join("\n");
    return /频繁|操作过快|稍后再试|访问受限|账号异常|账号限制|今日.*上限/.test(notices) ? "平台限制了当前操作，请稍后再试" : "";
  };
  return { visible, text, first, profileId, blocked };
}

function readCreatorSearch(tools, options) {
  const url = new URL(location.href);
  const pageMatches = url.protocol === "https:" && ["www.xiaohongshu.com", "xiaohongshu.com"].includes(url.hostname)
    && !url.username && !url.password && !url.port && /^\/search_result\/?$/.test(url.pathname)
    && url.searchParams.get("keyword")?.normalize("NFC") === options.keyword && url.searchParams.get("type") === "51";
  if (!pageMatches) return { pageMatches: false, rows: [], blocked: "" };
  const blocked = tools.blocked();
  if (blocked) return { pageMatches: true, rows: [], blocked };
  const containers = [...document.querySelectorAll('[data-search-users],[data-creator-results],.user-list,.users-list,.search-user,.search-user-container,.search-result-container,.search-layout,.search-container')].filter(tools.visible);
  const cardSelector = '[data-search-user],[data-creator-card],.user-list-item,.user-item,.user-card,.user-container';
  const cards = new Set(containers.flatMap((root) => [...root.querySelectorAll(cardSelector)]));
  for (const card of document.querySelectorAll('[data-search-user],[data-creator-card],.user-list-item')) cards.add(card);
  const rows = [];
  for (const card of cards) {
    if (rows.length >= 300 || !tools.visible(card) || card.closest("nav,aside,header,.side-bar,.sidebar")) continue;
    const links = [...card.querySelectorAll('a[href*="/user/profile/"]')].filter(tools.visible);
    const ids = [...new Set(links.map((link) => tools.profileId(link.href)).filter(Boolean))];
    if (ids.length !== 1) continue;
    const nickname = tools.first(card, '[data-user-name],.user-name,.user-nickname,.nickname,.name');
    const namedLink = links.find((link) => tools.text(link));
    const image = tools.first(card, "img");
    const fanElement = tools.first(card, '[data-followers],[data-fans],.fans-count,.fans-info,.user-fans,.fans');
    const cardText = tools.text(card).slice(0, 4000);
    const fanText = fanElement?.getAttribute("data-followers") ?? fanElement?.getAttribute("data-fans") ?? tools.text(fanElement);
    const count = "(?:约|近)?[\\d,.，]+(?:千|万|亿|[kKwWmM])?\\+?";
    const labeledFans = cardText.match(new RegExp(`粉丝(?:数|量)?\\s*[:：]?\\s*(${count})`))
      || cardText.match(new RegExp(`(${count})\\s*(?:位|个|人)?粉丝`));
    const fanLabel = fanText.match(new RegExp(`粉丝(?:数|量)?\\s*[:：]?\\s*(${count})`))
      || fanText.match(new RegExp(`(${count})\\s*(?:位|个|人)?粉丝`));
    const rawFans = fanLabel?.[1] || labeledFans?.[1] || fanText || null;
    const description = tools.first(card, '[data-user-description],.user-desc,.user-description,.desc,.description,.signature');
    const redId = cardText.match(/小红书号\s*[:：]?\s*([a-zA-Z0-9_-]+)/)?.[1] || "";
    rows.push({
      userId: ids[0], nickname: tools.text(nickname) || tools.text(namedLink), profileUrl: links[0].href,
      avatarUrl: image?.currentSrc || image?.src || "", followers: rawFans, followerLabel: rawFans || "",
      description: tools.text(description), redId,
    });
  }
  const empty = [...document.querySelectorAll('.empty,.empty-container,.no-result,.no-results,[data-empty-results]')].some(tools.visible);
  return { pageMatches: true, blocked: "", rows, empty };
}

function scrollCreatorSearch(tools, options) {
  const url = new URL(location.href);
  if (!/^\/search_result\/?$/.test(url.pathname) || url.searchParams.get("keyword")?.normalize("NFC") !== options.keyword
    || url.searchParams.get("type") !== "51") return { moved: false, atBottom: true };
  const roots = [...document.querySelectorAll('[data-search-users],[data-creator-results],.user-list,.users-list,.search-user,.search-user-container,.search-result-container,.search-layout,.search-container')].filter(tools.visible);
  const scroller = roots.find((root) => root.scrollHeight > root.clientHeight + 20 && /auto|scroll/.test(getComputedStyle(root).overflowY))
    || document.scrollingElement;
  if (!scroller) return { moved: false, atBottom: true };
  const before = scroller.scrollTop;
  scroller.scrollBy({ top: Math.max(300, Math.min(1200, scroller.clientHeight * 0.8)), behavior: "instant" });
  return { moved: scroller.scrollTop > before, atBottom: scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 8 };
}

function confirmConversation(tools, options) {
  const url = new URL(location.href);
  if (url.protocol !== "https:" || !["www.xiaohongshu.com", "xiaohongshu.com"].includes(url.hostname)
    || url.username || url.password || url.port) return { status: "paused", reason: "私信页面地址无法验证，未确认会话" };
  const blocked = tools.blocked();
  if (blocked) return { status: "paused", reason: blocked };
  const roots = [...document.querySelectorAll('[data-chat-user-id],.chat-container,.chat-window,.conversation-panel,.chat-panel')].filter(tools.visible);
  for (const root of roots) {
    const header = tools.first(root, '[data-conversation-user-id],.chat-header,.conversation-header,.chat-title');
    const ids = [root.getAttribute("data-chat-user-id"), header?.getAttribute("data-conversation-user-id"),
      ...[...(header?.querySelectorAll('a[href*="/user/profile/"]') || [])].map((link) => tools.profileId(link.href))]
      .filter(Boolean).map((id) => id.toLowerCase());
    if (!ids.length || !ids.every((id) => id === options.userId)) continue;
    const editor = tools.first(root, 'textarea,[contenteditable="true"],[data-chat-editor]');
    if (!editor) continue;
    return { status: "opened", userId: options.userId };
  }
  return { status: "waiting", reason: "尚未确认该达人的私信会话，请在账号页面检查私信入口或权限" };
}

const script = (fn, options) => `(${fn.toString()})((${creatorPageTools.toString()})(), ${JSON.stringify(options || {})})`;
module.exports = {
  readCreatorSearchScript: (options) => script(readCreatorSearch, options),
  scrollCreatorSearchScript: (options) => script(scrollCreatorSearch, options),
  confirmConversationScript: (options) => script(confirmConversation, options),
};
