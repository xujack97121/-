(() => {
  if (window.__XHS_COLLECTOR_INSTALLED__) return;
  window.__XHS_COLLECTOR_INSTALLED__ = true;

  const allowed = (url) => {
    try {
      const target = new URL(String(url), location.href);
      return ["www.xiaohongshu.com", "edith.xiaohongshu.com"].includes(target.hostname) && target.pathname.includes("/api/");
    } catch {
      return false;
    }
  };

  const publish = (url, text) => {
    if (!allowed(url) || typeof text !== "string" || text.length < 2 || text.length > 12_000_000) return;
    try {
      const json = JSON.parse(text);
      window.postMessage({ source: "xhs-public-collector", type: "NETWORK_JSON", url: String(url), json }, location.origin);
    } catch {
      // Only structured JSON responses are relevant.
    }
  };

  const originalFetch = window.fetch;
  window.fetch = async function collectorFetch(...args) {
    const response = await originalFetch.apply(this, args);
    const requestUrl = response.url || args[0]?.url || args[0];
    if (allowed(requestUrl)) response.clone().text().then((text) => publish(requestUrl, text)).catch(() => {});
    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function collectorOpen(method, url, ...rest) {
    this.__xhsCollectorUrl = url;
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function collectorSend(...args) {
    if (allowed(this.__xhsCollectorUrl)) {
      this.addEventListener("load", () => {
        try {
          const text = typeof this.response === "string" ? this.response : JSON.stringify(this.response);
          publish(this.responseURL || this.__xhsCollectorUrl, text);
        } catch { /* ignore non-readable responses */ }
      }, { once: true });
    }
    return originalSend.apply(this, args);
  };
})();
