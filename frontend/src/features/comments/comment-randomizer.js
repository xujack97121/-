export const COMMENT_EMOJIS = ["😊", "✨", "🌷", "🍀", "🙌", "🎉", "💛", "👍", "🌟", "💪"];

const pickIndex = (length, random) => Math.min(length - 1, Math.floor(Math.max(0, random()) * length));

export function randomizeComment(value, random = Math.random) {
  const characters = Array.from(String(value ?? "").trim());
  if (!characters.length) return { text: "", emoji: "", dotIndex: -1, emojiIndex: -1 };

  const emoji = COMMENT_EMOJIS[pickIndex(COMMENT_EMOJIS.length, random)];
  const boundaryCount = Math.max(1, characters.length - 1);
  const dotIndex = characters.length === 1 ? 1 : pickIndex(boundaryCount, random) + 1;
  let emojiIndex = characters.length === 1 ? 1 : pickIndex(boundaryCount, random) + 1;
  if (boundaryCount > 1 && emojiIndex === dotIndex) emojiIndex = (emojiIndex % boundaryCount) + 1;

  const inserts = [
    { index: dotIndex, value: ".", order: 0 },
    { index: emojiIndex, value: emoji, order: 1 },
  ].sort((left, right) => right.index - left.index || left.order - right.order);
  for (const insert of inserts) characters.splice(insert.index, 0, insert.value);

  return { text: characters.join(""), emoji, dotIndex, emojiIndex };
}
