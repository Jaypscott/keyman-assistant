const escapeText = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const escapeAttr = escapeText;
export function rosterReviewMarkup({ contacts, capacity, message = '', confirmLabel = 'Add selected volunteers', capacityLabel = `${capacity} empty slot${capacity === 1 ? '' : 's'} available`, description = 'Confirm every name and number before filling the shift.' }) {
  const selectedCount = contacts.filter(c => c.selected).length;
  return `
    <div class="roster-review-overlay" role="dialog" aria-modal="true" aria-labelledby="rosterReviewTitle">
      <button class="roster-review-backdrop" id="closeRosterReviewBackdrop" type="button" aria-label="Close roster review"></button>
      <article class="roster-review-sheet">
        <div class="roster-review-header">
          <div>
            <p class="detail-kicker">On-device image scan</p>
            <h2 id="rosterReviewTitle">Review volunteers</h2>
            <p class="subtle">${description}</p>
          </div>
          <button class="icon-btn" id="closeRosterReview" type="button" aria-label="Close roster review">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m18 6-12 12"></path><path d="m6 6 12 12"></path></svg>
          </button>
        </div>
        <div class="roster-capacity" role="status">
          <strong>${selectedCount} selected</strong>
          <span>${capacityLabel}</span>
        </div>
        <div class="roster-review-list">
          ${contacts.map((contact, index) => `
            <div class="roster-review-row ${contact.needsReview ? "needs-review" : ""}">
              <label class="roster-include">
                <input class="roster-select" data-index="${index}" type="checkbox" ${contact.selected ? "checked" : ""} ${!contact.name ? "disabled" : ""}>
                <span>Include</span>
              </label>
              <label>
                <span>Name</span>
                <input class="name-input roster-review-input" data-index="${index}" data-field="name" value="${escapeAttr(contact.name)}" placeholder="Volunteer name">
              </label>
              <label>
                <span>Phone</span>
                <input class="phone-input roster-review-input" data-index="${index}" data-field="phone" type="tel" inputmode="tel" value="${escapeAttr(contact.phone)}" placeholder="Phone number">
              </label>
              ${contact.needsReview ? `<p class="roster-confidence">Check this result${contact.confidence ? ` · ${Math.round(contact.confidence * 100)}% OCR confidence` : ""}</p>` : ""}
            </div>
          `).join("")}
        </div>
        ${message ? `<p class="message roster-review-message">${escapeText(message)}</p>` : ""}
        <div class="roster-review-actions">
          <button class="secondary-btn" id="discardRosterReview" type="button">Discard import</button>
          <button class="primary-btn" id="applyRosterReview" type="button" ${selectedCount === 0 || selectedCount > capacity ? "disabled" : ""}>${confirmLabel}</button>
        </div>
      </article>
    </div>
  `;
}
