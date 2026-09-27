import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import pg from "pg";
import {
  createPasswordRecord,
  createResetCode,
  hashResetCode,
  passwordMatches,
  resetCodeMatches,
} from "./server/passwordSecurity.mjs";
import { fetchWeather, parseWeatherRequest } from "./server/weatherProxy.mjs";
import { migrateLegacyTopic } from "./services/notes/noteService.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || process.env.AUTH_PORT || 3001);
const DATA_FILE = resolve(process.env.AUTH_DATA_FILE || resolve(__dirname, "data/auth-db.json"));
const PRIVACY_FILE = resolve(__dirname, "public/privacy.html");
const DATABASE_URL = process.env.DATABASE_URL || "";
const configuredSessionIdleDays = Number(process.env.SESSION_IDLE_TTL_DAYS || 7);
export const SESSION_IDLE_TTL_MS = (
  Number.isFinite(configuredSessionIdleDays) && configuredSessionIdleDays > 0
    ? configuredSessionIdleDays
    : 7
) * 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 15 * 60 * 1000;
const PASSWORD_RESET_COOLDOWN_MS = 60 * 1000;
const PASSWORD_RESET_MAX_ATTEMPTS = 5;
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const PASSWORD_RESET_FROM_EMAIL = process.env.PASSWORD_RESET_FROM_EMAIL || "";
const PASSWORD_RESET_SECRET = process.env.PASSWORD_RESET_SECRET
  || (process.env.NODE_ENV === "production" ? "" : "keyman-local-reset-secret");

const { Pool } = pg;
const pool = DATABASE_URL ? new Pool({
  connectionString: DATABASE_URL,
  connectionTimeoutMillis: 1000,
  statement_timeout: 2000,
  query_timeout: 3000,
  ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
}) : null;
// Never log the client or raw database errors: they can contain credentials or SQL data.
pool?.on("error", (error) => {
  console.error(JSON.stringify({ event: "database_pool_error", code: safeErrorCode(error) }));
});
let postgresReady;

function safeErrorCode(error) {
  return /^[A-Z0-9_]{2,40}$/.test(error?.code || "") ? error.code : "UNKNOWN";
}

const defaultDb = { users: [], sessions: [], appData: {}, passwordResets: {} };

function loadDb() {
  try {
    if (!existsSync(DATA_FILE)) return structuredClone(defaultDb);
    return { ...structuredClone(defaultDb), ...JSON.parse(readFileSync(DATA_FILE, "utf8")) };
  } catch {
    return structuredClone(defaultDb);
  }
}

function saveDb(db) {
  mkdirSync(dirname(DATA_FILE), { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Content-Type": "application/json",
  });
  response.end(JSON.stringify(body));
}

function sendHtml(response, status, html) {
  response.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
  });
  response.end(html);
}

function readBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    let data = "";
    request.on("data", (chunk) => {
      data += chunk;
      if (data.length > 250000) {
        request.destroy();
        rejectBody(new Error("Request body is too large."));
      }
    });
    request.on("end", () => {
      try {
        resolveBody(data ? JSON.parse(data) : {});
      } catch {
        rejectBody(new Error("Invalid JSON."));
      }
    });
  });
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function validateCredentials(email, password) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email address.";
  if (String(password || "").length < 6) return "Password must be at least 6 characters.";
  return "";
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
  };
}

function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    salt: row.salt,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
  };
}

async function ensurePostgres() {
  if (!pool) return;
  postgresReady ||= (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL
      )
    `);
    await pool.query("CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id)");
    await pool.query("CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at)");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL,
        expires_at BIGINT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        requested_at BIGINT NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_data (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        events JSONB NOT NULL DEFAULT '[]'::jsonb,
        checks JSONB NOT NULL DEFAULT '{}'::jsonb,
        topic TEXT NOT NULL DEFAULT '',
        notes JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query("ALTER TABLE app_data ADD COLUMN IF NOT EXISTS notes JSONB NOT NULL DEFAULT '[]'::jsonb");
    await pool.query(`
      UPDATE app_data
      SET
        notes = notes || jsonb_build_array(jsonb_build_object(
          'id', 'legacy-topic',
          'title', 'Discussion Topic',
          'body', topic,
          'createdAt', updated_at,
          'updatedAt', updated_at
        )),
        topic = ''
      WHERE BTRIM(topic) <> ''
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(notes) AS note
          WHERE note->>'id' = 'legacy-topic'
             OR (note->>'title' = 'Discussion Topic' AND BTRIM(note->>'body') = BTRIM(topic))
        )
    `);
    await pool.query("UPDATE app_data SET topic = '' WHERE BTRIM(topic) <> ''");
  })().catch((error) => {
    // A transient initialization failure must not poison every later request.
    postgresReady = undefined;
    throw error;
  });
  return postgresReady;
}

async function findUserByEmail(email) {
  if (pool) {
    await ensurePostgres();
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    return rowToUser(result.rows[0]);
  }
  const db = loadDb();
  return db.users.find((user) => user.email === email) || null;
}

async function insertUser(user) {
  if (pool) {
    await ensurePostgres();
    await pool.query(
      "INSERT INTO users (id, email, salt, password_hash, created_at) VALUES ($1, $2, $3, $4, $5)",
      [user.id, user.email, user.salt, user.passwordHash, user.createdAt],
    );
    return;
  }
  const db = loadDb();
  db.users.push(user);
  saveDb(db);
}

const localResetLocks = new Map();
async function withPasswordResetLock(userId, action) {
  if (pool) {
    await ensurePostgres();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const user = await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [userId]);
      const result = user.rows.length ? await action(client) : null;
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  const previous = localResetLocks.get(userId) || Promise.resolve();
  const pending = previous.catch(() => {}).then(() => action(null));
  localResetLocks.set(userId, pending);
  try { return await pending; }
  finally { if (localResetLocks.get(userId) === pending) localResetLocks.delete(userId); }
}

function passwordResetConfigured() {
  return Boolean(PASSWORD_RESET_SECRET && (process.env.NODE_ENV !== "production"
    || (RESEND_API_KEY && PASSWORD_RESET_FROM_EMAIL)));
}

async function getPasswordReset(userId, client = pool) {
  if (pool) {
    await ensurePostgres();
    const result = await client.query(
      "SELECT token_hash, expires_at, attempts, requested_at FROM password_reset_tokens WHERE user_id = $1",
      [userId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      tokenHash: row.token_hash,
      expiresAt: Number(row.expires_at),
      attempts: Number(row.attempts),
      requestedAt: Number(row.requested_at),
    };
  }
  const db = loadDb();
  return db.passwordResets?.[userId] || null;
}

async function savePasswordReset(userId, reset, client = pool) {
  if (pool) {
    await ensurePostgres();
    await client.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, attempts, requested_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE SET
         token_hash = EXCLUDED.token_hash,
         expires_at = EXCLUDED.expires_at,
         attempts = EXCLUDED.attempts,
         requested_at = EXCLUDED.requested_at`,
      [userId, reset.tokenHash, reset.expiresAt, reset.attempts, reset.requestedAt],
    );
    return;
  }
  const db = loadDb();
  db.passwordResets = db.passwordResets || {};
  db.passwordResets[userId] = reset;
  saveDb(db);
}

async function incrementPasswordResetAttempts(userId, client = pool) {
  if (pool) {
    await ensurePostgres();
    await client.query(
      "UPDATE password_reset_tokens SET attempts = attempts + 1 WHERE user_id = $1",
      [userId],
    );
    return;
  }
  const db = loadDb();
  if (db.passwordResets?.[userId]) {
    db.passwordResets[userId].attempts += 1;
    saveDb(db);
  }
}

async function deletePasswordReset(userId, client = pool) {
  if (pool) {
    await ensurePostgres();
    await client.query("DELETE FROM password_reset_tokens WHERE user_id = $1", [userId]);
    return;
  }
  const db = loadDb();
  if (db.passwordResets) delete db.passwordResets[userId];
  saveDb(db);
}

async function completePasswordReset(userId, passwordRecord, client = pool) {
  if (pool) {
    await ensurePostgres();
    await client.query(
      "UPDATE users SET salt = $1, password_hash = $2 WHERE id = $3",
      [passwordRecord.salt, passwordRecord.passwordHash, userId],
    );
    await client.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
    await client.query("DELETE FROM password_reset_tokens WHERE user_id = $1", [userId]);
    return;
  }

  const db = loadDb();
  const user = db.users.find((item) => item.id === userId);
  if (!user) throw new Error("Account no longer exists.");
  user.salt = passwordRecord.salt;
  user.passwordHash = passwordRecord.passwordHash;
  db.sessions = db.sessions.filter((session) => session.userId !== userId);
  if (db.passwordResets) delete db.passwordResets[userId];
  saveDb(db);
}

async function sendPasswordResetEmail(email, code, userId, requestedAt) {
  // Ownership verification must fail closed in production. The reset code is
  // exposed only outside production so local development can test the flow
  // before transactional email credentials are configured.
  if (!RESEND_API_KEY || !PASSWORD_RESET_FROM_EMAIL) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Password reset email is not configured.");
    }
    return false;
  }

  const emailResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `password-reset-${userId}-${requestedAt}`,
    },
    body: JSON.stringify({
      from: PASSWORD_RESET_FROM_EMAIL,
      to: [email],
      subject: "Keyman Assistant password reset code",
      text: `Your Keyman Assistant password reset code is ${code}. It expires in 15 minutes. If you did not request this code, you can ignore this email.`,
    }),
  });
  if (!emailResponse.ok) {
    throw new Error(`Unable to send password reset email (HTTP ${emailResponse.status}).`);
  }
  return true;
}

async function createSession(userId) {
  const now = Date.now();
  const token = randomBytes(32).toString("hex");
  const session = {
    token,
    userId,
    createdAt: now,
    expiresAt: now + SESSION_IDLE_TTL_MS,
  };
  if (pool) {
    await ensurePostgres();
    await pool.query("DELETE FROM sessions WHERE expires_at <= $1", [now]);
    await pool.query(
      "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)",
      [session.token, session.userId, session.createdAt, session.expiresAt],
    );
    return token;
  }

  const db = loadDb();
  db.sessions = db.sessions.filter((item) => item.expiresAt > now);
  db.sessions.push({
    token: session.token,
    userId: session.userId,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
  });
  saveDb(db);
  return token;
}

async function getSessionUser(request) {
  const header = request.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;

  const now = Date.now();
  if (pool) {
    await ensurePostgres();
    await pool.query("DELETE FROM sessions WHERE expires_at <= $1", [now]);
    const result = await pool.query(
      `WITH active_session AS (
         UPDATE sessions
         SET expires_at = $3
         WHERE token = $1 AND expires_at > $2
         RETURNING user_id
       )
       SELECT users.*
       FROM active_session
       JOIN users ON users.id = active_session.user_id`,
      [token, now, now + SESSION_IDLE_TTL_MS],
    );
    return rowToUser(result.rows[0]);
  }

  const db = loadDb();
  const session = db.sessions.find((item) => item.token === token && item.expiresAt > now);
  if (!session) return null;
  const user = db.users.find((item) => item.id === session.userId) || null;
  if (!user) return null;
  session.expiresAt = now + SESSION_IDLE_TTL_MS;
  saveDb(db);
  return user;
}

async function deleteSession(token) {
  if (pool) {
    await ensurePostgres();
    await pool.query("DELETE FROM sessions WHERE token = $1", [token]);
    return;
  }
  const db = loadDb();
  db.sessions = db.sessions.filter((session) => session.token !== token);
  saveDb(db);
}

async function deleteUserAccount(userId, token) {
  if (pool) {
    await ensurePostgres();
    await pool.query("DELETE FROM sessions WHERE user_id = $1 OR token = $2", [userId, token]);
    await pool.query("DELETE FROM users WHERE id = $1", [userId]);
    return;
  }
  const db = loadDb();
  db.users = db.users.filter((item) => item.id !== userId);
  db.sessions = db.sessions.filter((session) => session.userId !== userId && session.token !== token);
  if (db.appData) delete db.appData[userId];
  saveDb(db);
}

function normalizeAppData(body = {}) {
  const migrated = migrateLegacyTopic({
    notes: body.notes,
    topic: body.topic,
  });
  return {
    events: Array.isArray(body.events) ? body.events : [],
    checks: body.checks && typeof body.checks === "object" && !Array.isArray(body.checks) ? body.checks : {},
    notes: migrated.notes,
    topic: "",
  };
}

function rowToAppData(row) {
  return normalizeAppData(row);
}

async function getUserAppData(userId) {
  if (pool) {
    await ensurePostgres();
    const result = await pool.query("SELECT events, checks, notes, topic FROM app_data WHERE user_id = $1", [userId]);
    return rowToAppData(result.rows[0]);
  }
  const db = loadDb();
  const stored = db.appData?.[userId];
  const appData = normalizeAppData(stored);
  if (stored && (String(stored.topic || "").trim() || !Array.isArray(stored.notes))) {
    db.appData[userId] = appData;
    saveDb(db);
  }
  return appData;
}

async function saveUserAppData(userId, data) {
  const includesNotes = Object.prototype.hasOwnProperty.call(data, "notes");
  const appData = normalizeAppData({
    ...data,
    notes: includesNotes ? data.notes : [],
    topic: includesNotes ? data.topic : "",
  });
  if (pool) {
    await ensurePostgres();
    const result = await pool.query(
      `INSERT INTO app_data (user_id, events, checks, notes, topic, updated_at)
       VALUES ($1, $2, $3, $4, '', NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         events = EXCLUDED.events,
         checks = EXCLUDED.checks,
         notes = CASE WHEN $5 THEN EXCLUDED.notes ELSE app_data.notes END,
         topic = '',
         updated_at = NOW()
       RETURNING events, checks, notes, topic`,
      [
        userId,
        JSON.stringify(appData.events),
        JSON.stringify(appData.checks),
        JSON.stringify(appData.notes),
        includesNotes,
      ],
    );
    return rowToAppData(result.rows[0]);
  }
  const db = loadDb();
  db.appData = db.appData || {};
  const existing = normalizeAppData(db.appData[userId]);
  db.appData[userId] = {
    ...appData,
    notes: includesNotes ? appData.notes : existing.notes,
    topic: "",
  };
  saveDb(db);
  return db.appData[userId];
}

async function handleRegister(request, response) {
  const body = await readBody(request);
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  const error = validateCredentials(email, password);
  if (error) return sendJson(response, 400, { error });

  if (await findUserByEmail(email)) {
    return sendJson(response, 409, { error: "An account already exists for that email." });
  }

  const passwordRecord = createPasswordRecord(password);
  const user = {
    id: randomBytes(12).toString("hex"),
    email,
    ...passwordRecord,
    createdAt: new Date().toISOString(),
  };
  await insertUser(user);
  const token = await createSession(user.id);
  return sendJson(response, 201, { token, user: publicUser(user) });
}

async function handlePasswordResetRequest(request, response) {
  const body = await readBody(request);
  const email = normalizeEmail(body.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return sendJson(response, 400, { error: "Enter a valid email address." });
  }
  // Check service configuration before account lookup to avoid disclosing account existence.
  if (!passwordResetConfigured()) {
    return sendJson(response, 503, {
      error: "Password reset email is temporarily unavailable. Please try again later.",
      code: "PASSWORD_RESET_UNAVAILABLE",
    });
  }
  const receipt = { ok: true, expiresInSeconds: PASSWORD_RESET_TTL_MS / 1000,
    retryAfterSeconds: PASSWORD_RESET_COOLDOWN_MS / 1000 };
  const user = await findUserByEmail(email);
  if (!user) return sendJson(response, 200, receipt);
  const code = createResetCode();
  const reset = await withPasswordResetLock(user.id, async (client) => {
    const now = Date.now();
    const existing = await getPasswordReset(user.id, client);
    if (existing && now - existing.requestedAt < PASSWORD_RESET_COOLDOWN_MS) return null;
    const next = { tokenHash: hashResetCode(code, PASSWORD_RESET_SECRET),
      expiresAt: now + PASSWORD_RESET_TTL_MS, attempts: 0, requestedAt: now };
    await savePasswordReset(user.id, next, client);
    return next;
  });
  // Return the same receipt during cooldown; do not reveal which addresses have accounts.
  if (!reset) return sendJson(response, 200, receipt);
  try {
    // Email delivery is outside the transaction: no database lock is held across network I/O.
    const delivered = await sendPasswordResetEmail(email, code, user.id, reset.requestedAt);
    return sendJson(response, 200, { ...receipt, developmentCode: delivered ? undefined : code });
  } catch {
    await withPasswordResetLock(user.id, async (client) => {
      const current = await getPasswordReset(user.id, client);
      if (current?.tokenHash === reset.tokenHash && current.requestedAt === reset.requestedAt) {
        await deletePasswordReset(user.id, client);
      }
    });
    console.error(JSON.stringify({ event: "password_reset_delivery_failed" }));
    return sendJson(response, 503, {
      error: "Password reset email is temporarily unavailable. Please try again later.",
      code: "PASSWORD_RESET_DELIVERY_FAILED",
    });
  }
}

async function handlePasswordReset(request, response) {
  const body = await readBody(request);
  const email = normalizeEmail(body.email);
  const code = String(body.code || "").trim();
  const newPassword = String(body.newPassword || "");
  const error = validateCredentials(email, newPassword);
  if (error) return sendJson(response, 400, { error });
  if (!/^\d{6}$/.test(code)) return sendJson(response, 400, { error: "Enter the six-digit reset code." });
  if (!passwordResetConfigured()) return sendJson(response, 503, {
    error: "Password reset email is temporarily unavailable. Please try again later.",
    code: "PASSWORD_RESET_UNAVAILABLE",
  });
  const user = await findUserByEmail(email);
  const valid = user && await withPasswordResetLock(user.id, async (client) => {
    const reset = await getPasswordReset(user.id, client);
    if (!reset || reset.expiresAt <= Date.now() || reset.attempts >= PASSWORD_RESET_MAX_ATTEMPTS) {
      if (reset) await deletePasswordReset(user.id, client);
      return false;
    }
    if (!resetCodeMatches(code, reset.tokenHash, PASSWORD_RESET_SECRET)) {
      await incrementPasswordResetAttempts(user.id, client);
      return false;
    }
    await completePasswordReset(user.id, createPasswordRecord(newPassword), client);
    return true;
  });
  if (!valid) return sendJson(response, 400, {
    error: "Reset code is invalid or expired. Check the code or request a new one.",
    code: "INVALID_RESET_CODE",
  });
  return sendJson(response, 200, { ok: true });
}

async function handleLogin(request, response) {
  const body = await readBody(request);
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  const error = validateCredentials(email, password);
  if (error) return sendJson(response, 400, { error });

  const user = await findUserByEmail(email);
  if (!user || !passwordMatches(password, user)) {
    return sendJson(response, 401, { error: "Email or password does not match." });
  }

  const token = await createSession(user.id);
  return sendJson(response, 200, { token, user: publicUser(user) });
}

async function handleMe(request, response) {
  const user = await getSessionUser(request);
  if (!user) return sendJson(response, 401, { error: "Sign in required." });
  return sendJson(response, 200, { user: publicUser(user) });
}

async function handleDeleteMe(request, response) {
  const header = request.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const user = await getSessionUser(request);
  if (!user) return sendJson(response, 401, { error: "Sign in required." });

  await deleteUserAccount(user.id, token);
  return sendJson(response, 200, { ok: true });
}

async function handleLogout(request, response) {
  const header = request.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  await deleteSession(token);
  return sendJson(response, 200, { ok: true });
}

async function handleGetAppData(request, response) {
  const user = await getSessionUser(request);
  if (!user) return sendJson(response, 401, { error: "Sign in required." });
  return sendJson(response, 200, await getUserAppData(user.id));
}

async function handleSaveAppData(request, response) {
  const user = await getSessionUser(request);
  if (!user) return sendJson(response, 401, { error: "Sign in required." });
  const body = await readBody(request);
  return sendJson(response, 200, await saveUserAppData(user.id, body));
}

async function handleHealth(response) {
  if (pool) {
    let timer;
    try {
      await Promise.race([
        (async () => {
          await ensurePostgres();
          await pool.query("SELECT 1");
        })(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("Health check timed out.")), 4000);
        }),
      ]);
    } catch (error) {
      console.error(JSON.stringify({ event: "database_health_error", code: safeErrorCode(error) }));
      return sendJson(response, 503, { ok: false, error: "Database temporarily unavailable." });
    } finally {
      clearTimeout(timer);
    }
  }
  return sendJson(response, 200, {
    ok: true,
    storage: pool ? "postgres" : "json",
    features: {
      passwordReset: passwordResetConfigured(),
      sessionIdleTimeoutDays: SESSION_IDLE_TTL_MS / (24 * 60 * 60 * 1000),
    },
  });
}

async function handleWeather(request, response) {
  try {
    const location = parseWeatherRequest(request.url);
    return sendJson(response, 200, await fetchWeather(location));
  } catch (error) {
    const isInvalidLocation = error.message === "Invalid weather location.";
    return sendJson(response, isInvalidLocation ? 400 : 503, {
      error: isInvalidLocation ? error.message : "Weather is temporarily unavailable.",
    });
  }
}

function handlePrivacy(response) {
  return sendHtml(response, 200, readFileSync(PRIVACY_FILE, "utf8"));
}

export const server = createServer(async (request, response) => {
  const startedAt = performance.now();
  // Restrict log paths to known routes; omit query strings, bodies, and headers.
  const path = request.url?.split("?")[0];
  const route = ["/api/health", "/api/weather", "/privacy", "/privacy.html",
    "/api/auth/register", "/api/auth/login", "/api/auth/password-reset/request",
    "/api/auth/password-reset", "/api/auth/me", "/api/auth/logout", "/api/app-data",
  ].includes(path) ? path : "unmatched";
  const logSlowRequest = (event) => console.warn(JSON.stringify({
    event, route, durationMs: Math.round(performance.now() - startedAt),
    status: response.writableFinished ? response.statusCode : undefined,
  }));
  const slowTimer = setTimeout(() => logSlowRequest("slow_request_pending"), 1000);
  slowTimer.unref();
  response.once("close", () => {
    clearTimeout(slowTimer);
    if (performance.now() - startedAt >= 1000) logSlowRequest("slow_request_completed");
  });
  try {
    if (request.method === "OPTIONS") return sendJson(response, 204, {});
    if (request.url === "/api/health") return await handleHealth(response);
    if (request.url?.startsWith("/api/weather?") && request.method === "GET") return await handleWeather(request, response);
    if ((request.url === "/privacy" || request.url === "/privacy.html") && request.method === "GET") return await handlePrivacy(response);
    if (request.url === "/api/auth/register" && request.method === "POST") return await handleRegister(request, response);
    if (request.url === "/api/auth/login" && request.method === "POST") return await handleLogin(request, response);
    if (request.url === "/api/auth/password-reset/request" && request.method === "POST") return await handlePasswordResetRequest(request, response);
    if (request.url === "/api/auth/password-reset" && request.method === "POST") return await handlePasswordReset(request, response);
    if (request.url === "/api/auth/me" && request.method === "GET") return await handleMe(request, response);
    if (request.url === "/api/auth/me" && request.method === "DELETE") return await handleDeleteMe(request, response);
    if (request.url === "/api/auth/logout" && request.method === "POST") return await handleLogout(request, response);
    if (request.url === "/api/app-data" && request.method === "GET") return await handleGetAppData(request, response);
    if (request.url === "/api/app-data" && request.method === "PUT") return await handleSaveAppData(request, response);
    return sendJson(response, 404, { error: "Not found." });
  } catch (error) {
    const invalidBody = ["Invalid JSON.", "Request body is too large."].includes(error.message);
    if (!invalidBody) {
      console.error(JSON.stringify({ event: "request_error", route, code: safeErrorCode(error) }));
    }
    if (!response.destroyed && !response.writableEnded) {
      return sendJson(response, invalidBody ? 400 : 500, {
        error: invalidBody ? error.message : "Request failed. Please try again.",
      });
    }
  }
});

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Keyman auth backend running at http://127.0.0.1:${PORT}`);
  });
}
