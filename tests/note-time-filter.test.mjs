import assert from "node:assert/strict";
import { noteMatchesTimeRange } from "../src/comment-time-filter.js";

const now = new Date(2026, 7, 4, 12, 0, 0);
const notes = [
  { id: "recent", time: "2小时前" },
  { id: "yesterday", time: "昨天 15:00" },
  { id: "week", time: "6天前" },
  { id: "month", time: "20天前" },
  { id: "half-year", time: "5个月前" },
  { id: "old", time: "1年前" },
  { id: "missing", time: "" },
];

const filterIds = (range) => notes.filter((note) => noteMatchesTimeRange(note.time, range, now)).map((note) => note.id);

assert.deepEqual(filterIds("all"), ["recent", "yesterday", "week", "month", "half-year", "old", "missing"]);
assert.deepEqual(filterIds("day"), ["recent", "yesterday"]);
assert.deepEqual(filterIds("week"), ["recent", "yesterday", "week"]);
assert.deepEqual(filterIds("month"), ["recent", "yesterday", "week", "month"]);
assert.deepEqual(filterIds("half-year"), ["recent", "yesterday", "week", "month", "half-year"]);

console.log("note publication time filtering: passed");
