import test from "node:test";
import assert from "node:assert/strict";
import {
  createPasswordRecord,
  createResetCode,
  hashResetCode,
  passwordMatches,
  resetCodeMatches,
} from "../server/passwordSecurity.mjs";

test("password records use unique salts and do not contain the plaintext password", () => {
  const first = createPasswordRecord("sample-password");
  const second = createPasswordRecord("sample-password");
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.passwordHash, second.passwordHash);
  assert.equal(first.passwordHash.includes("sample-password"), false);
});

test("password verification accepts the correct password and rejects another", () => {
  const record = createPasswordRecord("correct-password");
  assert.equal(passwordMatches("correct-password", record), true);
  assert.equal(passwordMatches("wrong-password", record), false);
});

test("reset codes are six digits and stored as keyed hashes", () => {
  const code = createResetCode();
  const secret = "test-reset-secret";
  const hash = hashResetCode(code, secret);
  assert.match(code, /^\d{6}$/);
  assert.notEqual(hash, code);
  assert.equal(resetCodeMatches(code, hash, secret), true);
  assert.equal(resetCodeMatches("000000", hash, secret), code === "000000");
});
