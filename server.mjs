import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || process.env.AUTH_PORT || 3001);
const DATA_FILE = resolve(process.env.AUTH_DATA_FILE || resolve(__dirname, "data/auth-db.json"));
const PRIVACY_FILE = resolve(__dirname, "public/privacy.html");
const DATABASE_URL = process.env.DATABASE_URL || "";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const PASSWORD_ITERATIONS = 120000;

const { Pool } = pg;
const pool = DATABASE_URL ? new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
}) : null;
let postgresReady;

const defaultDb = { users: [], sessions: [] };

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
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
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
      if (data.length > 10000) {
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

function hashPassword(password, salt) {
  return pbkdf2Sync(String(password), salt, PASSWORD_ITERATIONS, 32, "sha256").toString("hex");
}

function passwordMatches(password, user) {
  const expected = Buffer.from(user.passwordHash, "hex");
  const actual = Buffer.from(hashPassword(password, user.salt), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
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
  })();
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

async function createSession(userId) {
  const now = Date.now();
  const token = randomBytes(32).toString("hex");
  const session = {
    token,
    userId,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
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
      `SELECT users.*
       FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.token = $1 AND sessions.expires_at > $2`,
      [token, now],
    );
    return rowToUser(result.rows[0]);
  }

  const db = loadDb();
  const session = db.sessions.find((item) => item.token === token && item.expiresAt > now);
  if (!session) return null;
  return db.users.find((user) => user.id === session.userId) || null;
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
  saveDb(db);
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

  const salt = randomBytes(16).toString("hex");
  const user = {
    id: randomBytes(12).toString("hex"),
    email,
    salt,
    passwordHash: hashPassword(password, salt),
    createdAt: new Date().toISOString(),
  };
  await insertUser(user);
  const token = await createSession(user.id);
  return sendJson(response, 201, { token, user: publicUser(user) });
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

async function handleHealth(response) {
  if (pool) await ensurePostgres();
  return sendJson(response, 200, { ok: true, storage: pool ? "postgres" : "json" });
}

function handlePrivacy(response) {
  return sendHtml(response, 200, readFileSync(PRIVACY_FILE, "utf8"));
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "OPTIONS") return sendJson(response, 204, {});
    if (request.url === "/api/health") return handleHealth(response);
    if ((request.url === "/privacy" || request.url === "/privacy.html") && request.method === "GET") return handlePrivacy(response);
    if (request.url === "/api/auth/register" && request.method === "POST") return handleRegister(request, response);
    if (request.url === "/api/auth/login" && request.method === "POST") return handleLogin(request, response);
    if (request.url === "/api/auth/me" && request.method === "GET") return handleMe(request, response);
    if (request.url === "/api/auth/me" && request.method === "DELETE") return handleDeleteMe(request, response);
    if (request.url === "/api/auth/logout" && request.method === "POST") return handleLogout(request, response);
    return sendJson(response, 404, { error: "Not found." });
  } catch (error) {
    return sendJson(response, 400, { error: error.message || "Request failed." });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Keyman auth backend running at http://127.0.0.1:${PORT}`);
});
