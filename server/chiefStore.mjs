import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export const newConversation = () => ({ id: randomUUID(), messages: [], drafts: [], results: {}, sessionId: null, lastTurnId: null, run: null, retiredSessions: [], updatedAt: Date.now() });

// A separate record prevents app-data PUTs and auth writes from overwriting chat.
export function createChiefStore({ pool, ensurePostgres = async () => {}, file }) {
  let ready;
  async function prepare() {
    if (!pool) return;
    await ensurePostgres();
    ready ||= pool.query(`CREATE TABLE IF NOT EXISTS chief_conversations (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      document JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    try { await ready; } catch (e) { ready = null; throw e; }
  }
  const load = () => existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const save = data => {
    mkdirSync(dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(data), { mode: 0o600 });
    renameSync(temp, file);
  };
  return {
    async read(userId) {
      await prepare();
      if (pool) return (await pool.query('SELECT document FROM chief_conversations WHERE user_id=$1', [userId])).rows[0]?.document ?? null;
      return load()[userId] ?? null;
    },
    async mutate(userId, change) {
      await prepare();
      if (!pool) {
        // Synchronous read/change/write: no interleaving with another request in this process.
        const all = load(), doc = all[userId] || newConversation();
        const next = change(doc);
        if (next === null) delete all[userId]; else all[userId] = next ?? doc;
        save(all);
        return structuredClone(next === null ? null : all[userId]);
      }
      const db = await pool.connect();
      try {
        await db.query('BEGIN');
        await db.query('INSERT INTO chief_conversations (user_id,document) VALUES ($1,$2) ON CONFLICT DO NOTHING', [userId, JSON.stringify(newConversation())]);
        const doc = (await db.query('SELECT document FROM chief_conversations WHERE user_id=$1 FOR UPDATE', [userId])).rows[0].document;
        const next = change(doc);
        if (next === null) await db.query('DELETE FROM chief_conversations WHERE user_id=$1', [userId]);
        else await db.query('UPDATE chief_conversations SET document=$2,updated_at=NOW() WHERE user_id=$1', [userId, JSON.stringify(next ?? doc)]);
        await db.query('COMMIT');
        return next === null ? null : next ?? doc;
      } catch (e) { await db.query('ROLLBACK'); throw e; }
      finally { db.release(); }
    },
  };
}
