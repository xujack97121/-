function isLoopbackHostname(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost"
    || host === "::1"
    || host === "0:0:0:0:0:0:0:1"
    || /^127(?:\.\d{1,3}){3}$/.test(host);
}

function resolveRendererDevUrl(rawValue, { isPackaged = false } = {}) {
  if (isPackaged || typeof rawValue !== "string" || !rawValue.trim()) return "";
  try {
    const url = new URL(rawValue.trim());
    if (!["http:", "https:"].includes(url.protocol)) return "";
    if (!isLoopbackHostname(url.hostname) || url.username || url.password) return "";
    return url.href;
  } catch {
    return "";
  }
}

function normalizedDocumentUrl(rawValue) {
  try {
    const url = new URL(rawValue);
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

function isAllowedRendererNavigation(rawValue, allowedValues = []) {
  const candidate = normalizedDocumentUrl(rawValue);
  if (!candidate) return false;
  return allowedValues.some((value) => normalizedDocumentUrl(value) === candidate);
}

module.exports = { isAllowedRendererNavigation, isLoopbackHostname, resolveRendererDevUrl };
