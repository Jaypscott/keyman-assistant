import test from "node:test";
import assert from "node:assert/strict";

import {
  JACKSONVILLE_BEACH_WEATHER_LOCATION,
  locationPages,
  shifts,
} from "../constants/locationPages.mjs";
import { calculateRotationIntervals } from "../services/schedule/rotationService.mjs";
import { buildWeatherUrl } from "../services/weather/weatherService.mjs";

test("keeps Beaches Town Center first with its four existing shifts", () => {
  assert.equal(locationPages[0].title, "Beaches Town Center");
  assert.deepEqual(locationPages[0].shifts.map((shift) => shift.id), [
    "morning",
    "midday",
    "afternoon",
    "evening",
  ]);
});

test("configures Jax Fishing Pier with one location-specific shift and weather", () => {
  const pier = locationPages[1];
  assert.equal(pier.title, "Jax Fishing Pier");
  assert.equal(pier.address, "503 1st St N, Jacksonville Beach, FL 32250");
  assert.equal(pier.headingTextColor, "#ffffff");
  assert.equal(pier.weatherLocation, JACKSONVILLE_BEACH_WEATHER_LOCATION);
  assert.deepEqual(pier.shifts.map(({ shortLabel, start, end }) => ({ shortLabel, start, end })), [
    { shortLabel: "10:00a - 1:00p", start: "10:00", end: "13:00" },
  ]);
  assert.equal(shifts.length, 5);
});

test("supports every existing rotation option for the Pier shift", () => {
  const shift = locationPages[1].shifts[0];
  assert.deepEqual(
    [15, 20, 30].map((duration) => calculateRotationIntervals(shift.start, shift.end, duration).length),
    [12, 9, 6],
  );
});

test("builds Jacksonville Beach weather requests from the Pier location", () => {
  const url = new URL(buildWeatherUrl(JACKSONVILLE_BEACH_WEATHER_LOCATION));
  assert.equal(url.searchParams.get("latitude"), "30.2947");
  assert.equal(url.searchParams.get("longitude"), "-81.3931");
});
