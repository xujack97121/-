function normalizeCaptureTarget(value, fallback = 100, maximum = 2000) {
  const numeric = Number(value);
  const resolved = Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
  return Math.min(maximum, Math.max(1, Math.floor(resolved)));
}

function isActiveCaptureRun(state, runId) {
  return Boolean(runId && state?.active && state.runId === runId);
}

function selectUniqueRowsWithinTarget({ rows, seenKeys, target, keyOf }) {
  if (!(seenKeys instanceof Set)) throw new TypeError("seenKeys must be a Set");
  if (typeof keyOf !== "function") throw new TypeError("keyOf must be a function");

  const normalizedTarget = normalizeCaptureTarget(target);
  let remaining = Math.max(0, normalizedTarget - seenKeys.size);
  const acceptedRows = [];
  const acceptedKeys = [];
  const stagedKeys = new Set();

  for (const row of Array.isArray(rows) ? rows : []) {
    if (remaining <= 0) break;
    const key = String(keyOf(row) || "").trim();
    if (!key || seenKeys.has(key) || stagedKeys.has(key)) continue;
    stagedKeys.add(key);
    acceptedKeys.push(key);
    acceptedRows.push(row);
    remaining -= 1;
  }

  const collected = seenKeys.size + acceptedKeys.length;
  return {
    rows: acceptedRows,
    keys: acceptedKeys,
    collected,
    target: normalizedTarget,
    reachedTarget: collected >= normalizedTarget,
  };
}

function discardPendingResponsesForRun(pendingResponses, runId) {
  if (!(pendingResponses instanceof Map) || !runId) return 0;
  let removed = 0;
  for (const [requestId, meta] of pendingResponses) {
    if (meta?.runId !== runId) continue;
    pendingResponses.delete(requestId);
    removed += 1;
  }
  return removed;
}

module.exports = {
  discardPendingResponsesForRun,
  isActiveCaptureRun,
  normalizeCaptureTarget,
  selectUniqueRowsWithinTarget,
};
