import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { api, ApiError } from "../web/src/api.ts";
test("响应体超时或无效 JSON 不能被当作抽奖成功", async () => {
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/invalid") res.end("not-json");
    else {
      res.writeHead(200);
      res.flushHeaders();
      setTimeout(() => res.end('{"ok":true}'), 500);
    }
  });
  server.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  const origin = "http://127.0.0.1:" + (server.address() as any).port;
  const originalFetch = globalThis.fetch,
    originalTimeout = AbortSignal.timeout;
  mock.method(globalThis, "fetch", (path: string, init: any) =>
    originalFetch(origin + path, init),
  );
  mock.method(AbortSignal, "timeout", () => originalTimeout(100));
  try {
    await assert.rejects(
      api("/slow", "POST", { requestId: "keep-original-id" }),
      (e) => e instanceof ApiError && e.status === 0,
    );
    await assert.rejects(
      api("/invalid"),
      (e) => e instanceof ApiError && e.status === 502,
    );
  } finally {
    mock.restoreAll();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
