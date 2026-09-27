export function createPasswordResetDraft() {
  return { code: "", password: "", confirmation: "", visible: false, errors: {},
    action: "", retryAt: 0, expiresAt: 0 };
}
export function remainingResetSeconds(deadline, now = Date.now()) {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}
export function validatePasswordReset(draft) {
  const errors = {};
  if (!/^\d{6}$/.test(draft.code.trim())) errors.code = "Enter the six-digit reset code.";
  if (draft.password.length < 6) errors.password = "Use at least 6 characters.";
  if (draft.password !== draft.confirmation) errors.confirmation = "Passwords do not match.";
  return errors;
}
