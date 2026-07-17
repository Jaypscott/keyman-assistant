import {
  DEFAULT_WEATHER_LOCATION,
  WEATHER_API_BASE,
  WEATHER_CACHE_KEY,
  WEATHER_CACHE_TTL_MS,
  WEATHER_REQUEST_TIMEOUT_MS,
} from "../../constants/weatherConfig.mjs";

const CURRENT_FIELDS = [
  "temperature_2m",
  "apparent_temperature",
  "relative_humidity_2m",
  "weather_code",
  "wind_speed_10m",
  "is_day",
];

const DAILY_FIELDS = ["temperature_2m_max", "temperature_2m_min"];

export class WeatherUnavailableError extends Error {
  constructor(message = "Weather unavailable") {
    super(message);
    this.name = "WeatherUnavailableError";
  }
}

export function buildWeatherUrl(location = DEFAULT_WEATHER_LOCATION, apiBase = WEATHER_API_BASE) {
  const url = new URL(apiBase);
  url.searchParams.set("latitude", String(location.latitude));
  url.searchParams.set("longitude", String(location.longitude));
  url.searchParams.set("current", CURRENT_FIELDS.join(","));
  url.searchParams.set("daily", DAILY_FIELDS.join(","));
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("wind_speed_unit", "mph");
  url.searchParams.set("timezone", location.timezone);
  url.searchParams.set("timeformat", "unixtime");
  url.searchParams.set("forecast_days", "1");
  return url.toString();
}

export function mapWeatherCode(code, isDay = true) {
  if (code === 0) {
    return { condition: "Clear", icon: isDay ? "clear-day" : "clear-night" };
  }
  if (code === 1) {
    return { condition: "Mostly Clear", icon: isDay ? "partly-cloudy-day" : "partly-cloudy-night" };
  }
  if (code === 2) {
    return { condition: "Partly Cloudy", icon: isDay ? "partly-cloudy-day" : "partly-cloudy-night" };
  }
  if (code === 3) return { condition: "Cloudy", icon: "cloudy" };
  if ([45, 48].includes(code)) return { condition: "Fog", icon: "fog" };
  if ([51, 53, 55, 56, 57].includes(code)) return { condition: "Drizzle", icon: "drizzle" };
  if ([61, 63, 65, 66, 67].includes(code)) return { condition: "Rain", icon: "rain" };
  if ([71, 73, 75, 77].includes(code)) return { condition: "Snow", icon: "snow" };
  if ([80, 81, 82].includes(code)) return { condition: "Rain Showers", icon: "showers" };
  if ([85, 86].includes(code)) return { condition: "Snow Showers", icon: "snow" };
  if ([95, 96, 99].includes(code)) return { condition: "Thunderstorm", icon: "thunderstorm" };
  return { condition: "Conditions Unknown", icon: "cloudy" };
}

export function parseWeatherResponse(payload, location = DEFAULT_WEATHER_LOCATION, fetchedAt = new Date()) {
  const current = payload?.current;
  const daily = payload?.daily;
  if (!current || !isFiniteNumber(current.temperature_2m) || !Number.isInteger(current.weather_code)) {
    throw new WeatherUnavailableError("Weather service returned an invalid response.");
  }

  const observedAt = unixSecondsToIso(current.time);
  if (!observedAt) {
    throw new WeatherUnavailableError("Weather service returned an invalid observation time.");
  }

  const mapped = mapWeatherCode(current.weather_code, current.is_day !== 0);
  return {
    location: { ...location },
    temperature: Math.round(current.temperature_2m),
    feelsLike: roundOptional(current.apparent_temperature),
    condition: mapped.condition,
    icon: mapped.icon,
    windSpeed: roundOptional(current.wind_speed_10m),
    humidity: roundOptional(current.relative_humidity_2m),
    high: roundOptional(firstValue(daily?.temperature_2m_max)),
    low: roundOptional(firstValue(daily?.temperature_2m_min)),
    observedAt,
    fetchedAt: fetchedAt.toISOString(),
  };
}

export function createWeatherService({
  fetchImpl = globalThis.fetch?.bind(globalThis),
  storage = globalThis.localStorage,
  now = () => Date.now(),
  apiBase = WEATHER_API_BASE,
  requestTimeoutMs = WEATHER_REQUEST_TIMEOUT_MS,
} = {}) {
  let inFlight = null;

  function readCachedWeather(location = DEFAULT_WEATHER_LOCATION) {
    if (!storage) return null;
    try {
      const cached = JSON.parse(storage.getItem(cacheKey(location)) || "null");
      if (!isWeather(cached?.weather) || !isFiniteNumber(cached?.cachedAt)) return null;
      return {
        weather: cached.weather,
        isFresh: now() - cached.cachedAt < WEATHER_CACHE_TTL_MS,
      };
    } catch {
      return null;
    }
  }

  function writeCachedWeather(weather, location = DEFAULT_WEATHER_LOCATION) {
    if (!storage) return;
    try {
      storage.setItem(cacheKey(location), JSON.stringify({
        cachedAt: now(),
        weather,
      }));
    } catch {
      // Weather should still render when device storage is unavailable or full.
    }
  }

  async function fetchCurrentWeather(location = DEFAULT_WEATHER_LOCATION) {
    if (inFlight) return inFlight;
    if (typeof fetchImpl !== "function") {
      throw new WeatherUnavailableError();
    }

    inFlight = (async () => {
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const timeout = controller
        ? setTimeout(() => controller.abort(), requestTimeoutMs)
        : null;

      try {
        const response = await fetchImpl(buildWeatherUrl(location, apiBase), {
          headers: { Accept: "application/json" },
          signal: controller?.signal,
        });
        if (!response?.ok) throw new WeatherUnavailableError();
        const weather = parseWeatherResponse(await response.json(), location, new Date(now()));
        writeCachedWeather(weather, location);
        return weather;
      } catch (error) {
        if (error instanceof WeatherUnavailableError) throw error;
        throw new WeatherUnavailableError();
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    })();

    try {
      return await inFlight;
    } finally {
      inFlight = null;
    }
  }

  return {
    readCachedWeather,
    fetchCurrentWeather,
  };
}

function cacheKey(location) {
  return `${WEATHER_CACHE_KEY}:${location.id}`;
}

function unixSecondsToIso(value) {
  if (!isFiniteNumber(value)) return "";
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function firstValue(value) {
  return Array.isArray(value) ? value[0] : null;
}

function roundOptional(value) {
  return isFiniteNumber(value) ? Math.round(value) : null;
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isWeather(value) {
  return Boolean(
    value
    && value.location?.id
    && isFiniteNumber(value.temperature)
    && typeof value.condition === "string"
    && typeof value.icon === "string"
    && typeof value.observedAt === "string"
    && typeof value.fetchedAt === "string",
  );
}
