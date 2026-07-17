import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

test("password recovery works and sessions use a rolling seven-day inactivity timeout", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "keyman-auth-test-"));
  const dataFile = join(directory, "auth-db.json");
  const previousDataFile = process.env.AUTH_DATA_FILE;
  const previousNodeEnv = process.env.NODE_ENV;
  const previousIdleDays = process.env.SESSION_IDLE_TTL_DAYS;
  process.env.AUTH_DATA_FILE = dataFile;
  process.env.NODE_ENV = "test";
  process.env.SESSION_IDLE_TTL_DAYS = "7";

  const { server, SESSION_IDLE_TTL_MS } = await import(`../server.mjs?auth-test=${Date.now()}`);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
    restoreEnvironment("AUTH_DATA_FILE", previousDataFile);
    restoreEnvironment("NODE_ENV", previousNodeEnv);
    restoreEnvironment("SESSION_IDLE_TTL_DAYS", previousIdleDays);
  });

  const health = await request(baseUrl, "/api/health");
  assert.equal(health.status, 200);
  assert.equal(health.data.features.passwordReset, true);
  assert.equal(health.data.features.sessionIdleTimeoutDays, 7);

  const email = "reset-user@example.com";
  const registration = await request(baseUrl, "/api/auth/register", {
    email,
    password: "old-password",
  });
  assert.equal(registration.status, 201);
  const originalToken = registration.data.token;

  const firstDatabase = JSON.parse(await readFile(dataFile, "utf8"));
  const firstExpiry = firstDatabase.sessions[0].expiresAt;
  assert.ok(firstExpiry - Date.now() <= SESSION_IDLE_TTL_MS);
  assert.ok(firstExpiry - Date.now() > SESSION_IDLE_TTL_MS - 2_000);

  await delay(20);
  const rememberedSession = await request(baseUrl, "/api/auth/me", undefined, originalToken);
  assert.equal(rememberedSession.status, 200);
  const touchedDatabase = JSON.parse(await readFile(dataFile, "utf8"));
  assert.ok(touchedDatabase.sessions[0].expiresAt > firstExpiry);

  const unknownReset = await request(baseUrl, "/api/auth/password-reset/request", {
    email: "nobody@example.com",
  });
  assert.equal(unknownReset.status, 200);
  assert.equal("developmentCode" in unknownReset.data, false);

  const resetRequest = await request(baseUrl, "/api/auth/password-reset/request", { email });
  assert.equal(resetRequest.status, 200);
  assert.match(resetRequest.data.developmentCode, /^\d{6}$/);

  const reset = await request(baseUrl, "/api/auth/password-reset", {
    email,
    code: resetRequest.data.developmentCode,
    newPassword: "new-password",
  });
  assert.equal(reset.status, 200);

  const invalidatedSession = await request(baseUrl, "/api/auth/me", undefined, originalToken);
  assert.equal(invalidatedSession.status, 401);
  const oldLogin = await request(baseUrl, "/api/auth/login", { email, password: "old-password" });
  assert.equal(oldLogin.status, 401);
  const newLogin = await request(baseUrl, "/api/auth/login", { email, password: "new-password" });
  assert.equal(newLogin.status, 200);
});

async function request(baseUrl, path, body, token = "") {
  const response = await fetch(`${baseUrl}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: response.status,
    data: await response.json(),
  };
}

function restoreEnvironment(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
