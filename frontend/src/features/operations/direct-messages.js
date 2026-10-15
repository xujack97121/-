export const DEFAULT_DM_CONFIG = { messages: [""], limit: 20, intervalSeconds: 60 };
export const DM_STATUS_LABELS = {
  ready: "待确认", queued: "待发送", sending: "发送中", sent: "已发送",
  skipped: "已跳过", "not-sent": "未提交", unconfirmed: "结果待确认",
};
export const isDmSelectable = (candidate) => ["ready", "skipped", "not-sent"].includes(candidate.status);

export function previewMessages(candidates, selected, messages, limit) {
  const valid = messages.filter((text) => typeof text === "string" && text.trim());
  if (!valid.length) return [];
  const count = Number.isInteger(Number(limit)) && Number(limit) > 0 ? Math.min(500, Number(limit)) : 20;
  return candidates.filter((candidate) => selected.has(candidate.token) && isDmSelectable(candidate)).slice(0, count)
    .map((candidate, index) => ({ ...candidate, message: valid[index % valid.length] }));
}

export function normalizeDmConfig(value) {
  const messages = Array.isArray(value?.messages) && value.messages.length && value.messages.length <= 50
    ? value.messages.map((text) => String(text).slice(0, 4000)) : [""];
  return { ...DEFAULT_DM_CONFIG, ...value, messages };
}
