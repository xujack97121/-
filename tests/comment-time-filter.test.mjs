import assert from "node:assert/strict";
import { commentMatchesTimeRange, parseCommentTime } from "../src/comment-time-filter.js";

const now = new Date(2026, 7, 3, 12, 0, 0);

assert.equal(commentMatchesTimeRange("11小时前", "day", now), true);
assert.equal(commentMatchesTimeRange("2天前", "day", now), false);
assert.equal(commentMatchesTimeRange("昨天 21:34", "day", now), true);
assert.equal(commentMatchesTimeRange("7天前", "week", now), true);
assert.equal(commentMatchesTimeRange("8天前", "week", now), false);
assert.equal(commentMatchesTimeRange("2026-07-28 09:14", "month", now), true);
assert.equal(commentMatchesTimeRange("2026-02-03 12:00", "half-year", now), true);
assert.equal(commentMatchesTimeRange("2026-02-02 12:00", "half-year", now), false);
assert.equal(commentMatchesTimeRange("未知", "all", now), true);
assert.equal(commentMatchesTimeRange("未知", "day", now), false);
assert.equal(new Date(parseCommentTime("昨天 21:34", now)).getDate(), 2);

console.log("comment time filtering: passed");
