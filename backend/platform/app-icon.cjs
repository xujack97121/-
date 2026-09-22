const path = require("node:path");

function resolveAppIconPath({ isPackaged, resourcesPath, projectRoot, platform = process.platform }) {
  if (!isPackaged) {
    return path.join(projectRoot, "frontend", "public", "assets", "ai-collector-icon.png");
  }

  return path.join(resourcesPath, "ai-collector-icon.png");
}

function setDockIconSafely({ dock, iconPath, logger = console }) {
  if (!dock || typeof dock.setIcon !== "function") return false;
  try {
    dock.setIcon(iconPath);
    return true;
  } catch (error) {
    logger.warn?.(`[desktop] Dock 图标加载失败，继续使用应用包图标：${error?.message || error}`);
    return false;
  }
}

module.exports = { resolveAppIconPath, setDockIconSafely };
