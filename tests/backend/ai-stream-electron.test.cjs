const { app, net } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");

async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "xhs-electron-stream-"));
  app.setPath("userData", directory);
  await app.whenReady();
  const { AiService } = require(process.argv[2]
    ? path.resolve(process.argv[2])
    : "../../backend/ai/ai-service.cjs");
  const requests = [];
  let contentType = "text/event-stream";
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({
      url: request.url,
      authorization: request.headers.authorization,
      body: JSON.parse(Buffer.concat(chunks).toString()),
    });
    const text = "data: " + JSON.stringify({ type: "response.output_text.delta", delta: "OK" }) + "\n\n"
      + "event: response.completed\ndata: " + JSON.stringify({ type: "response.completed", response: { status: "completed" } }) + "\n\n";
    response.writeHead(200, { "Content-Type": contentType });
    response.write(text);
    // A normal SSE completion should not wait for the server to close its socket.
    if (contentType !== "text/event-stream") response.end();
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const service = new AiService({
      filePath: path.join(directory, "test-settings.json"),
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (text) => Buffer.from(text),
        decryptString: (bytes) => bytes.toString(),
      },
      fetchImpl: (url, options) => net.fetch(url, options),
      controlTimeoutMs: 5000,
    });
    await service.saveSettings({
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
      model: "local-synthetic-test-model",
      wireApi: "responses",
      apiKey: "local-synthetic-key",
    });
    for (const type of ["text/event-stream", "application/json", "text/plain"]) {
      contentType = type;
      assert.equal((await service.testConnection()).ok, true);
    }
    assert.equal(requests.length, 3);
    for (const request of requests) {
      assert.equal(request.url, "/v1/responses");
      assert.equal(request.authorization, "Bearer local-synthetic-key");
      assert.equal(request.body.stream, false);
      assert.equal(request.body.store, false);
    }
    console.log(`PASS: Electron ${process.versions.electron} net.fetch accepts relay SSE, mislabeled responses, and completion without socket close`);
  } finally {
    server.closeAllConnections();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await fs.rm(path.join(directory, "test-settings.json"), { force: true });
  }
}

main().then(() => app.quit()).catch((error) => {
  console.error(error);
  app.exit(1);
});
