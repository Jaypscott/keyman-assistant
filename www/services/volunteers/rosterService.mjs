const PHONE_CANDIDATE_PATTERN = /(?:\+\s*\d[\d\s().\p{Pd}]{8,}\d|\(?\d{3}\)?[\s.\p{Pd}]*\d{3}[\s.\p{Pd}]*\d{4}|\+?\d{10,15})/gu;

const NON_NAME_TEXT = new Set([
  "add volunteer",
  "assigned",
  "calendar",
  "contact",
  "contacts",
  "date",
  "email",
  "location",
  "message",
  "name",
  "phone",
  "roster",
  "schedule",
  "send message",
  "shift",
  "time",
  "volunteer",
  "volunteers",
]);

export function normalizePhoneNumber(value) {
  const raw = String(value || "").trim();
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return "";
  if (raw.startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

export function formatPhoneNumber(value) {
  const normalized = normalizePhoneNumber(value);
  if (!normalized) return String(value || "").trim();
  const digits = normalized.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length === 10) {
    return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
  }
  return normalized;
}

export function createVolunteerContact(contact = {}) {
  return {
    name: String(contact.name || "").trim(),
    phone: formatPhoneNumber(contact.phone),
  };
}

export function contactsForEvent(event = {}) {
  const source = Array.isArray(event.volunteerContacts) && event.volunteerContacts.length
    ? event.volunteerContacts
    : (Array.isArray(event.volunteers) ? event.volunteers.map((name) => ({ name, phone: "" })) : []);
  return source.map(createVolunteerContact).filter((contact) => contact.name || contact.phone);
}

export function cleanVolunteerContacts(contacts = []) {
  const seenNames = new Set();
  return contacts
    .map(createVolunteerContact)
    .filter((contact) => contact.name)
    .filter((contact) => {
      const key = contact.name.toLocaleLowerCase();
      if (seenNames.has(key)) return false;
      seenNames.add(key);
      return true;
    });
}

export function createGroupMessagePayload(contacts, body) {
  const recipients = [];
  const excluded = [];
  const seen = new Set();

  contacts.map(createVolunteerContact).forEach((contact, index) => {
    if (!contact.name && !contact.phone) return;
    const phone = normalizePhoneNumber(contact.phone);
    if (!phone) {
      excluded.push(contact.name || `Volunteer ${index + 1}`);
      return;
    }
    if (seen.has(phone)) return;
    seen.add(phone);
    recipients.push(phone);
  });

  return {
    recipients,
    excluded,
    body: String(body || ""),
  };
}

export function prepareRosterReview(contacts, capacity) {
  let selectedCount = 0;
  const safeCapacity = Math.max(0, Number(capacity) || 0);
  return contacts.map((contact, index) => {
    const normalized = createVolunteerContact(contact);
    const selected = Boolean(normalized.name) && selectedCount < safeCapacity;
    if (selected) selectedCount += 1;
    return {
      id: String(contact.id || `scan-${index + 1}`),
      ...normalized,
      confidence: clampConfidence(contact.confidence),
      needsReview: Boolean(contact.needsReview || !normalized.name || !normalizePhoneNumber(normalized.phone)),
      selected,
      applied: false,
    };
  });
}

export function parseRosterObservations(observations = [], { lowConfidenceThreshold = 0.75 } = {}) {
  const items = observations
    .map(normalizeObservation)
    .filter((item) => item.text)
    .sort((a, b) => a.centerY - b.centerY || a.bounds.x - b.bounds.x);
  const names = items
    .map((item, index) => ({ ...item, index, candidate: cleanNameCandidate(removePhoneCandidates(item.text)) }))
    .filter((item) => item.candidate);
  const usedNameIndexes = new Set();
  const contacts = [];

  items.forEach((phoneItem, phoneItemIndex) => {
    const matches = extractPhoneCandidates(phoneItem.text);
    matches.forEach((phoneMatch) => {
      const inlineName = cleanNameCandidate(phoneItem.text.replace(phoneMatch.raw, " "));
      if (inlineName) usedNameIndexes.add(phoneItemIndex);
      const pairedName = inlineName
        ? { candidate: inlineName, confidence: phoneItem.confidence, index: -1 }
        : findNearestName(phoneItem, names, usedNameIndexes);
      if (pairedName?.index >= 0) usedNameIndexes.add(pairedName.index);
      const confidence = Math.min(phoneItem.confidence, pairedName?.confidence ?? phoneItem.confidence);
      contacts.push({
        name: pairedName?.candidate || "",
        phone: formatPhoneNumber(phoneMatch.normalized),
        confidence,
        needsReview: !pairedName?.candidate || confidence < lowConfidenceThreshold,
      });
    });
  });

  names.forEach((nameItem) => {
    if (usedNameIndexes.has(nameItem.index)) return;
    contacts.push({
      name: nameItem.candidate,
      phone: "",
      confidence: nameItem.confidence,
      needsReview: true,
    });
  });

  return deduplicateParsedContacts(contacts).map((contact, index) => ({
    id: `scan-${index + 1}`,
    ...contact,
  }));
}

function normalizeObservation(observation = {}) {
  const bounds = observation.bounds || {};
  const normalizedBounds = {
    x: finiteNumber(bounds.x),
    y: finiteNumber(bounds.y),
    width: Math.max(0, finiteNumber(bounds.width)),
    height: Math.max(0, finiteNumber(bounds.height)),
  };
  return {
    text: String(observation.text || "").replace(/\s+/g, " ").trim(),
    confidence: clampConfidence(observation.confidence),
    bounds: normalizedBounds,
    centerX: normalizedBounds.x + normalizedBounds.width / 2,
    centerY: normalizedBounds.y + normalizedBounds.height / 2,
  };
}

function extractPhoneCandidates(text) {
  const matches = [];
  String(text || "").matchAll(PHONE_CANDIDATE_PATTERN).forEach((match) => {
    const normalized = normalizePhoneNumber(match[0]);
    if (normalized) matches.push({ raw: match[0], normalized });
  });
  return matches;
}

function removePhoneCandidates(text) {
  return String(text || "").replace(PHONE_CANDIDATE_PATTERN, " ");
}

function cleanNameCandidate(value) {
  const cleaned = String(value || "")
    .replace(/\b(?:mobile|phone|tel|telephone)\b\s*:?/gi, " ")
    .replace(/[^\p{L}\p{M}.'’\-\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 2 || cleaned.length > 60) return "";
  const lowered = cleaned.toLocaleLowerCase();
  if (NON_NAME_TEXT.has(lowered)) return "";
  const words = lowered.split(" ");
  if (words.every((word) => NON_NAME_TEXT.has(word))) return "";
  if (words.length > 5) return "";
  return cleaned;
}

function findNearestName(phone, names, usedNameIndexes) {
  const candidates = names
    .filter((name) => !usedNameIndexes.has(name.index))
    .map((name) => {
      const verticalDistance = Math.abs(name.centerY - phone.centerY);
      const rowTolerance = Math.max(name.bounds.height, phone.bounds.height, 0.018) * 1.25;
      const sameRow = verticalDistance <= rowTolerance;
      const aboveDistance = phone.bounds.y - (name.bounds.y + name.bounds.height);
      const horizontalOverlap = overlapRatio(name.bounds.x, name.bounds.width, phone.bounds.x, phone.bounds.width);
      const immediatelyAbove = aboveDistance >= -rowTolerance && aboveDistance <= Math.max(0.08, rowTolerance * 3)
        && horizontalOverlap >= 0.15;
      if (!sameRow && !immediatelyAbove) return null;
      const score = sameRow
        ? verticalDistance * 5 + Math.abs(name.centerX - phone.centerX) * 0.25
        : Math.max(0, aboveDistance) * 3 + Math.abs(name.centerX - phone.centerX) * 0.2;
      return { ...name, score };
    })
    .filter(Boolean)
    .sort((a, b) => a.score - b.score);
  return candidates[0] || null;
}

function overlapRatio(firstX, firstWidth, secondX, secondWidth) {
  const overlap = Math.max(0, Math.min(firstX + firstWidth, secondX + secondWidth) - Math.max(firstX, secondX));
  return overlap / Math.max(0.001, Math.min(firstWidth, secondWidth));
}

function deduplicateParsedContacts(contacts) {
  const seen = new Set();
  return contacts.filter((contact) => {
    const phone = normalizePhoneNumber(contact.phone);
    const key = phone || contact.name.toLocaleLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function clampConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}
