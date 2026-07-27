import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateRotationIntervals,
  canUseScheduleActions,
  createSchedule,
} from "../services/schedule/rotationService.mjs";

test("divides a three-hour shift into each supported rotation length", () => {
  assert.equal(calculateRotationIntervals("09:00", "12:00", 15).length, 12);
  assert.equal(calculateRotationIntervals("09:00", "12:00", 20).length, 9);
  assert.equal(calculateRotationIntervals("09:00", "12:00", 30).length, 6);
});

test("divides the evening shift into each supported rotation length", () => {
  assert.equal(calculateRotationIntervals("18:00", "20:00", 15).length, 8);
  assert.equal(calculateRotationIntervals("18:00", "20:00", 20).length, 6);
  assert.equal(calculateRotationIntervals("18:00", "20:00", 30).length, 4);
});

test("supports arbitrary valid times and caps the final interval at shift end", () => {
  assert.deepEqual(
    calculateRotationIntervals("09:10", "10:00", 20),
    ["9:10am - 9:30am", "9:30am - 9:50am", "9:50am - 10:00am"],
  );
});

test("returns an empty interval list for invalid input", () => {
  assert.deepEqual(calculateRotationIntervals("nope", "12:00", 30), []);
  assert.deepEqual(calculateRotationIntervals("12:00", "09:00", 30), []);
  assert.deepEqual(calculateRotationIntervals("09:00", "12:00", 0), []);
});

test("only binds schedule actions when volunteer names are present", () => {
  assert.equal(canUseScheduleActions([], []), false);
  assert.equal(canUseScheduleActions([], ["Alex Morgan"]), true);
  assert.equal(canUseScheduleActions(null, ["Alex Morgan"]), false);
});

test("shows every volunteer in each rotation for eight-slot shifts", () => {
  const shift = {
    start: "18:00",
    end: "20:00",
    slots: 8,
    minutes: 20,
  };

  for (const volunteerCount of [7, 8]) {
    const names = Array.from({ length: volunteerCount }, (_, index) => `Volunteer ${index + 1}`);
    const schedule = createSchedule(names, shift);

    schedule.forEach((row) => {
      const assigned = [
        ...row.assignments.primary,
        ...row.assignments.secondary,
        ...row.assignments.informal,
      ];
      assert.equal(row.assignments.primary.length, 2);
      assert.equal(row.assignments.secondary.length, 2);
      assert.equal(row.assignments.informal.length, volunteerCount - 4);
      assert.deepEqual(assigned.slice().sort(), names.slice().sort());
    });
  }
});

test("primary-only mode uses Primary and Informal for a full crew", () => {
  const shift = {
    start: "10:00",
    end: "13:00",
    slots: 6,
    minutes: 30,
  };

  for (const volunteerCount of [6, 8]) {
    const names = Array.from({ length: volunteerCount }, (_, index) => `Volunteer ${index + 1}`);
    const schedule = createSchedule(names, shift, 30, { primaryOnly: true });
    const primaryCounts = Object.fromEntries(names.map((name) => [name, 0]));

    schedule.forEach((row) => {
      assert.deepEqual(Object.keys(row.assignments).sort(), ["informal", "primary"]);
      assert.equal(row.assignments.primary.length, 2);
      assert.equal(row.assignments.informal.length, volunteerCount - 2);
      assert.deepEqual(
        [...row.assignments.primary, ...row.assignments.informal].sort(),
        names.slice().sort(),
      );
      row.assignments.primary.forEach((name) => {
        primaryCounts[name] += 1;
      });
    });

    const counts = Object.values(primaryCounts);
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
  }
});

test("normal mode keeps Secondary assignments for a full six-person crew", () => {
  const names = Array.from({ length: 6 }, (_, index) => `Volunteer ${index + 1}`);
  const shift = {
    start: "10:00",
    end: "13:00",
    slots: 6,
    minutes: 30,
  };
  const schedule = createSchedule(names, shift);

  schedule.forEach((row) => {
    assert.deepEqual(Object.keys(row.assignments).sort(), ["informal", "primary", "secondary"]);
    assert.equal(row.assignments.primary.length, 2);
    assert.equal(row.assignments.secondary.length, 2);
    assert.equal(row.assignments.informal.length, 2);
  });
});
