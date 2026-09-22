import assert from "node:assert/strict";
import { MAX_INTERVAL_JITTER_SECONDS, randomizeOperationInterval } from "../../frontend/src/features/operations/operation-interval.js";

const lower = randomizeOperationInterval(5, () => 0);
assert.equal(lower.offsetSeconds, -10);
assert.equal(lower.totalSeconds, 290);
assert.equal(lower.milliseconds, 290000);
assert.equal(lower.offsetLabel, "-10.00 秒");
assert.equal(lower.totalLabel, "290.00 秒");

const middle = randomizeOperationInterval(5, () => 0.5);
assert.equal(middle.offsetSeconds, 0);
assert.equal(middle.totalSeconds, 300);
assert.equal(middle.offsetLabel, "+0.00 秒");

const upper = randomizeOperationInterval(5, () => 1);
assert.equal(upper.offsetSeconds, 10);
assert.equal(upper.totalSeconds, 310);
assert.equal(upper.milliseconds, 310000);

const precise = randomizeOperationInterval(5, () => 0.123456);
assert.equal(precise.offsetSeconds, -7.53);
assert.equal(precise.totalSeconds, 292.47);
assert.equal(precise.offsetLabel, "-7.53 秒");
assert.equal(precise.totalLabel, "292.47 秒");

for (let index = 0; index < 10000; index += 1) {
  const result = randomizeOperationInterval(1);
  assert.ok(Math.abs(result.offsetSeconds) <= MAX_INTERVAL_JITTER_SECONDS);
  assert.match(result.offsetLabel, /^[+-]\d+\.\d{2} 秒$/);
  assert.match(result.totalLabel, /^\d+\.\d{2} 秒$/);
  assert.equal(result.milliseconds, Math.round(result.totalSeconds * 1000));
}

console.log("operation interval randomization: passed");
