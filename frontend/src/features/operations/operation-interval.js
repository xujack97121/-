export const DEFAULT_OPERATION_INTERVAL_SECONDS = 10;
export const MAX_INTERVAL_JITTER_SECONDS = 1;

const roundToOneDecimal = (value) => Math.round(Number(value) * 10) / 10;

export function normalizeOperationIntervalSeconds(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0
    ? roundToOneDecimal(Math.min(36_000, Math.max(1, seconds)))
    : DEFAULT_OPERATION_INTERVAL_SECONDS;
}

export function randomizeOperationInterval(baseSeconds = DEFAULT_OPERATION_INTERVAL_SECONDS, random = Math.random) {
  const seconds = normalizeOperationIntervalSeconds(baseSeconds);
  const randomValue = Math.min(1, Math.max(0, Number(random()) || 0));
  const totalSeconds = roundToOneDecimal(Math.max(1, seconds + (randomValue * 2 - 1) * MAX_INTERVAL_JITTER_SECONDS));
  const offsetSeconds = roundToOneDecimal(totalSeconds - seconds);

  return {
    baseSeconds: seconds,
    offsetSeconds,
    totalSeconds,
    milliseconds: Math.round(totalSeconds * 1000),
    offsetLabel: `${offsetSeconds >= 0 ? "+" : ""}${offsetSeconds.toFixed(1)} 秒`,
    totalLabel: `${totalSeconds.toFixed(1)} 秒`,
  };
}
