export const AUTH_TOKEN_KEY = "keyman-auth-token";

export function getStoredAuthToken({
  persistentStorage = globalThis.localStorage,
  legacySessionStorage = globalThis.sessionStorage,
} = {}) {
  const persistentToken = readStorage(persistentStorage, AUTH_TOKEN_KEY);
  if (persistentToken) return persistentToken;

  const legacyToken = readStorage(legacySessionStorage, AUTH_TOKEN_KEY);
  if (!legacyToken) return "";

  // Earlier app versions used sessionStorage, which iOS can clear whenever the
  // WebView closes. Migrate an existing live token so the next close/reopen is
  // remembered without forcing an extra sign-in.
  if (writeStorage(persistentStorage, AUTH_TOKEN_KEY, legacyToken)) {
    removeStorage(legacySessionStorage, AUTH_TOKEN_KEY);
  }
  return legacyToken;
}

export function storeAuthToken(token, {
  persistentStorage = globalThis.localStorage,
  legacySessionStorage = globalThis.sessionStorage,
} = {}) {
  const storedPersistently = writeStorage(persistentStorage, AUTH_TOKEN_KEY, String(token || ""));
  if (!storedPersistently) {
    writeStorage(legacySessionStorage, AUTH_TOKEN_KEY, String(token || ""));
    return;
  }
  removeStorage(legacySessionStorage, AUTH_TOKEN_KEY);
}

export function removeStoredAuthToken({
  persistentStorage = globalThis.localStorage,
  legacySessionStorage = globalThis.sessionStorage,
} = {}) {
  removeStorage(persistentStorage, AUTH_TOKEN_KEY);
  removeStorage(legacySessionStorage, AUTH_TOKEN_KEY);
}

function readStorage(storage, key) {
  try {
    return storage?.getItem(key) || "";
  } catch {
    return "";
  }
}

function writeStorage(storage, key, value) {
  try {
    storage?.setItem(key, value);
    return Boolean(storage);
  } catch {
    return false;
  }
}

function removeStorage(storage, key) {
  try {
    storage?.removeItem(key);
  } catch {
    // Storage cleanup is best-effort when a browser blocks access.
  }
}
