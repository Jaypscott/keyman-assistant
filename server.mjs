import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || process.env.AUTH_PORT || 3001);
const DATA_FILE = resolve(process.env.AUTH_DATA_FILE || resolve(__dirname, "data/auth-db.json"));
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const PASSWORD_ITERATIONS = 120000;

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

function createSession(db, userId) {
  const now = Date.now();
  db.sessions = db.sessions.filter((session) => session.expiresAt > now);
  const token = randomBytes(32).toString("hex");
  db.sessions.push({
    token,
    userId,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  });
  return token;
}

function getSessionUser(request, db) {
  const header = request.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;

  const now = Date.now();
  const session = db.sessions.find((item) => item.token === token && item.expiresAt > now);
  if (!session) return null;
  return db.users.find((user) => user.id === session.userId) || null;
}

async function handleRegister(request, response) {
  const body = await readBody(request);
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  const error = validateCredentials(email, password);
  if (error) return sendJson(response, 400, { error });

  const db = loadDb();
  if (db.users.some((user) => user.email === email)) {
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
  db.users.push(user);
  const token = createSession(db, user.id);
  saveDb(db);
  return sendJson(response, 201, { token, user: publicUser(user) });
}

async function handleLogin(request, response) {
  const body = await readBody(request);
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  const error = validateCredentials(email, password);
  if (error) return sendJson(response, 400, { error });

  const db = loadDb();
  const user = db.users.find((item) => item.email === email);
  if (!user || !passwordMatches(password, user)) {
    return sendJson(response, 401, { error: "Email or password does not match." });
  }

  const token = createSession(db, user.id);
  saveDb(db);
  return sendJson(response, 200, { token, user: publicUser(user) });
}

function handleMe(request, response) {
  const db = loadDb();
  const user = getSessionUser(request, db);
  if (!user) return sendJson(response, 401, { error: "Sign in required." });
  return sendJson(response, 200, { user: publicUser(user) });
}

function handleDeleteMe(request, response) {
  const header = request.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const db = loadDb();
  const user = getSessionUser(request, db);
  if (!user) return sendJson(response, 401, { error: "Sign in required." });

  db.users = db.users.filter((item) => item.id !== user.id);
  db.sessions = db.sessions.filter((session) => session.userId !== user.id && session.token !== token);
  saveDb(db);
  return sendJson(response, 200, { ok: true });
}

async function handleLogout(request, response) {
  const header = request.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const db = loadDb();
  db.sessions = db.sessions.filter((session) => session.token !== token);
  saveDb(db);
  return sendJson(response, 200, { ok: true });
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "OPTIONS") return sendJson(response, 204, {});
    if (request.url === "/api/health") return sendJson(response, 200, { ok: true });
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
