import assert from "node:assert/strict";
import { actionResultLabel, formatElapsedTime, isActionComplete, taskTimingLabel } from "../src/operation-status.js";

assert.equal(formatElapsedTime(0), "00:00");
assert.equal(formatElapsedTime(65), "01:05");
assert.equal(formatElapsedTime(3661), "01:01:01");
assert.equal(taskTimingLabel("running", 7), "进行中 00:07");
assert.equal(taskTimingLabel("completed", 65), "已完成 01:05");

assert.equal(actionResultLabel("comment", { status: "done" }), "已完成评论");
assert.equal(actionResultLabel("comment", { status: "already" }), "已完成评论");
assert.equal(actionResultLabel("comment", { status: "unconfirmed", message: "已点击发送，页面状态未能确认" }), "已完成评论");
assert.equal(isActionComplete("comment", { status: "unconfirmed", message: "已点击发送，页面状态未能确认" }), true);
assert.equal(actionResultLabel("comment", { status: "unconfirmed", message: "发送按钮当前不可用" }), "需页面确认");

assert.equal(actionResultLabel("collect", { status: "done" }), "已完成收藏");
assert.equal(actionResultLabel("collect", { status: "already" }), "已完成收藏");
assert.equal(actionResultLabel("collect", { status: "unconfirmed" }), "需页面确认");
assert.equal(actionResultLabel("collect", null), "待执行");

console.log("operation status: passed");
