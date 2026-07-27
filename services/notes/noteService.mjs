export const UNTITLED_NOTE_TITLE = "Untitled Note";
export const LEGACY_TOPIC_NOTE_ID = "legacy-topic";

export function createNote({ id = createNoteId(), now = new Date().toISOString() } = {}) {
  const timestamp = normalizeTimestamp(now, new Date().toISOString());
  return {
    id,
    title: "",
    body: "",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function normalizeNote(note, { index = 0, now = new Date().toISOString() } = {}) {
  if (!note || typeof note !== "object" || Array.isArray(note)) return null;
  const fallbackTimestamp = normalizeTimestamp(now, new Date().toISOString());
  const createdAt = normalizeTimestamp(note.createdAt, normalizeTimestamp(note.updatedAt, fallbackTimestamp));
  const updatedAt = normalizeTimestamp(note.updatedAt, createdAt);
  return {
    id: String(note.id || `note-${index + 1}`),
    title: String(note.title || ""),
    body: String(note.body || ""),
    createdAt,
    updatedAt,
  };
}

export function normalizeNotes(notes, options = {}) {
  if (!Array.isArray(notes)) return [];
  const seen = new Set();
  return notes.flatMap((note, index) => {
    const normalized = normalizeNote(note, { ...options, index });
    if (!normalized || !hasNoteContent(normalized) || seen.has(normalized.id)) return [];
    seen.add(normalized.id);
    return [normalized];
  });
}

export function migrateLegacyTopic({ notes, topic, now = new Date().toISOString() } = {}) {
  const normalizedNotes = normalizeNotes(notes, { now });
  const legacyBody = String(topic || "").trim();
  if (!legacyBody) return { notes: normalizedNotes, topic: "", migrated: false };

  const alreadyMigrated = normalizedNotes.some((note) => (
    note.id === LEGACY_TOPIC_NOTE_ID
    || (note.title === "Discussion Topic" && note.body.trim() === legacyBody)
  ));
  if (alreadyMigrated) return { notes: normalizedNotes, topic: "", migrated: true };

  const timestamp = normalizeTimestamp(now, new Date().toISOString());
  return {
    notes: [
      ...normalizedNotes,
      {
        id: LEGACY_TOPIC_NOTE_ID,
        title: "Discussion Topic",
        body: legacyBody,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    topic: "",
    migrated: true,
  };
}

export function noteDisplayTitle(note) {
  return String(note?.title || "").trim() || UNTITLED_NOTE_TITLE;
}

export function hasNoteContent(note) {
  return Boolean(String(note?.title || "").trim() || String(note?.body || "").trim());
}

export function sortNotesByUpdated(notes) {
  return [...normalizeNotes(notes)].sort((first, second) => (
    Date.parse(second.updatedAt) - Date.parse(first.updatedAt)
    || Date.parse(second.createdAt) - Date.parse(first.createdAt)
    || first.id.localeCompare(second.id)
  ));
}

export function searchNotes(notes, query) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  const sorted = sortNotesByUpdated(notes);
  if (!normalizedQuery) return sorted;
  return sorted.filter((note) => (
    `${note.title}\n${note.body}`.toLowerCase().includes(normalizedQuery)
  ));
}

export function removeNoteById(notes, id) {
  const target = String(id || "");
  return normalizeNotes(notes).filter((note) => note.id !== target);
}

export function mergeNotes(primary, secondary) {
  const byId = new Map();
  [...normalizeNotes(secondary), ...normalizeNotes(primary)].forEach((note) => {
    const existing = byId.get(note.id);
    if (!existing || Date.parse(note.updatedAt) >= Date.parse(existing.updatedAt)) {
      byId.set(note.id, note);
    }
  });
  return sortNotesByUpdated([...byId.values()]);
}

function normalizeTimestamp(value, fallback) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toISOString();
}

function createNoteId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `note-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
