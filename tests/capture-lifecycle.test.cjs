const assert = require("node:assert/strict");
const {
  discardPendingResponsesForRun,
  isActiveCaptureRun,
  normalizeCaptureTarget,
  selectUniqueRowsWithinTarget,
} = require("../electron/capture-lifecycle.cjs");

assert.equal(normalizeCaptureTarget("100.9"), 100);
assert.equal(normalizeCaptureTarget(0, 500), 500);
assert.equal(normalizeCaptureTarget(9000), 2000);

assert.equal(isActiveCaptureRun({ active: true, runId: "run-new" }, "run-new"), true);
assert.equal(isActiveCaptureRun({ active: false, runId: "run-new" }, "run-new"), false);
assert.equal(isActiveCaptureRun({ active: true, runId: "run-new" }, "run-old"), false);
assert.equal(isActiveCaptureRun({ active: true, runId: "run-new" }, ""), false);

const seen = new Set(Array.from({ length: 96 }, (_, index) => `note-${index + 1}`));
const boundary = selectUniqueRowsWithinTarget({
  rows: Array.from({ length: 20 }, (_, index) => ({ id: `note-${97 + index}` })),
  seenKeys: seen,
  target: 100,
  keyOf: (row) => row.id,
});
assert.deepEqual(boundary.rows.map((row) => row.id), ["note-97", "note-98", "note-99", "note-100"]);
assert.equal(boundary.collected, 100);
assert.equal(boundary.reachedTarget, true);
assert.equal(seen.size, 96, "selection stays pure until the caller commits the accepted keys");

const duplicateBatch = selectUniqueRowsWithinTarget({
  rows: [{ id: "note-1" }, { id: "" }, { id: "note-97" }, { id: "note-97" }, { id: "note-98" }],
  seenKeys: seen,
  target: 100,
  keyOf: (row) => row.id,
});
assert.deepEqual(duplicateBatch.keys, ["note-97", "note-98"]);
assert.equal(duplicateBatch.collected, 98);
assert.equal(duplicateBatch.reachedTarget, false);

const pending = new Map([
  ["request-a", { runId: "run-old" }],
  ["request-b", { runId: "run-new" }],
  ["request-c", { runId: "run-old" }],
]);
assert.equal(discardPendingResponsesForRun(pending, "run-old"), 2);
assert.deepEqual(Array.from(pending.keys()), ["request-b"]);
assert.equal(discardPendingResponsesForRun(pending, "run-old"), 0, "stopping the same run twice is harmless");

console.log("capture lifecycle tests passed");
