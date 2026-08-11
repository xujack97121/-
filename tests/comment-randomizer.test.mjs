import assert from "node:assert/strict";
import { COMMENT_EMOJIS, randomizeComment } from "../src/comment-randomizer.js";

const sequenceRandom = (...values) => {
  let index = 0;
  return () => values[index++ % values.length];
};

const original = "支持支持";
const first = randomizeComment(original, sequenceRandom(0, 0, 0));
assert.equal(first.emoji, COMMENT_EMOJIS[0]);
assert.equal(first.text.split(".").length - 1, 1);
assert.equal(first.text.split(first.emoji).length - 1, 1);
assert.equal(first.text.replace(".", "").replace(first.emoji, ""), original);
assert.equal(first.text.startsWith(original[0]), true);
assert.equal(first.text.endsWith(original.at(-1)), true);

const second = randomizeComment(original, sequenceRandom(0.99, 0.99, 0.25));
assert.equal(second.emoji, COMMENT_EMOJIS.at(-1));
assert.notEqual(second.text, first.text);
assert.equal(second.text.replace(".", "").replace(second.emoji, ""), original);

assert.deepEqual(randomizeComment("", () => 0), { text: "", emoji: "", dotIndex: -1, emojiIndex: -1 });

console.log("comment randomizer: passed");
