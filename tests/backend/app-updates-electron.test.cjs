const { app } = require("electron");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { once } = require("node:events");
const { NsisUpdater } = require("electron-updater");
const { ElectronHttpExecutor } = require("electron-updater/out/electronHttpExecutor");
const { AppUpdates } = require("../../backend/platform/app-updates.cjs");

async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "xhs-real-updater-"));
  app.setPath("userData", directory);
  await app.whenReady();
  let corrupted = false;
  const payload = Buffer.from("Synthetic test data. This is not an executable.");
  const goodHash = createHash("sha512").update(payload).digest("base64");
  const badHash = createHash("sha512").update("different bytes").digest("base64");
  const server = http.createServer((request, response) => {
    if (request.url.startsWith("/latest.yml")) {
      response.setHeader("Content-Type", "application/yaml");
      response.end(JSON.stringify({
        version: corrupted ? "9.0.2" : "9.0.1",
        files: [{ url: corrupted ? "bad.exe" : "good.exe", size: payload.length, sha512: corrupted ? badHash : goodHash }],
        releaseDate: new Date().toISOString(),
      }));
    } else {
      response.setHeader("Content-Type", "application/octet-stream");
      response.setHeader("Content-Length", payload.length);
      response.end(payload);
    }
  });
  const services = [];
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    for (const bad of [false, true]) {
      corrupted = bad;
      const testDir = path.join(directory, bad ? "bad" : "good");
      await fs.mkdir(testDir);
      const config = path.join(testDir, "app-update.yml");
      await fs.writeFile(config, "updaterCacheDirName: cache\n");
      const updater = new NsisUpdater(undefined, {
        version: "2.0.6", name: "Update test", isPackaged: true,
        userDataPath: testDir, baseCachePath: testDir, appUpdateConfigPath: config,
        whenReady: () => app.whenReady(),
        onQuit: () => { throw new Error("Automatic installation must stay disabled"); },
        quit: () => { throw new Error("Test must not quit to run an installer"); },
      });
      updater.httpExecutor = new ElectronHttpExecutor(() => {});
      updater.disableDifferentialDownload = true;
      updater.disableWebInstaller = true;
      updater.logger = null;
      const service = new AppUpdates({
        version: "2.0.6", isPackaged: true, platform: "win32", updater,
        settingsPath: path.join(testDir, "settings.json"),
        beforeInstall: async () => { throw new Error("No installer execution in tests"); },
      });
      services.push(service);
      // Only the test instance uses a local fixture feed; production pins GitHub.
      updater.setFeedURL({ provider: "generic", url: `http://127.0.0.1:${server.address().port}` });
      assert.equal((await service.check()).status, "available");
      const state = await service.download();
      if (bad) {
        assert.equal(state.status, "error");
        assert.match(state.error, /校验未通过/);
      } else {
        assert.equal(state.status, "downloaded");
        assert.deepEqual(await fs.readFile(updater.installerPath), payload);
      }
    }
    console.log("PASS: real Electron updater downloads verified bytes and rejects a mismatched SHA-512; no installer was executed");
  } finally {
    services.forEach((service) => service.dispose());
    server.closeAllConnections();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  }
}

main().then(() => app.quit()).catch((error) => { console.error(error); app.exit(1); });
