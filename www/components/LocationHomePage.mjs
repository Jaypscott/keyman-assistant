export function renderLocationHomePage({
  location,
  index,
  quickActionsOpen,
  weatherMarkup,
  weatherPullIndicatorMarkup,
}) {
  return `
    <article
      class="location-page"
      data-location-page="${index}"
      data-location-id="${escapeAttribute(location.id)}"
      aria-label="${escapeAttribute(location.title)}"
    >
      <div class="hero ${quickActionsOpen ? "is-actions-open" : ""}" style="--location-background:${location.backgroundColor}; --location-heading:${location.headingTextColor}">
        <div class="hero-location" aria-label="Location">
          <h2>${escapeHTML(location.title)}</h2>
          <p>${escapeHTML(location.address)}</p>
          ${weatherPullIndicatorMarkup}
          <div class="weather-card-slot" data-weather-location="${escapeAttribute(location.id)}">
            ${weatherMarkup}
          </div>
        </div>
        <div class="shift-panel ${quickActionsOpen ? "is-expanded" : ""}">
          <button class="sheet-handle" aria-label="${quickActionsOpen ? "Hide quick actions" : "Show quick actions"}" aria-expanded="${quickActionsOpen}"></button>
          <h1>Shifts</h1>
          <p class="shift-panel-intro">Select a volunteer shift</p>
          <div class="shift-grid">
            ${location.shifts.map((shift) => `
              <button class="shift-card" data-location="${escapeAttribute(location.id)}" data-shift="${escapeAttribute(shift.id)}" aria-label="Select ${escapeAttribute(shift.label)} at ${escapeAttribute(location.title)}">
                <span class="shift-time">${escapeHTML(shift.shortLabel)}</span>
              </button>
            `).join("")}
          </div>
          <section class="quick-actions" aria-hidden="${!quickActionsOpen}">
            <h2>Quick Actions</h2>
            <button class="quick-action-card" data-action="emergency">
              <span><strong class="quick-action-label">
                <svg class="caution-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 21h20L12 3Z"></path><path d="M12 9v5"></path><path d="M12 17h.01"></path></svg>
                Emergency Plan
              </strong></span>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>
            </button>
          </section>
        </div>
      </div>
    </article>
  `;
}

export function renderLocationPageIndicator(locations, activeIndex) {
  return `
    <div class="location-page-indicator" role="tablist" aria-label="Locations">
      ${locations.map((location, index) => `
        <button class="location-page-dot ${index === activeIndex ? "is-active" : ""}" type="button" role="tab" data-location-index="${index}" aria-label="${escapeAttribute(location.title)}" aria-selected="${index === activeIndex}"></button>
      `).join("")}
    </div>
  `;
}

function escapeHTML(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttribute(value) {
  return escapeHTML(value)
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

