const appApiBase = globalThis.KEYMAN_CONFIG?.authApiBase || "http://127.0.0.1:3001";

export const WEATHER_API_BASE = `${appApiBase.replace(/\/+$/, "")}/api/weather`;

export const DEFAULT_WEATHER_LOCATION = Object.freeze({
  id: "neptune-beach-fl",
  name: "Neptune Beach",
  region: "FL",
  latitude: 30.3155,
  longitude: -81.3962,
  timezone: "America/New_York",
});

export const WEATHER_CACHE_TTL_MS = 15 * 60 * 1000;
export const WEATHER_CACHE_KEY = "keyman-weather-v1";
export const WEATHER_REQUEST_TIMEOUT_MS = 10_000;
