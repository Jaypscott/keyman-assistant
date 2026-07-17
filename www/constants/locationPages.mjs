import { DEFAULT_WEATHER_LOCATION } from "./weatherConfig.mjs";

export const JACKSONVILLE_BEACH_WEATHER_LOCATION = Object.freeze({
  id: "jacksonville-beach-fl",
  name: "Jacksonville Beach",
  region: "FL",
  latitude: 30.2947,
  longitude: -81.3931,
  timezone: "America/New_York",
});

const beachesShifts = Object.freeze([
  Object.freeze({ id: "morning", label: "9:00am - 12:00pm", shortLabel: "9:00a - 12:00p", start: "09:00", end: "12:00", slots: 6, minutes: 30 }),
  Object.freeze({ id: "midday", label: "12:00pm - 3:00pm", shortLabel: "12:00p - 3:00p", start: "12:00", end: "15:00", slots: 6, minutes: 30 }),
  Object.freeze({ id: "afternoon", label: "3:00pm - 6:00pm", shortLabel: "3:00 - 6:00p", start: "15:00", end: "18:00", slots: 6, minutes: 30 }),
  Object.freeze({ id: "evening", label: "6:00pm - 8:00pm", shortLabel: "6:00p - 8:00p", start: "18:00", end: "20:00", slots: 8, minutes: 20 }),
]);

const pierShifts = Object.freeze([
  Object.freeze({ id: "jax-pier-midday", label: "10:00am - 1:00pm", shortLabel: "10:00a - 1:00p", start: "10:00", end: "13:00", slots: 6, minutes: 30 }),
]);

export const locationPages = Object.freeze([
  Object.freeze({
    id: "beaches-town-center",
    title: "Beaches Town Center",
    address: "0 Atlantic Blvd, Neptune Beach, FL 32266",
    backgroundColor: "#dff3ec",
    headingTextColor: "#ffffff",
    weatherLocation: DEFAULT_WEATHER_LOCATION,
    shifts: beachesShifts,
  }),
  Object.freeze({
    id: "jax-fishing-pier",
    title: "Jax Fishing Pier",
    address: "503 1st St N, Jacksonville Beach, FL 32250",
    backgroundColor: "#dff3ec",
    headingTextColor: "#ffffff",
    weatherLocation: JACKSONVILLE_BEACH_WEATHER_LOCATION,
    shifts: pierShifts,
  }),
]);

export const shifts = Object.freeze(locationPages.flatMap((location) => location.shifts));

export function findLocationById(id) {
  return locationPages.find((location) => location.id === id) || locationPages[0];
}
