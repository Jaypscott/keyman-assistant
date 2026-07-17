import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTH_TOKEN_KEY,
  getStoredAuthToken,
  removeStoredAuthToken,
  storeAuthToken,
} from "../services/auth/sessionTokenStorage.mjs";

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) || null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  };
}

test("auth tokens survive app closure in persistent storage", () => {
  const persistentStorage = createStorage();
  const legacySessionStorage = createStorage();

  storeAuthToken("remember-me", { persistentStorage, legacySessionStorage });

  assert.equal(persistentStorage.getItem(AUTH_TOKEN_KEY), "remember-me");
  assert.equal(legacySessionStorage.getItem(AUTH_TOKEN_KEY), null);
  assert.equal(getStoredAuthToken({ persistentStorage, legacySessionStorage }), "remember-me");
});

test("an existing session-only token is migrated and sign-out clears both stores", () => {
  const persistentStorage = createStorage();
  const legacySessionStorage = createStorage({ [AUTH_TOKEN_KEY]: "legacy-token" });

  assert.equal(getStoredAuthToken({ persistentStorage, legacySessionStorage }), "legacy-token");
  assert.equal(persistentStorage.getItem(AUTH_TOKEN_KEY), "legacy-token");
  assert.equal(legacySessionStorage.getItem(AUTH_TOKEN_KEY), null);

  removeStoredAuthToken({ persistentStorage, legacySessionStorage });
  assert.equal(persistentStorage.getItem(AUTH_TOKEN_KEY), null);
  assert.equal(legacySessionStorage.getItem(AUTH_TOKEN_KEY), null);
});
