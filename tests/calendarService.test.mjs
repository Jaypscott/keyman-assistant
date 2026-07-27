import test from "node:test";
import assert from "node:assert/strict";

import {
  calendarMonthCells,
  eventsForDate,
  eventsForMonth,
  monthStartISO,
  shiftCalendarDateByMonth,
} from "../services/calendar/calendarService.mjs";

test("keeps the selected day when changing months and clamps shorter months", () => {
  assert.equal(shiftCalendarDateByMonth("2026-07-26", -1), "2026-06-26");
  assert.equal(shiftCalendarDateByMonth("2026-01-31", 1), "2026-02-28");
  assert.equal(shiftCalendarDateByMonth("2024-01-31", 1), "2024-02-29");
});

test("crosses calendar years without UTC date drift", () => {
  assert.equal(shiftCalendarDateByMonth("2026-01-15", -1), "2025-12-15");
  assert.equal(shiftCalendarDateByMonth("2026-12-15", 1), "2027-01-15");
  assert.equal(monthStartISO("2027-01-15"), "2027-01-01");
});

test("builds an accurate Sunday-first month grid", () => {
  const july = calendarMonthCells("2026-07-01");
  assert.equal(july.length, 34);
  assert.deepEqual(july.slice(0, 4), [null, null, null, "2026-07-01"]);
  assert.equal(july.at(-1), "2026-07-31");
});

test("filters events to the displayed month", () => {
  const events = [
    { id: "june", date: "2026-06-30" },
    { id: "july-1", date: "2026-07-01" },
    { id: "july-26", date: "2026-07-26" },
    { id: "august", date: "2026-08-01" },
  ];
  assert.deepEqual(
    eventsForMonth(events, "2026-07-26").map((event) => event.id),
    ["july-1", "july-26"],
  );
});

test("groups selected-day events and orders them by start time", () => {
  const events = [
    { id: "afternoon", date: "2026-07-26", start: "15:00", end: "18:00" },
    { id: "other-day", date: "2026-07-27", start: "09:00", end: "12:00" },
    { id: "morning", date: "2026-07-26", start: "09:00", end: "12:00" },
    { id: "midday", date: "2026-07-26", start: "12:00", end: "15:00" },
  ];
  assert.deepEqual(
    eventsForDate(events, "2026-07-26").map((event) => event.id),
    ["morning", "midday", "afternoon"],
  );
  assert.equal(eventsForDate(events, "2026-07-27").length, 1);
});
