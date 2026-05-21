const shifts = [
  { id: "morning", label: "9:00am - 12:00pm", start: "09:00", end: "12:00", slots: 6, minutes: 30 },
  { id: "midday", label: "12:00pm - 3:00pm", start: "12:00", end: "15:00", slots: 6, minutes: 30 },
  { id: "afternoon", label: "3:00pm - 6:00pm", start: "15:00", end: "18:00", slots: 6, minutes: 30 },
  { id: "evening", label: "6:00pm - 8:00pm", start: "18:00", end: "20:00", slots: 8, minutes: 20 },
];

const tasks = [
  "Sent confirmation text to volunteers",
  "Created shift rotation",
  "Reviewed safety procedures",
  "Reviewed topic of discussion",
  "Sent EOS report",
];

const emergencyPlanPages = [
  "assets/emergency-plan-pages/page-1.png",
  "assets/emergency-plan-pages/page-2.png",
  "assets/emergency-plan-pages/page-3.png",
  "assets/emergency-plan-pages/page-4.png",
];

const APP_CONFIG = window.KEYMAN_CONFIG || {};
const AUTH_API_BASE = localStorage.getItem("keyman-auth-api") || APP_CONFIG.authApiBase || "http://127.0.0.1:3001";
const PRIVACY_POLICY_URL = APP_CONFIG.privacyPolicyUrl || "";
const AUTH_TOKEN_KEY = "keyman-auth-token";

const state = {
  authEmail: localStorage.getItem("keyman-auth-email") || "",
  authUser: null,
  authChecking: Boolean(getAuthToken()),
  authBusy: false,
  authenticated: false,
  authMode: "signin",
  authMessage: "",
  profileView: "settings",
  profileMessage: "",
  profileBusy: false,
  tab: getInitialTab(),
  homeView: "shifts",
  quickActionsOpen: false,
  selectedShift: null,
  selectedDate: todayISO(),
  volunteers: [],
  schedule: null,
  message: "",
  events: readStore("keyman-events", []),
  checks: readStore("keyman-checks", {}),
  expanded: {},
  search: "",
  calendarDate: todayISO(),
  calendarEventId: null,
  calendarEditing: false,
  calendarDraft: [],
  calendarEditMessage: "",
};

const app = document.querySelector("#app");
const nav = document.querySelector(".bottom-nav");
const shell = document.querySelector(".phone-shell");
let toastTimer = null;

nav.addEventListener("click", (event) => {
  if (!state.authenticated) return;
  const button = event.target.closest(".nav-item");
  if (!button) return;
  state.tab = button.dataset.tab;
  state.selectedShift = null;
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
          ${state.authMessage ? `<p class="auth-message">${state.authMessage}</p>` : ""}
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
    renderAuth();
  });
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
    state.authBusy = false;
    state.authMessage = "";
    localStorage.setItem("keyman-auth-email", result.user.email);
    setAuthToken(result.token);
    updateNav();
    render();
  } catch (error) {
    state.authBusy = false;
    state.authMessage = error.message || "Unable to sign in. Make sure the auth backend is running.";
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
        <p>The app stores your email address for sign in, volunteer names, rotation schedules, checklist progress, and discussion notes needed for shift planning.</p>
        <h2>How it is stored</h2>
        <p>Schedule and checklist information is stored on this device. Account authentication is handled by the Keyman Assistant backend, and passwords are stored as salted hashes.</p>
        <h2>Sharing</h2>
        <p>Keyman Assistant does not sell personal information. Data is used only to support account access and shift planning.</p>
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
      <div class="hero ${state.quickActionsOpen ? "is-actions-open" : ""}">
        <div class="hero-location" aria-label="Location">
          <h2>Beaches Town Center</h2>
          <p>0 Atlantic Blvd, Neptune Beach, FL 32266</p>
        </div>
        <div class="shift-panel ${state.quickActionsOpen ? "is-expanded" : ""}">
          <button class="sheet-handle" id="quickActionsHandle" aria-label="${state.quickActionsOpen ? "Hide quick actions" : "Show quick actions"}" aria-expanded="${state.quickActionsOpen}"></button>
          <h1>Shifts</h1>
          <div class="shift-grid">
            ${shifts.map((shift) => `
              <button class="shift-card" data-shift="${shift.id}">
                <span class="shift-time">${shift.label}</span>
              </button>
            `).join("")}
          </div>
          <section class="quick-actions" aria-hidden="${!state.quickActionsOpen}">
            <h2>Quick Actions</h2>
            <button class="quick-action-card" data-action="topic">
              <span>
                <strong class="quick-action-label">
                  <svg class="book-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15Z"></path></svg>
                  Topic for discussion
                </strong>
              </span>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>
            </button>
            <button class="quick-action-card" data-action="emergency">
              <span>
                <strong class="quick-action-label">
                  <svg class="caution-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 21h20L12 3Z"></path><path d="M12 9v5"></path><path d="M12 17h.01"></path></svg>
                  Emergency Plan
                </strong>
              </span>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>
            </button>
          </section>
        </div>
      </div>
    </section>
  `;

  attachQuickActionsHandle();

  app.querySelectorAll(".shift-card").forEach((card) => {
    card.addEventListener("click", () => {
      const shift = shifts.find((item) => item.id === card.dataset.shift);
      state.selectedShift = shift;
      state.selectedDate = todayISO();
      state.volunteers = Array.from({ length: shift.slots }, () => "");
      state.schedule = null;
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

function attachQuickActionsHandle() {
  const handle = app.querySelector("#quickActionsHandle");
  const hero = app.querySelector(".hero");
  const panel = app.querySelector(".shift-panel");
  if (!handle || !hero || !panel) return;
  let startY = 0;
  let dragged = false;
  let dragBase = state.quickActionsOpen ? 1 : 0;
  let startedOnHandle = false;
  let suppressNextClick = false;

  hero.addEventListener("pointerdown", (event) => {
    startY = event.clientY;
    dragged = false;
    startedOnHandle = Boolean(event.target.closest("#quickActionsHandle"));
    dragBase = state.quickActionsOpen ? 1 : 0;
    hero.setPointerCapture?.(event.pointerId);
  });

  hero.addEventListener("pointermove", (event) => {
    if (!startY) return;
    const delta = event.clientY - startY;
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

function setQuickActionsOpen(open) {
  state.quickActionsOpen = open;
  const hero = app.querySelector(".hero");
  const panel = app.querySelector(".shift-panel");
  const handle = app.querySelector("#quickActionsHandle");
  const actions = app.querySelector(".quick-actions");
  if (!panel || !handle || !actions) return;
  clearLocationDrag(hero);
  hero?.classList.toggle("is-actions-open", open);
  panel.classList.toggle("is-expanded", open);
  handle.setAttribute("aria-expanded", String(open));
  handle.setAttribute("aria-label", open ? "Hide quick actions" : "Show quick actions");
  actions.setAttribute("aria-hidden", String(!open));
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
        <textarea id="topicEditor" class="topic-editor" placeholder="Paste or type the topic of discussion here.">${escapeText(readStore("keyman-topic", ""))}</textarea>
      </label>
      <button class="primary-btn" id="saveTopic">Save topic</button>
    </section>
  `;

  app.querySelector("#backToHome").addEventListener("click", () => {
    state.homeView = "shifts";
    renderHome();
  });

  app.querySelector("#topicEditor").addEventListener("input", (event) => {
    writeStore("keyman-topic", event.target.value);
  });

  app.querySelector("#saveTopic").addEventListener("click", () => {
    writeStore("keyman-topic", app.querySelector("#topicEditor").value);
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
          <p class="subtle">Zone 2 Emergency Plan</p>
        </div>
      </div>
      <div class="plan-viewer" aria-label="Zone 2 Emergency Plan pages">
        ${emergencyPlanPages.map((page, index) => `
          <img class="plan-page" src="${page}" alt="Zone 2 Emergency Plan page ${index + 1}">
        `).join("")}
      </div>
    </section>
  `;

  app.querySelector("#backToHome").addEventListener("click", () => {
    state.homeView = "shifts";
    renderHome();
  });
}

function renderBuilder() {
  const shift = state.selectedShift;
  app.className = "app";
  app.innerHTML = `
    <section class="screen">
      <div class="topbar">
        <button class="icon-btn" id="backHome" aria-label="Back to shifts">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <div>
          <h2>${shift.label}</h2>
          <p class="subtle">${shift.minutes}-minute rotations · ${shift.slots} volunteer slots</p>
        </div>
      </div>

      <label class="date-row">
        <span class="slot-label">Shift date</span>
        <input id="shiftDate" type="date" value="${state.selectedDate}">
      </label>

      <h3 class="section-title">Volunteers</h3>
      <div class="volunteer-grid">
        ${state.volunteers.map((name, index) => `
          <label class="volunteer-field">
            <input class="name-input" data-index="${index}" value="${escapeAttr(name)}" aria-label="Volunteer ${index + 1} name">
          </label>
        `).join("")}
      </div>

      ${state.message ? `<p class="message">${state.message}</p>` : ""}

      ${state.schedule ? renderScheduleMarkup() : ""}

      <div class="builder-action">
        <button class="primary-btn" id="generateSchedule">
          <span>${state.schedule ? "Regenerate schedule" : "Schedule"}</span>
        </button>
        ${state.schedule ? `
          <div class="actions">
            <button class="secondary-btn" id="sendScheduleMessage" type="button">Send message</button>
            <button class="secondary-btn" id="saveEvent">Add to calendar</button>
          </div>
        ` : ""}
      </div>
    </section>
  `;

  app.querySelector("#backHome").addEventListener("click", () => {
    state.selectedShift = null;
    state.schedule = null;
    state.message = "";
    renderHome();
  });

  app.querySelector("#shiftDate").addEventListener("change", (event) => {
    state.selectedDate = event.target.value || todayISO();
  });

  app.querySelectorAll(".name-input").forEach((input) => {
    input.addEventListener("input", (event) => {
      state.volunteers[Number(event.target.dataset.index)] = event.target.value;
      state.message = "";
    });
  });

  app.querySelector("#generateSchedule").addEventListener("click", () => {
    const names = cleanNames();
    if (names.length === 0) {
      state.message = "Add at least one volunteer to create a rotation.";
      state.schedule = null;
    } else {
      state.message = "";
      state.schedule = createSchedule(names, shift);
    }
    renderBuilder();
  });

  if (state.schedule) {
    app.querySelectorAll(".edit-select").forEach((select) => {
      select.addEventListener("change", (event) => {
        const { row, role, position } = event.target.dataset;
        state.schedule[Number(row)].assignments[role][Number(position)] = event.target.value;
      });
    });

    app.querySelector("#sendScheduleMessage").addEventListener("click", sendScheduleMessage);

    app.querySelector("#saveEvent").addEventListener("click", () => {
      const event = {
        id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
        date: state.selectedDate,
        shiftId: shift.id,
        shiftLabel: shift.label,
        start: shift.start,
        end: shift.end,
        volunteers: cleanNames(),
        schedule: state.schedule,
      };
      state.events = [event, ...state.events.filter((item) => !(item.date === event.date && item.shiftId === event.shiftId))];
      state.checks[event.id] = state.checks[event.id] || Array.from({ length: tasks.length }, () => false);
      writeStore("keyman-events", state.events);
      writeStore("keyman-checks", state.checks);
      state.tab = "calendar";
      state.selectedShift = null;
      state.schedule = null;
      updateNav();
      renderCalendar();
      showToast("Rotation added to calendar");
    });
  }
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
  const roles = getScheduleRoles(state.schedule);
  return `
    <h3 class="section-title">Rotation</h3>
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
  const message = buildScheduleMessage(state.selectedShift, state.selectedDate, state.schedule);
  window.location.href = `sms:&body=${encodeURIComponent(message)}`;
}

function buildScheduleMessage(shift, date, schedule) {
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
    `${formatDate(date)} · ${shift.label}`,
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
              <span>${event.shiftLabel}</span>
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
      state.calendarDraft = event.volunteers.slice();
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

  app.querySelectorAll(".calendar-draft-input").forEach((input) => {
    input.addEventListener("input", (event) => {
      state.calendarDraft[Number(event.target.dataset.index)] = event.target.value;
      state.calendarEditMessage = "";
    });
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
      state.calendarDraft.push("");
      state.calendarEditMessage = "";
      renderCalendar();
      const inputs = app.querySelectorAll(".calendar-draft-input");
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
  const volunteers = state.calendarEditing ? state.calendarDraft : event.volunteers;

  return `
    <div class="calendar-detail-overlay" role="dialog" aria-modal="true" aria-label="Shift rotation details">
      <button class="calendar-detail-backdrop" id="closeCalendarDetailBackdrop" aria-label="Close shift details"></button>
      <article class="calendar-detail-sheet">
        <div class="calendar-detail-header">
          <div>
            <p class="detail-kicker">${formatDate(event.date)}</p>
            <h2>Shift rotation</h2>
            <p class="subtle">${event.shiftLabel}</p>
          </div>
          <button class="icon-btn" id="closeCalendarDetail" aria-label="Close shift details">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m18 6-12 12"></path><path d="m6 6 12 12"></path></svg>
          </button>
        </div>

        ${state.calendarEditing ? renderCalendarEditor(volunteers) : renderCalendarVolunteerList(volunteers)}
      </article>
    </div>
  `;
}

function renderCalendarVolunteerList(volunteers) {
  return `
    <div class="calendar-volunteers">
      <h3>Volunteers</h3>
      <div class="volunteer-pills">
        ${volunteers.map((name) => `<span>${escapeText(name)}</span>`).join("")}
      </div>
    </div>
    <div class="calendar-detail-actions">
      <button class="primary-btn" id="editCalendarEvent">Edit</button>
      <button class="danger-btn" id="deleteCalendarEvent" type="button">Delete</button>
    </div>
  `;
}

function renderCalendarEditor(volunteers) {
  return `
    <div class="calendar-volunteers">
      <h3>Volunteers</h3>
      <div class="calendar-edit-list">
        ${volunteers.map((name, index) => `
          <label class="calendar-edit-row">
            <input class="name-input calendar-draft-input" data-index="${index}" value="${escapeAttr(name)}" aria-label="Volunteer ${index + 1} name">
            <button class="remove-volunteer" data-index="${index}" type="button" aria-label="Remove volunteer">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m18 6-12 12"></path><path d="m6 6 12 12"></path></svg>
            </button>
          </label>
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

function updateCalendarEvent(clickEvent) {
  clickEvent?.preventDefault();
  clickEvent?.stopPropagation();
  const calendarEvent = state.events.find((item) => item.id === state.calendarEventId);
  if (!calendarEvent) return;
  const names = uniqueNames(state.calendarDraft);
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
    schedule: createSchedule(names, shift),
  };
  state.events = state.events.map((item) => (item.id === calendarEvent.id ? updatedEvent : item));
  state.checks[updatedEvent.id] = state.checks[updatedEvent.id] || Array.from({ length: tasks.length }, () => false);
  writeStore("keyman-events", state.events);
  writeStore("keyman-checks", state.checks);
  state.calendarEventId = null;
  state.calendarEditing = false;
  state.calendarDraft = [];
  state.calendarEditMessage = "";
  app.querySelector(".calendar-detail-overlay")?.remove();
  renderCalendar();
  showToast("Schedule updated");
}

function deleteCalendarEvent(clickEvent) {
  clickEvent?.preventDefault();
  clickEvent?.stopPropagation();
  const eventId = state.calendarEventId;
  if (!eventId) return;

  state.events = state.events.filter((event) => event.id !== eventId);
  delete state.checks[eventId];
  writeStore("keyman-events", state.events);
  writeStore("keyman-checks", state.checks);
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
      writeStore("keyman-checks", state.checks);
      renderChecklistResults();
    });
  });
}

function getFilteredChecklistEvents() {
  return state.events.filter((event) => {
    const query = state.search.trim().toLowerCase();
    if (!query) return true;
    return [
      formatDate(event.date),
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
    <article class="check-card ${expanded ? "is-expanded" : ""}">
      <button class="check-summary" data-id="${event.id}" aria-expanded="${expanded}">
        <span>
          <h3>${formatDate(event.date)}</h3>
          <p class="subtle">${event.shiftLabel} · ${event.volunteers.join(", ")}</p>
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
  `;
}

function createSchedule(names, shift) {
  if (names.length < 6) return createSmallCrewSchedule(names, shift);

  const periods = makePeriods(shift.start, shift.end, shift.minutes);
  let best = null;
  let bestScore = -Infinity;

  for (let attempt = 0; attempt < 180; attempt += 1) {
    const rows = [];
    const roleCounts = Object.fromEntries(names.map((name) => [name, { primary: 0, secondary: 0, informal: 0, total: 0 }]));
    const pairCounts = new Map();
    let cursor = shuffle(names);

    periods.forEach((period, index) => {
      if (index % Math.max(1, Math.floor(names.length / 2)) === 0) cursor = shuffle(names);
      const ranked = names
        .slice()
        .sort((a, b) => roleCounts[a].total - roleCounts[b].total || cursor.indexOf(a) - cursor.indexOf(b));
      const active = ranked.slice(0, 6);
      const groups = buildGroups(active, pairCounts);
      const assignments = assignRoles(groups, roleCounts);

      rows.push({ time: period, assignments });

      ["primary", "secondary", "informal"].forEach((role) => {
        assignments[role].forEach((name) => {
          roleCounts[name][role] += 1;
          roleCounts[name].total += 1;
        });
        addPair(assignments[role], pairCounts);
      });
    });

    const score = scoreSchedule(roleCounts, pairCounts);
    if (score > bestScore) {
      bestScore = score;
      best = rows;
    }
  }

  return best;
}

function createSmallCrewSchedule(names, shift) {
  const periods = makePeriods(shift.start, shift.end, shift.minutes);
  const primaryCounts = Object.fromEntries(names.map((name) => [name, 0]));
  const pairCounts = new Map();

  return periods.map((period, index) => {
    const ranked = names
      .slice()
      .sort((a, b) => primaryCounts[a] - primaryCounts[b] || rotateIndex(a, names, index) - rotateIndex(b, names, index));
    const primary = chooseSmallCrewPrimary(ranked, pairCounts);
    primary.forEach((name) => {
      primaryCounts[name] += 1;
    });
    if (primary.length === 2) addPair(primary, pairCounts);

    return {
      time: period,
      assignments: {
        primary,
        informal: names.filter((name) => !primary.includes(name)),
      },
    };
  });
}

function chooseSmallCrewPrimary(ranked, pairCounts) {
  if (ranked.length <= 2) return ranked;

  let bestPair = ranked.slice(0, 2);
  let bestScore = Infinity;
  for (let i = 0; i < ranked.length; i += 1) {
    for (let j = i + 1; j < ranked.length; j += 1) {
      const pair = [ranked[i], ranked[j]];
      const score = i + j + ((pairCounts.get(pairKey(pair[0], pair[1])) || 0) * ranked.length);
      if (score < bestScore) {
        bestScore = score;
        bestPair = pair;
      }
    }
  }

  return bestPair;
}

function rotateIndex(name, names, offset) {
  return (names.indexOf(name) + offset) % names.length;
}

function buildGroups(active, pairCounts) {
  const remaining = active.slice();
  const groups = [];

  while (remaining.length > 1) {
    let bestPair = [remaining[0], remaining[1]];
    let bestScore = Infinity;
    for (let i = 0; i < remaining.length; i += 1) {
      for (let j = i + 1; j < remaining.length; j += 1) {
        const score = pairCounts.get(pairKey(remaining[i], remaining[j])) || 0;
        if (score < bestScore) {
          bestScore = score;
          bestPair = [remaining[i], remaining[j]];
        }
      }
    }
    groups.push(bestPair);
    bestPair.forEach((person) => remaining.splice(remaining.indexOf(person), 1));
  }

  return groups;
}

function assignRoles(groups, roleCounts) {
  const roles = ["primary", "secondary", "informal"];
  const result = {};
  const orderedGroups = groups.slice().sort((a, b) => {
    const aTotal = a.reduce((sum, name) => sum + roleCounts[name].total, 0);
    const bTotal = b.reduce((sum, name) => sum + roleCounts[name].total, 0);
    return aTotal - bTotal;
  });

  roles.forEach((role) => {
    let bestIndex = 0;
    let bestScore = Infinity;
    orderedGroups.forEach((group, index) => {
      const score = group.reduce((sum, name) => sum + roleCounts[name][role], 0);
      if (score < bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    result[role] = orderedGroups.splice(bestIndex, 1)[0];
  });

  return result;
}

function scoreSchedule(roleCounts, pairCounts) {
  const totals = Object.values(roleCounts).map((count) => count.total);
  const roleSpread = Object.values(roleCounts).reduce((sum, count) => {
    const values = [count.primary, count.secondary, count.informal];
    return sum + (Math.max(...values) - Math.min(...values));
  }, 0);
  const pairSpread = pairCounts.size ? Math.max(...pairCounts.values()) - Math.min(...pairCounts.values()) : 0;
  return 1000 - ((Math.max(...totals) - Math.min(...totals)) * 18) - (roleSpread * 7) - (pairSpread * 5);
}

function makePeriods(start, end, minutes) {
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  let current = startHour * 60 + startMinute;
  const finish = endHour * 60 + endMinute;
  const periods = [];

  while (current < finish) {
    periods.push(`${formatMinutes(current)} - ${formatMinutes(Math.min(current + minutes, finish))}`);
    current += minutes;
  }

  return periods;
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
  return uniqueNames(state.volunteers);
}

function uniqueNames(names) {
  return [...new Set(names.map((name) => name.trim()).filter(Boolean))];
}

function shuffle(items) {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function addPair(group, pairCounts) {
  pairCounts.set(pairKey(group[0], group[1]), (pairCounts.get(pairKey(group[0], group[1])) || 0) + 1);
}

function pairKey(a, b) {
  return [a, b].sort().join("::");
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

function clearLocalAppData() {
  ["keyman-events", "keyman-checks", "keyman-topic"].forEach((key) => localStorage.removeItem(key));
  state.events = [];
  state.checks = {};
  state.expanded = {};
  state.search = "";
  state.calendarDate = todayISO();
  state.calendarEventId = null;
  state.calendarEditing = false;
  state.calendarDraft = [];
  state.calendarEditMessage = "";
  state.selectedShift = null;
  state.schedule = null;
  state.volunteers = [];
  state.message = "";
}

function getAuthToken() {
  try {
    return sessionStorage.getItem(AUTH_TOKEN_KEY) || localStorage.getItem(AUTH_TOKEN_KEY) || "";
  } catch {
    return localStorage.getItem(AUTH_TOKEN_KEY) || "";
  }
}

function setAuthToken(token) {
  try {
    sessionStorage.setItem(AUTH_TOKEN_KEY, token);
  } catch {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
  }
}

function clearAuthToken() {
  try {
    sessionStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {}
  localStorage.removeItem(AUTH_TOKEN_KEY);
}

function clearSignedInState({ clearLocalData = false } = {}) {
  clearAuthToken();
  localStorage.removeItem("keyman-auth-email");
  if (clearLocalData) clearLocalAppData();
  state.authenticated = false;
  state.authUser = null;
  state.authEmail = "";
  state.authChecking = false;
  state.authBusy = false;
  state.authMode = "signin";
  state.authMessage = "";
  state.profileView = "settings";
  state.profileMessage = "";
  state.profileBusy = false;
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
    throw new Error("Authentication server is unavailable. Start the auth backend, then try again.");
  }
  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (!response.ok) {
    throw new Error(data.error || "Authentication request failed.");
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
  } catch {
    clearAuthToken();
    state.authChecking = false;
    state.authenticated = false;
    state.authMessage = "Please sign in to continue.";
  }
  updateNav();
  render();
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

initializeAuth();
