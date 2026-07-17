import { renderWeatherCard, renderWeatherPullIndicator } from "./components/WeatherCard.mjs";
import { renderLocationHomePage, renderLocationPageIndicator } from "./components/LocationHomePage.mjs";
import { createWeatherController } from "./hooks/useWeather.mjs";
import { findLocationById, locationPages, shifts } from "./constants/locationPages.mjs";
import {
  calculateRotationIntervals,
  canUseScheduleActions,
  createSchedule,
} from "./services/schedule/rotationService.mjs";
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
  topic: readStore("keyman-topic", ""),
  expanded: {},
  search: "",
  checklistSwipeId: null,
  calendarDate: todayISO(),
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
let sessionValidationPromise = null;

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
  state.homeView = "shifts";
  state.profileView = "settings";
  state.profileMessage = "";
  state.calendarEventId = null;
  state.calendarEditing = false;
  state.calendarEditMessage = "";
  window.location.hash = state.tab === "home" ? "" : state.tab;
  state.message = "";
  updateNav();
  render();
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
  else if (state.homeView === "topic") renderTopicScreen();
  else if (state.homeView === "emergency") renderEmergencyPlanScreen();
  else renderHome();
}

function updateNav() {
  shell.dataset.auth = state.authenticated ? "unlocked" : "locked";
  shell.dataset.tab = state.tab;
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("is-active", item.dataset.tab === state.tab);
  });
}

function updateShellSurface() {
  const isMintPage = state.authenticated && state.tab === "home" && (state.selectedShift || state.homeView === "shifts");
  const surface = !state.authenticated ? "auth" : isMintPage ? "mint" : "paper";
  const color = surface === "auth" ? "#ffffff" : surface === "mint" ? "#dff3ec" : "#f6faf8";
  shell.dataset.surface = surface;
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
    state.authView = "forgot-email";
    state.passwordResetEmail = state.authEmail;
    state.passwordResetDevelopmentCode = "";
    state.authMessage = "";
    state.authMessageType = "error";
    renderAuth();
  });
}

function renderPasswordReset() {
  const isPasswordStep = state.authView === "forgot-password";
  app.className = "app auth-app";
  app.innerHTML = `
    <section class="auth-screen">
      <img class="auth-logo auth-logo-small" src="assets/auth-logo.png" alt="Keyman app logo">
      <div class="auth-card password-reset-card">
        <div>
          <h1>${isPasswordStep ? "Create new password" : "Forgot Password"}</h1>
          <p class="auth-copy">${isPasswordStep
            ? `Enter the code sent to ${escapeText(state.passwordResetEmail)} and choose a new password.`
            : "Enter the email address associated with your account."}</p>
        </div>
        ${isPasswordStep ? `
          <form id="passwordResetForm" class="auth-form" ${state.authBusy ? "aria-busy=\"true\"" : ""}>
            <label>
              <span>Reset code</span>
              <input id="passwordResetCode" class="auth-input reset-code-input" inputmode="numeric" autocomplete="one-time-code" maxlength="6" ${state.authBusy ? "disabled" : ""} required>
            </label>
            <label>
              <span>New Password</span>
              <input id="newPassword" class="auth-input" type="password" autocomplete="new-password" minlength="6" ${state.authBusy ? "disabled" : ""} required>
            </label>
            <label>
              <span>Confirm New Password</span>
              <input id="confirmNewPassword" class="auth-input" type="password" autocomplete="new-password" minlength="6" ${state.authBusy ? "disabled" : ""} required>
            </label>
            ${state.passwordResetDevelopmentCode ? `<p class="development-code">Development reset code: <strong>${escapeText(state.passwordResetDevelopmentCode)}</strong></p>` : ""}
            ${state.authMessage ? `<p class="auth-message ${state.authMessageType === "success" ? "is-success" : ""}">${escapeText(state.authMessage)}</p>` : ""}
            <button class="primary-btn" type="submit" ${state.authBusy ? "disabled" : ""}>${state.authBusy ? "Updating password" : "Update password"}</button>
            <button class="auth-toggle" id="resendResetCode" type="button" ${state.authBusy ? "disabled" : ""}>Send a new code</button>
          </form>
        ` : `
          <form id="passwordResetEmailForm" class="auth-form" ${state.authBusy ? "aria-busy=\"true\"" : ""}>
            <label>
              <span>Email address</span>
              <input id="passwordResetEmail" class="auth-input" type="email" autocomplete="email" value="${escapeAttr(state.passwordResetEmail)}" ${state.authBusy ? "disabled" : ""} required>
            </label>
            ${state.authMessage ? `<p class="auth-message ${state.authMessageType === "success" ? "is-success" : ""}">${escapeText(state.authMessage)}</p>` : ""}
            <button class="primary-btn" type="submit" ${state.authBusy ? "disabled" : ""}>${state.authBusy ? "Checking email" : "Send reset code"}</button>
          </form>
        `}
        <button class="auth-toggle" id="backToSignIn" type="button" ${state.authBusy ? "disabled" : ""}>Back to Sign In</button>
      </div>
    </section>
  `;

  app.querySelector("#backToSignIn").addEventListener("click", returnToSignIn);
  app.querySelector("#passwordResetEmailForm")?.addEventListener("submit", handlePasswordResetEmail);
  app.querySelector("#passwordResetForm")?.addEventListener("submit", handlePasswordResetSubmit);
  app.querySelector("#resendResetCode")?.addEventListener("click", () => {
    requestPasswordResetCode(state.passwordResetEmail);
  });
}

async function handlePasswordResetEmail(event) {
  event.preventDefault();
  if (state.authBusy) return;
  const email = app.querySelector("#passwordResetEmail").value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    state.authMessage = "Enter a valid email address.";
    renderAuth();
    return;
  }

  requestPasswordResetCode(email);
}

async function requestPasswordResetCode(email) {
  if (state.authBusy) return;
  state.passwordResetEmail = email;
  state.authBusy = true;
  state.authMessage = "";
  state.authMessageType = "error";
  state.passwordResetDevelopmentCode = "";
  renderAuth();
  try {
    const result = await authRequest("/api/auth/password-reset/request", {
      method: "POST",
      body: { email },
    });
    state.authBusy = false;
    state.authView = "forgot-password";
    state.passwordResetDevelopmentCode = result.developmentCode || "";
    state.authMessage = "If an account exists for that email, a six-digit code is on its way. Check your spam folder too.";
    state.authMessageType = "success";
    renderAuth();
  } catch (error) {
    state.authBusy = false;
    state.authMessage = error.status === 404 && error.message === "Not found."
      ? "Password recovery is not available on the current app service yet. Please contact support."
      : error.message || "Unable to start password reset.";
    state.authMessageType = "error";
    renderAuth();
  }
}

async function handlePasswordResetSubmit(event) {
  event.preventDefault();
  if (state.authBusy) return;
  const code = app.querySelector("#passwordResetCode").value.trim();
  const newPassword = app.querySelector("#newPassword").value;
  const confirmPassword = app.querySelector("#confirmNewPassword").value;

  if (!/^\d{6}$/.test(code)) {
    state.authMessage = "Enter the six-digit reset code.";
    state.authMessageType = "error";
    renderAuth();
    return;
  }
  if (newPassword.length < 6) {
    state.authMessage = "Password must be at least 6 characters.";
    state.authMessageType = "error";
    renderAuth();
    return;
  }
  if (newPassword !== confirmPassword) {
    state.authMessage = "Passwords do not match.";
    state.authMessageType = "error";
    renderAuth();
    return;
  }

  state.authBusy = true;
  state.authMessage = "";
  state.authMessageType = "error";
  renderAuth();
  try {
    await authRequest("/api/auth/password-reset", {
      method: "POST",
      body: {
        email: state.passwordResetEmail,
        code,
        newPassword,
      },
    });
    const email = state.passwordResetEmail;
    returnToSignIn();
    state.authEmail = email;
    state.authMessage = "Password updated successfully. Please sign in with your new password.";
    state.authMessageType = "success";
    renderAuth();
  } catch (error) {
    state.authBusy = false;
    state.authMessage = error.message || "Unable to update password.";
    state.authMessageType = "error";
    renderAuth();
  }
}

function returnToSignIn() {
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
        <p>The app stores your email address for sign in, volunteer names and phone numbers, rotation schedules, checklist progress, and discussion notes needed for shift planning.</p>
        <h2>Roster image recognition</h2>
        <p>Roster screenshots and images are selected by you and processed on your device to recognize names and phone numbers. Keyman Assistant does not upload or retain the source image. You review recognized information before adding it to a shift.</p>
        <h2>How it is stored</h2>
        <p>Confirmed volunteer contact information, schedules, checklist information, and discussion information are saved to the Keyman Assistant backend for your account and cached on this device. Passwords are stored as salted hashes.</p>
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
      state.selectedLocation = location;
      state.selectedShift = shift;
      state.selectedRotationDuration = 30;
      state.selectedDate = todayISO();
      state.volunteerContacts = Array.from({ length: shift.slots }, () => createVolunteerContact());
      state.rosterReview = [];
      state.rosterReviewOpen = false;
      state.rosterSourceOpen = false;
      state.rosterBusy = false;
      state.schedule = createSchedule([], shift, state.selectedRotationDuration);
      state.message = "";
      renderBuilder();
    });
  });

  app.querySelectorAll(".quick-action-card").forEach((card) => {
    card.addEventListener("click", () => {
      state.homeView = card.dataset.action;
      render();
    });
  });
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

function renderTopicScreen() {
  app.className = "app action-screen";
  app.innerHTML = `
    <section class="screen">
      <div class="topbar">
        <button class="icon-btn" id="backToHome" aria-label="Back to home">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <div>
          <h1>Topic for discussion</h1>
          <p class="subtle">Paste the discussion topic for this shift.</p>
        </div>
      </div>
      <label class="topic-editor-label">
        <span>Discussion topic</span>
        <textarea id="topicEditor" class="topic-editor" placeholder="Paste or type the topic of discussion here.">${escapeText(state.topic)}</textarea>
      </label>
      <button class="primary-btn" id="saveTopic">Save topic</button>
    </section>
  `;

  app.querySelector("#backToHome").addEventListener("click", () => {
    state.homeView = "shifts";
    renderHome();
  });

  app.querySelector("#topicEditor").addEventListener("input", (event) => {
    state.topic = event.target.value;
    persistAppData();
  });

  app.querySelector("#saveTopic").addEventListener("click", () => {
    state.topic = app.querySelector("#topicEditor").value;
    persistAppData();
    showToast("Topic saved");
  });
}

function renderEmergencyPlanScreen() {
  app.className = "app action-screen emergency-screen";
  app.innerHTML = `
    <section class="screen">
      <div class="topbar">
        <button class="icon-btn" id="backToHome" aria-label="Back to home">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <div>
          <h1>Emergency Plan</h1>
          <p class="subtle">This file will be added after testing.</p>
        </div>
      </div>
      <div class="empty-state">Emergency plan unavailable during testing.</div>
    </section>
  `;

  app.querySelector("#backToHome").addEventListener("click", () => {
    state.homeView = "shifts";
    renderHome();
  });
}

function renderBuilder() {
  const shift = state.selectedShift;
  const location = state.selectedLocation || locationPages[0];
  const names = cleanNames();
  const scheduleActionsAvailable = canUseScheduleActions(state.schedule, names);
  const pendingRosterCount = state.rosterReview.length;
  const rotationSlots = calculateRotationIntervals(
    shift.start,
    shift.end,
    state.selectedRotationDuration,
  ).length;
  app.className = "app builder-screen";
  app.innerHTML = `
    <section class="screen">
      <div class="topbar">
        <button class="icon-btn" id="backHome" aria-label="Back to shifts">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <div class="selected-shift-summary">
          <span>Selected shift</span>
          <p class="selected-location">${escapeText(location.title)}</p>
          <h2>${shift.label}</h2>
          <p class="subtle">${state.selectedRotationDuration}-minute rotations · ${rotationSlots} rotation slots</p>
        </div>
      </div>

      <label class="date-row">
        <span class="slot-label">Shift date</span>
        <input id="shiftDate" type="date" value="${state.selectedDate}">
      </label>

      <fieldset class="rotation-length">
        <legend>Rotation Length</legend>
        <div class="rotation-options">
          ${rotationDurations.map((duration) => `
            <button
              class="rotation-option ${duration === state.selectedRotationDuration ? "is-selected" : ""}"
              type="button"
              data-duration="${duration}"
              aria-pressed="${duration === state.selectedRotationDuration}"
            >
              <strong>${duration}</strong>
              <span>min</span>
            </button>
          `).join("")}
        </div>
      </fieldset>

      <div class="volunteer-section-heading">
        <div>
          <h3 class="section-title">Volunteers</h3>
          <p class="subtle">Add contacts manually or import a roster screenshot.</p>
        </div>
        <button class="secondary-btn import-roster-btn" id="${state.rosterBusy ? "cancelRosterImport" : "importRosterImage"}" type="button">
          ${state.rosterBusy ? "Cancel image import" : "Import roster image"}
        </button>
        ${state.rosterBusy ? "" : `<input class="visually-hidden" id="rosterImageInput" type="file" accept="image/*" tabindex="-1" aria-hidden="true">`}
        ${pendingRosterCount ? `<button class="text-btn pending-roster-btn" id="reviewPendingRoster" type="button">Review pending (${pendingRosterCount})</button>` : ""}
      </div>
      <div class="volunteer-grid">
        ${state.volunteerContacts.map((contact, index) => `
          <div class="volunteer-field">
            <span class="volunteer-slot-title">Volunteer ${index + 1}</span>
            <label>
              <span class="visually-hidden">Volunteer ${index + 1} name</span>
              <input class="name-input volunteer-contact-input" data-index="${index}" data-field="name" value="${escapeAttr(contact.name)}" placeholder="Name" aria-label="Volunteer ${index + 1} name">
            </label>
            <label>
              <span class="visually-hidden">Volunteer ${index + 1} phone number</span>
              <input class="phone-input volunteer-contact-input" data-index="${index}" data-field="phone" type="tel" inputmode="tel" autocomplete="tel" value="${escapeAttr(contact.phone)}" placeholder="Phone number" aria-label="Volunteer ${index + 1} phone number">
            </label>
          </div>
        `).join("")}
      </div>

      ${state.message ? `<p class="message">${state.message}</p>` : ""}

      ${state.schedule ? renderScheduleMarkup() : ""}

      <div class="builder-action">
        <button class="primary-btn" id="generateSchedule">
          <span>${names.length ? "Regenerate schedule" : "Create schedule"}</span>
        </button>
        ${scheduleActionsAvailable ? `
          <div class="actions">
            <button class="secondary-btn" id="sendScheduleMessage" type="button">Send message</button>
            <button class="secondary-btn" id="saveEvent">Add to calendar</button>
          </div>
        ` : ""}
      </div>
    </section>
    ${state.rosterReviewOpen ? renderRosterReview() : ""}
  `;

  app.querySelector("#backHome").addEventListener("click", () => {
    state.selectedShift = null;
    state.selectedLocation = null;
    state.selectedRotationDuration = 30;
    state.schedule = null;
    state.volunteerContacts = [];
    state.rosterReview = [];
    state.rosterReviewOpen = false;
    state.rosterSourceOpen = false;
    state.rosterBusy = false;
    state.message = "";
    renderHome();
  });

  app.querySelector("#shiftDate").addEventListener("change", (event) => {
    state.selectedDate = event.target.value || todayISO();
  });

  app.querySelectorAll(".rotation-option").forEach((button) => {
    button.addEventListener("click", () => {
      const duration = Number(button.dataset.duration);
      if (!rotationDurations.includes(duration) || duration === state.selectedRotationDuration) return;
      state.selectedRotationDuration = duration;
      state.message = "";
      state.schedule = createSchedule(cleanNames(), shift, duration);
      renderBuilder();
    });
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

    // Keep the Photos-backed input and its value alive until WebKit has read
    // the bytes. Clearing or replacing it first can invalidate the selected
    // file on a physical iPhone before FileReader finishes.
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
    const names = cleanNames();
    if (names.length === 0) {
      state.message = "Add at least one volunteer to create a rotation.";
      state.schedule = createSchedule([], shift, state.selectedRotationDuration);
    } else {
      state.message = "";
      state.schedule = createSchedule(names, shift, state.selectedRotationDuration);
    }
    renderBuilder();
  });

  if (scheduleActionsAvailable) {
    app.querySelectorAll(".edit-select").forEach((select) => {
      select.addEventListener("change", (event) => {
        const { row, role, position } = event.target.dataset;
        state.schedule[Number(row)].assignments[role][Number(position)] = event.target.value;
      });
    });

    app.querySelector("#sendScheduleMessage").addEventListener("click", sendScheduleMessage);

    app.querySelector("#saveEvent").addEventListener("click", async () => {
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
        volunteers: contacts.map((contact) => contact.name),
        volunteerContacts: contacts,
        schedule: state.schedule,
      };
      state.events = [event, ...state.events.filter((item) => !(item.date === event.date && item.shiftId === event.shiftId && (item.locationId || locationPages[0].id) === event.locationId))];
      state.checks[event.id] = state.checks[event.id] || Array.from({ length: tasks.length }, () => false);
      await persistAppData({ immediate: true });
      state.tab = "calendar";
      state.selectedShift = null;
      state.selectedRotationDuration = 30;
      state.schedule = null;
      state.volunteerContacts = [];
      state.rosterReview = [];
      state.rosterReviewOpen = false;
      state.rosterSourceOpen = false;
      updateNav();
      renderCalendar();
      showToast("Rotation added to calendar");
    });
  }
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
  state.schedule = createSchedule(cleanNames(), state.selectedShift, state.selectedRotationDuration);
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

function renderScheduleMarkup() {
  const names = cleanNames();
  if (!names.length) return "";
  const roles = getScheduleRoles(state.schedule);
  return `
    <h3 class="section-title">Rotation Schedule</h3>
    <div class="schedule-card">
      <div class="rotation-head ${roles.length === 2 ? "is-compact" : ""}">
        <div>Time</div>
        ${roles.map((role) => `<div>${roleLabels[role]}</div>`).join("")}
      </div>
      ${state.schedule.map((row, rowIndex) => `
        <div class="rotation-row ${roles.length === 2 ? "is-compact" : ""}">
          <div class="time-cell">${row.time}</div>
          ${roles.map((role) => `
            <div class="assignment">
              ${(row.assignments[role] || []).map((person, position) => `
                <select class="edit-select" data-row="${rowIndex}" data-role="${role}" data-position="${position}" aria-label="${role} ${position + 1} for ${row.time}">
                  ${names.map((name) => `<option value="${escapeAttr(name)}" ${name === person ? "selected" : ""}>${name}</option>`).join("")}
                </select>
              `).join("")}
            </div>
          `).join("")}
        </div>
      `).join("")}
    </div>
  `;
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
  app.className = "app";
  const now = new Date();
  const activeDate = state.calendarDate || todayISO();
  const monthEvents = state.events.filter((event) => {
    const date = new Date(`${event.date}T12:00:00`);
    return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
  });

  app.innerHTML = `
    <section class="screen">
      <div class="topbar">
        <div>
          <h1>Calendar</h1>
          <p class="subtle">Saved rotations appear in their shift time block.</p>
        </div>
      </div>
      <div class="calendar-wrap">
        <div class="calendar-header">
          <h2>${now.toLocaleString(undefined, { month: "long", year: "numeric" })}</h2>
          <span class="subtle">${monthEvents.length} rotation${monthEvents.length === 1 ? "" : "s"}</span>
        </div>
        <div class="month-grid">
          ${["S", "M", "T", "W", "T", "F", "S"].map((day) => `<div class="weekday">${day}</div>`).join("")}
          ${renderMonthCells(now, monthEvents)}
        </div>
        ${renderTimeline(state.events, activeDate)}
      </div>
      ${state.calendarEventId ? renderCalendarEventSheet() : ""}
    </section>
  `;

  attachCalendarHandlers();
}

function renderTimeline(events, activeDate) {
  const visible = events
    .slice()
    .filter((event) => event.date === activeDate)
    .sort((a, b) => a.start.localeCompare(b.start));
  const startMinute = 9 * 60;
  const endMinute = 20 * 60;
  const hourHeight = 58;
  const totalHeight = ((endMinute - startMinute) / 60) * hourHeight;

  return `
    <div class="timeline-wrap">
      <div class="timeline-title">
        <h3>${formatDate(activeDate)}</h3>
        <span class="subtle">${visible.length} block${visible.length === 1 ? "" : "s"}</span>
      </div>
      <div class="day-timeline" style="height:${totalHeight}px">
        ${Array.from({ length: (endMinute - startMinute) / 60 + 1 }, (_, index) => {
          const minute = startMinute + index * 60;
          return `
            <div class="hour-line" style="top:${index * hourHeight}px">
              <span>${formatMinutes(minute)}</span>
            </div>
          `;
        }).join("")}
        ${visible.map((event) => {
          const top = ((timeToMinutes(event.start) - startMinute) / 60) * hourHeight;
          const height = ((timeToMinutes(event.end) - timeToMinutes(event.start)) / 60) * hourHeight;
          const overlapping = visible.filter((item) => item.start === event.start && item.end === event.end);
          const overlapIndex = overlapping.findIndex((item) => item.id === event.id);
          const blockWidth = overlapping.length > 1 ? `calc(${100 / overlapping.length}% - 12px)` : "calc(100% - 12px)";
          const blockLeft = overlapping.length > 1 ? `calc(12px + ${(100 / overlapping.length) * overlapIndex}%)` : "12px";
          return `
            <button class="time-block" type="button" data-event-id="${escapeAttr(event.id)}" style="top:${top}px; height:${height}px; left:${blockLeft}; width:${blockWidth}">
              <strong>Shift rotation</strong>
              <span>${event.locationName ? `${escapeText(event.locationName)} · ` : ""}${event.shiftLabel}</span>
            </button>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function attachCalendarHandlers() {
  app.querySelectorAll(".day-cell[data-date]").forEach((cell) => {
    cell.addEventListener("click", () => {
      state.calendarDate = cell.dataset.date;
      state.calendarEventId = null;
      state.calendarEditing = false;
      state.calendarEditMessage = "";
      renderCalendar();
    });
  });

  app.querySelectorAll(".time-block").forEach((block) => {
    block.addEventListener("click", () => {
      const event = state.events.find((item) => item.id === block.dataset.eventId);
      if (!event) return;
      state.calendarEventId = event.id;
      state.calendarEditing = false;
      state.calendarDraft = contactsForEvent(event);
      state.calendarEditMessage = "";
      renderCalendar();
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

function renderMonthCells(now, events) {
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const eventDates = new Set(events.map((event) => event.date));
  const today = todayISO();
  const activeDate = state.calendarDate || today;
  const cells = [];

  for (let i = 0; i < first.getDay(); i += 1) {
    cells.push(`<div class="day-cell"></div>`);
  }

  for (let day = 1; day <= last.getDate(); day += 1) {
    const iso = toISO(new Date(now.getFullYear(), now.getMonth(), day));
    cells.push(`
      <button class="day-cell ${eventDates.has(iso) ? "has-event" : ""} ${iso === today ? "is-today" : ""} ${iso === activeDate ? "is-selected" : ""}" data-date="${iso}" type="button" aria-label="View ${formatDate(iso)}">
        <span>${day}</span>
      </button>
    `);
  }

  return cells.join("");
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
    topic: state.topic,
  };
}

function saveAppDataLocal() {
  writeStore("keyman-events", state.events);
  writeStore("keyman-checks", state.checks);
  writeStore("keyman-topic", state.topic);
}

function hasAppData(data) {
  return Boolean(
    (Array.isArray(data.events) && data.events.length)
    || (data.checks && Object.keys(data.checks).length)
    || String(data.topic || "").trim(),
  );
}

function normalizeAppData(data = {}) {
  return {
    events: normalizeEvents(data.events),
    checks: data.checks && typeof data.checks === "object" && !Array.isArray(data.checks) ? data.checks : {},
    topic: String(data.topic || ""),
  };
}

function normalizeEvents(events) {
  if (!Array.isArray(events)) return [];
  return events.map((event) => {
    const contacts = contactsForEvent(event);
    return {
      ...event,
      volunteers: contacts.length ? contacts.map((contact) => contact.name).filter(Boolean) : (Array.isArray(event.volunteers) ? event.volunteers : []),
      volunteerContacts: contacts,
    };
  });
}

function applyAppData(data) {
  const normalized = normalizeAppData(data);
  state.events = normalized.events;
  state.checks = normalized.checks;
  state.topic = normalized.topic;
  saveAppDataLocal();
}

async function loadAccountData() {
  const localData = getAppDataSnapshot();
  try {
    const remoteData = normalizeAppData(await authRequest("/api/app-data"));
    if (!hasAppData(remoteData) && hasAppData(localData)) {
      await saveAccountData(localData);
      applyAppData(localData);
    } else {
      applyAppData(remoteData);
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
  ["keyman-events", "keyman-checks", "keyman-topic"].forEach((key) => localStorage.removeItem(key));
  state.events = [];
  state.checks = {};
  state.topic = "";
  state.expanded = {};
  state.search = "";
  state.checklistSwipeId = null;
  state.calendarDate = todayISO();
  state.calendarEventId = null;
  state.calendarEditing = false;
  state.calendarDraft = [];
  state.calendarEditMessage = "";
  state.selectedShift = null;
  state.selectedRotationDuration = 30;
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
  try {
    response = await fetch(`${AUTH_API_BASE}${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new Error("The Keyman service is temporarily unavailable. Check your connection and try again.");
  }
  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (!response.ok) {
    const error = new Error(data.error || "Authentication request failed.");
    error.status = response.status;
    error.code = data.code || "";
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
