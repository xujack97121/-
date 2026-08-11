const DAY_MS = 24 * 60 * 60 * 1000;

function calendarDate(now, year, month, day, hour = 0, minute = 0) {
  const date = new Date(now);
  date.setFullYear(year, month, day);
  date.setHours(hour, minute, 0, 0);
  return date;
}

function subtractCalendarMonths(now, months) {
  const date = new Date(now);
  const day = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() - months);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(day, lastDay));
  return date;
}

export function parseCommentTime(value, now = new Date()) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const nowDate = new Date(now);
  if (Number.isNaN(nowDate.getTime())) return null;
  if (text === "刚刚") return nowDate.getTime();

  const relative = text.match(/^(\d+)\s*(秒钟?|分钟|小时|天|周|个月|月|年)前$/);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2];
    if (/^秒/.test(unit)) return nowDate.getTime() - amount * 1000;
    if (unit === "分钟") return nowDate.getTime() - amount * 60 * 1000;
    if (unit === "小时") return nowDate.getTime() - amount * 60 * 60 * 1000;
    if (unit === "天") return nowDate.getTime() - amount * DAY_MS;
    if (unit === "周") return nowDate.getTime() - amount * 7 * DAY_MS;
    if (unit === "个月" || unit === "月") return subtractCalendarMonths(nowDate, amount).getTime();
    if (unit === "年") {
      const date = new Date(nowDate);
      date.setFullYear(date.getFullYear() - amount);
      return date.getTime();
    }
  }

  const dayWord = text.match(/^(今天|昨天)(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (dayWord) {
    const date = new Date(nowDate);
    date.setDate(date.getDate() - (dayWord[1] === "昨天" ? 1 : 0));
    date.setHours(Number(dayWord[2] || 0), Number(dayWord[3] || 0), 0, 0);
    return date.getTime();
  }

  const absolute = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (absolute) {
    return calendarDate(nowDate, Number(absolute[1]), Number(absolute[2]) - 1, Number(absolute[3]), Number(absolute[4] || 0), Number(absolute[5] || 0)).getTime();
  }

  const monthDay = text.match(/^(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (monthDay) {
    let date = calendarDate(nowDate, nowDate.getFullYear(), Number(monthDay[1]) - 1, Number(monthDay[2]), Number(monthDay[3] || 0), Number(monthDay[4] || 0));
    if (date.getTime() > nowDate.getTime() + DAY_MS) {
      date = calendarDate(nowDate, nowDate.getFullYear() - 1, Number(monthDay[1]) - 1, Number(monthDay[2]), Number(monthDay[3] || 0), Number(monthDay[4] || 0));
    }
    return date.getTime();
  }

  return null;
}

export function timeMatchesRange(value, range, now = new Date()) {
  if (!range || range === "all") return true;
  const timestamp = parseCommentTime(value, now);
  if (timestamp == null) return false;
  const nowDate = new Date(now);
  const cutoffs = {
    day: nowDate.getTime() - DAY_MS,
    week: nowDate.getTime() - 7 * DAY_MS,
    month: subtractCalendarMonths(nowDate, 1).getTime(),
    "half-year": subtractCalendarMonths(nowDate, 6).getTime(),
  };
  const cutoff = cutoffs[range];
  return cutoff == null || (timestamp >= cutoff && timestamp <= nowDate.getTime() + 5 * 60 * 1000);
}

export function commentMatchesTimeRange(value, range, now = new Date()) {
  return timeMatchesRange(value, range, now);
}

export function noteMatchesTimeRange(value, range, now = new Date()) {
  return timeMatchesRange(value, range, now);
}
