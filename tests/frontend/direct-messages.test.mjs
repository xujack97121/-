import assert from "node:assert/strict";
import { previewMessages, normalizeDmConfig } from "../../frontend/src/features/operations/direct-messages.js";
const candidates = [
  { token: "a", status: "ready" }, { token: "b", status: "sent" },
  { token: "c", status: "ready" }, { token: "d", status: "unconfirmed" }, { token: "e", status: "ready" },
];
const selected = new Set(candidates.map((row) => row.token));
assert.deepEqual(previewMessages(candidates, selected, ["第一段", "第二段"], 20).map((row) => [row.token, row.message]), [
  ["a", "第一段"], ["c", "第二段"], ["e", "第一段"],
]);
assert.equal(previewMessages(candidates, selected, ["内容"], 2).length, 2);
assert.deepEqual(previewMessages(candidates, selected, [""], 20), []);
assert.deepEqual(normalizeDmConfig({}), { messages: [""], limit: 20, intervalSeconds: 60 });
assert.deepEqual(normalizeDmConfig({ messages: ["保留内容"], limit: "5", intervalSeconds: "10.5" }).messages, ["保留内容"]);
console.log("PASS: private-message previews, original text rotation, count limit, blocked recipients and configuration defaults");
