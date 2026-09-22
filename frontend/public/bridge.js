(() => {
  const pageOrigin = "https://www.xiaohongshu.com";
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== pageOrigin) return;
    if (event.data?.source !== "xhs-public-collector" || event.data?.type !== "NETWORK_JSON") return;
    chrome.runtime.sendMessage({
      type: "XHS_CAPTURE",
      url: event.data.url,
      json: event.data.json,
    }).catch(() => {});
  });
})();
