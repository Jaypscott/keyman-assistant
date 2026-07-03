import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOpenMeteoUrl,
  fetchWeather,
  parseWeatherRequest,
} from "../server/weatherProxy.mjs";

const location = {
  latitude: 30.2947,
  longitude: -81.3931,
  timezone: "America/New_York",
};

test("accepts Jacksonville weather requests but rejects an open proxy", () => {
  assert.deepEqual(
    parseWeatherRequest("/api/weather?latitude=30.2947&longitude=-81.3931&timezone=America%2FNew_York"),
    location,
  );
  assert.throws(
    () => parseWeatherRequest("/api/weather?latitude=40.7128&longitude=-74.006"),
    /Invalid weather location/,
  );
});

test("builds a fixed imperial Open-Meteo request", () => {
  const url = new URL(buildOpenMeteoUrl(location));
  assert.equal(url.hostname, "api.open-meteo.com");
  assert.equal(url.searchParams.get("temperature_unit"), "fahrenheit");
  assert.equal(url.searchParams.get("wind_speed_unit"), "mph");
});

test("returns the provider payload", async () => {
  const payload = { current: { temperature_2m: 82, weather_code: 1 } };
  assert.equal(await fetchWeather(location, {
    now: () => 1,
    fetchImpl: async () => ({ ok: true, json: async () => payload }),
  }), payload);
});
