import assert from "node:assert/strict";
import {
  inferNoteTimeFromId,
  normalizeNoteTime,
  noteMatchesTimeRange,
  noteTimestampFromId,
  parseCommentTime,
} from "../src/comment-time-filter.js";

const now = new Date(2026, 7, 4, 12, 0, 0);
const notes = [
  { id: "recent", time: "2小时前" },
  { id: "yesterday", time: "昨天 15:00" },
  { id: "week", time: "6天前" },
  { id: "month", time: "20天前" },
  { id: "half-year", time: "5个月前" },
  { id: "6a47919900000000160277c9", time: "" },
  { id: "old", time: "1年前" },
  { id: "missing", time: "" },
];

const inferredId = "6a47919900000000160277c9";
const inferredTimestamp = Number.parseInt(inferredId.slice(0, 8), 16) * 1000;
const inferredTime = inferNoteTimeFromId(inferredId, now);
assert.equal(noteTimestampFromId(inferredId, now), inferredTimestamp);
assert.equal(parseCommentTime(inferredTime, now), Math.floor(inferredTimestamp / 60000) * 60000);
assert.equal(normalizeNoteTime({ id: inferredId, time: "" }, now).time, inferredTime);

const filterIds = (range) => notes.filter((note) => noteMatchesTimeRange(note, range, now)).map((note) => note.id);

assert.deepEqual(filterIds("all"), ["recent", "yesterday", "week", "month", "half-year", inferredId, "old", "missing"]);
assert.deepEqual(filterIds("day"), ["recent", "yesterday"]);
assert.deepEqual(filterIds("week"), ["recent", "yesterday", "week"]);
assert.deepEqual(filterIds("month"), ["recent", "yesterday", "week", "month"]);
assert.deepEqual(filterIds("half-year"), ["recent", "yesterday", "week", "month", "half-year", inferredId]);

console.log("note publication time filtering: passed");
