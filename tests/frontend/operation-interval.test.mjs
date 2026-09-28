import assert from "node:assert/strict";
import { DEFAULT_OPERATION_INTERVAL_SECONDS, MAX_INTERVAL_JITTER_SECONDS, normalizeOperationIntervalSeconds, randomizeOperationInterval } from "../../frontend/src/features/operations/operation-interval.js";

assert.equal(DEFAULT_OPERATION_INTERVAL_SECONDS, 10);
const lower = randomizeOperationInterval(10, () => 0);
assert.equal(lower.baseSeconds, 10);
assert.equal(lower.offsetSeconds, -1);
assert.equal(lower.totalSeconds, 9);
assert.equal(lower.milliseconds, 9000);
assert.equal(lower.offsetLabel, "-1.0 秒");
assert.equal(lower.totalLabel, "9.0 秒");

const middle = randomizeOperationInterval(10, () => 0.5);
assert.equal(middle.offsetSeconds, 0);
assert.equal(middle.totalSeconds, 10);
assert.equal(middle.offsetLabel, "+0.0 秒");

const upper = randomizeOperationInterval(10, () => 1);
assert.equal(upper.offsetSeconds, 1);
assert.equal(upper.totalSeconds, 11);
assert.equal(upper.milliseconds, 11000);

const precise = randomizeOperationInterval(10, () => 0.123456);
assert.equal(precise.offsetSeconds, -0.8);
assert.equal(precise.totalSeconds, 9.2);
assert.equal(precise.offsetLabel, "-0.8 秒");
assert.equal(precise.totalLabel, "9.2 秒");

for (const invalid of [undefined, null, "", "invalid", NaN, Infinity, -1, 0])
  assert.equal(normalizeOperationIntervalSeconds(invalid), 10);
assert.equal(normalizeOperationIntervalSeconds("12.345"), 12.3);
assert.equal(normalizeOperationIntervalSeconds(100000), 36000);
assert.equal(randomizeOperationInterval(1, () => 0).totalSeconds, 1);
assert.equal(randomizeOperationInterval(undefined, () => 0.5).totalSeconds, 10);

for (let index = 0; index < 10000; index += 1) {
  const result = randomizeOperationInterval(10);
  assert.ok(result.totalSeconds >= 9 && result.totalSeconds <= 11);
  assert.ok(Math.abs(result.offsetSeconds) <= MAX_INTERVAL_JITTER_SECONDS);
  assert.match(result.offsetLabel, /^[+-]\d+\.\d 秒$/);
  assert.match(result.totalLabel, /^\d+\.\d 秒$/);
  assert.equal(result.milliseconds, Math.round(result.totalSeconds * 1000));
  assert.equal(result.milliseconds % 100, 0);
}

console.log("operation interval randomization: passed");
