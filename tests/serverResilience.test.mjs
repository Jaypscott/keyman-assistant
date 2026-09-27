import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import pg from "pg";

test("server survives database and request failures and reports slow requests safely", async (t) => {
  const OriginalPool = pg.Pool;
  const previousUrl = process.env.DATABASE_URL;
  const originalError = console.error;
  const originalWarn = console.warn;
  const logs = [];
  let pool;
  let mode = "initialization-failure";
  let initializationAttempts = 0;
  class FakePool extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      pool = this;
    }
    async query(sql) {
      if (sql.includes("CREATE TABLE IF NOT EXISTS users")) initializationAttempts++;
      if (mode === "initialization-failure" || mode === "query-failure") {
        throw Object.assign(new Error("private database details"), { code: "ECONNRESET" });
      }
      if (mode === "slow" && sql === "SELECT 1") {
        await new Promise((resolve) => setTimeout(resolve, 1100));
      }
      if (mode === "hung" && sql === "SELECT 1") return new Promise(() => {});
      return { rows: [] };
    }
  }
  pg.Pool = FakePool;
  process.env.DATABASE_URL = "postgres://test-only";
  console.error = console.warn = (value) => logs.push(JSON.parse(value));
  let server;
  t.after(async () => {
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    pg.Pool = OriginalPool;
    console.error = originalError;
    console.warn = originalWarn;
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
  });
  ({ server } = await import(`../server.mjs?resilience=${Date.now()}`));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const health = () => fetch(`${base}/api/health`);
  assert.equal(pool.options.connectionTimeoutMillis, 1000);
  assert.equal(pool.options.statement_timeout, 2000);
  assert.equal(pool.options.query_timeout, 3000);

  assert.equal((await health()).status, 503);
  mode = "healthy";
  assert.equal((await health()).status, 200);
  assert.equal(initializationAttempts, 2, "initialization retries after transient failure");
  mode = "query-failure";
  assert.equal((await health()).status, 503, "health checks current database connectivity");
  const failure = await fetch(`${base}/api/auth/login`, {
    method: "POST", body: JSON.stringify({ email: "test@example.com", password: "secret-password" }),
  });
  assert.equal(failure.status, 500);
  assert.doesNotMatch(await failure.text(), /private database/);
  assert.doesNotThrow(() => pool.emit("error", Object.assign(new Error("private details"), { code: "ECONNRESET" })));
  mode = "healthy";
  const malformed = await fetch(`${base}/api/auth/login`, { method: "POST", body: "{" });
  assert.equal(malformed.status, 400);
  assert.equal((await health()).status, 200, "server remains available after rejected async handlers");
  mode = "slow";
  assert.equal((await health()).status, 200);
  assert.ok(logs.some((entry) => entry.event === "slow_request_pending"));
  assert.ok(logs.some((entry) => entry.event === "slow_request_completed"));
  mode = "hung";
  const started = performance.now();
  assert.equal((await health()).status, 503);
  assert.ok(performance.now() - started < 4900, "health deadline precedes Render's five-second timeout");
  mode = "healthy";
  assert.equal((await health()).status, 200);
  assert.ok(logs.some((entry) => entry.event === "database_pool_error"));
  assert.doesNotMatch(JSON.stringify(logs), /private|secret-password|test@example/);
});
