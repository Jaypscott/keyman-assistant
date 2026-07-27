import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

  const savedNotes = [{
    id: "note-one",
    title: "Arrival",
    body: "Bring the setup signs.",
    createdAt: "2026-07-20T13:00:00.000Z",
    updatedAt: "2026-07-20T13:05:00.000Z",
  }];
  const appDataSave = await request(baseUrl, "/api/app-data", {
    events: [],
    checks: {},
    notes: savedNotes,
    topic: "",
  }, originalToken, "PUT");
  assert.equal(appDataSave.status, 200);
  assert.deepEqual(appDataSave.data.notes, savedNotes);

  const legacyClientSave = await request(baseUrl, "/api/app-data", {
    events: [{ id: "legacy-event" }],
    checks: { "legacy-event": [true] },
    topic: "An older client value should not replace notes.",
  }, originalToken, "PUT");
  assert.equal(legacyClientSave.status, 200);
  assert.deepEqual(legacyClientSave.data.notes, savedNotes);
  assert.equal(legacyClientSave.data.topic, "");

  const restoredAppData = await request(baseUrl, "/api/app-data", undefined, originalToken);
  assert.equal(restoredAppData.status, 200);
  assert.deepEqual(restoredAppData.data.notes, savedNotes);
  assert.deepEqual(restoredAppData.data.events, [{ id: "legacy-event" }]);

  const legacyRegistration = await request(baseUrl, "/api/auth/register", {
    email: "legacy-topic@example.com",
    password: "legacy-password",
  });
  const legacyDatabase = JSON.parse(await readFile(dataFile, "utf8"));
  legacyDatabase.appData[legacyRegistration.data.user.id] = {
    events: [],
    checks: {},
    topic: "Review the legacy discussion topic.",
  };
  await writeFile(dataFile, JSON.stringify(legacyDatabase, null, 2));
  const migratedAppData = await request(
    baseUrl,
    "/api/app-data",
    undefined,
    legacyRegistration.data.token,
  );
  assert.equal(migratedAppData.status, 200);
  assert.equal(migratedAppData.data.topic, "");
  assert.equal(migratedAppData.data.notes.length, 1);
  assert.equal(migratedAppData.data.notes[0].title, "Discussion Topic");
  assert.equal(migratedAppData.data.notes[0].body, "Review the legacy discussion topic.");
  const migratedDatabase = JSON.parse(await readFile(dataFile, "utf8"));
  assert.equal(migratedDatabase.appData[legacyRegistration.data.user.id].topic, "");

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

async function request(baseUrl, path, body, token = "", method = body ? "POST" : "GET") {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
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
