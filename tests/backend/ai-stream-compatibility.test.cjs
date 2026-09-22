const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { AiService } = require("../../backend/ai/ai-service.cjs");

const secret = "stream-compatibility-test-key";
const event = (payload, name = "") => `${name ? `event: ${name}\n` : ""}data: ${typeof payload === "string" ? payload : JSON.stringify(payload)}\n\n`;
const completeResponse = (text = "OK") => ({
  status: "completed",
  output: [{ type: "message", content: [{ type: "output_text", text }] }],
});
const responseStream = (text = "OK") => event({ type: "response.output_text.delta", delta: text })
  + event({ type: "response.completed", response: completeResponse(text) });

async function serviceFor(t, fetchImpl, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "xhs-stream-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  // Synthetic fetches have no sockets to keep the service's unref'ed timeout alive.
  const keepAlive = setInterval(() => {}, 1000);
  t.after(() => clearInterval(keepAlive));
  const service = new AiService({
    filePath: path.join(directory, "settings.json"),
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (text) => Buffer.from(text),
      decryptString: (bytes) => bytes.toString(),
    },
    fetchImpl,
    ...options,
  });
  await service.saveSettings({
    baseUrl: "https://relay.example.test/v1",
    model: "custom-relay-model",
    wireApi: "responses",
    apiKey: secret,
  });
  return service;
}

test("connection test accepts SSE even when the relay ignores stream:false", async (t) => {
  let calls = 0;
  const service = await serviceFor(t, async (url, options) => {
    calls++;
    assert.equal(url, "https://relay.example.test/v1/responses");
    assert.equal(JSON.parse(options.body).stream, false);
    assert.equal(JSON.parse(options.body).store, false);
    assert.equal(options.headers.Authorization, `Bearer ${secret}`);
    return new Response(responseStream(), { headers: { "Content-Type": "text/event-stream" } });
  });
  assert.equal((await service.testConnection()).ok, true);
  assert.equal(calls, 1, "Response format detection must not repeat a potentially billable request");
});

for (const contentType of ["application/json", "text/plain", ""]) {
  test(`detects SSE despite incorrect or missing Content-Type: ${contentType || "(missing)"}`, async (t) => {
    const body = ": keep-alive\n\nid: relay-event\n" + responseStream();
    const service = await serviceFor(t, async () => new Response(Buffer.from(body), {
      headers: contentType ? { "Content-Type": contentType } : {},
    }));
    assert.equal((await service.testConnection()).ok, true);
  });
}

test("uses SSE event names when the relay omits JSON type fields", async (t) => {
  const body = event({ delta: "OK" }, "response.output_text.delta")
    + event({ response: { status: "completed" } }, "response.completed");
  const service = await serviceFor(t, async () => new Response(body, { headers: { "Content-Type": "text/event-stream" } }));
  assert.equal((await service.testConnection()).ok, true);
});

test("handles UTF-8 and CRLF split across single-byte network chunks", async (t) => {
  const bytes = Buffer.from(responseStream("连接正常").replaceAll("\n", "\r\n"));
  const service = await serviceFor(t, async () => {
    let offset = 0;
    return new Response(new ReadableStream({
      pull(controller) {
        if (offset === bytes.length) controller.close();
        else controller.enqueue(bytes.subarray(offset, ++offset));
      },
    }), { headers: { "Content-Type": "text/event-stream; charset=utf-8" } });
  });
  assert.equal((await service.testConnection()).ok, true);
});

test("accepts a completed Responses payload without deltas", async (t) => {
  const body = event({ type: "response.completed", response: completeResponse() });
  const service = await serviceFor(t, async () => new Response(body, { headers: { "Content-Type": "text/event-stream" } }));
  assert.equal((await service.testConnection()).ok, true);
});

test("stops at response.completed and releases a relay connection left open", async (t) => {
  let cancelled = false;
  const service = await serviceFor(t, async (_url, options) => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(Buffer.from(responseStream()));
      options.signal.addEventListener("abort", () => controller.error(new Error("aborted")), { once: true });
    },
    cancel() { cancelled = true; },
  }), { headers: { "Content-Type": "text/event-stream" } }), { controlTimeoutMs: 100 });
  assert.equal((await service.testConnection()).ok, true);
  assert.equal(cancelled, true);
});

for (const ending of ["done", "stop"]) {
  test(`accepts Chat Completions SSE during connection tests (${ending})`, async (t) => {
    const body = event({ choices: [{ delta: { content: "OK" }, finish_reason: ending === "stop" ? "stop" : null }] })
      + (ending === "done" ? event("[DONE]") : "");
    const service = await serviceFor(t, async () => new Response(body, { headers: { "Content-Type": "text/event-stream" } }));
    await service.saveSettings({ wireApi: "chat_completions" });
    assert.equal((await service.testConnection()).ok, true);
  });
}

for (const [name, body, code, message] of [
  ["malformed event", "data: {not-json}\n\n", "INVALID_RESPONSE", /无法解析的流式事件/],
  ["empty stream", event("[DONE]"), "INVALID_RESPONSE", /空的流式响应/],
  ["truncated response", event({ type: "response.output_text.delta", delta: "OK" }), "INVALID_RESPONSE", /提前结束/],
  ["provider failure", event({ type: "error", message: `invalid ${secret}` }), "PROVIDER_ERROR", /\[REDACTED\]/],
  ["incomplete response", event({ type: "response.output_text.delta", delta: "OK" }) + event({ type: "response.incomplete" }), "PROVIDER_ERROR", /未完成/],
  ["failed terminal payload", event({ type: "response.completed", response: { status: "failed", error: { message: secret } } }), "PROVIDER_ERROR", /\[REDACTED\]/],
  ["truncated chat response", event({ choices: [{ delta: { content: "OK" }, finish_reason: "length" }] }), "INVALID_RESPONSE", /截断/],
]) {
  test(`rejects ${name} without exposing credentials`, async (t) => {
    const service = await serviceFor(t, async () => new Response(body, { headers: { "Content-Type": "text/event-stream" } }));
    await assert.rejects(service.testConnection(), (error) => {
      assert.equal(error.code, code);
      assert.match(error.message, message);
      assert.ok(!error.message.includes(secret));
      return true;
    });
  });
}

test("does not accept partial JSON output marked incomplete", async (t) => {
  const payload = { ...completeResponse(), status: "incomplete", incomplete_details: { reason: "max_output_tokens" } };
  const service = await serviceFor(t, async () => Response.json(payload));
  await assert.rejects(service.testConnection(), /未完成本次响应/);
});

test("keeps normal buffered JSON support", async (t) => {
  const service = await serviceFor(t, async () => Response.json(completeResponse()));
  assert.equal((await service.testConnection()).ok, true);
});

test("applies size limits to unsolicited SSE", async (t) => {
  const service = await serviceFor(t, async () => new Response(responseStream("x".repeat(2000)), {
    headers: { "Content-Type": "text/event-stream" },
  }), { maxResponseBytes: 1024 });
  await assert.rejects(service.testConnection(), (error) => error.code === "RESPONSE_TOO_LARGE");
});

test("keeps connection timeout active while reading unsolicited SSE", async (t) => {
  const service = await serviceFor(t, async (_url, options) => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(Buffer.from(event({ type: "response.output_text.delta", delta: "O" })));
      options.signal.addEventListener("abort", () => controller.error(new Error("aborted")), { once: true });
    },
  }), { headers: { "Content-Type": "text/event-stream" } }), { controlTimeoutMs: 20 });
  await assert.rejects(service.testConnection(), (error) => error.code === "TIMEOUT");
});

test("analysis fallback accepts a relay that still returns SSE for stream:false", async (t) => {
  const modes = [];
  const progress = [];
  const service = await serviceFor(t, async (_url, options) => {
    const request = JSON.parse(options.body);
    modes.push(request.stream);
    if (request.stream) return Response.json({ error: { message: "stream unsupported" } }, { status: 400 });
    const task = JSON.parse(request.input.at(-1).content);
    const text = JSON.stringify(task.task === "synthesize-recommendations"
      ? { recommendations: [], limitations: [] }
      : { sentiments: [], topics: [{ label: "流式兼容", summary: "返回格式自动识别", sourceIds: ["N000001"] }], needs: [], recommendations: [], limitations: [] });
    return new Response(responseStream(text), { headers: { "Content-Type": "text/event-stream" } });
  });
  const result = await service.analyze({
    requestId: "unsolicited-stream-analysis",
    fingerprint: "unsolicited-stream-fingerprint",
    records: [{ sourceId: "N000001", kind: "note", title: "流式兼容" }],
  }, { senderId: 1, onProgress: (value) => progress.push(value) });
  assert.equal(result.coverage.analyzedRecords, 1);
  assert.equal(result.topics[0].label, "流式兼容");
  assert.deepEqual(modes, [true, false, false]);
  assert.ok(progress.some((value) => value.streamDelta));
});
