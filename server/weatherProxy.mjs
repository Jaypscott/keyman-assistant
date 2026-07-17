const OPEN_METEO_API_BASE = "https://api.open-meteo.com/v1/forecast";
const REQUEST_TIMEOUT_MS = 12_000;
const CACHE_TTL_MS = 5 * 60 * 1000;

const CURRENT_FIELDS = [
  "temperature_2m",
  "apparent_temperature",
  "relative_humidity_2m",
  "weather_code",
  "wind_speed_10m",
  "is_day",
];

const DAILY_FIELDS = ["temperature_2m_max", "temperature_2m_min"];
const cache = new Map();

export function parseWeatherRequest(requestUrl) {
  const url = new URL(requestUrl, "http://localhost");
  const latitude = Number(url.searchParams.get("latitude"));
  const longitude = Number(url.searchParams.get("longitude"));
  const timezone = url.searchParams.get("timezone") || "America/New_York";

  if (
    !Number.isFinite(latitude)
    || !Number.isFinite(longitude)
    || latitude < 30
    || latitude > 31
    || longitude < -82
    || longitude > -81
    || timezone !== "America/New_York"
  ) {
    throw new Error("Invalid weather location.");
  }

  return { latitude, longitude, timezone };
}

export function buildOpenMeteoUrl(location) {
  const url = new URL(OPEN_METEO_API_BASE);
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

export async function fetchWeather(
  location,
  {
    fetchImpl = globalThis.fetch,
    now = () => Date.now(),
    requestTimeoutMs = REQUEST_TIMEOUT_MS,
  } = {},
) {
  const key = `${location.latitude}:${location.longitude}:${location.timezone}`;
  const cached = cache.get(key);
  if (cached && now() - cached.cachedAt < CACHE_TTL_MS) return cached.payload;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetchImpl(buildOpenMeteoUrl(location), {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("Weather provider is unavailable.");
    const payload = await response.json();
    cache.set(key, { cachedAt: now(), payload });
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}
