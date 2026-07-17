const CACHE_NAME = "keyman-shift-planner-v86";
const ASSETS = [
  "./",
  "index.html",
  "styles.css?v=55",
  "config.js?v=2",
  "app.js?v=57",
  "components/LocationHomePage.mjs",
  "components/WeatherCard.mjs",
  "constants/weatherConfig.mjs",
  "constants/locationPages.mjs",
  "hooks/useWeather.mjs",
  "services/weather/weatherService.mjs",
  "services/schedule/rotationService.mjs",
  "services/volunteers/rosterService.mjs",
  "services/auth/sessionTokenStorage.mjs",
  "types/weather.mjs",
  "manifest.json",
  "public/privacy.html",
  "assets/keyman-header.png",
  "assets/auth-logo.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith("keyman-shift-planner-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.open(CACHE_NAME)
      .then((cache) => cache.match(event.request))
      .then((cached) => cached || fetch(event.request)),
  );
});
