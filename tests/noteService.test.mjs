import test from "node:test";
import assert from "node:assert/strict";

import {
  createNote,
  hasNoteContent,
  migrateLegacyTopic,
  normalizeNotes,
  noteDisplayTitle,
  removeNoteById,
  searchNotes,
  sortNotesByUpdated,
} from "../services/notes/noteService.mjs";

const earlier = "2026-07-20T13:00:00.000Z";
const later = "2026-07-21T13:00:00.000Z";

test("normalizes note data and removes empty or duplicate records", () => {
  const notes = normalizeNotes([
    { id: "one", title: "  ", body: "Keep this", createdAt: earlier, updatedAt: later },
    { id: "empty", title: " ", body: "\n", createdAt: earlier, updatedAt: later },
    { id: "one", title: "Duplicate", body: "", createdAt: earlier, updatedAt: later },
    null,
  ]);

  assert.deepEqual(notes, [{
    id: "one",
    title: "  ",
    body: "Keep this",
    createdAt: earlier,
    updatedAt: later,
  }]);
});

test("creates blank drafts, detects content, and supplies the untitled fallback", () => {
  const draft = createNote({ id: "draft", now: earlier });
  assert.equal(hasNoteContent(draft), false);
  assert.equal(noteDisplayTitle(draft), "Untitled Note");
  assert.equal(noteDisplayTitle({ title: "  Shift ideas  " }), "Shift ideas");
  assert.deepEqual(normalizeNotes([draft]), []);
});

test("migrates a legacy discussion topic exactly once and clears the old field", () => {
  const first = migrateLegacyTopic({
    notes: [],
    topic: "Review the new territory map.",
    now: earlier,
  });
  assert.equal(first.migrated, true);
  assert.equal(first.topic, "");
  assert.equal(first.notes.length, 1);
  assert.equal(first.notes[0].id, "legacy-topic");
  assert.equal(first.notes[0].title, "Discussion Topic");
  assert.equal(first.notes[0].body, "Review the new territory map.");

  const second = migrateLegacyTopic({
    notes: first.notes,
    topic: "Review the new territory map.",
    now: later,
  });
  assert.equal(second.notes.length, 1);
  assert.equal(second.topic, "");
});

test("sorts by most recent update and searches titles and bodies case-insensitively", () => {
  const notes = [
    { id: "old", title: "Parking", body: "Meet near the pier", createdAt: earlier, updatedAt: earlier },
    { id: "new", title: "UNF setup", body: "Bring the signs", createdAt: earlier, updatedAt: later },
  ];
  assert.deepEqual(sortNotesByUpdated(notes).map((note) => note.id), ["new", "old"]);
  assert.deepEqual(searchNotes(notes, "SIGNS").map((note) => note.id), ["new"]);
  assert.deepEqual(searchNotes(notes, "pier").map((note) => note.id), ["old"]);
});

test("removes a note by id without altering the remaining notes", () => {
  const notes = [
    { id: "one", title: "One", body: "", createdAt: earlier, updatedAt: earlier },
    { id: "two", title: "Two", body: "", createdAt: earlier, updatedAt: later },
  ];
  assert.deepEqual(removeNoteById(notes, "two").map((note) => note.id), ["one"]);
});
