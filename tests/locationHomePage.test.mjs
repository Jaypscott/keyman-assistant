import test from "node:test";
import assert from "node:assert/strict";

import {
  renderLocationHomePage,
  renderLocationPageIndicator,
} from "../components/LocationHomePage.mjs";
import { locationPages } from "../constants/locationPages.mjs";

function renderPage(location, index = 0) {
  return renderLocationHomePage({
    location,
    index,
    quickActionsOpen: false,
    weatherMarkup: `<article class="weather-card">${location.weatherLocation.name}</article>`,
    weatherPullIndicatorMarkup: `<div class="weather-pull-indicator"></div>`,
  });
}

test("renders Beaches first and Pier second through the same location component", () => {
  const markup = locationPages.map(renderPage).join("");
  assert.ok(markup.indexOf("Beaches Town Center") < markup.indexOf("Jax Fishing Pier"));
  assert.equal((markup.match(/class="location-page"/g) || []).length, 2);
  assert.equal((markup.match(/class="weather-card-slot"/g) || []).length, 2);
  assert.equal((markup.match(/class="shift-panel /g) || []).length, 2);
});

test("renders only the configured Pier shift with its location identity", () => {
  const markup = renderPage(locationPages[1], 1);
  assert.match(markup, /Jax Fishing Pier/);
  assert.match(markup, /503 1st St N, Jacksonville Beach, FL 32250/);
  assert.match(markup, /10:00a - 1:00p/);
  assert.match(markup, /data-location="jax-fishing-pier"/);
  assert.match(markup, /data-shift="jax-pier-midday"/);
  assert.equal((markup.match(/class="shift-card"/g) || []).length, 1);
});

test("renders one indicator per location and highlights the active page", () => {
  const first = renderLocationPageIndicator(locationPages, 0);
  const second = renderLocationPageIndicator(locationPages, 1);
  assert.equal((first.match(/location-page-dot/g) || []).length, 2);
  assert.match(first, /data-location-index="0" aria-label="Beaches Town Center" aria-selected="true"/);
  assert.match(second, /data-location-index="1" aria-label="Jax Fishing Pier" aria-selected="true"/);
});
