import { createPasswordResetDraft, remainingResetSeconds, validatePasswordReset } from "./services/auth/passwordResetState.mjs";
import { renderWeatherCard, renderWeatherPullIndicator } from "./components/WeatherCard.mjs";
import { renderLocationHomePage, renderLocationPageIndicator } from "./components/LocationHomePage.mjs";
import { createWeatherController } from "./hooks/useWeather.mjs";
import { findLocationById, locationPages, shifts } from "./constants/locationPages.mjs";
import {
  calculateRotationIntervals,
  createSchedule,
} from "./services/schedule/rotationService.mjs";
import {
  calendarMonthCells,
  eventsForDate,
  eventsForMonth,
  monthStartISO,
  shiftCalendarDateByMonth,
} from "./services/calendar/calendarService.mjs";
import {
  cleanVolunteerContacts,
  contactsForEvent,
  createGroupMessagePayload,
  createVolunteerContact,
  normalizePhoneNumber,
  parseRosterObservations,
  prepareRosterReview,
} from "./services/volunteers/rosterService.mjs";
import {
  createNote,
  hasNoteContent,
  mergeNotes,
  migrateLegacyTopic,
  normalizeNotes,
  noteDisplayTitle,
  removeNoteById,
  searchNotes,
} from "./services/notes/noteService.mjs";
import {
  getStoredAuthToken,
  removeStoredAuthToken,
  storeAuthToken,
} from "./services/auth/sessionTokenStorage.mjs";

const rotationDurations = [15, 20, 30];

const tasks = [
  "Sent confirmation text to volunteers",
  "Created shift rotation",
  "Reviewed safety procedures",
  "Reviewed topic of discussion",
  "Sent EOS report",
];

const APP_CONFIG = window.KEYMAN_CONFIG || {};
const AUTH_API_BASE = String(APP_CONFIG.authApiBase || "").replace(/\/+$/, "");
const PRIVACY_POLICY_URL = APP_CONFIG.privacyPolicyUrl || "";
const initialLocalNotes = migrateLegacyTopic({
  notes: readStore("keyman-notes", []),
  topic: readStore("keyman-topic", ""),
});

const state = {
  authEmail: localStorage.getItem("keyman-auth-email") || "",
  authUser: null,
  authChecking: Boolean(getAuthToken()),
  authBusy: false,
  authenticated: false,
  authMode: "signin",
  authView: "signin",
  authMessage: "",
  authMessageType: "error",
  passwordResetDraft: createPasswordResetDraft(),
  passwordResetEmail: "",
  passwordResetDevelopmentCode: "",
  profileView: "settings",
  profileMessage: "",
  profileBusy: false,
  tab: getInitialTab(),
  homeView: "shifts",
  activeLocationIndex: 0,
  quickActionsOpen: false,
  selectedLocation: null,
  selectedShift: null,
  selectedRotationDuration: 30,
  primaryOnly: false,
  rotationView: "setup",
  rotationOrigin: "home",
  scheduleEditing: false,
  selectedDate: todayISO(),
  volunteerContacts: [],
  rosterReview: [],
  rosterReviewOpen: false,
  rosterSourceOpen: false,
  rosterBusy: false,
  schedule: null,
  message: "",
  events: normalizeEvents(readStore("keyman-events", [])),
  checks: readStore("keyman-checks", {}),
  notes: initialLocalNotes.notes,
  notesView: "list",
  activeNoteId: null,
  noteSearch: "",
  noteSaveStatus: "saved",
  noteSwipeId: null,
  expanded: {},
  search: "",
  checklistSwipeId: null,
  calendarDate: todayISO(),
  calendarMonth: monthStartISO(todayISO()),
  calendarCreateOpen: false,
  calendarEventId: null,
  calendarEditing: false,
  calendarDraft: [],
  calendarEditMessage: "",
  appDataLoaded: false,
};

const app = document.querySelector("#app");
const nav = document.querySelector(".bottom-nav");
const shell = document.querySelector(".phone-shell");
const weatherByLocation = new Map(locationPages.map((location) => [
  location.id,
  createWeatherController({ location: location.weatherLocation }),
]));
let toastTimer = null;
let appDataSyncTimer = null;
let noteAutosaveTimer = null;
let sessionValidationPromise = null;

writeStore("keyman-notes", state.notes);
writeStore("keyman-topic", "");

weatherByLocation.forEach((weather, locationId) => {
  weather.subscribe(() => {
    renderWeatherCardIntoSlot(locationId);
  });
});

nav.addEventListener("click", (event) => {
  if (!state.authenticated) return;
  const button = event.target.closest(".nav-item");
  if (!button) return;
  state.tab = button.dataset.tab;
  state.selectedShift = null;
  state.selectedLocation = null;
  state.volunteerContacts = [];
  state.rosterReview = [];
  state.rosterReviewOpen = false;
  state.rosterSourceOpen = false;
  state.rosterBusy = false;
  state.selectedRotationDuration = 30;
  state.primaryOnly = false;
  state.rotationView = "setup";
  state.rotationOrigin = "home";
  state.scheduleEditing = false;
  state.homeView = "shifts";
  state.notesView = "list";
  state.activeNoteId = null;
  state.noteSearch = "";
  state.noteSaveStatus = "saved";
  state.noteSwipeId = null;
  state.profileView = "settings";
  state.profileMessage = "";
  state.calendarEventId = null;
  state.calendarCreateOpen = false;
  state.calendarEditing = false;
  state.calendarEditMessage = "";
  window.location.hash = state.tab === "home" ? "" : state.tab;
  state.message = "";
  updateNav();
  render();
  window.scrollTo(0, 0);
});

function render() {
  updateShellSurface();
  if (!state.authenticated) {
    renderAuth();
    return;
  }
  if (state.tab === "calendar") renderCalendar();
  else if (state.tab === "checklist") renderChecklist();
  else if (state.tab === "profile") renderProfile();
  else if (state.selectedShift) renderBuilder();
  else if (state.homeView === "notes") renderNotesScreen();
  else renderHome();
}

function updateNav() {
  shell.dataset.auth = state.authenticated ? "unlocked" : "locked";
  shell.dataset.tab = state.tab;
  document.querySelectorAll(".nav-item").forEach((item) => {
    const isActive = item.dataset.tab === state.tab;
    item.classList.toggle("is-active", isActive);
    if (isActive) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
}

function updateShellSurface() {
  const isRotationFlow = state.authenticated && state.tab === "home" && Boolean(state.selectedShift);
  const isNotesEditor = state.authenticated
    && state.tab === "home"
    && state.homeView === "notes"
    && state.notesView === "editor";
  const isMintPage = state.authenticated && state.tab === "home" && state.homeView === "shifts";
  const isNotesPage = state.authenticated
    && state.tab === "home"
    && state.homeView === "notes";
  const isWhitePage = state.authenticated && (state.tab === "calendar" || isNotesPage);
  const surface = !state.authenticated ? "auth" : isRotationFlow ? "rotation" : isMintPage ? "mint" : isWhitePage ? "white" : "paper";
  const color = surface === "auth" || surface === "rotation" || surface === "white" ? "#ffffff" : surface === "mint" ? "#dff3ec" : "#f6faf8";
  shell.dataset.surface = surface;
  shell.dataset.rotationFlow = isRotationFlow ? "active" : "inactive";
  shell.dataset.notesEditor = isNotesEditor ? "active" : "inactive";
  document.documentElement.style.setProperty("--native-status-surface", color);
  updateNativeStatusBar(color);
}

function renderAuth() {
  if (state.authView !== "signin") {
    renderPasswordReset();
    return;
  }
  const isCreate = state.authMode === "create";
  app.className = "app auth-app";
  app.innerHTML = `
    <section class="auth-screen">
      <img class="auth-logo" src="assets/auth-logo.png" alt="Keyman app logo">
      <div class="auth-card">
        <div>
          <h1>${state.authChecking ? "Checking account" : isCreate ? "Create account" : "Sign in"}</h1>
        </div>
        <form id="authForm" class="auth-form" ${state.authChecking ? "aria-busy=\"true\"" : ""}>
          <label>
            <span>Email address</span>
            <input id="authEmail" class="auth-input" type="email" autocomplete="email" value="${escapeAttr(state.authEmail)}" ${state.authChecking ? "disabled" : ""} required>
          </label>
          <label>
            <span>Password</span>
            <input id="authPassword" class="auth-input" type="password" autocomplete="${isCreate ? "new-password" : "current-password"}" ${state.authChecking ? "disabled" : ""} required minlength="6">
          </label>
          ${!isCreate ? `<button class="forgot-password-link" id="forgotPassword" type="button" ${state.authChecking || state.authBusy ? "disabled" : ""}>Forgot Password?</button>` : ""}
          ${state.authMessage ? `<p class="auth-message ${state.authMessageType === "success" ? "is-success" : ""}">${escapeText(state.authMessage)}</p>` : ""}
          <button class="primary-btn" type="submit" ${state.authChecking || state.authBusy ? "disabled" : ""}>${state.authBusy ? "Please wait" : isCreate ? "Create account" : "Sign in"}</button>
        </form>
        <button class="auth-toggle" id="authToggle" type="button" ${state.authChecking || state.authBusy ? "disabled" : ""}>${isCreate ? "I already have an account" : "Create a new account"}</button>
      </div>
    </section>
  `;

  app.querySelector("#authForm").addEventListener("submit", handleAuthSubmit);
  app.querySelector("#authToggle")?.addEventListener("click", () => {
    state.authMode = isCreate ? "signin" : "create";
    state.authMessage = "";
    state.authMessageType = "error";
    renderAuth();
  });
  app.querySelector("#forgotPassword")?.addEventListener("click", () => {
    state.passwordResetDraft = createPasswordResetDraft();
    state.authView = "forgot-email";
    state.passwordResetEmail = state.authEmail;
    state.passwordResetDevelopmentCode = "";
    state.authMessage = "";
    state.authMessageType = "error";
    renderAuth();
  });
}

let passwordResetTimer;
function renderPasswordReset() {
  clearInterval(passwordResetTimer);
  const draft = state.passwordResetDraft;
  const isPasswordStep = state.authView === "forgot-password";
  const busy = state.authBusy ? "disabled" : "";
  const errorAttributes = (field) => `aria-invalid="${Boolean(draft.errors[field])}" aria-describedby="reset-${field}-error"`;
  const fieldError = (field) => `<span id="reset-${field}-error" class="reset-field-error">${escapeText(draft.errors[field] || "")}</span>`;
  app.className = "app auth-app";
  app.innerHTML = `
    <section class="auth-screen">
      <img class="auth-logo auth-logo-small" src="assets/auth-logo.png" alt="Keyman app logo">
      <div class="auth-card password-reset-card">
        <div><h1>${isPasswordStep ? "Create new password" : "Forgot password?"}</h1>
          <p class="auth-copy">${isPasswordStep
            ? `Use the six-digit code emailed to ${escapeText(state.passwordResetEmail)}. Check your spam folder too.`
            : "Enter your account email and we’ll send you a reset code."}</p></div>
        ${isPasswordStep ? `
          <form id="passwordResetForm" class="auth-form" novalidate aria-busy="${state.authBusy}">
            <label><span>Reset code</span>
              <input id="passwordResetCode" class="auth-input reset-code-input" inputmode="numeric" autocomplete="one-time-code" maxlength="6" ${errorAttributes("code")} ${busy} required>
              ${fieldError("code")}
            </label>
            <p id="resetExpiry" class="reset-hint">Codes expire after 15 minutes.</p>
            <label><span>New password</span>
              <input id="newPassword" class="auth-input" type="${draft.visible ? "text" : "password"}" autocomplete="new-password" minlength="6" ${errorAttributes("password")} ${busy} required>
              ${fieldError("password")}
            </label>
            <label><span>Confirm new password</span>
              <input id="confirmNewPassword" class="auth-input" type="${draft.visible ? "text" : "password"}" autocomplete="new-password" minlength="6" ${errorAttributes("confirmation")} ${busy} required>
              ${fieldError("confirmation")}
            </label>
            <button class="auth-toggle reset-visibility" id="toggleResetPassword" type="button" aria-pressed="${draft.visible}" aria-controls="newPassword confirmNewPassword" ${busy}>${draft.visible ? "Hide passwords" : "Show passwords"}</button>
            <p class="auth-message ${state.authMessageType === "success" ? "is-success" : ""}" role="status" aria-live="polite" aria-atomic="true">${escapeText(state.authMessage)}</p>
            ${state.passwordResetDevelopmentCode ? `<p class="development-code">Development reset code: <strong>${escapeText(state.passwordResetDevelopmentCode)}</strong></p>` : ""}
            <button class="primary-btn" type="submit" ${busy}>${draft.action === "updating" ? "Updating password…" : "Update password"}</button>
            <button class="auth-toggle" id="resendResetCode" type="button" ${busy}>${draft.action === "resending" ? "Resending code…" : "Send a new code"}</button>
            <button class="auth-toggle" id="changeResetEmail" type="button" ${busy}>Change email</button>
          </form>` : `
          <form id="passwordResetEmailForm" class="auth-form" novalidate aria-busy="${state.authBusy}">
            <label><span>Email address</span>
              <input id="passwordResetEmail" class="auth-input" type="email" autocomplete="email" value="${escapeAttr(state.passwordResetEmail)}" ${errorAttributes("email")} ${busy} required>
              ${fieldError("email")}
            </label>
            <p class="auth-message ${state.authMessageType === "success" ? "is-success" : ""}" role="status" aria-live="polite" aria-atomic="true">${escapeText(state.authMessage)}</p>
            <button class="primary-btn" type="submit" ${busy}>${draft.action === "sending" ? "Sending code…" : "Send reset code"}</button>
          </form>`}
        <button class="auth-toggle" id="backToSignIn" type="button" ${busy}>Back to sign in</button>
      </div>
    </section>`;
  const fields = { passwordResetCode: "code", newPassword: "password", confirmNewPassword: "confirmation" };
  for (const [id, field] of Object.entries(fields)) {
    const input = app.querySelector(`#${id}`);
    if (!input) continue;
    input.value = draft[field];
    input.addEventListener("input", () => { draft[field] = input.value; });
  }
  app.querySelector("#passwordResetEmail")?.addEventListener("input", (event) => {
    state.passwordResetEmail = event.target.value;
  });
  app.querySelector("#backToSignIn").addEventListener("click", returnToSignIn);
  app.querySelector("#passwordResetEmailForm")?.addEventListener("submit", handlePasswordResetEmail);
  app.querySelector("#passwordResetForm")?.addEventListener("submit", handlePasswordResetSubmit);
  app.querySelector("#resendResetCode")?.addEventListener("click", () => requestPasswordResetCode(state.passwordResetEmail));
  app.querySelector("#toggleResetPassword")?.addEventListener("click", (event) => {
    draft.visible = !draft.visible;
    for (const id of ["newPassword", "confirmNewPassword"]) app.querySelector(`#${id}`).type = draft.visible ? "text" : "password";
    event.currentTarget.setAttribute("aria-pressed", String(draft.visible));
    event.currentTarget.textContent = draft.visible ? "Hide passwords" : "Show passwords";
  });
  app.querySelector("#changeResetEmail")?.addEventListener("click", () => {
    clearInterval(passwordResetTimer);
    state.passwordResetDraft = createPasswordResetDraft();
    state.passwordResetDevelopmentCode = "";
    state.authView = "forgot-email";
    state.authMessage = "";
    renderAuth();
    app.querySelector("#passwordResetEmail")?.focus();
  });
  if (isPasswordStep) {
    updatePasswordResetCountdown();
    passwordResetTimer = setInterval(updatePasswordResetCountdown, 1000);
  }
}

function updatePasswordResetCountdown() {
  if (state.authView !== "forgot-password") { clearInterval(passwordResetTimer); return; }
  const draft = state.passwordResetDraft;
  const seconds = remainingResetSeconds(draft.retryAt);
  const button = app.querySelector("#resendResetCode");
  if (button) {
    button.disabled = state.authBusy || seconds > 0;
    button.textContent = draft.action === "resending" ? "Resending code…"
      : seconds > 0 ? `Send a new code in ${seconds}s` : "Send a new code";
  }
  const expiry = app.querySelector("#resetExpiry");
  if (expiry) expiry.textContent = draft.expiresAt && Date.now() >= draft.expiresAt
    ? "Your code may have expired. Request a new code to continue."
    : "Codes expire after 15 minutes. Use the most recent email.";
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state.authView === "forgot-password") updatePasswordResetCountdown();
});

async function handlePasswordResetEmail(event) {
  event.preventDefault();
  if (state.authBusy) return;
  const email = app.querySelector("#passwordResetEmail").value.trim().toLowerCase();
  state.passwordResetEmail = email;
  state.passwordResetDraft.errors = {};
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    state.passwordResetDraft.errors.email = "Enter a valid email address.";
    renderAuth();
    app.querySelector("#passwordResetEmail").focus();
    return;
  }
  await requestPasswordResetCode(email);
}

async function requestPasswordResetCode(email) {
  const draft = state.passwordResetDraft;
  if (state.authBusy || remainingResetSeconds(draft.retryAt) > 0) return;
  state.passwordResetEmail = email;
  const resending = state.authView === "forgot-password";
  draft.action = resending ? "resending" : "sending";
  draft.errors = {};
  state.authBusy = true;
  state.authMessage = "";
  state.authMessageType = "error";
  renderAuth();
  try {
    const result = await authRequest("/api/auth/password-reset/request", { method: "POST", body: { email }, timeoutMs: 15000 });
    state.authView = "forgot-password";
    state.passwordResetDevelopmentCode = result.developmentCode || "";
    draft.code = "";
    draft.retryAt = Date.now() + (result.retryAfterSeconds || 60) * 1000;
    draft.expiresAt = Date.now() + (result.expiresInSeconds || 900) * 1000;
    state.authMessage = "If an account exists for that email, a code is on its way.";
    state.authMessageType = "success";
  } catch (error) {
    if (error.status === 429) draft.retryAt = Date.now() + (error.retryAfterSeconds || 60) * 1000;
    state.authMessage = error.status === 404 ? "Password recovery is currently unavailable. Please try again later."
      : error.message || "Unable to send a reset code. Please try again.";
  } finally {
    state.authBusy = false;
    draft.action = "";
    renderAuth();
    if (state.authMessageType === "success") app.querySelector("#passwordResetCode")?.focus();
  }
}

async function handlePasswordResetSubmit(event) {
  event.preventDefault();
  if (state.authBusy) return;
  const draft = state.passwordResetDraft;
  draft.code = app.querySelector("#passwordResetCode").value.trim();
  draft.password = app.querySelector("#newPassword").value;
  draft.confirmation = app.querySelector("#confirmNewPassword").value;
  draft.errors = validatePasswordReset(draft);
  state.authMessage = "";
  state.authMessageType = "error";
  if (Object.keys(draft.errors).length) {
    renderAuth();
    app.querySelector('[aria-invalid="true"]')?.focus();
    return;
  }
  draft.action = "updating";
  state.authBusy = true;
  renderAuth();
  try {
    await authRequest("/api/auth/password-reset", {
      method: "POST", timeoutMs: 15000,
      body: { email: state.passwordResetEmail, code: draft.code, newPassword: draft.password },
    });
    const email = state.passwordResetEmail;
    returnToSignIn();
    state.authEmail = email;
    state.authMessage = "Password updated. Sign in with your new password.";
    state.authMessageType = "success";
    renderAuth();
  } catch (error) {
    state.authBusy = false;
    draft.action = "";
    if (error.code === "INVALID_RESET_CODE") draft.errors.code = error.message;
    state.authMessage = error.message || "Unable to update password. Please try again.";
    renderAuth();
    app.querySelector('[aria-invalid="true"]')?.focus();
  }
}

function returnToSignIn() {
  clearInterval(passwordResetTimer);
  state.passwordResetDraft = createPasswordResetDraft();
  state.authView = "signin";
  state.authMode = "signin";
  state.authBusy = false;
  state.authMessage = "";
  state.authMessageType = "error";
  state.passwordResetEmail = "";
  state.passwordResetDevelopmentCode = "";
  renderAuth();
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const email = app.querySelector("#authEmail").value.trim().toLowerCase();
  const password = app.querySelector("#authPassword").value;
  const isCreate = state.authMode === "create";

  if (!email || password.length < 6) {
    state.authMessage = "Enter an email and a password with at least 6 characters.";
    renderAuth();
    return;
  }

  state.authBusy = true;
  state.authMessage = "";
  renderAuth();

  try {
    const result = await authRequest(isCreate ? "/api/auth/register" : "/api/auth/login", {
      method: "POST",
      body: { email, password },
    });
    state.authUser = result.user;
    state.authEmail = result.user.email;
    state.authenticated = true;
    state.authMode = "signin";
    state.authView = "signin";
    state.authBusy = false;
    state.authMessage = "";
    state.authMessageType = "error";
    localStorage.setItem("keyman-auth-email", result.user.email);
    setAuthToken(result.token);
    await loadAccountData();
    updateNav();
    render();
  } catch (error) {
    state.authBusy = false;
    state.authMessage = error.message || "Unable to sign in. Make sure the auth backend is running.";
    state.authMessageType = "error";
    renderAuth();
  }
}

function getInitialTab() {
  const tab = window.location.hash.replace("#", "");
  return ["home", "calendar", "checklist", "profile"].includes(tab) ? tab : "home";
}

function renderProfile() {
  if (state.profileView === "privacy") {
    renderPrivacyPolicy();
    return;
  }

  app.className = "app profile-screen";
  app.innerHTML = `
    <section class="screen">
      <div class="topbar">
        <div>
          <h1>Profile</h1>
          <p class="subtle">${escapeText(state.authUser?.email || state.authEmail || "Signed in")}</p>
        </div>
      </div>

      <article class="profile-card">
        <div class="profile-row">
          <span>Account</span>
          <strong>${escapeText(state.authUser?.email || state.authEmail || "Keyman user")}</strong>
        </div>
      </article>

      ${state.profileMessage ? `<p class="message">${escapeText(state.profileMessage)}</p>` : ""}

      <div class="profile-actions">
        <button class="secondary-btn" id="privacyPolicy" type="button">Privacy Policy</button>
        <button class="secondary-btn" id="signOut" type="button" ${state.profileBusy ? "disabled" : ""}>Sign out</button>
        <button class="danger-btn" id="deleteAccount" type="button" ${state.profileBusy ? "disabled" : ""}>Delete account</button>
      </div>
    </section>
  `;

  app.querySelector("#privacyPolicy").addEventListener("click", () => {
    if (PRIVACY_POLICY_URL) {
      window.open(PRIVACY_POLICY_URL, "_blank", "noopener");
      return;
    }
    state.profileView = "privacy";
    renderProfile();
  });
  app.querySelector("#signOut").addEventListener("click", signOut);
  app.querySelector("#deleteAccount").addEventListener("click", deleteAccount);
}

function renderPrivacyPolicy() {
  app.className = "app profile-screen";
  app.innerHTML = `
    <section class="screen">
      <div class="topbar">
        <button class="icon-btn" id="backToProfile" aria-label="Back to profile">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <div>
          <h1>Privacy Policy</h1>
          <p class="subtle">Keyman Assistant</p>
        </div>
      </div>
      <article class="privacy-card">
        <h2>Information used by the app</h2>
        <p>The app stores your email address for sign in, volunteer names and phone numbers, rotation schedules, checklist progress, and notes you create for shift planning.</p>
        <h2>Roster image recognition</h2>
        <p>Roster screenshots and images are selected by you and processed on your device to recognize names and phone numbers. Keyman Assistant does not upload or retain the source image. You review recognized information before adding it to a shift.</p>
        <h2>How it is stored</h2>
        <p>Confirmed volunteer contact information, schedules, checklist information, and user notes are saved to the Keyman Assistant backend for your account and cached on this device. Passwords are stored as salted hashes.</p>
        <h2>Sharing</h2>
        <p>Keyman Assistant does not sell personal information. Data is used only to support account access and shift planning. When you create a group message, recipients may see one another’s phone numbers; the app warns you before opening Messages, and you decide whether to send.</p>
        <h2>Account deletion</h2>
        <p>You can delete your account from the Profile page. This removes the account from the backend and clears local app data from this device.</p>
      </article>
    </section>
  `;

  app.querySelector("#backToProfile").addEventListener("click", () => {
    state.profileView = "settings";
    renderProfile();
  });
}

function renderHome() {
  app.className = "app";
  app.innerHTML = `
    <section class="screen">
      ${renderLocationPageIndicator(locationPages, state.activeLocationIndex)}
      <div class="location-pager" aria-label="Location pages">
        ${locationPages.map((location, index) => renderLocationHomePage({
          location,
          index,
          quickActionsOpen: state.quickActionsOpen,
          weatherMarkup: renderWeatherCard(weatherByLocation.get(location.id).getState()),
          weatherPullIndicatorMarkup: renderWeatherPullIndicator(),
        })).join("")}
      </div>
    </section>
  `;

  attachLocationPaging();
  app.querySelectorAll(".hero").forEach((hero) => attachQuickActionsHandle(hero));
  attachWeatherCardActions();
  weatherByLocation.forEach((weather) => weather.load());

  app.querySelectorAll(".shift-card").forEach((card) => {
    card.addEventListener("click", () => {
      const location = findLocationById(card.dataset.location);
      const shift = location.shifts.find((item) => item.id === card.dataset.shift);
      if (shift) beginRotationFlow(location, shift, todayISO(), "home");
    });
  });

  app.querySelectorAll(".quick-action-card").forEach((card) => {
    card.addEventListener("click", () => {
      state.homeView = card.dataset.action;
      if (state.homeView === "notes") {
        state.notesView = "list";
        state.activeNoteId = null;
        state.noteSearch = "";
        state.noteSwipeId = null;
      }
      render();
      window.scrollTo(0, 0);
    });
  });
}

function beginRotationFlow(location, shift, date, origin = "home") {
  state.selectedLocation = location;
  state.selectedShift = shift;
  state.selectedRotationDuration = 30;
  state.primaryOnly = false;
  state.rotationView = "setup";
  state.rotationOrigin = origin === "calendar" ? "calendar" : "home";
  state.scheduleEditing = false;
  state.selectedDate = date || todayISO();
  state.volunteerContacts = Array.from({ length: shift.slots }, () => createVolunteerContact());
  state.rosterReview = [];
  state.rosterReviewOpen = false;
  state.rosterSourceOpen = false;
  state.rosterBusy = false;
  state.schedule = null;
  state.message = "";
  state.calendarCreateOpen = false;
  state.tab = "home";
  window.location.hash = "";
  updateNav();
  renderBuilder();
  window.scrollTo(0, 0);
}

function attachLocationPaging() {
  const pager = app.querySelector(".location-pager");
  if (!pager) return;
  pager.scrollLeft = state.activeLocationIndex * pager.clientWidth;
  let frame = null;
  pager.addEventListener("scroll", () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const index = clamp(Math.round(pager.scrollLeft / Math.max(pager.clientWidth, 1)), 0, locationPages.length - 1);
      if (index === state.activeLocationIndex) return;
      state.activeLocationIndex = index;
      updateLocationIndicator();
    });
  }, { passive: true });
  app.querySelectorAll(".location-page-dot").forEach((dot) => {
    dot.addEventListener("click", () => {
      const index = Number(dot.dataset.locationIndex);
      state.activeLocationIndex = index;
      pager.scrollTo({ left: index * pager.clientWidth, behavior: "smooth" });
      updateLocationIndicator();
    });
  });
}

function updateLocationIndicator() {
  app.querySelectorAll(".location-page-dot").forEach((dot, index) => {
    const active = index === state.activeLocationIndex;
    dot.classList.toggle("is-active", active);
    dot.setAttribute("aria-selected", String(active));
  });
}

function attachQuickActionsHandle(hero) {
  const handle = hero.querySelector(".sheet-handle");
  const panel = hero.querySelector(".shift-panel");
  if (!handle || !hero || !panel) return;
  let startY = 0;
  let dragged = false;
  let dragBase = state.quickActionsOpen ? 1 : 0;
  let startedOnHandle = false;
  let startedInWeather = false;
  let pullingWeather = false;
  let suppressNextClick = false;

  hero.addEventListener("pointerdown", (event) => {
    startY = event.clientY;
    dragged = false;
    startedOnHandle = Boolean(event.target.closest(".sheet-handle"));
    startedInWeather = Boolean(event.target.closest(".hero-location")) && !state.quickActionsOpen;
    pullingWeather = false;
    dragBase = state.quickActionsOpen ? 1 : 0;
    hero.setPointerCapture?.(event.pointerId);
  });

  hero.addEventListener("pointermove", (event) => {
    if (!startY) return;
    const delta = event.clientY - startY;
    if (startedInWeather && dragBase === 0 && delta > 0) {
      const pullProgress = clamp(delta / 72, 0, 1);
      hero.style.setProperty("--weather-pull-progress", String(pullProgress));
      hero.style.setProperty("--weather-pull-offset", `${Math.round(pullProgress * 18)}px`);
      hero.style.setProperty("--weather-pull-rotation", `${Math.round(pullProgress * 180)}deg`);
      hero.style.setProperty("--weather-card-pull", `${Math.round(pullProgress * 12)}px`);
      hero.classList.toggle("is-weather-pull-ready", pullProgress >= 1);
      if (delta < 12) return;
      if (event.cancelable) event.preventDefault();
      dragged = true;
      pullingWeather = true;
      return;
    }
    const nextProgress = clamp(dragBase - delta / 120, 0, 1);
    if (hero && panel) {
      hero.style.setProperty("--location-opacity", String(1 - nextProgress));
      hero.style.setProperty("--location-offset", `${Math.round(nextProgress * -58)}px`);
    }
    if (Math.abs(delta) < 18) {
      return;
    }
    if (event.cancelable) {
      event.preventDefault();
    }
    dragged = true;
    panel.classList.toggle("is-expanded", nextProgress > 0.5);
    hero.classList.toggle("is-actions-open", nextProgress > 0.5);
    handle.setAttribute("aria-expanded", String(nextProgress > 0.5));
  });

  hero.addEventListener("pointerup", (event) => {
    if (!startY) return;
    const delta = event.clientY - startY;
    startY = 0;
    if (pullingWeather) {
      suppressNextClick = true;
      clearWeatherPull(hero);
      if (delta >= 72) {
        const locationId = hero.closest(".location-page")?.dataset.locationId;
        weatherByLocation.get(locationId)?.refresh();
      }
      return;
    }
    clearLocationDrag(hero);
    if (!dragged) {
      if (startedOnHandle) {
        setQuickActionsOpen(!state.quickActionsOpen);
      }
      return;
    }
    suppressNextClick = true;
    setQuickActionsOpen(dragBase - delta / 120 > 0.5);
  });

  hero.addEventListener("pointercancel", () => {
    startY = 0;
    pullingWeather = false;
    clearWeatherPull(hero);
    clearLocationDrag(hero);
    setQuickActionsOpen(state.quickActionsOpen);
  });

  hero.addEventListener("click", (event) => {
    if (!suppressNextClick) return;
    suppressNextClick = false;
    event.preventDefault();
    event.stopPropagation();
  }, true);
}

function renderWeatherCardIntoSlot(locationId) {
  const slot = app.querySelector(`[data-weather-location="${locationId}"]`);
  if (!slot) return;
  slot.innerHTML = renderWeatherCard(weatherByLocation.get(locationId).getState());
  attachWeatherCardActions();
}

function attachWeatherCardActions() {
  app.querySelectorAll(".weather-retry").forEach((button) => {
    button.addEventListener("click", () => {
      const locationId = button.closest(".weather-card-slot")?.dataset.weatherLocation;
      weatherByLocation.get(locationId)?.refresh();
    });
  });
}

function clearWeatherPull(hero) {
  if (!hero) return;
  hero.style.removeProperty("--weather-pull-progress");
  hero.style.removeProperty("--weather-pull-offset");
  hero.style.removeProperty("--weather-pull-rotation");
  hero.style.removeProperty("--weather-card-pull");
  hero.classList.remove("is-weather-pull-ready");
}

function setQuickActionsOpen(open) {
  state.quickActionsOpen = open;
  app.querySelectorAll(".hero").forEach((hero) => {
    const panel = hero.querySelector(".shift-panel");
    const handle = hero.querySelector(".sheet-handle");
    const actions = hero.querySelector(".quick-actions");
    if (!panel || !handle || !actions) return;
    clearLocationDrag(hero);
    hero.classList.toggle("is-actions-open", open);
    panel.classList.toggle("is-expanded", open);
    handle.setAttribute("aria-expanded", String(open));
    handle.setAttribute("aria-label", open ? "Hide quick actions" : "Show quick actions");
    actions.setAttribute("aria-hidden", String(!open));
  });
}

function clearLocationDrag(hero) {
  if (!hero) return;
  hero.style.removeProperty("--location-opacity");
  hero.style.removeProperty("--location-offset");
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function renderNotesScreen() {
  updateShellSurface();
  if (state.notesView === "editor" && state.activeNoteId) {
    renderNoteEditor();
    return;
  }
  renderNotesList();
}

function renderNotesList() {
  state.notesView = "list";
  app.className = "app action-screen notes-screen";
  app.innerHTML = `
    <section class="screen notes-page">
      <header class="notes-header">
        <button class="icon-btn" id="backToHome" type="button" aria-label="Back to home">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <div>
          <h1>Notes</h1>
          <p class="subtle">Keep shift reminders and ideas together.</p>
        </div>
        <button class="notes-new-btn" id="newNote" type="button" aria-label="New Note">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>
          <span class="notes-new-label-full">New Note</span>
          <span class="notes-new-label-short" aria-hidden="true">New</span>
        </button>
      </header>
      <label class="notes-search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg>
        <span class="sr-only">Search notes</span>
        <input id="noteSearch" type="search" value="${escapeAttr(state.noteSearch)}" placeholder="Search notes" autocomplete="off">
      </label>
      <div class="notes-list" id="notesList"></div>
    </section>
  `;

  app.querySelector("#backToHome").addEventListener("click", () => {
    state.homeView = "shifts";
    state.noteSearch = "";
    state.noteSwipeId = null;
    render();
    window.scrollTo(0, 0);
  });
  app.querySelector("#newNote").addEventListener("click", openNewNote);
  app.querySelector("#noteSearch").addEventListener("input", (event) => {
    state.noteSearch = event.target.value;
    state.noteSwipeId = null;
    renderNotesResults();
  });
  renderNotesResults();
}

function renderNotesResults() {
  const list = app.querySelector("#notesList");
  if (!list) return;
  const notes = searchNotes(state.notes, state.noteSearch);
  if (!notes.length) {
    const searching = Boolean(state.noteSearch.trim());
    list.innerHTML = `
      <div class="notes-empty">
        <span class="notes-empty-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"></path><path d="M14 3v6h6"></path><path d="M8 14h8M8 18h5"></path></svg>
        </span>
        <h2>${searching ? "No matching notes" : "No notes yet"}</h2>
        <p>${searching ? "Try a different word or phrase." : "Create a note for reminders, ideas, or anything you need during a shift."}</p>
        ${searching ? "" : `<button class="primary-btn" id="emptyNewNote" type="button">Create your first note</button>`}
      </div>
    `;
    app.querySelector("#emptyNewNote")?.addEventListener("click", openNewNote);
    return;
  }

  list.innerHTML = notes.map(renderNoteCard).join("");
  list.querySelectorAll(".note-card-open").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.noteId;
      if (state.noteSwipeId === id) {
        setNoteSwipeOpen(null);
        return;
      }
      openNote(id);
    });
  });
  list.querySelectorAll(".note-delete-action").forEach((button) => {
    button.addEventListener("click", async () => {
      const note = state.notes.find((item) => item.id === button.dataset.deleteNote);
      if (!note || !confirm(`Delete “${noteDisplayTitle(note)}”? This cannot be undone.`)) return;
      state.notes = removeNoteById(state.notes, note.id);
      state.noteSwipeId = null;
      await persistAppData({ immediate: true });
      renderNotesResults();
      showToast("Note deleted");
    });
  });
  attachNoteSwipeActions();
}

function renderNoteCard(note) {
  const preview = note.body.trim().replace(/\s+/g, " ") || "No additional text";
  return `
    <div class="note-card-swipe ${state.noteSwipeId === note.id ? "is-revealed" : ""}" data-note-id="${escapeAttr(note.id)}">
      <button class="note-delete-action" data-delete-note="${escapeAttr(note.id)}" type="button" aria-label="Delete ${escapeAttr(noteDisplayTitle(note))}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="m19 6-1 15H6L5 6"></path><path d="M10 11v5M14 11v5"></path></svg>
        <span>Delete</span>
      </button>
      <article class="note-card">
        <button class="note-card-open" type="button" data-note-id="${escapeAttr(note.id)}" aria-label="Open ${escapeAttr(noteDisplayTitle(note))}">
          <span class="note-card-copy">
            <strong>${escapeText(noteDisplayTitle(note))}</strong>
            <span>${escapeText(preview)}</span>
            <small>${escapeText(formatNoteUpdated(note.updatedAt))}</small>
          </span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>
        </button>
      </article>
    </div>
  `;
}

function openNewNote() {
  const note = createNote();
  state.notes = [...state.notes, note];
  state.activeNoteId = note.id;
  state.notesView = "editor";
  state.noteSaveStatus = "saved";
  state.noteSwipeId = null;
  renderNotesScreen();
  app.querySelector("#noteTitle")?.focus();
}

function openNote(id) {
  if (!state.notes.some((note) => note.id === id)) return;
  state.activeNoteId = id;
  state.notesView = "editor";
  state.noteSaveStatus = "saved";
  state.noteSwipeId = null;
  renderNotesScreen();
}

function renderNoteEditor() {
  const note = state.notes.find((item) => item.id === state.activeNoteId);
  if (!note) {
    state.notesView = "list";
    state.activeNoteId = null;
    renderNotesScreen();
    return;
  }

  app.className = "app action-screen note-editor-screen";
  app.innerHTML = `
    <section class="screen note-editor-page">
      <header class="note-editor-header">
        <button class="note-editor-back" id="backToNotes" type="button" aria-label="Back to notes">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <span class="note-save-status" id="noteSaveStatus" role="status" aria-live="polite">${state.noteSaveStatus === "saving" ? "Saving…" : "Saved"}</span>
        <button class="note-done-btn" id="doneNote" type="button">Done</button>
      </header>
      <div class="note-writing-canvas">
        <label class="sr-only" for="noteTitle">Note title</label>
        <input class="note-title-input" id="noteTitle" type="text" value="${escapeAttr(note.title)}" placeholder="Title" autocomplete="off">
        <div class="note-editor-divider"></div>
        <label class="sr-only" for="noteBody">Note text</label>
        <textarea class="note-body-input" id="noteBody" placeholder="Start writing…" spellcheck="true">${escapeText(note.body)}</textarea>
      </div>
    </section>
  `;

  const updateNote = () => {
    const title = app.querySelector("#noteTitle")?.value || "";
    const body = app.querySelector("#noteBody")?.value || "";
    const updatedAt = new Date().toISOString();
    state.notes = state.notes.map((item) => (
      item.id === note.id ? { ...item, title, body, updatedAt } : item
    ));
    scheduleNoteAutosave();
  };
  app.querySelector("#noteTitle").addEventListener("input", updateNote);
  app.querySelector("#noteBody").addEventListener("input", updateNote);
  app.querySelector("#backToNotes").addEventListener("click", finishNoteEditing);
  app.querySelector("#doneNote").addEventListener("click", finishNoteEditing);
}

function scheduleNoteAutosave() {
  saveAppDataLocal();
  clearTimeout(noteAutosaveTimer);
  setNoteSaveStatus("saving");
  noteAutosaveTimer = setTimeout(async () => {
    await persistAppData({ immediate: true });
    setNoteSaveStatus("saved");
  }, 500);
}

async function finishNoteEditing() {
  const back = app.querySelector("#backToNotes");
  const done = app.querySelector("#doneNote");
  if (back?.disabled || done?.disabled) return;
  if (back) back.disabled = true;
  if (done) done.disabled = true;
  clearTimeout(noteAutosaveTimer);
  const note = state.notes.find((item) => item.id === state.activeNoteId);
  if (note && !hasNoteContent(note)) {
    state.notes = removeNoteById(state.notes, note.id);
  }
  setNoteSaveStatus("saving");
  await persistAppData({ immediate: true });
  state.noteSaveStatus = "saved";
  state.notesView = "list";
  state.activeNoteId = null;
  renderNotesScreen();
  window.scrollTo(0, 0);
}

function setNoteSaveStatus(status) {
  state.noteSaveStatus = status === "saving" ? "saving" : "saved";
  const label = app.querySelector("#noteSaveStatus");
  if (label) label.textContent = state.noteSaveStatus === "saving" ? "Saving…" : "Saved";
}

function attachNoteSwipeActions() {
  app.querySelectorAll(".note-card-swipe").forEach((noteShell) => {
    const card = noteShell.querySelector(".note-card");
    const id = noteShell.dataset.noteId;
    let startX = 0;
    let startY = 0;
    let currentOffset = state.noteSwipeId === id ? -84 : 0;
    let dragging = false;
    let suppressNextClick = false;

    card.addEventListener("pointerdown", (event) => {
      startX = event.clientX;
      startY = event.clientY;
      currentOffset = state.noteSwipeId === id ? -84 : 0;
      dragging = false;
      card.setPointerCapture?.(event.pointerId);
    });
    card.addEventListener("pointermove", (event) => {
      if (!startX) return;
      const deltaX = event.clientX - startX;
      const deltaY = event.clientY - startY;
      if (!dragging && Math.abs(deltaY) > Math.abs(deltaX)) return;
      if (Math.abs(deltaX) < 8) return;
      dragging = true;
      if (event.cancelable) event.preventDefault();
      card.style.transform = `translateX(${clamp(currentOffset + deltaX, -84, 0)}px)`;
    });
    card.addEventListener("pointerup", (event) => {
      if (!startX) return;
      const deltaX = event.clientX - startX;
      startX = 0;
      if (!dragging) return;
      suppressNextClick = true;
      const shouldReveal = currentOffset + deltaX < -42;
      card.style.removeProperty("transform");
      setNoteSwipeOpen(shouldReveal ? id : null);
    });
    card.addEventListener("pointercancel", () => {
      startX = 0;
      card.style.removeProperty("transform");
      setNoteSwipeOpen(state.noteSwipeId);
    });
    card.addEventListener("click", (event) => {
      if (!suppressNextClick) return;
      suppressNextClick = false;
      event.preventDefault();
      event.stopPropagation();
    }, true);
  });
}

function setNoteSwipeOpen(id) {
  state.noteSwipeId = id;
  app.querySelectorAll(".note-card-swipe").forEach((noteShell) => {
    noteShell.classList.toggle("is-revealed", noteShell.dataset.noteId === id);
    noteShell.querySelector(".note-card")?.style.removeProperty("transform");
  });
}

function formatNoteUpdated(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Updated recently";
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  if (isToday) {
    return `Updated today at ${date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  }
  return `Updated ${date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" })}`;
}

function renderBuilder() {
  updateShellSurface();
  if (state.rotationView === "review" && state.schedule && cleanNames().length) {
    renderScheduleReview();
    return;
  }
  renderRotationSetup();
}

function renderRotationSetup() {
  const shift = state.selectedShift;
  const location = state.selectedLocation || locationPages[0];
  const names = cleanNames();
  const pendingRosterCount = state.rosterReview.length;
  const rotationSlots = calculateRotationIntervals(
    shift.start,
    shift.end,
    state.selectedRotationDuration,
  ).length;
  const hasGeneratedSchedule = Array.isArray(state.schedule)
    && state.schedule.length > 0
    && names.length > 0;

  app.className = "app builder-screen rotation-flow-screen rotation-setup-screen";
  app.innerHTML = `
    <section class="screen rotation-screen">
      <header class="rotation-flow-header">
        <button class="icon-btn" id="backHome" type="button" aria-label="${state.rotationOrigin === "calendar" ? "Back to calendar" : "Back to shifts"}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <div class="rotation-flow-heading">
          <p>${escapeText(location.title)}</p>
          <h1>Create Rotation</h1>
          <span>${escapeText(shift.label)} · ${rotationSlots} intervals</span>
        </div>
      </header>

      <div class="rotation-setup-content">
        <div class="rotation-setup-controls">
          <label class="compact-control">
            <span>Date</span>
            <input id="shiftDate" type="date" value="${state.selectedDate}">
          </label>
          <label class="compact-control duration-control">
            <span>Rotation</span>
            <select id="rotationDuration" aria-label="Rotation length">
              ${rotationDurations.map((duration) => `
                <option value="${duration}" ${duration === state.selectedRotationDuration ? "selected" : ""}>${duration} min</option>
              `).join("")}
            </select>
          </label>
        </div>

        <label class="primary-only-option">
          <span class="primary-only-copy">
            <strong>Primary location only</strong>
          </span>
          <input id="primaryOnlyToggle" type="checkbox" role="switch" ${state.primaryOnly ? "checked" : ""}>
          <span class="toggle-control" aria-hidden="true"></span>
        </label>

        <div class="volunteer-section-heading">
          <div>
            <h2>Volunteers</h2>
            <p><strong>${names.length}</strong> of ${shift.slots} filled</p>
          </div>
          <button class="import-roster-action" id="${state.rosterBusy ? "cancelRosterImport" : "importRosterImage"}" type="button">
            ${state.rosterBusy ? "Cancel import" : "Import roster"}
          </button>
          ${state.rosterBusy ? "" : `<input class="visually-hidden" id="rosterImageInput" type="file" accept="image/*" tabindex="-1" aria-hidden="true">`}
          ${pendingRosterCount ? `<button class="pending-roster-btn" id="reviewPendingRoster" type="button">Review pending (${pendingRosterCount})</button>` : ""}
        </div>

        <div class="volunteer-grid">
          ${state.volunteerContacts.map((contact, index) => `
            <div class="volunteer-row">
              <span class="volunteer-number" aria-hidden="true">${index + 1}</span>
              <label>
                <span class="visually-hidden">Volunteer ${index + 1} name</span>
                <input class="name-input volunteer-contact-input" data-index="${index}" data-field="name" value="${escapeAttr(contact.name)}" placeholder="Name" aria-label="Volunteer ${index + 1} name">
              </label>
              <label>
                <span class="visually-hidden">Volunteer ${index + 1} phone number</span>
                <input class="phone-input volunteer-contact-input" data-index="${index}" data-field="phone" type="tel" inputmode="tel" autocomplete="tel" value="${escapeAttr(contact.phone)}" placeholder="Phone (optional)" aria-label="Volunteer ${index + 1} phone number">
              </label>
            </div>
          `).join("")}
        </div>

        ${state.message ? `<p class="message" role="alert">${escapeText(state.message)}</p>` : ""}
      </div>

      <div class="rotation-sticky-actions setup-sticky-action">
        <button class="primary-btn" id="generateSchedule" type="button">
          ${hasGeneratedSchedule ? "Update Rotation" : "Generate Rotation"}
        </button>
      </div>
    </section>
    ${state.rosterReviewOpen ? renderRosterReview() : ""}
  `;

  app.querySelector("#backHome").addEventListener("click", () => {
    const origin = state.rotationOrigin;
    resetRotationFlow();
    if (origin === "calendar") {
      state.tab = "calendar";
      window.location.hash = "calendar";
      updateNav();
      render();
      window.scrollTo(0, 0);
      return;
    }
    renderHome();
  });

  app.querySelector("#shiftDate").addEventListener("change", (event) => {
    state.selectedDate = event.target.value || todayISO();
    state.message = "";
  });

  app.querySelector("#rotationDuration").addEventListener("change", (event) => {
    const duration = Number(event.target.value);
    if (!rotationDurations.includes(duration)) return;
    state.selectedRotationDuration = duration;
    state.message = "";
    renderBuilder();
  });

  app.querySelector("#primaryOnlyToggle").addEventListener("change", (event) => {
    state.primaryOnly = event.target.checked;
    state.message = "";
    renderBuilder();
  });

  app.querySelectorAll(".volunteer-contact-input").forEach((input) => {
    input.addEventListener("input", (event) => {
      const index = Number(event.target.dataset.index);
      const field = event.target.dataset.field;
      state.volunteerContacts[index] = {
        ...state.volunteerContacts[index],
        [field]: event.target.value,
      };
      state.message = "";
      updateFilledVolunteerCount();
    });
    if (input.dataset.field === "phone") {
      input.addEventListener("change", (event) => {
        const index = Number(event.target.dataset.index);
        state.volunteerContacts[index] = createVolunteerContact(state.volunteerContacts[index]);
        renderBuilder();
      });
    }
  });

  app.querySelector("#importRosterImage")?.addEventListener("click", () => {
    const plugin = getVolunteerToolsPlugin();
    if (!plugin?.recognizeRosterImage) {
      state.message = "Roster image import is available in the installed iPhone app.";
      renderBuilder();
      return;
    }
    app.querySelector("#rosterImageInput")?.click();
  });
  app.querySelector("#rosterImageInput")?.addEventListener("change", async (event) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    // Keep the Photos-backed input alive until WebKit has read the bytes.
    // Replacing it first can invalidate the selected file on a physical iPhone.
    await importRosterImageFile(file);
    input.value = "";
  });
  app.querySelector("#cancelRosterImport")?.addEventListener("click", cancelRosterImport);
  app.querySelector("#reviewPendingRoster")?.addEventListener("click", () => {
    state.rosterReviewOpen = true;
    renderBuilder();
  });
  attachRosterReviewHandlers();

  app.querySelector("#generateSchedule").addEventListener("click", () => {
    const volunteerNames = cleanNames();
    if (!volunteerNames.length) {
      state.message = "Add at least one volunteer to create a rotation.";
      state.schedule = null;
      renderBuilder();
      return;
    }
    state.message = "";
    state.schedule = createSchedule(
      volunteerNames,
      shift,
      state.selectedRotationDuration,
      { primaryOnly: state.primaryOnly },
    );
    state.rotationView = "review";
    state.scheduleEditing = false;
    renderBuilder();
    window.scrollTo(0, 0);
  });
}

function updateFilledVolunteerCount() {
  const count = app.querySelector(".volunteer-section-heading p");
  if (count && state.selectedShift) {
    count.innerHTML = `<strong>${cleanNames().length}</strong> of ${state.selectedShift.slots} filled`;
  }
}

function renderScheduleReview() {
  const shift = state.selectedShift;
  const location = state.selectedLocation || locationPages[0];
  const names = cleanNames();
  const roles = getScheduleRoles(state.schedule);

  app.className = "app builder-screen rotation-flow-screen schedule-review-screen";
  app.innerHTML = `
    <section class="screen rotation-screen">
      <header class="rotation-flow-header review-header">
        <button class="icon-btn" id="backToSetup" type="button" aria-label="Back to rotation setup">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <div class="rotation-flow-heading">
          <p>${escapeText(location.title)}</p>
          <h1>Rotation Schedule</h1>
        </div>
        <button class="schedule-edit-toggle" id="toggleScheduleEditing" type="button" aria-pressed="${state.scheduleEditing}">
          ${state.scheduleEditing ? "Done" : "Edit"}
        </button>
      </header>

      <div class="rotation-review-content">
        <div class="schedule-summary" aria-label="Schedule details">
          <span>${escapeText(formatDate(state.selectedDate))}</span>
          <span>${escapeText(shift.label)}</span>
          <span>${state.selectedRotationDuration} min</span>
          ${state.primaryOnly ? "<span>Primary only</span>" : ""}
        </div>

        <div class="interval-card-list">
          ${state.schedule.map((row, rowIndex) => `
            <article class="interval-card">
              <div class="interval-card-heading">
                <span>Interval ${rowIndex + 1}</span>
                <h2>${escapeText(formatReviewTimeRange(row.time))}</h2>
              </div>
              <div class="interval-assignments">
                ${roles.map((role) => `
                  <div class="interval-role-row">
                    <span class="role-label role-${role}">${roleLabels[role]}</span>
                    <div class="role-assignment">
                      ${state.scheduleEditing
                        ? (row.assignments[role] || []).map((person, position) => `
                            <select class="edit-select" data-row="${rowIndex}" data-role="${role}" data-position="${position}" aria-label="${roleLabels[role]} ${position + 1} for ${row.time}">
                              ${names.map((name) => `<option value="${escapeAttr(name)}" ${name === person ? "selected" : ""}>${escapeText(name)}</option>`).join("")}
                            </select>
                          `).join("")
                        : `<p>${(row.assignments[role] || []).map(escapeText).join(" · ") || "Unassigned"}</p>`
                      }
                    </div>
                  </div>
                `).join("")}
              </div>
            </article>
          `).join("")}
        </div>
      </div>

      <div class="rotation-sticky-actions review-sticky-actions">
        <button class="primary-btn" id="saveEvent" type="button">Add to Calendar</button>
        <button class="secondary-btn" id="sendScheduleMessage" type="button">Send Schedule</button>
      </div>
    </section>
  `;

  app.querySelector("#backToSetup").addEventListener("click", () => {
    state.rotationView = "setup";
    state.scheduleEditing = false;
    state.message = "";
    renderBuilder();
    window.scrollTo(0, 0);
  });

  app.querySelector("#toggleScheduleEditing").addEventListener("click", () => {
    state.scheduleEditing = !state.scheduleEditing;
    renderBuilder();
  });

  app.querySelectorAll(".edit-select").forEach((select) => {
    select.addEventListener("change", (event) => {
      const { row, role, position } = event.target.dataset;
      state.schedule[Number(row)].assignments[role][Number(position)] = event.target.value;
    });
  });

  app.querySelector("#sendScheduleMessage").addEventListener("click", sendScheduleMessage);
  app.querySelector("#saveEvent").addEventListener("click", saveCurrentScheduleToCalendar);
}

function formatReviewTimeRange(range) {
  return String(range)
    .replace(/am/g, "a")
    .replace(/pm/g, "p")
    .replace(/\s+-\s+/, " – ");
}

async function saveCurrentScheduleToCalendar() {
  if (!state.schedule || !state.selectedShift) return;
  const shift = state.selectedShift;
  const location = state.selectedLocation || locationPages[0];
  const contacts = cleanVolunteerContacts(state.volunteerContacts);
  const event = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    date: state.selectedDate,
    shiftId: shift.id,
    shiftLabel: shift.label,
    locationId: location.id,
    locationName: location.title,
    start: shift.start,
    end: shift.end,
    rotationDuration: state.selectedRotationDuration,
    primaryOnly: state.primaryOnly,
    volunteers: contacts.map((contact) => contact.name),
    volunteerContacts: contacts,
    schedule: state.schedule,
  };
  state.events = [event, ...state.events.filter((item) => !(item.date === event.date && item.shiftId === event.shiftId && (item.locationId || locationPages[0].id) === event.locationId))];
  state.checks[event.id] = state.checks[event.id] || Array.from({ length: tasks.length }, () => false);
  await persistAppData({ immediate: true });
  state.tab = "calendar";
  state.calendarDate = event.date;
  state.calendarMonth = monthStartISO(event.date);
  state.calendarCreateOpen = false;
  resetRotationFlow();
  window.location.hash = "calendar";
  updateNav();
  render();
  window.scrollTo(0, 0);
  showToast("Rotation added to calendar");
}

function resetRotationFlow() {
  state.selectedShift = null;
  state.selectedLocation = null;
  state.selectedRotationDuration = 30;
  state.primaryOnly = false;
  state.rotationView = "setup";
  state.rotationOrigin = "home";
  state.scheduleEditing = false;
  state.schedule = null;
  state.volunteerContacts = [];
  state.rosterReview = [];
  state.rosterReviewOpen = false;
  state.rosterSourceOpen = false;
  state.rosterBusy = false;
  state.message = "";
  updateShellSurface();
}

function renderRosterReview() {
  const capacity = availableVolunteerSlotCount();
  const selectedCount = state.rosterReview.filter((contact) => contact.selected).length;
  return `
    <div class="roster-review-overlay" role="dialog" aria-modal="true" aria-labelledby="rosterReviewTitle">
      <button class="roster-review-backdrop" id="closeRosterReviewBackdrop" type="button" aria-label="Close roster review"></button>
      <article class="roster-review-sheet">
        <div class="roster-review-header">
          <div>
            <p class="detail-kicker">On-device image scan</p>
            <h2 id="rosterReviewTitle">Review volunteers</h2>
            <p class="subtle">Confirm every name and number before filling the shift.</p>
          </div>
          <button class="icon-btn" id="closeRosterReview" type="button" aria-label="Close roster review">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m18 6-12 12"></path><path d="m6 6 12 12"></path></svg>
          </button>
        </div>
        <div class="roster-capacity" role="status">
          <strong>${selectedCount} selected</strong>
          <span>${capacity} empty slot${capacity === 1 ? "" : "s"} available</span>
        </div>
        <div class="roster-review-list">
          ${state.rosterReview.map((contact, index) => `
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
        ${state.message ? `<p class="message roster-review-message">${escapeText(state.message)}</p>` : ""}
        <div class="roster-review-actions">
          <button class="secondary-btn" id="discardRosterReview" type="button">Discard import</button>
          <button class="primary-btn" id="applyRosterReview" type="button" ${selectedCount === 0 || selectedCount > capacity ? "disabled" : ""}>Add selected volunteers</button>
        </div>
      </article>
    </div>
  `;
}

async function importRosterImageFile(file) {
  const plugin = getVolunteerToolsPlugin();
  if (!plugin?.recognizeRosterImage) {
    state.message = "Roster image import is available in the installed iPhone app.";
    renderBuilder();
    return;
  }
  if (file.type && !String(file.type).startsWith("image/")) {
    state.message = "Choose an image file to import a roster.";
    renderBuilder();
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    state.message = "Choose an image smaller than 20 MB.";
    renderBuilder();
    return;
  }

  state.rosterSourceOpen = false;
  state.rosterBusy = true;
  state.message = "";
  const importButton = app.querySelector("#importRosterImage");
  if (importButton) {
    importButton.disabled = true;
    importButton.textContent = "Reading image…";
    importButton.setAttribute("aria-busy", "true");
  }

  let recognitionStarted = false;
  try {
    const dataUrl = await withTimeout(
      readFileAsDataURL(file),
      20_000,
      "The selected image took too long to open. Please choose it again.",
    );
    state.message = "Recognizing volunteer names and phone numbers on this device…";
    renderBuilder();
    recognitionStarted = true;
    const result = await withTimeout(
      plugin.recognizeRosterImage({ dataUrl }),
      45_000,
      "Text recognition took too long. Please try the image again.",
    );
    if (result?.cancelled) {
      state.message = "Roster image import cancelled.";
      return;
    }
    const contacts = parseRosterObservations(result?.observations || []);
    if (!contacts.length) {
      state.message = "No volunteer names or phone numbers were recognized. Try a clearer image.";
      return;
    }
    state.rosterReview = prepareRosterReview(contacts, availableVolunteerSlotCount());
    state.rosterReviewOpen = true;
    state.message = "";
  } catch (error) {
    if (recognitionStarted) {
      try {
        await plugin.cancelRosterImport?.();
      } catch {
        // The OCR request may already have completed or rejected.
      }
    }
    state.message = error?.message || "The roster image could not be read.";
  } finally {
    state.rosterBusy = false;
    renderBuilder();
  }
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")), { once: true });
    reader.addEventListener("error", () => reject(reader.error || new Error("The selected image could not be read.")), { once: true });
    reader.addEventListener("abort", () => reject(new Error("The selected image could not be read.")), { once: true });
    reader.readAsDataURL(file);
  });
}

function withTimeout(promise, milliseconds, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), milliseconds);
  });
  return Promise.race([Promise.resolve(promise), timeout])
    .finally(() => clearTimeout(timeoutId));
}

async function cancelRosterImport() {
  const plugin = getVolunteerToolsPlugin();
  try {
    await plugin?.cancelRosterImport?.();
  } catch {
    // The local UI still recovers even if the native picker already closed.
  } finally {
    state.rosterBusy = false;
    state.rosterSourceOpen = false;
    state.message = "Roster image import cancelled.";
    renderBuilder();
  }
}

function attachRosterReviewHandlers() {
  if (!state.rosterReviewOpen) return;
  const close = () => {
    state.rosterReviewOpen = false;
    state.message = "";
    renderBuilder();
  };
  app.querySelector("#closeRosterReview")?.addEventListener("click", close);
  app.querySelector("#closeRosterReviewBackdrop")?.addEventListener("click", close);
  app.querySelector("#discardRosterReview")?.addEventListener("click", () => {
    state.rosterReview = [];
    state.rosterReviewOpen = false;
    state.message = "Roster import discarded.";
    renderBuilder();
  });
  app.querySelectorAll(".roster-review-input").forEach((input) => {
    input.addEventListener("input", (event) => {
      const contact = state.rosterReview[Number(event.target.dataset.index)];
      contact[event.target.dataset.field] = event.target.value;
      contact.needsReview = !contact.name.trim() || !normalizePhoneNumber(contact.phone) || contact.confidence < 0.75;
      state.message = "";
    });
    input.addEventListener("change", (event) => {
      const index = Number(event.target.dataset.index);
      if (event.target.dataset.field === "name" && !state.rosterReview[index].name.trim()) {
        state.rosterReview[index].selected = false;
      }
      state.rosterReview[index] = {
        ...state.rosterReview[index],
        ...createVolunteerContact(state.rosterReview[index]),
      };
      renderBuilder();
    });
  });
  app.querySelectorAll(".roster-select").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const index = Number(checkbox.dataset.index);
      const selectedCount = state.rosterReview.filter((contact) => contact.selected).length;
      if (checkbox.checked && selectedCount >= availableVolunteerSlotCount()) {
        state.message = "This shift has no more empty volunteer slots. Deselect another result first.";
        renderBuilder();
        return;
      }
      state.rosterReview[index].selected = checkbox.checked;
      state.message = "";
      renderBuilder();
    });
  });
  app.querySelector("#applyRosterReview")?.addEventListener("click", applyRosterReview);
}

function applyRosterReview() {
  const selected = state.rosterReview
    .filter((contact) => contact.selected)
    .map(createVolunteerContact)
    .filter((contact) => contact.name);
  const emptyIndexes = state.volunteerContacts
    .map((contact, index) => (!String(contact.name || "").trim() ? index : -1))
    .filter((index) => index >= 0);
  if (!selected.length || selected.length > emptyIndexes.length) {
    state.message = "Select only as many volunteers as there are empty slots.";
    renderBuilder();
    return;
  }

  selected.forEach((contact, index) => {
    state.volunteerContacts[emptyIndexes[index]] = contact;
  });
  state.rosterReview = state.rosterReview
    .filter((contact) => !contact.selected)
    .map((contact) => ({ ...contact, selected: false }));
  state.rosterReviewOpen = false;
  state.schedule = createSchedule(
    cleanNames(),
    state.selectedShift,
    state.selectedRotationDuration,
    { primaryOnly: state.primaryOnly },
  );
  const pending = state.rosterReview.length;
  state.message = `Added ${selected.length} volunteer${selected.length === 1 ? "" : "s"}.${pending ? ` ${pending} result${pending === 1 ? " remains" : "s remain"} pending.` : ""}`;
  renderBuilder();
}

function availableVolunteerSlotCount() {
  return state.volunteerContacts.filter((contact) => !String(contact.name || "").trim()).length;
}

function getVolunteerToolsPlugin() {
  return window.Capacitor?.Plugins?.VolunteerTools || null;
}

function showToast(message) {
  let toast = shell.querySelector(".toast-popup");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "toast-popup";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    shell.appendChild(toast);
  }

  toast.innerHTML = `
    <span>${message}</span>
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 6 9 17l-5-5"></path>
    </svg>
  `;
  toast.classList.add("is-visible");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 3000);
}

const roleLabels = {
  primary: "Primary",
  secondary: "Secondary",
  informal: "Informal",
};

function sendScheduleMessage() {
  if (!state.schedule || !state.selectedShift) return;
  const message = buildScheduleMessage(state.selectedShift, state.selectedDate, state.schedule, state.selectedLocation);
  confirmGroupMessage(state.volunteerContacts, message);
}

function sendCalendarScheduleMessage(event) {
  if (!event?.schedule) return;
  const location = findLocationById(event.locationId);
  const shift = shifts.find((item) => item.id === event.shiftId) || {
    id: event.shiftId,
    label: event.shiftLabel,
    start: event.start,
    end: event.end,
  };
  const message = buildScheduleMessage(shift, event.date, event.schedule, {
    ...location,
    title: event.locationName || location.title,
  });
  confirmGroupMessage(contactsForEvent(event), message);
}

function confirmGroupMessage(contacts, body) {
  const payload = createGroupMessagePayload(contacts, body);
  if (!payload.recipients.length) {
    showToast("Add at least one valid volunteer phone number");
    return;
  }

  shell.querySelector(".message-warning-overlay")?.remove();
  const overlay = document.createElement("div");
  overlay.className = "message-warning-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "messageWarningTitle");
  overlay.innerHTML = `
    <button class="message-warning-backdrop" type="button" aria-label="Cancel group message"></button>
    <article class="message-warning-sheet">
      <p class="detail-kicker">Before you continue</p>
      <h2 id="messageWarningTitle">Recipients can see each other’s numbers</h2>
      <p>This will create one group conversation with ${payload.recipients.length} recipient${payload.recipients.length === 1 ? "" : "s"}. The message is not sent until you approve it in Messages.</p>
      ${payload.excluded.length ? `<p class="message-warning-excluded"><strong>Not included:</strong> ${payload.excluded.map(escapeText).join(", ")} ${payload.excluded.length === 1 ? "has" : "have"} no valid phone number.</p>` : ""}
      <div class="message-warning-actions">
        <button class="secondary-btn" id="cancelGroupMessage" type="button">Cancel</button>
        <button class="primary-btn" id="continueGroupMessage" type="button">Open Messages</button>
      </div>
    </article>
  `;
  shell.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector(".message-warning-backdrop").addEventListener("click", close);
  overlay.querySelector("#cancelGroupMessage").addEventListener("click", close);
  overlay.querySelector("#continueGroupMessage").addEventListener("click", async () => {
    close();
    await composeGroupMessage(payload);
  });
  overlay.querySelector("#cancelGroupMessage").focus();
}

async function composeGroupMessage(payload) {
  const plugin = getVolunteerToolsPlugin();
  if (plugin?.composeMessage) {
    try {
      const result = await plugin.composeMessage({
        recipients: payload.recipients,
        body: payload.body,
      });
      if (result?.result === "sent") showToast("Message sent");
      else if (result?.result === "failed") showToast("Message could not be sent");
    } catch (error) {
      showToast(error?.message || "Messages is unavailable on this device");
    }
    return;
  }
  window.location.href = `sms:${payload.recipients.join(",")}&body=${encodeURIComponent(payload.body)}`;
}

function buildScheduleMessage(shift, date, schedule, location = locationPages[0]) {
  const roles = getScheduleRoles(schedule);
  const rows = schedule.map((row) => {
    const assignments = roles.map((role) => {
      const people = (row.assignments[role] || []).join(", ");
      return `${roleLabels[role]}: ${people}`;
    }).join("\n");
    return `${formatMessageTimeRange(row.time)}\n${assignments}`;
  }).join("\n\n");

  return [
    "Here is the rotation schedule for our shift. See you soon!",
    "",
    `${location.title} · ${formatDate(date)} · ${shift.label}`,
    "",
    rows,
  ].join("\n");
}

function formatMessageTimeRange(range) {
  return range
    .replace(/\s+/g, "")
    .replace(/am|pm/g, "");
}

function getScheduleRoles(schedule) {
  const firstRow = schedule && schedule[0];
  if (!firstRow) return ["primary", "secondary", "informal"];
  return ["primary", "secondary", "informal"].filter((role) => Array.isArray(firstRow.assignments[role]));
}

function renderCalendar() {
  const activeDate = state.calendarDate || todayISO();
  const displayMonth = state.calendarMonth || monthStartISO(activeDate);
  const monthEvents = eventsForMonth(state.events, displayMonth);
  const dayEvents = eventsForDate(state.events, activeDate);
  const monthTitle = new Date(`${displayMonth}T12:00:00`).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  app.className = "app calendar-screen";

  app.innerHTML = `
    <section class="screen calendar-page">
      <header class="calendar-topbar">
        <h1>Calendar</h1>
        <button class="calendar-today-btn" id="calendarToday" type="button">Today</button>
      </header>

      <div class="calendar-month">
        <div class="calendar-month-nav">
          <button class="calendar-month-btn" id="previousCalendarMonth" type="button" aria-label="Previous month">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
          </button>
          <h2>${escapeText(monthTitle)}</h2>
          <button class="calendar-month-btn" id="nextCalendarMonth" type="button" aria-label="Next month">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
          </button>
        </div>

        <div class="month-grid" role="grid" aria-label="${escapeAttr(monthTitle)}">
          ${["S", "M", "T", "W", "T", "F", "S"].map((day) => `<div class="weekday">${day}</div>`).join("")}
          ${renderMonthCells(displayMonth, monthEvents)}
        </div>
      </div>

      <section class="calendar-agenda" aria-labelledby="calendarAgendaTitle">
        <div class="calendar-agenda-heading">
          <h2 id="calendarAgendaTitle">${escapeText(formatCalendarDayHeading(activeDate))}</h2>
          <span>${dayEvents.length} rotation${dayEvents.length === 1 ? "" : "s"}</span>
        </div>
        <div class="calendar-agenda-list">
          ${dayEvents.length
            ? dayEvents.map(renderCalendarAgendaCard).join("")
            : `<p class="calendar-agenda-empty">No rotations scheduled</p>`
          }
        </div>
        <button class="calendar-create-btn" id="openCalendarCreate" type="button">
          <span aria-hidden="true">+</span> Create Rotation
        </button>
      </section>

      ${state.calendarEventId ? renderCalendarEventSheet() : ""}
      ${state.calendarCreateOpen ? renderCalendarCreatePicker() : ""}
    </section>
  `;

  attachCalendarHandlers();
}

function formatCalendarDayHeading(iso) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function renderCalendarAgendaCard(event) {
  const contacts = contactsForEvent(event).filter((contact) => contact.name);
  const volunteerCount = contacts.length || (Array.isArray(event.volunteers) ? event.volunteers.filter(Boolean).length : 0);
  const roles = getScheduleRoles(event.schedule)
    .filter((role) => !event.primaryOnly || role !== "secondary")
    .map((role) => roleLabels[role]);
  const duration = Number(event.rotationDuration) || 30;
  return `
    <button class="calendar-agenda-card" type="button" data-event-id="${escapeAttr(event.id)}" aria-label="View ${escapeAttr(event.locationName || "shift rotation")} from ${escapeAttr(formatCalendarEventTime(event))}">
      <span class="calendar-agenda-accent" aria-hidden="true"></span>
      <span class="calendar-agenda-card-copy">
        <strong class="calendar-agenda-time">${escapeText(formatCalendarEventTime(event))}</strong>
        <span class="calendar-agenda-location">${escapeText(event.locationName || "Shift rotation")}</span>
        <span class="calendar-agenda-meta">${volunteerCount} volunteer${volunteerCount === 1 ? "" : "s"} · ${duration} min</span>
        <span class="calendar-agenda-roles">${escapeText(roles.join(" · "))}</span>
      </span>
      <svg class="calendar-agenda-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
    </button>
  `;
}

function formatCalendarEventTime(event) {
  if (event.start && event.end) {
    const range = `${formatMinutes(timeToMinutes(event.start))} - ${formatMinutes(timeToMinutes(event.end))}`;
    return formatReviewTimeRange(range);
  }
  return formatReviewTimeRange(event.shiftLabel || "Scheduled rotation");
}

function renderCalendarCreatePicker() {
  return `
    <div class="calendar-create-overlay" role="dialog" aria-modal="true" aria-labelledby="calendarCreateTitle">
      <button class="calendar-create-backdrop" id="closeCalendarCreateBackdrop" type="button" aria-label="Close shift picker"></button>
      <article class="calendar-create-sheet">
        <span class="calendar-create-handle" aria-hidden="true"></span>
        <header class="calendar-create-header">
          <div>
            <p>${escapeText(formatCalendarDayHeading(state.calendarDate))}</p>
            <h2 id="calendarCreateTitle">Create Rotation</h2>
          </div>
          <button class="icon-btn" id="closeCalendarCreate" type="button" aria-label="Close shift picker">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m18 6-12 12"></path><path d="m6 6 12 12"></path></svg>
          </button>
        </header>
        <div class="calendar-create-locations">
          ${locationPages.map((location) => `
            <section class="calendar-create-location">
              <h3>${escapeText(location.title)}</h3>
              <div class="calendar-create-shifts">
                ${location.shifts.map((shift) => `
                  <button class="calendar-shift-option" type="button" data-location="${escapeAttr(location.id)}" data-shift="${escapeAttr(shift.id)}">
                    <span>${escapeText(shift.shortLabel || formatReviewTimeRange(shift.label))}</span>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
                  </button>
                `).join("")}
              </div>
            </section>
          `).join("")}
        </div>
      </article>
    </div>
  `;
}

function closeCalendarCreatePicker() {
  state.calendarCreateOpen = false;
  renderCalendar();
  app.querySelector("#openCalendarCreate")?.focus();
}

function moveCalendarMonth(monthDelta) {
  const nextDate = shiftCalendarDateByMonth(state.calendarDate || todayISO(), monthDelta);
  if (!nextDate) return;
  state.calendarDate = nextDate;
  state.calendarMonth = monthStartISO(nextDate);
  state.calendarEventId = null;
  state.calendarEditing = false;
  state.calendarEditMessage = "";
  renderCalendar();
}

function openCalendarEvent(eventId) {
  const event = state.events.find((item) => item.id === eventId);
  if (!event) return;
  state.calendarEventId = event.id;
  state.calendarEditing = false;
  state.calendarDraft = contactsForEvent(event);
  state.calendarEditMessage = "";
  renderCalendar();
}

function attachCalendarHandlers() {
  app.querySelector("#calendarToday")?.addEventListener("click", () => {
    state.calendarDate = todayISO();
    state.calendarMonth = monthStartISO(state.calendarDate);
    state.calendarEventId = null;
    state.calendarEditing = false;
    state.calendarEditMessage = "";
    renderCalendar();
  });

  app.querySelector("#previousCalendarMonth")?.addEventListener("click", () => {
    moveCalendarMonth(-1);
  });

  app.querySelector("#nextCalendarMonth")?.addEventListener("click", () => {
    moveCalendarMonth(1);
  });

  app.querySelectorAll(".day-cell[data-date]").forEach((cell) => {
    cell.addEventListener("click", () => {
      state.calendarDate = cell.dataset.date;
      state.calendarMonth = monthStartISO(state.calendarDate);
      state.calendarEventId = null;
      state.calendarEditing = false;
      state.calendarEditMessage = "";
      renderCalendar();
    });
  });

  app.querySelectorAll(".calendar-agenda-card").forEach((card) => {
    card.addEventListener("click", () => {
      openCalendarEvent(card.dataset.eventId);
    });
  });

  app.querySelector("#openCalendarCreate")?.addEventListener("click", () => {
    state.calendarCreateOpen = true;
    state.calendarEventId = null;
    renderCalendar();
    app.querySelector("#closeCalendarCreate")?.focus();
  });

  app.querySelector("#closeCalendarCreate")?.addEventListener("click", closeCalendarCreatePicker);
  app.querySelector("#closeCalendarCreateBackdrop")?.addEventListener("click", closeCalendarCreatePicker);
  app.querySelector(".calendar-create-sheet")?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeCalendarCreatePicker();
  });
  app.querySelectorAll(".calendar-shift-option").forEach((button) => {
    button.addEventListener("click", () => {
      const location = findLocationById(button.dataset.location);
      const shift = location.shifts.find((item) => item.id === button.dataset.shift);
      if (shift) beginRotationFlow(location, shift, state.calendarDate, "calendar");
    });
  });

  const closeButton = app.querySelector("#closeCalendarDetail");
  if (closeButton) {
    closeButton.addEventListener("click", closeCalendarDetail);
  }

  const backdrop = app.querySelector(".calendar-detail-backdrop");
  if (backdrop) {
    backdrop.addEventListener("click", closeCalendarDetail);
  }

  const editButton = app.querySelector("#editCalendarEvent");
  if (editButton) {
    editButton.addEventListener("click", () => {
      state.calendarEditing = true;
      state.calendarEditMessage = "";
      renderCalendar();
    });
  }

  const deleteButton = app.querySelector("#deleteCalendarEvent");
  if (deleteButton) {
    deleteButton.addEventListener("click", deleteCalendarEvent);
  }

  const messageButton = app.querySelector("#messageCalendarVolunteers");
  if (messageButton) {
    messageButton.addEventListener("click", () => {
      const event = state.events.find((item) => item.id === state.calendarEventId);
      sendCalendarScheduleMessage(event);
    });
  }

  app.querySelectorAll(".calendar-contact-input").forEach((input) => {
    input.addEventListener("input", (event) => {
      const index = Number(event.target.dataset.index);
      state.calendarDraft[index] = {
        ...state.calendarDraft[index],
        [event.target.dataset.field]: event.target.value,
      };
      state.calendarEditMessage = "";
    });
    if (input.dataset.field === "phone") {
      input.addEventListener("change", (event) => {
        const index = Number(event.target.dataset.index);
        state.calendarDraft[index] = createVolunteerContact(state.calendarDraft[index]);
        renderCalendar();
      });
    }
  });

  app.querySelectorAll(".remove-volunteer").forEach((button) => {
    button.addEventListener("click", () => {
      state.calendarDraft.splice(Number(button.dataset.index), 1);
      state.calendarEditMessage = "";
      renderCalendar();
    });
  });

  const addButton = app.querySelector("#addCalendarVolunteer");
  if (addButton) {
    addButton.addEventListener("click", () => {
      state.calendarDraft.push(createVolunteerContact());
      state.calendarEditMessage = "";
      renderCalendar();
      const inputs = app.querySelectorAll('.calendar-contact-input[data-field="name"]');
      inputs[inputs.length - 1]?.focus();
    });
  }

  const updateButton = app.querySelector("#updateCalendarEvent");
  if (updateButton) {
    updateButton.addEventListener("click", updateCalendarEvent);
  }
}

function renderCalendarEventSheet() {
  const event = state.events.find((item) => item.id === state.calendarEventId);
  if (!event) return "";
  const contacts = state.calendarEditing ? state.calendarDraft : contactsForEvent(event);

  return `
    <div class="calendar-detail-overlay" role="dialog" aria-modal="true" aria-label="Shift rotation details">
      <button class="calendar-detail-backdrop" id="closeCalendarDetailBackdrop" aria-label="Close shift details"></button>
      <article class="calendar-detail-sheet">
        <div class="calendar-detail-header">
          <div>
            <p class="detail-kicker">${formatDate(event.date)}</p>
            <h2>Shift rotation</h2>
            <p class="subtle">${event.locationName ? `${escapeText(event.locationName)} · ` : ""}${event.shiftLabel}</p>
          </div>
          <button class="icon-btn" id="closeCalendarDetail" aria-label="Close shift details">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m18 6-12 12"></path><path d="m6 6 12 12"></path></svg>
          </button>
        </div>

        ${state.calendarEditing ? renderCalendarEditor(contacts) : renderCalendarVolunteerList(contacts, event)}
      </article>
    </div>
  `;
}

function renderCalendarVolunteerList(contacts, event) {
  const validRecipientCount = createGroupMessagePayload(contacts, "").recipients.length;
  return `
    <div class="calendar-volunteers">
      <h3>Volunteers</h3>
      <div class="calendar-contact-list">
        ${contacts.map((contact) => `
          <div class="calendar-contact-card">
            <strong>${escapeText(contact.name)}</strong>
            <span>${contact.phone ? escapeText(contact.phone) : "No phone number"}</span>
          </div>
        `).join("")}
      </div>
    </div>
    <div class="calendar-detail-actions">
      <button class="secondary-btn" id="messageCalendarVolunteers" type="button" ${!validRecipientCount || !event.schedule ? "disabled" : ""}>Send message</button>
      <button class="primary-btn" id="editCalendarEvent">Edit</button>
      <button class="danger-btn" id="deleteCalendarEvent" type="button">Delete</button>
    </div>
  `;
}

function renderCalendarEditor(contacts) {
  return `
    <div class="calendar-volunteers">
      <h3>Volunteers</h3>
      <div class="calendar-edit-list">
        ${contacts.map((contact, index) => `
          <div class="calendar-edit-row">
            <label>
              <span class="visually-hidden">Volunteer ${index + 1} name</span>
              <input class="name-input calendar-contact-input" data-index="${index}" data-field="name" value="${escapeAttr(contact.name)}" placeholder="Name" aria-label="Volunteer ${index + 1} name">
            </label>
            <label>
              <span class="visually-hidden">Volunteer ${index + 1} phone number</span>
              <input class="phone-input calendar-contact-input" data-index="${index}" data-field="phone" type="tel" inputmode="tel" value="${escapeAttr(contact.phone)}" placeholder="Phone number" aria-label="Volunteer ${index + 1} phone number">
            </label>
            <button class="remove-volunteer" data-index="${index}" type="button" aria-label="Remove volunteer">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m18 6-12 12"></path><path d="m6 6 12 12"></path></svg>
            </button>
          </div>
        `).join("")}
      </div>
      ${state.calendarEditMessage ? `<p class="message">${state.calendarEditMessage}</p>` : ""}
    </div>
    <button class="secondary-btn" id="addCalendarVolunteer" type="button">Add volunteer</button>
    <button class="primary-btn" id="updateCalendarEvent" type="button">Update Schedule</button>
  `;
}

function closeCalendarDetail() {
  state.calendarEventId = null;
  state.calendarEditing = false;
  state.calendarDraft = [];
  state.calendarEditMessage = "";
  renderCalendar();
}

async function updateCalendarEvent(clickEvent) {
  clickEvent?.preventDefault();
  clickEvent?.stopPropagation();
  const calendarEvent = state.events.find((item) => item.id === state.calendarEventId);
  if (!calendarEvent) return;
  const contacts = cleanVolunteerContacts(state.calendarDraft);
  const names = contacts.map((contact) => contact.name);
  if (!names.length) {
    state.calendarEditMessage = "Add at least one volunteer to update the schedule.";
    renderCalendar();
    return;
  }
  const shift = shifts.find((item) => item.id === calendarEvent.shiftId) || {
    id: calendarEvent.shiftId,
    label: calendarEvent.shiftLabel,
    start: calendarEvent.start,
    end: calendarEvent.end,
    slots: names.length,
    minutes: calendarEvent.shiftId === "evening" ? 20 : 30,
  };
  const updatedEvent = {
    ...calendarEvent,
    volunteers: names,
    volunteerContacts: contacts,
    schedule: createSchedule(
      names,
      shift,
      calendarEvent.rotationDuration || shift.minutes || 30,
      { primaryOnly: Boolean(calendarEvent.primaryOnly) },
    ),
  };
  state.events = state.events.map((item) => (item.id === calendarEvent.id ? updatedEvent : item));
  state.checks[updatedEvent.id] = state.checks[updatedEvent.id] || Array.from({ length: tasks.length }, () => false);
  await persistAppData({ immediate: true });
  state.calendarEventId = null;
  state.calendarEditing = false;
  state.calendarDraft = [];
  state.calendarEditMessage = "";
  app.querySelector(".calendar-detail-overlay")?.remove();
  renderCalendar();
  showToast("Schedule updated");
}

async function deleteCalendarEvent(clickEvent) {
  clickEvent?.preventDefault();
  clickEvent?.stopPropagation();
  const eventId = state.calendarEventId;
  if (!eventId) return;

  state.events = state.events.filter((event) => event.id !== eventId);
  delete state.checks[eventId];
  await persistAppData({ immediate: true });
  state.calendarEventId = null;
  state.calendarEditing = false;
  state.calendarDraft = [];
  state.calendarEditMessage = "";
  app.querySelector(".calendar-detail-overlay")?.remove();
  renderCalendar();
  showToast("Rotation deleted");
}

function renderMonthCells(monthISO, events) {
  const eventDates = new Set(events.map((event) => event.date));
  const today = todayISO();
  const activeDate = state.calendarDate || today;
  return calendarMonthCells(monthISO).map((iso) => {
    if (!iso) return `<div class="day-cell is-placeholder" role="gridcell" aria-hidden="true"></div>`;
    const day = Number(iso.slice(-2));
    const isToday = iso === today;
    const isSelected = iso === activeDate;
    return `
      <button
        class="day-cell ${eventDates.has(iso) ? "has-event" : ""} ${isToday ? "is-today" : ""} ${isSelected ? "is-selected" : ""}"
        data-date="${iso}"
        type="button"
        role="gridcell"
        aria-label="View ${formatDate(iso)}"
        aria-selected="${isSelected}"
        ${isToday ? `aria-current="date"` : ""}
      >
        <span>${day}</span>
      </button>
    `;
  }).join("");
}

function renderChecklist() {
  app.className = "app checklist-screen";
  app.innerHTML = `
    <section class="screen">
      <div class="checklist-bg-icon" aria-hidden="true">
        <svg viewBox="0 0 96 96">
          <rect x="22" y="14" width="52" height="68" rx="10"></rect>
          <path d="M36 32h26M36 48h26M36 64h18"></path>
          <path d="m22 42 7 7 12-14"></path>
          <path d="m22 60 7 7 12-14"></path>
        </svg>
      </div>
      <h1>Checklist</h1>
      <input class="search" id="checkSearch" value="${escapeAttr(state.search)}" placeholder="Search dates or volunteers" aria-label="Search dates or volunteers">
      <div class="check-list"></div>
    </section>
  `;

  app.querySelector("#checkSearch").addEventListener("input", (event) => {
    state.search = event.target.value;
    state.checklistSwipeId = null;
    renderChecklistResults();
  });

  renderChecklistResults();
}

function renderChecklistResults() {
  const list = app.querySelector(".check-list");
  if (!list) return;

  const filtered = getFilteredChecklistEvents();
  list.innerHTML = filtered.length ? filtered.map(renderCheckCard).join("") : `<div class="empty-state">No checklist found.</div>`;

  app.querySelectorAll(".check-summary").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.id;
      if (state.checklistSwipeId === id) {
        setChecklistSwipeOpen(null);
        return;
      }
      const expanded = !state.expanded[id];
      const card = button.closest(".check-card");
      state.expanded[id] = expanded;
      button.setAttribute("aria-expanded", String(expanded));
      card.classList.toggle("is-expanded", expanded);
      card.querySelector(".tasks-panel").setAttribute("aria-hidden", String(!expanded));
      card.querySelector(".chevron-path").setAttribute("d", expanded ? "m18 15-6-6-6 6" : "m6 9 6 6 6-6");
    });
  });

  app.querySelectorAll(".task-row input").forEach((checkbox) => {
    checkbox.addEventListener("change", (event) => {
      const { id, index } = event.target.dataset;
      state.checks[id] = state.checks[id] || Array.from({ length: tasks.length }, () => false);
      state.checks[id][Number(index)] = event.target.checked;
      persistAppData();
      renderChecklistResults();
    });
  });

  attachChecklistSwipeActions();

  app.querySelectorAll(".check-delete-action").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.deleteChecklist;
      if (!confirm("Are you sure you want to delete this checklist?")) return;
      state.events = state.events.map((event) => (
        String(event.id) === id ? { ...event, checklistDeleted: true } : event
      ));
      delete state.checks[id];
      delete state.expanded[id];
      state.checklistSwipeId = null;
      await persistAppData({ immediate: true });
      renderChecklistResults();
      showToast("Checklist deleted");
    });
  });
}

function getFilteredChecklistEvents() {
  return state.events.filter((event) => !event.checklistDeleted).filter((event) => {
    const query = state.search.trim().toLowerCase();
    if (!query) return true;
    return [
      formatDate(event.date),
      event.locationName || "",
      event.shiftLabel,
      ...event.volunteers,
    ].join(" ").toLowerCase().includes(query);
  });
}

function renderCheckCard(event) {
  const checks = state.checks[event.id] || Array.from({ length: tasks.length }, () => false);
  const done = checks.filter(Boolean).length;
  const expanded = Boolean(state.expanded[event.id]);
  return `
    <div class="check-card-swipe ${state.checklistSwipeId === event.id ? "is-revealed" : ""}" data-check-id="${escapeAttr(event.id)}">
      <button class="check-delete-action" data-delete-checklist="${escapeAttr(event.id)}" type="button" aria-label="Delete checklist for ${escapeAttr(formatDate(event.date))}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="m19 6-1 15H6L5 6"></path><path d="M10 11v5M14 11v5"></path></svg>
        <span>Delete</span>
      </button>
      <article class="check-card ${expanded ? "is-expanded" : ""}">
        <button class="check-summary" data-id="${event.id}" aria-expanded="${expanded}">
          <span>
            <h3>${formatDate(event.date)}</h3>
            <p class="subtle">${event.locationName ? `${escapeText(event.locationName)} · ` : ""}${event.shiftLabel} · ${event.volunteers.join(", ")}</p>
            <span class="progress-pill">${done}/${tasks.length} complete</span>
          </span>
          <span class="chevron">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path class="chevron-path" d="${expanded ? "m18 15-6-6-6 6" : "m6 9 6 6 6-6"}"/></svg>
          </span>
        </button>
        <div class="tasks-panel" aria-hidden="${!expanded}">
          <div class="tasks">
            ${tasks.map((task, index) => `
              <label class="task-row">
                <input type="checkbox" data-id="${event.id}" data-index="${index}" ${checks[index] ? "checked" : ""}>
                <span>${task}</span>
              </label>
            `).join("")}
          </div>
        </div>
      </article>
    </div>
  `;
}

function attachChecklistSwipeActions() {
  app.querySelectorAll(".check-card-swipe").forEach((shell) => {
    const card = shell.querySelector(".check-card");
    const id = shell.dataset.checkId;
    let startX = 0;
    let startY = 0;
    let currentOffset = state.checklistSwipeId === id ? -84 : 0;
    let dragging = false;
    let suppressNextClick = false;

    card.addEventListener("pointerdown", (event) => {
      startX = event.clientX;
      startY = event.clientY;
      currentOffset = state.checklistSwipeId === id ? -84 : 0;
      dragging = false;
      card.setPointerCapture?.(event.pointerId);
    });

    card.addEventListener("pointermove", (event) => {
      if (!startX) return;
      const deltaX = event.clientX - startX;
      const deltaY = event.clientY - startY;
      if (!dragging && Math.abs(deltaY) > Math.abs(deltaX)) return;
      if (Math.abs(deltaX) < 8) return;
      dragging = true;
      if (event.cancelable) event.preventDefault();
      const offset = clamp(currentOffset + deltaX, -84, 0);
      card.style.transform = `translateX(${offset}px)`;
    });

    card.addEventListener("pointerup", (event) => {
      if (!startX) return;
      const deltaX = event.clientX - startX;
      startX = 0;
      if (!dragging) return;
      suppressNextClick = true;
      const shouldReveal = currentOffset + deltaX < -42;
      card.style.removeProperty("transform");
      setChecklistSwipeOpen(shouldReveal ? id : null);
    });

    card.addEventListener("pointercancel", () => {
      startX = 0;
      card.style.removeProperty("transform");
      setChecklistSwipeOpen(state.checklistSwipeId);
    });

    card.addEventListener("click", (event) => {
      if (!suppressNextClick) return;
      suppressNextClick = false;
      event.preventDefault();
      event.stopPropagation();
    }, true);
  });
}

function setChecklistSwipeOpen(id) {
  state.checklistSwipeId = id;
  app.querySelectorAll(".check-card-swipe").forEach((shell) => {
    shell.classList.toggle("is-revealed", shell.dataset.checkId === id);
    shell.querySelector(".check-card")?.style.removeProperty("transform");
  });
}

function formatMinutes(total) {
  const hour24 = Math.floor(total / 60);
  const minute = total % 60;
  const suffix = hour24 >= 12 ? "pm" : "am";
  const hour = hour24 % 12 || 12;
  return `${hour}:${String(minute).padStart(2, "0")}${suffix}`;
}

function timeToMinutes(time) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function cleanNames() {
  return cleanVolunteerContacts(state.volunteerContacts).map((contact) => contact.name);
}

function uniqueNames(names) {
  return [...new Set(names.map((name) => name.trim()).filter(Boolean))];
}

function todayISO() {
  return toISO(new Date());
}

function toISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(iso) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function readStore(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}

function writeStore(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function getAppDataSnapshot() {
  return {
    events: state.events,
    checks: state.checks,
    notes: normalizeNotes(state.notes),
    topic: "",
  };
}

function saveAppDataLocal() {
  writeStore("keyman-events", state.events);
  writeStore("keyman-checks", state.checks);
  writeStore("keyman-notes", normalizeNotes(state.notes));
  writeStore("keyman-topic", "");
}

function hasAppData(data) {
  return Boolean(
    (Array.isArray(data.events) && data.events.length)
    || (data.checks && Object.keys(data.checks).length)
    || (Array.isArray(data.notes) && data.notes.length)
    || String(data.topic || "").trim(),
  );
}

function normalizeAppData(data = {}) {
  const migratedNotes = migrateLegacyTopic({
    notes: data.notes,
    topic: data.topic,
  });
  return {
    events: normalizeEvents(data.events),
    checks: data.checks && typeof data.checks === "object" && !Array.isArray(data.checks) ? data.checks : {},
    notes: migratedNotes.notes,
    topic: "",
  };
}

function normalizeEvents(events) {
  if (!Array.isArray(events)) return [];
  return events.map((event) => {
    const contacts = contactsForEvent(event);
    return {
      ...event,
      primaryOnly: Boolean(event.primaryOnly),
      volunteers: contacts.length ? contacts.map((contact) => contact.name).filter(Boolean) : (Array.isArray(event.volunteers) ? event.volunteers : []),
      volunteerContacts: contacts,
    };
  });
}

function applyAppData(data) {
  const normalized = normalizeAppData(data);
  state.events = normalized.events;
  state.checks = normalized.checks;
  state.notes = normalized.notes;
  saveAppDataLocal();
}

async function loadAccountData() {
  const localData = getAppDataSnapshot();
  try {
    const remoteRaw = await authRequest("/api/app-data");
    const remoteData = normalizeAppData(remoteRaw);
    if (!hasAppData(remoteData) && hasAppData(localData)) {
      await saveAccountData(localData);
      applyAppData(localData);
    } else {
      if (initialLocalNotes.migrated) {
        const localLegacyNote = localData.notes.find((note) => note.id === "legacy-topic");
        if (localLegacyNote && !remoteData.notes.some((note) => note.id === localLegacyNote.id)) {
          remoteData.notes = mergeNotes(remoteData.notes, [localLegacyNote]);
        }
      }
      applyAppData(remoteData);
      if (String(remoteRaw.topic || "").trim() || remoteData.notes.length !== normalizeNotes(remoteRaw.notes).length) {
        await saveAccountData(remoteData);
      }
    }
    state.appDataLoaded = true;
  } catch {
    state.appDataLoaded = false;
    saveAppDataLocal();
  }
}

function persistAppData({ immediate = false } = {}) {
  saveAppDataLocal();
  if (!state.authenticated || !getAuthToken()) return Promise.resolve();
  clearTimeout(appDataSyncTimer);
  if (immediate) return saveAccountData(getAppDataSnapshot()).catch(() => {});
  appDataSyncTimer = setTimeout(() => {
    saveAccountData(getAppDataSnapshot()).catch(() => {});
  }, 500);
  return Promise.resolve();
}

async function saveAccountData(data) {
  return authRequest("/api/app-data", {
    method: "PUT",
    body: normalizeAppData(data),
  });
}

function clearLocalAppData() {
  ["keyman-events", "keyman-checks", "keyman-notes", "keyman-topic"].forEach((key) => localStorage.removeItem(key));
  state.events = [];
  state.checks = {};
  state.notes = [];
  state.notesView = "list";
  state.activeNoteId = null;
  state.noteSearch = "";
  state.noteSaveStatus = "saved";
  state.noteSwipeId = null;
  state.expanded = {};
  state.search = "";
  state.checklistSwipeId = null;
  state.calendarDate = todayISO();
  state.calendarMonth = monthStartISO(state.calendarDate);
  state.calendarCreateOpen = false;
  state.calendarEventId = null;
  state.calendarEditing = false;
  state.calendarDraft = [];
  state.calendarEditMessage = "";
  state.selectedShift = null;
  state.selectedRotationDuration = 30;
  state.primaryOnly = false;
  state.rotationView = "setup";
  state.rotationOrigin = "home";
  state.scheduleEditing = false;
  state.schedule = null;
  state.volunteerContacts = [];
  state.rosterReview = [];
  state.rosterReviewOpen = false;
  state.rosterSourceOpen = false;
  state.rosterBusy = false;
  state.message = "";
}

function getAuthToken() {
  return getStoredAuthToken();
}

function setAuthToken(token) {
  storeAuthToken(token);
}

function clearAuthToken() {
  removeStoredAuthToken();
}

function clearSignedInState({ clearLocalData = false } = {}) {
  clearTimeout(appDataSyncTimer);
  clearTimeout(noteAutosaveTimer);
  clearAuthToken();
  localStorage.removeItem("keyman-auth-email");
  if (clearLocalData) clearLocalAppData();
  state.authenticated = false;
  state.authUser = null;
  state.authEmail = "";
  state.authChecking = false;
  state.authBusy = false;
  state.authMode = "signin";
  state.authView = "signin";
  state.authMessage = "";
  state.authMessageType = "error";
  state.passwordResetEmail = "";
  state.passwordResetDevelopmentCode = "";
  state.profileView = "settings";
  state.profileMessage = "";
  state.profileBusy = false;
  state.appDataLoaded = false;
  state.tab = "home";
  state.homeView = "shifts";
  state.notesView = "list";
  state.activeNoteId = null;
  state.noteSearch = "";
  state.noteSaveStatus = "saved";
  state.noteSwipeId = null;
  state.rotationView = "setup";
  state.rotationOrigin = "home";
  state.scheduleEditing = false;
  window.location.hash = "";
  updateNav();
  render();
}

async function signOut() {
  state.profileBusy = true;
  state.profileMessage = "";
  renderProfile();
  try {
    await authRequest("/api/auth/logout", { method: "POST" });
  } catch {
    // Local sign out should still succeed if the server is unreachable.
  }
  clearSignedInState();
}

async function deleteAccount() {
  if (!confirm("Delete this account and clear this device's app data?")) return;

  state.profileBusy = true;
  state.profileMessage = "";
  renderProfile();
  try {
    await authRequest("/api/auth/me", { method: "DELETE" });
    clearSignedInState({ clearLocalData: true });
    showToast("Account deleted");
  } catch (error) {
    state.profileBusy = false;
    state.profileMessage = error.message || "Unable to delete account.";
    renderProfile();
  }
}

async function authRequest(path, options = {}) {
  if (!AUTH_API_BASE) {
    throw new Error("Authentication service is not configured.");
  }
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  let data = {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 15000);
  try {
    response = await fetch(`${AUTH_API_BASE}${path}`, {
      method: options.method || "GET",
      signal: controller.signal,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    try { data = await response.json(); }
    catch (error) { if (controller.signal.aborted) throw error; }
  } catch {
    throw new Error(controller.signal.aborted
      ? "The request took too long. Please try again. If you requested a code, check your email first."
      : "The Keyman service is temporarily unavailable. Check your connection and try again.");
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const error = new Error(data.error || "Authentication request failed.");
    error.status = response.status;
    error.code = data.code || "";
    error.retryAfterSeconds = data.retryAfterSeconds;
    throw error;
  }
  return data;
}

async function initializeAuth() {
  updateNav();
  const token = getAuthToken();
  if (!token) {
    state.authChecking = false;
    render();
    return;
  }

  render();
  try {
    const result = await authRequest("/api/auth/me");
    state.authUser = result.user;
    state.authEmail = result.user.email;
    state.authenticated = true;
    state.authChecking = false;
    localStorage.setItem("keyman-auth-email", result.user.email);
    await loadAccountData();
  } catch (error) {
    state.authChecking = false;
    state.authenticated = false;
    if (error.status === 401) {
      clearAuthToken();
      state.authMessage = "Your saved session expired after seven days of inactivity. Please sign in again.";
    } else {
      state.authMessage = "We could not verify your saved session. Check your connection and try again.";
    }
    state.authMessageType = "error";
  }
  updateNav();
  render();
}

function validateSessionOnResume() {
  if (!getAuthToken() || state.authChecking || sessionValidationPromise) return;
  const wasAuthenticated = state.authenticated;
  sessionValidationPromise = authRequest("/api/auth/me")
    .then(async (result) => {
      state.authUser = result.user;
      state.authEmail = result.user.email;
      state.authenticated = true;
      localStorage.setItem("keyman-auth-email", result.user.email);
      if (!wasAuthenticated) {
        await loadAccountData();
        updateNav();
        render();
      }
    })
    .catch((error) => {
      // A temporary connection failure should never erase a valid remembered
      // login. Only the server's explicit rejection ends the local session.
      if (error.status !== 401) return;
      clearSignedInState();
      state.authMessage = "Your saved session expired after seven days of inactivity. Please sign in again.";
      state.authMessageType = "error";
      renderAuth();
    })
    .finally(() => {
      sessionValidationPromise = null;
    });
}

function escapeAttr(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

function escapeText(value) {
  return String(value).replace(/[&<>]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
  })[char]);
}

async function updateNativeStatusBar(color) {
  const statusBar = window.Capacitor?.Plugins?.StatusBar;
  if (!statusBar) return;
  try {
    await statusBar.setOverlaysWebView({ overlay: false });
    await statusBar.setStyle({ style: "LIGHT" });
    await statusBar.setBackgroundColor({ color });
  } catch {
    // The native status bar bridge is unavailable in regular browsers.
  }
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") validateSessionOnResume();
});
window.addEventListener("online", validateSessionOnResume);

initializeAuth();
