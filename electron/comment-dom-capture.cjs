const COMMENT_DOM_CAPTURE_SCRIPT = String.raw`(() => {
  const visible = (element) => {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const textOf = (element) => String(element?.innerText || element?.textContent || '').replace(/\s+/g, ' ').trim();
  const profileSelector = 'a[href*="/user/profile/"]';
  const timeSource = '(?:刚刚|\\d+\\s*(?:秒钟?|分钟|小时|天|周|个月|月|年)前|今天\\s*\\d{1,2}:\\d{2}|昨天\\s*\\d{1,2}:\\d{2}|\\d{1,2}-\\d{1,2}(?:\\s+\\d{1,2}:\\d{2})?|\\d{4}-\\d{1,2}-\\d{1,2}(?:\\s+\\d{1,2}:\\d{2})?)';
  const regionSource = '(?:北京|上海|天津|重庆|河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|台湾|内蒙古|广西|西藏|宁夏|新疆|香港|澳门|海外|其他)';
  const timePattern = new RegExp(timeSource);
  const regionPattern = new RegExp('(?:IP属地[:：]?\\s*)?(' + regionSource + ')');
  const candidates = [];
  const seen = new Set();
  const addCandidate = (element) => {
    if (!element || seen.has(element) || !visible(element)) return;
    const profiles = element.querySelectorAll(profileSelector);
    if (!profiles.length || profiles.length > 4 || textOf(element).length < 2) return;
    seen.add(element);
    candidates.push(element);
  };

  const preferredSelectors = [
    '#noteContainer .comment-item',
    '.note-detail-mask .comment-item',
    '[class*="comments-container"] .comment-item',
    '[class*="comment-list"] .comment-item',
    '[class*="commentList"] [class*="commentItem"]',
    '[class*="reply-container"] .comment-item'
  ];
  for (const selector of preferredSelectors) {
    for (const element of document.querySelectorAll(selector)) addCandidate(element);
  }

  if (!candidates.length) {
    const profileLinks = Array.from(document.querySelectorAll(profileSelector))
      .filter((link) => /(?:xsec_source=pc_comment|channel_type=web_note_detail)/.test(link.href || ''));
    for (const link of profileLinks) {
      let current = link.parentElement;
      for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
        const profileCount = current.querySelectorAll(profileSelector).length;
        const className = typeof current.className === 'string' ? current.className : '';
        if (profileCount >= 1 && profileCount <= 4 && /comment|reply/i.test(className) && textOf(current).length >= 2) {
          addCandidate(current);
          break;
        }
      }
    }
  }

  const cleanContent = (value, nickname) => {
    let text = String(value || '').replace(/\s+/g, ' ').trim();
    if (nickname && text.startsWith(nickname)) text = text.slice(nickname.length).trim();
    text = text.replace(/^作者\s*/, '');
    text = text.replace(new RegExp('\\s*' + timeSource + '(?:\\s+' + regionSource + ')?(?=\\s|$)', 'g'), ' ');
    text = text.replace(new RegExp('\\s*(?:IP属地[:：]?\\s*)?' + regionSource + '(?=\\s+(?:赞|回复|\\d+|展开)|$)', 'g'), ' ');
    text = text.replace(/(?:\s+(?:赞|回复)(?:\s+\d+)?)+\s*$/g, '');
    return text.replace(/\s+/g, ' ').trim();
  };

  return candidates.slice(0, 2000).map((element) => {
    const profileLinks = Array.from(element.querySelectorAll(profileSelector));
    const namedProfile = profileLinks
      .map((link) => ({ link, text: textOf(link) }))
      .filter((entry) => entry.text)
      .sort((left, right) => left.text.length - right.text.length)[0];
    const profile = namedProfile?.link || profileLinks[0];
    const nickname = namedProfile?.text || '';
    let authorId = '';
    try { authorId = new URL(profile?.href || '', location.href).pathname.match(/\/user\/profile\/([^/?#]+)/)?.[1] || ''; } catch { /* keep blank */ }

    const fullText = textOf(element);
    const rawLines = String(element.innerText || '').split(/\n+/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const contentSelectors = ['.comment-content', '[class*="comment-content"]', '[class*="commentContent"]', '.content'];
    let content = '';
    for (const selector of contentSelectors) {
      const matches = Array.from(element.querySelectorAll(selector));
      const match = matches.find((candidate) => visible(candidate)
        && !candidate.querySelector(profileSelector)
        && cleanContent(textOf(candidate), nickname).length > 0);
      if (match) {
        content = cleanContent(textOf(match), nickname);
        break;
      }
    }
    if (!content) {
      const ignored = /^(?:作者|赞|回复|展开\s*\d+\s*条回复|\d+)$/;
      const line = rawLines.find((value) => value !== nickname && !ignored.test(value) && !timePattern.test(value) && !regionPattern.test(value));
      content = cleanContent(line || fullText, nickname);
    }

    const timeMatches = Array.from(fullText.matchAll(new RegExp(timePattern.source, 'g')));
    const lastTimeMatch = timeMatches.at(-1);
    const time = lastTimeMatch?.[0] || '';
    const regions = Array.from(fullText.matchAll(new RegExp(regionPattern.source, 'g')));
    const metadataTail = lastTimeMatch
      ? fullText.slice((lastTimeMatch.index || 0) + lastTimeMatch[0].length).trim()
      : '';
    const regionAfterTime = metadataTail.split(/\s+/).find((token) => {
      const value = token.replace(/^IP属地[:：]?/, '').replace(/[，,。；;：:]$/, '');
      return value
        && value.length <= 12
        && !/^(?:赞|回复|展开|收起|作者|置顶|\\d+)$/.test(value)
        && !/^\\d+(?:赞|条回复)?$/.test(value);
    })?.replace(/^IP属地[:：]?/, '').replace(/[，,。；;：:]$/, '') || '';
    const region = regions.at(-1)?.[1] || regionAfterTime;
    const id = element.getAttribute('data-comment-id') || element.getAttribute('data-id') || '';
    return { id, nickname, authorId, content, time, region };
  }).filter((row) => row.nickname && row.content);
})()`;

const COMMENT_REPLY_EXPAND_SCRIPT = String.raw`(() => {
  const visible = (element) => {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const matches = Array.from(document.querySelectorAll('button,[role="button"],span,div'))
    .filter((element) => visible(element)
      && /^展开\s*\d+\s*条回复$/.test((element.textContent || '').trim())
      && !element.dataset.collectorExpanded
      && !Array.from(element.children).some((child) => /^展开\s*\d+\s*条回复$/.test((child.textContent || '').trim())));
  for (const element of matches.slice(0, 6)) {
    element.dataset.collectorExpanded = 'true';
    element.click();
  }
  return matches.slice(0, 6).length;
})()`;

module.exports = { COMMENT_DOM_CAPTURE_SCRIPT, COMMENT_REPLY_EXPAND_SCRIPT };
