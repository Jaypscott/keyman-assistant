export function renderWeatherCard(state) {
  if (state.status === "loading" || state.status === "idle") {
    return renderSkeleton();
  }
  if (state.status === "error" || !state.data) {
    return renderError();
  }

  const weather = state.data;
  return `
    <article class="weather-card${state.isStale ? " is-stale" : ""}" aria-label="Current weather for ${escapeText(weather.location.name)}">
      <div class="weather-card-main">
        <div class="weather-summary">
          <span class="weather-icon" aria-hidden="true">${weatherIcon(weather.icon)}</span>
          <span>
            <strong>${escapeText(weather.location.name)}, ${escapeText(weather.location.region)}</strong>
            <small>${escapeText(weather.condition)}</small>
          </span>
        </div>
        <div class="weather-temperature">
          <strong>${displayValue(weather.temperature, "°")}</strong>
          <span>${weather.feelsLike === null ? "" : `Feels like ${displayValue(weather.feelsLike, "°")}`}</span>
        </div>
      </div>
      <div class="weather-details">
        <span>H: ${displayValue(weather.high, "°")} <i></i> L: ${displayValue(weather.low, "°")}</span>
        <span>${metricIcon("wind")} Wind ${displayValue(weather.windSpeed, " mph")}</span>
        <span>${metricIcon("humidity")} Humidity ${displayValue(weather.humidity, "%")}</span>
      </div>
      <footer class="weather-footer">
        <span>${state.isRefreshing ? spinner() : ""}Updated ${formatUpdatedAt(weather.observedAt)}</span>
        ${state.error ? `<button class="weather-retry weather-retry-inline" type="button">Couldn’t update · Retry</button>` : ""}
      </footer>
    </article>
  `;
}

export function renderWeatherPullIndicator() {
  return `
    <div class="weather-pull-indicator" aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d="M12 4v12"></path><path d="m7 11 5 5 5-5"></path></svg>
      <span>Pull to refresh</span>
    </div>
  `;
}

function renderSkeleton() {
  return `
    <article class="weather-card weather-card-skeleton" aria-label="Loading weather" aria-busy="true">
      <div class="skeleton-row">
        <span class="skeleton-circle"></span>
        <span class="skeleton-copy"><i></i><i></i></span>
        <span class="skeleton-temperature"></span>
      </div>
      <div class="skeleton-details"><i></i><i></i><i></i></div>
    </article>
  `;
}

function renderError() {
  return `
    <article class="weather-card weather-card-error" role="status">
      <span class="weather-icon" aria-hidden="true">${weatherIcon("cloudy")}</span>
      <span>
        <strong>Weather unavailable</strong>
        <small>Check your connection and try again.</small>
      </span>
      <button class="weather-retry" type="button">Retry</button>
    </article>
  `;
}

function weatherIcon(icon) {
  const icons = {
    "clear-day": `<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="5"></circle><path d="M16 2v4M16 26v4M2 16h4M26 16h4M6.1 6.1l2.8 2.8M23.1 23.1l2.8 2.8M25.9 6.1l-2.8 2.8M8.9 23.1l-2.8 2.8"></path></svg>`,
    "clear-night": `<svg viewBox="0 0 32 32"><path d="M25 21.5A11 11 0 0 1 10.5 7 10.5 10.5 0 1 0 25 21.5Z"></path></svg>`,
    "partly-cloudy-day": `<svg viewBox="0 0 32 32"><circle cx="11" cy="11" r="4"></circle><path d="M11 3v2M3 11h2M5.3 5.3l1.4 1.4M16.7 5.3l-1.4 1.4"></path><path d="M8 24h16a5 5 0 0 0 0-10 7 7 0 0 0-13.4 2A4 4 0 0 0 8 24Z"></path></svg>`,
    "partly-cloudy-night": `<svg viewBox="0 0 32 32"><path d="M16 5a8 8 0 0 0 7 10A9 9 0 0 1 16 5Z"></path><path d="M7 25h17a5 5 0 0 0 0-10 7 7 0 0 0-13.5 2A4 4 0 0 0 7 25Z"></path></svg>`,
    cloudy: `<svg viewBox="0 0 32 32"><path d="M6 24h19a5 5 0 0 0 0-10 8 8 0 0 0-15.4 2A4 4 0 0 0 6 24Z"></path></svg>`,
    fog: `<svg viewBox="0 0 32 32"><path d="M5 11h22M3 16h20M8 21h21M5 26h18"></path></svg>`,
    drizzle: `<svg viewBox="0 0 32 32"><path d="M6 18h19a5 5 0 0 0 0-10 8 8 0 0 0-15.4 2A4 4 0 0 0 6 18Z"></path><path d="m10 23-1 3M17 23l-1 3M24 23l-1 3"></path></svg>`,
    rain: `<svg viewBox="0 0 32 32"><path d="M6 17h19a5 5 0 0 0 0-10 8 8 0 0 0-15.4 2A4 4 0 0 0 6 17Z"></path><path d="m10 21-2 6M18 21l-2 6M26 21l-2 6"></path></svg>`,
    showers: `<svg viewBox="0 0 32 32"><path d="M6 17h19a5 5 0 0 0 0-10 8 8 0 0 0-15.4 2A4 4 0 0 0 6 17Z"></path><path d="m10 21-2 5M18 22l-2 5M26 21l-2 5"></path></svg>`,
    snow: `<svg viewBox="0 0 32 32"><path d="M6 15h19a5 5 0 0 0 0-10 8 8 0 0 0-15.4 2A4 4 0 0 0 6 15Z"></path><path d="M10 20v8M6.5 22l7 4M13.5 22l-7 4M23 20v8M19.5 22l7 4M26.5 22l-7 4"></path></svg>`,
    thunderstorm: `<svg viewBox="0 0 32 32"><path d="M6 16h19a5 5 0 0 0 0-10 8 8 0 0 0-15.4 2A4 4 0 0 0 6 16Z"></path><path d="m17 18-4 7h4l-2 5 7-9h-4l2-3Z"></path></svg>`,
  };
  return icons[icon] || icons.cloudy;
}

function metricIcon(type) {
  if (type === "humidity") {
    return `<svg class="weather-metric-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2S5 8 5 12a5 5 0 0 0 10 0c0-4-5-10-5-10Z"></path></svg>`;
  }
  return `<svg class="weather-metric-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M2 7h10a2.5 2.5 0 1 0-2.5-2.5"></path><path d="M2 11h14a2.5 2.5 0 1 1-2.5 2.5"></path></svg>`;
}

function spinner() {
  return `<svg class="weather-spinner" viewBox="0 0 20 20" aria-hidden="true"><path d="M17 10a7 7 0 1 1-2-4.9"></path></svg>`;
}

function displayValue(value, suffix) {
  return value === null || value === undefined ? "—" : `${value}${suffix}`;
}

function formatUpdatedAt(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "recently";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function escapeText(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character]);
}
