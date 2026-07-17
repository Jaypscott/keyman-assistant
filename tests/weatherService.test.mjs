import test from "node:test";
import assert from "node:assert/strict";
import { WEATHER_CACHE_TTL_MS } from "../constants/weatherConfig.mjs";
import {
  buildWeatherUrl,
  createWeatherService,
  mapWeatherCode,
  parseWeatherResponse,
  WeatherUnavailableError,
} from "../services/weather/weatherService.mjs";
import { createWeatherController } from "../hooks/useWeather.mjs";

const location = {
  id: "test-location",
  name: "Neptune Beach",
  region: "FL",
  latitude: 30.3155,
  longitude: -81.3962,
  timezone: "America/New_York",
};

function responsePayload() {
  return {
    current: {
      time: 1_750_000_000,
      temperature_2m: 83.6,
      apparent_temperature: 87.2,
      relative_humidity_2m: 67.6,
      weather_code: 2,
      wind_speed_10m: 7.7,
      is_day: 1,
    },
    daily: {
      temperature_2m_max: [89.2],
      temperature_2m_min: [76.8],
    },
  };
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test("builds a Neptune Beach request through the Keyman weather proxy", () => {
  const url = new URL(buildWeatherUrl(location));
  assert.equal(url.pathname, "/api/weather");
  assert.equal(url.searchParams.get("latitude"), "30.3155");
  assert.equal(url.searchParams.get("longitude"), "-81.3962");
  assert.equal(url.searchParams.get("temperature_unit"), "fahrenheit");
  assert.equal(url.searchParams.get("wind_speed_unit"), "mph");
  assert.equal(url.searchParams.get("timezone"), "America/New_York");
  assert.match(url.searchParams.get("current"), /relative_humidity_2m/);
  assert.match(url.searchParams.get("daily"), /temperature_2m_max/);
});

test("maps every supported WMO weather category", () => {
  const expected = new Map([
    [0, "Clear"],
    [1, "Mostly Clear"],
    [2, "Partly Cloudy"],
    [3, "Cloudy"],
    [45, "Fog"],
    [51, "Drizzle"],
    [61, "Rain"],
    [71, "Snow"],
    [80, "Rain Showers"],
    [85, "Snow Showers"],
    [95, "Thunderstorm"],
  ]);
  expected.forEach((condition, code) => {
    assert.equal(mapWeatherCode(code, true).condition, condition);
  });
  assert.equal(mapWeatherCode(0, false).icon, "clear-night");
  assert.equal(mapWeatherCode(999).condition, "Conditions Unknown");
});

test("normalizes and rounds an Open-Meteo response", () => {
  const fetchedAt = new Date("2026-06-26T12:00:00.000Z");
  const weather = parseWeatherResponse(responsePayload(), location, fetchedAt);
  assert.deepEqual({
    temperature: weather.temperature,
    feelsLike: weather.feelsLike,
    humidity: weather.humidity,
    windSpeed: weather.windSpeed,
    high: weather.high,
    low: weather.low,
    condition: weather.condition,
  }, {
    temperature: 84,
    feelsLike: 87,
    humidity: 68,
    windSpeed: 8,
    high: 89,
    low: 77,
    condition: "Partly Cloudy",
  });
});

test("rejects malformed API data", () => {
  assert.throws(
    () => parseWeatherResponse({ current: {} }, location),
    WeatherUnavailableError,
  );
});

test("coalesces requests and stores a fresh cache entry", async () => {
  const storage = memoryStorage();
  let requests = 0;
  const service = createWeatherService({
    storage,
    now: () => 1_750_000_100_000,
    fetchImpl: async () => {
      requests += 1;
      return { ok: true, json: async () => responsePayload() };
    },
  });

  const [first, second] = await Promise.all([
    service.fetchCurrentWeather(location),
    service.fetchCurrentWeather(location),
  ]);
  assert.equal(requests, 1);
  assert.deepEqual(first, second);
  assert.equal(service.readCachedWeather(location).isFresh, true);
});

test("marks cached weather stale after fifteen minutes", async () => {
  const storage = memoryStorage();
  let time = 1_750_000_100_000;
  const service = createWeatherService({
    storage,
    now: () => time,
    fetchImpl: async () => ({ ok: true, json: async () => responsePayload() }),
  });
  await service.fetchCurrentWeather(location);
  time += WEATHER_CACHE_TTL_MS + 1;
  assert.equal(service.readCachedWeather(location).isFresh, false);
});

test("uses a fresh cache on load and only fetches after explicit refresh", async () => {
  const cachedWeather = parseWeatherResponse(responsePayload(), location);
  let requests = 0;
  const service = {
    readCachedWeather: () => ({ weather: cachedWeather, isFresh: true }),
    fetchCurrentWeather: async () => {
      requests += 1;
      return cachedWeather;
    },
  };
  const controller = createWeatherController({ service, location });
  await controller.load();
  assert.equal(requests, 0);
  assert.equal(controller.getState().data, cachedWeather);
  await controller.refresh();
  assert.equal(requests, 1);
});

test("retains stale weather when refresh fails and retries on demand", async () => {
  const cachedWeather = parseWeatherResponse(responsePayload(), location);
  let attempts = 0;
  const service = {
    readCachedWeather: () => ({ weather: cachedWeather, isFresh: false }),
    fetchCurrentWeather: async () => {
      attempts += 1;
      throw new WeatherUnavailableError();
    },
  };
  const controller = createWeatherController({ service, location });
  await controller.load();
  assert.equal(controller.getState().status, "ready");
  assert.equal(controller.getState().isStale, true);
  assert.equal(controller.getState().data, cachedWeather);
  await controller.refresh();
  assert.equal(attempts, 2);
});

test("shows an error when the network fails without cached weather", async () => {
  const service = {
    readCachedWeather: () => null,
    fetchCurrentWeather: async () => {
      throw new TypeError("network down");
    },
  };
  const controller = createWeatherController({ service, location });
  await controller.load();
  assert.equal(controller.getState().status, "error");
  assert.equal(controller.getState().data, null);
});
