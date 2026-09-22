const ACTION_COMPLETE_LABELS = {
  like: "已完成点赞",
  comment: "已完成评论",
  collect: "已完成收藏",
};

export function formatElapsedTime(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  const parts = hours > 0 ? [hours, minutes, remainder] : [minutes, remainder];
  return parts.map((part) => String(part).padStart(2, "0")).join(":");
}

export function isActionComplete(action, result) {
  if (!result) return false;
  if (["done", "already", "skipped"].includes(result.status)) return true;
  return action === "comment"
    && result.status === "unconfirmed"
    && /^已点击发送/.test(String(result.message || ""));
}

export function actionResultLabel(action, result) {
  if (!result) return "待执行";
  if (result.status === "skipped") return "未启用";
  if (["done", "already"].includes(result.status)) return ACTION_COMPLETE_LABELS[action] || "已完成";
  if (isActionComplete(action, result)) return ACTION_COMPLETE_LABELS[action] || "已完成";
  if (result.status === "missing") return "未找到控件";
  if (result.status === "unconfirmed") return "需页面确认";
  return result.message || "失败";
}

export function taskTimingLabel(state, totalSeconds) {
  const prefix = {
    running: "进行中",
    completed: "已完成",
    unconfirmed: "待确认",
    failed: "执行失败",
  }[state] || "待执行";
  return state === "pending" ? prefix : `${prefix} ${formatElapsedTime(totalSeconds)}`;
}
