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
    && url.searchParams.get("keyword")?.normalize("NFKC") === options.keyword && [null, "0", "51"].includes(url.searchParams.get("type"));
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
  const noteCards = [...document.querySelectorAll('.note-item,[data-search-note]')].filter(tools.visible);
  for (const card of noteCards.slice(0, 300)) {
    if (card.closest("nav,aside,header,.side-bar,.sidebar")) continue;
    const links = [...card.querySelectorAll('.author-wrapper a[href*="/user/profile/"],.author a[href*="/user/profile/"],a.author[href*="/user/profile/"],[data-note-author] a[href*="/user/profile/"]')].filter(tools.visible);
    const ids = [...new Set(links.map((link) => tools.profileId(link.href)).filter(Boolean))];
    if (ids.length !== 1) continue;
    const profile = links.find((link) => tools.text(link)) || links[0];
    const image = tools.first(card, ".author-wrapper img,.author img,[data-note-author] img");
    rows.push({
      userId: ids[0], nickname: tools.text(profile).slice(0, 100), profileUrl: profile.href,
      avatarUrl: image?.currentSrc || image?.src || "", followers: null, description: "",
    });
  }
  const empty = [...document.querySelectorAll('.empty,.empty-container,.no-result,.no-results,[data-empty-results]')].some(tools.visible);
  return { pageMatches: true, blocked: "", rows, empty };
}

function scrollCreatorSearch(tools, options) {
  const url = new URL(location.href);
  if (!/^\/search_result\/?$/.test(url.pathname) || url.searchParams.get("keyword")?.normalize("NFKC") !== options.keyword
    || ![null, "0", "51"].includes(url.searchParams.get("type"))) return { moved: false, atBottom: true };
  const roots = [...document.querySelectorAll('[data-search-users],[data-creator-results],.user-list,.users-list,.search-user,.search-user-container,.search-result-container,.search-layout,.search-container')].filter(tools.visible);
  const scroller = roots.find((root) => root.scrollHeight > root.clientHeight + 20 && /auto|scroll/.test(getComputedStyle(root).overflowY))
    || document.scrollingElement;
  if (!scroller) return { moved: false, atBottom: true };
  const before = scroller.scrollTop;
  scroller.scrollBy({ top: Math.max(300, Math.min(1200, scroller.clientHeight * 0.8)), behavior: "instant" });
  return { moved: scroller.scrollTop > before, atBottom: scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 8 };
}

function readCreatorProfile(tools, options) {
  const userId = tools.profileId(location.href);
  if (userId !== options.userId) return { pageMatches: false, profileReady: false, userId, notes: [] };
  const blocked = tools.blocked();
  if (blocked) return { pageMatches: true, profileReady: false, userId, blocked, notes: [] };
  const explicitHeaders = [...document.querySelectorAll('[data-profile-user],#userPage .user-info,.user-page .user-info')].filter(tools.visible)
    .filter((element) => !element.closest("nav,aside,.side-bar,.sidebar,.chat-container,.chat-panel"));
  const genericHeaders = [...document.querySelectorAll(".user-info,.userInfo")].filter(tools.visible)
    .filter((element) => !element.closest("nav,aside,header,.side-bar,.sidebar,.chat-container,.chat-panel"));
  const header = explicitHeaders.find((element) => element.getAttribute("data-profile-user")?.toLowerCase() === userId)
    || explicitHeaders[0] || genericHeaders[0];
  if (!header) return { pageMatches: true, profileReady: false, userId, notes: [] };
  const explicitIds = [header.getAttribute("data-profile-user"), header.getAttribute("data-user-id"),
    ...[...header.querySelectorAll('a[data-profile-link],.user-name a[href*="/user/profile/"],.user-nickname a[href*="/user/profile/"]')].map((link) => tools.profileId(link.href))]
    .filter((value) => /^[a-f\d]{24}$/i.test(value || "")).map((value) => value.toLowerCase());
  if (explicitIds.some((id) => id !== userId)) return { pageMatches: false, profileReady: false, userId, notes: [] };
  const nickname = tools.first(header, '[data-user-name],.user-name,.user-nickname,.nickname,.userName');
  const description = tools.first(header, '[data-user-description],.user-desc,.user-description,.description,.desc');
  const image = tools.first(header, ".avatar img,img.avatar,[data-avatar],img");
  const tags = [...header.querySelectorAll('[data-profile-tag],.user-tags .tag-item,.user-tags .tag,.user-tag,.user-info .tag,.userInfo .tag')].filter(tools.visible).map(tools.text).filter(Boolean).slice(0, 20);
  const metrics = [...header.querySelectorAll('[data-followers],[data-fans],.fans,.fans-count,.user-interactions,.user-interaction,.interactions,.interaction,.data-info,.user-data-item,.profile-stats,[data-profile-stats]')].filter(tools.visible)
    .filter((element) => !element.closest('[data-user-description],.user-desc,.user-description,.description,.desc,.user-name,.nickname,.user-tags,.user-tag,[data-profile-tag]'));
  const metric = metrics.find((element) => element.hasAttribute("data-followers") || element.hasAttribute("data-fans"))
    || metrics.find((element) => /粉丝/.test(tools.text(element)));
  const count = "(?:约|近)?[\\d,.，]+(?:千|万|亿|[kKwWmM])?\\+?";
  const labelElement = metric && [...metric.querySelectorAll("span,div,p,label")].find((element) => tools.visible(element) && tools.text(element) === "粉丝" && !element.querySelector("span,div,p,label"));
  const counter = labelElement?.parentElement;
  const counterValue = counter && tools.first(counter, ".count,[data-count],strong");
  const label = counterValue ? tools.text(counterValue) : tools.text(counter || metric);
  const fans = metric?.getAttribute("data-followers") ?? metric?.getAttribute("data-fans")
    ?? (counterValue && new RegExp(`^${count}$`).test(label) ? label : null)
    ?? label.match(new RegExp(`(${count})\\s*(?:位|个|人)?粉丝`))?.[1]
    ?? label.match(new RegExp(`^粉丝(?:数|量)?\\s*[:：]?\\s*(${count})\\s*$`))?.[1] ?? null;
  const activeTabs = [...document.querySelectorAll('[data-active-profile-tab],[role="tab"][aria-selected="true"],.reds-tab-item.active,.reds-tab-item.is-active,.tab-item.active')].filter(tools.visible).map(tools.text);
  const wrongTab = activeTabs.some((label) => /收藏|赞过|喜欢/.test(label));
  const postsTab = activeTabs.some((label) => /^(笔记|作品|发布|帖子)(?:\s*\d+)?$/.test(label));
  const explicitRoots = [...document.querySelectorAll('[data-user-posted-feeds],#userPostedFeeds')].filter(tools.visible);
  const roots = explicitRoots.length ? explicitRoots : [...document.querySelectorAll('.feeds-tab-container,.feeds-container,[data-profile-notes]')].filter(tools.visible);
  const notes = [];
  let authoredConfirmed = false;
  if (!wrongTab && (postsTab || explicitRoots.length)) {
    for (const card of roots.flatMap((root) => [...root.querySelectorAll('.note-item,[data-profile-note]')])) {
      if (notes.length >= Math.min(8, options.maxNotes || 8) || !tools.visible(card)
        || card.closest('.recommend-container,.recommendations,.related-notes,[data-recommended],[data-favorites]')
        || card.getAttribute("data-pinned") === "true" || card.querySelector('.sticky,.pinned,[data-pinned="true"]')) continue;
      const link = [...card.querySelectorAll('a[href*="/explore/"],a[href*="/discovery/item/"]')].find(tools.visible);
      let noteId = "";
      try {
        const url = new URL(link?.href || "", location.href);
        if (url.protocol === "https:" && ["www.xiaohongshu.com", "xiaohongshu.com"].includes(url.hostname)
          && !url.username && !url.password && !url.port) noteId = url.pathname.match(/^\/(?:explore|discovery\/item)\/([a-f\d]{24})\/?$/i)?.[1].toLowerCase() || "";
      } catch { /* Ignore malformed public links. */ }
      if (!noteId) continue;
      const authorIds = [card.getAttribute("data-author-id"), ...[...card.querySelectorAll('.author-wrapper a[href*="/user/profile/"],.author a[href*="/user/profile/"],a.author[href*="/user/profile/"],[data-note-author] a[href*="/user/profile/"]')].map((anchor) => tools.profileId(anchor.href))].filter(Boolean);
      if (authorIds.some((id) => id.toLowerCase() !== userId) || !authorIds.length && !postsTab && !explicitRoots.length) continue;
      const title = tools.text(tools.first(card, '[data-note-title],.title,.note-title'));
      const summary = tools.text(tools.first(card, '[data-note-description],.note-desc,.note-description,.desc'));
      if (!title && !summary) continue;
      const noteTags = [...card.querySelectorAll('[data-note-tag],.tag,.topic')].filter(tools.visible).map(tools.text).slice(0, 15);
      notes.push({ id: noteId, title, description: summary, authorId: userId, source: "profile", tags: noteTags });
      authoredConfirmed = true;
    }
  }
  return {
    pageMatches: true, profileReady: true, userId, blocked: "", authoredConfirmed, notes,
    creator: {
      userId, profileUrl: location.href, nickname: tools.text(nickname), description: tools.text(description),
      avatarUrl: image?.currentSrc || image?.src || "", followers: fans, followerLabel: fans || "", tags,
    },
  };
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
  readCreatorProfileScript: (options) => script(readCreatorProfile, options),
  confirmConversationScript: (options) => script(confirmConversation, options),
};
