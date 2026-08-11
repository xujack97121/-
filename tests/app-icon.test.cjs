const assert = require("node:assert/strict");
const path = require("node:path");
const { resolveAppIconPath, setDockIconSafely } = require("../electron/app-icon.cjs");

assert.equal(
  resolveAppIconPath({
    isPackaged: false,
    resourcesPath: "/bundle/Resources",
    projectRoot: "/project",
    platform: "darwin",
  }),
  path.join("/project", "public", "assets", "ai-collector-icon.png"),
);

assert.equal(
  resolveAppIconPath({
    isPackaged: true,
    resourcesPath: "/bundle/Resources",
    projectRoot: "/project",
    platform: "darwin",
  }),
  path.join("/bundle/Resources", "ai-collector-icon.png"),
);

let loggedWarning = "";
assert.equal(setDockIconSafely({
  dock: { setIcon() { throw new Error("missing icon"); } },
  iconPath: "/missing/icon.icns",
  logger: { warn(message) { loggedWarning = message; } },
}), false);
assert.match(loggedWarning, /missing icon/);

let receivedIcon = "";
assert.equal(setDockIconSafely({
  dock: { setIcon(iconPath) { receivedIcon = iconPath; } },
  iconPath: "/bundle/Resources/ai-collector-icon.png",
}), true);
assert.equal(receivedIcon, "/bundle/Resources/ai-collector-icon.png");

console.log("应用图标路径与失败降级测试通过");
