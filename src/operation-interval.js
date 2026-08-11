export const MAX_INTERVAL_JITTER_SECONDS = 10;

const roundToTwoDecimals = (value) => Math.round(Number(value) * 100) / 100;

export function randomizeOperationInterval(baseMinutes, random = Math.random) {
  const minutes = Math.max(0, Number(baseMinutes) || 0);
  const randomValue = Math.min(1, Math.max(0, Number(random()) || 0));
  const offsetSeconds = roundToTwoDecimals((randomValue * 2 - 1) * MAX_INTERVAL_JITTER_SECONDS);
  const totalSeconds = roundToTwoDecimals(Math.max(0, minutes * 60 + offsetSeconds));

  return {
    baseMinutes: minutes,
    offsetSeconds,
    totalSeconds,
    milliseconds: Math.round(totalSeconds * 1000),
    offsetLabel: `${offsetSeconds >= 0 ? "+" : ""}${offsetSeconds.toFixed(2)} 秒`,
    totalLabel: `${totalSeconds.toFixed(2)} 秒`,
  };
}
