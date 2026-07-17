import {
  createHmac,
  pbkdf2Sync,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";

export const PASSWORD_ITERATIONS = 120000;

export function createPasswordRecord(password) {
  const salt = randomBytes(16).toString("hex");
  return {
    salt,
    passwordHash: hashPassword(password, salt),
  };
}

export function hashPassword(password, salt) {
  return pbkdf2Sync(String(password), salt, PASSWORD_ITERATIONS, 32, "sha256").toString("hex");
}

export function passwordMatches(password, user) {
  return safeHexEqual(user.passwordHash, hashPassword(password, user.salt));
}

export function createResetCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashResetCode(code, secret) {
  return createHmac("sha256", secret).update(String(code)).digest("hex");
}

export function resetCodeMatches(code, expectedHash, secret) {
  return safeHexEqual(expectedHash, hashResetCode(code, secret));
}

function safeHexEqual(expectedHex, actualHex) {
  try {
    const expected = Buffer.from(expectedHex, "hex");
    const actual = Buffer.from(actualHex, "hex");
    return expected.length > 0
      && expected.length === actual.length
      && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
