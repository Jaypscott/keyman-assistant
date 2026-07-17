import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanVolunteerContacts,
  contactsForEvent,
  createGroupMessagePayload,
  normalizePhoneNumber,
  parseRosterObservations,
  prepareRosterReview,
} from "../services/volunteers/rosterService.mjs";

const observation = (text, x, y, width = 0.3, height = 0.03, confidence = 0.96) => ({
  text,
  confidence,
  bounds: { x, y, width, height },
});

test("normalizes common US and international phone numbers", () => {
  assert.equal(normalizePhoneNumber("(904) 555-0123"), "+19045550123");
  assert.equal(normalizePhoneNumber("1-904-555-0123"), "+19045550123");
  assert.equal(normalizePhoneNumber("+44 20 7946 0958"), "+442079460958");
  assert.equal(normalizePhoneNumber("555-0123"), "");
});

test("parses names and numbers from the same OCR line", () => {
  const contacts = parseRosterObservations([
    observation("Alex Morgan (904) 555-0101", 0.1, 0.1, 0.7),
    observation("Jordan Lee 904.555.0102", 0.1, 0.2, 0.7),
  ]);
  assert.deepEqual(contacts.map(({ name, phone }) => ({ name, phone })), [
    { name: "Alex Morgan", phone: "(904) 555-0101" },
    { name: "Jordan Lee", phone: "(904) 555-0102" },
  ]);
});

test("pairs two-column names and phone numbers by row", () => {
  const contacts = parseRosterObservations([
    observation("Taylor Reed", 0.1, 0.2),
    observation("(904) 555-0110", 0.62, 0.2),
    observation("Morgan Diaz", 0.1, 0.3),
    observation("904-555-0111", 0.62, 0.3),
  ]);
  assert.deepEqual(contacts.map(({ name, phone }) => ({ name, phone })), [
    { name: "Taylor Reed", phone: "(904) 555-0110" },
    { name: "Morgan Diaz", phone: "(904) 555-0111" },
  ]);
});

test("pairs a number with the nearby name immediately above it", () => {
  const contacts = parseRosterObservations([
    observation("Casey Patel", 0.15, 0.2, 0.3),
    observation("+1 904 555 0120", 0.15, 0.25, 0.3),
  ]);
  assert.equal(contacts[0].name, "Casey Patel");
  assert.equal(contacts[0].phone, "(904) 555-0120");
});

test("pairs a stacked roster and accepts dash variants produced by OCR", () => {
  const contacts = parseRosterObservations([
    observation("Avery Brooks", 0.06, 0.08, 0.54, 0.04),
    observation("904\u2011555\u20110101", 0.06, 0.135, 0.42, 0.035),
    observation("Morgan Ruiz", 0.06, 0.28, 0.54, 0.04),
    observation("757-555-0102", 0.06, 0.335, 0.42, 0.035),
    observation("Jordan Patel", 0.06, 0.48, 0.54, 0.04),
    observation("757\u2013555\u20130103", 0.06, 0.535, 0.42, 0.035),
    observation("Taylor Kim", 0.06, 0.68, 0.54, 0.04),
    observation("904-555-0104", 0.06, 0.735, 0.42, 0.035),
  ]);

  assert.deepEqual(contacts.map(({ name, phone }) => ({ name, phone })), [
    { name: "Avery Brooks", phone: "(904) 555-0101" },
    { name: "Morgan Ruiz", phone: "(757) 555-0102" },
    { name: "Jordan Patel", phone: "(757) 555-0103" },
    { name: "Taylor Kim", phone: "(904) 555-0104" },
  ]);
});

test("filters headers, preserves unmatched results, and flags low confidence", () => {
  const contacts = parseRosterObservations([
    observation("Volunteers", 0.1, 0.05),
    observation("Riley Chen", 0.1, 0.2, 0.3, 0.03, 0.6),
    observation("(904) 555-0130", 0.6, 0.2),
    observation("Jamie Fox", 0.1, 0.35),
    observation("904-555-0131", 0.6, 0.5),
  ]);
  assert.equal(contacts.length, 3);
  assert.equal(contacts[0].name, "Riley Chen");
  assert.equal(contacts[0].needsReview, true);
  assert.equal(contacts[1].name, "");
  assert.equal(contacts[1].phone, "(904) 555-0131");
  assert.equal(contacts[2].name, "Jamie Fox");
  assert.equal(contacts[2].phone, "");
});

test("deduplicates recognized phone numbers", () => {
  const contacts = parseRosterObservations([
    observation("Sam Rivera 904-555-0140", 0.1, 0.1),
    observation("Samuel Rivera (904) 555-0140", 0.1, 0.2),
  ]);
  assert.equal(contacts.length, 1);
});

test("prepares only available roster rows as selected and leaves overflow pending", () => {
  const review = prepareRosterReview([
    { name: "One Person", phone: "9045550101" },
    { name: "Two Person", phone: "9045550102" },
    { name: "Three Person", phone: "9045550103" },
  ], 2);
  assert.deepEqual(review.map((contact) => contact.selected), [true, true, false]);
});

test("migrates legacy events and cleans duplicate names", () => {
  assert.deepEqual(contactsForEvent({ volunteers: ["Alex", "Jordan"] }), [
    { name: "Alex", phone: "" },
    { name: "Jordan", phone: "" },
  ]);
  assert.deepEqual(cleanVolunteerContacts([
    { name: " Alex ", phone: "9045550101" },
    { name: "alex", phone: "9045550102" },
  ]), [{ name: "Alex", phone: "(904) 555-0101" }]);
});

test("builds an exact deduplicated group-message payload and reports exclusions", () => {
  assert.deepEqual(createGroupMessagePayload([
    { name: "Alex", phone: "904-555-0150" },
    { name: "Alex duplicate", phone: "(904) 555-0150" },
    { name: "Jordan", phone: "+44 20 7946 0958" },
    { name: "No Number", phone: "" },
    { name: "", phone: "" },
  ], "Rotation details"), {
    recipients: ["+19045550150", "+442079460958"],
    excluded: ["No Number"],
    body: "Rotation details",
  });
});
