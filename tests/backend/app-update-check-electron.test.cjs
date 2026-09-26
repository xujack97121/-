const { app, net, session } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { once } = require("node:events");
const { AppUpdates, requestReleaseRedirect, RELEASE_PAGE } = require("../../backend/platform/app-updates.cjs");

async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "xhs-update-check-"));
  app.setPath("userData", directory);
  await app.whenReady();
  let scenario = "api";
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push({ method: request.method, path: request.url, headers: request.headers });
    if (request.url === "/api") {
      if (scenario === "timeout") return;
      response.writeHead(scenario === "api" ? 200 : 403, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ tag_name: "v2.1.3", draft: false, prerelease: false }));
    } else if (request.url === "/latest") {
      if (scenario === "page-timeout") return;
      if (scenario === "unavailable") { response.writeHead(503); response.end(); return; }
      const location = scenario === "unsafe" ? "https://untrusted.test/releases/tag/v9.0.0"
        : "https://github.com/xujack97121/-/releases/tag/v2.1.3";
      response.writeHead(302, { Location: location });
      response.end();
    } else {
      response.writeHead(500);
      response.end("Unexpected redirect was followed");
    }
  });
  const services = [];
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    await session.defaultSession.cookies.set({ url: base, name: "fixture-session", value: "do-not-send" });
    for (const mode of ["api", "rate-limit", "timeout", "page-timeout", "unsafe", "unavailable"]) {
      scenario = mode;
      const start = requests.length;
      const states = [];
      const opened = [];
      const service = new AppUpdates({
        version: "2.1.1", isPackaged: true, platform: "darwin",
        settingsPath: path.join(directory, `${mode}.json`),
        fetchImpl: (url, options) => net.fetch(`${base}${url === RELEASE_PAGE ? "/latest" : "/api"}`, options),
        releaseRedirectImpl: () => requestReleaseRedirect({
          request: (options) => net.request({ ...options, url: `${base}/latest` }),
        }),
        openRelease: async (url) => opened.push(url),
        onState: (state) => states.push(state),
      });
      services.push(service);
      const state = await service.check();
      if (["page-timeout", "unsafe", "unavailable"].includes(mode)) {
        assert.equal(state.status, "error", mode);
        assert.equal(state.latestVersion, "");
        assert.doesNotMatch(state.error, /untrusted|fixture/);
        if (mode === "page-timeout") assert.match(state.error, /超时/);
      } else {
        assert.equal(state.status, "available", `${mode}: ${state.error}`);
        assert.equal(state.latestVersion, "2.1.3");
        assert.equal(state.error, "");
      }
      const recorded = requests.slice(start);
      assert.deepEqual(recorded.map(({ method, path }) => [method, path]),
        mode === "api" ? [["GET", "/api"]] : [["GET", "/api"], ["HEAD", "/latest"]]);
      for (const request of recorded) {
        assert.equal(request.headers.cookie, undefined);
        assert.equal(request.headers.authorization, undefined);
      }
      if (mode !== "api") assert.equal(recorded[1].headers["cache-control"], "no-cache");
      if (mode !== "api") assert.ok(states.some((value) => value.checkSource === "release-page"));
      await service.download();
      await service.install();
      await service.openDownloadPage();
      assert.deepEqual(opened, [RELEASE_PAGE]);
      if (mode === "unavailable") {
        scenario = "api";
        assert.equal((await service.check()).status, "available");
        assert.equal(service.getState().error, "");
      }
    }
    console.log("PASS: real Electron manual updates use the official redirect after API failure/timeout, omit cookies, reject unsafe metadata and recover on retry");
  } finally {
    services.forEach((service) => service.dispose());
    server.closeAllConnections();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  }
}

main().then(() => app.quit()).catch((error) => { console.error(error); app.exit(1); });
