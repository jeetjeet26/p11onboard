import {
  getCurrentSession,
  getInternalPortalContext,
  internalListOnboardingOverview,
  onAuthStateChange,
  setMyActiveCommunity,
  signInUser,
  signOutUser,
} from "./api.js";

const state = {
  session: null,
  context: null,
  overviewRows: [],
  openingCommunityId: null,
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(value) {
  if (!value) return "TBD";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "TBD";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function toStageLabel(stageCode) {
  return String(stageCode || "unknown")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function setAuthMessage(message = "", kind = "") {
  const target = document.getElementById("internalAuthMessage");
  if (!target) return;
  target.className = `auth-message${kind ? ` ${kind}` : ""}`;
  target.textContent = message;
}

function showLoggedOutView() {
  document.getElementById("authCard")?.classList.remove("hide");
  document.getElementById("internalShell")?.classList.remove("show");
  setAuthMessage("");
}

function showLoggedInView() {
  document.getElementById("authCard")?.classList.add("hide");
  document.getElementById("internalShell")?.classList.add("show");
}

function updateStats(rows) {
  const total = rows.length;
  const inIntake = rows.filter((row) => row.current_stage === "intake_form").length;
  const accessCount = rows.filter((row) => row.current_stage === "account_access").length;
  const goLiveCount = rows.filter((row) => row.current_stage === "go_live").length;

  const totalEl = document.getElementById("totalCommunities");
  const intakeEl = document.getElementById("intakeCount");
  const accessEl = document.getElementById("accessCount");
  const goLiveEl = document.getElementById("goLiveCount");
  if (totalEl) totalEl.textContent = String(total);
  if (intakeEl) intakeEl.textContent = String(inIntake);
  if (accessEl) accessEl.textContent = String(accessCount);
  if (goLiveEl) goLiveEl.textContent = String(goLiveCount);
}

function setTableLoadingState(onboardingClientId = null) {
  state.openingCommunityId = onboardingClientId;
  const body = document.getElementById("overviewBody");
  if (!body) return;

  body.querySelectorAll("tr[data-onboarding-client-id]").forEach((row) => {
    const rowId = Number(row.dataset.onboardingClientId);
    const isActive = onboardingClientId && rowId === Number(onboardingClientId);
    row.classList.toggle("is-opening", Boolean(isActive));
    row.setAttribute("aria-busy", isActive ? "true" : "false");
  });
}

function renderOverview(rows) {
  const body = document.getElementById("overviewBody");
  if (!body) return;

  if (!rows.length) {
    body.innerHTML = `
      <tr>
        <td colspan="6" style="color:#767676;">No onboarding communities matched your filters.</td>
      </tr>
    `;
    updateStats(rows);
    return;
  }

  body.innerHTML = rows
    .map(
      (row) => `
      <tr
        data-onboarding-client-id="${escapeHtml(row.onboarding_client_id)}"
        data-current-stage="${escapeHtml(row.current_stage || "")}"
        tabindex="0"
        role="button"
        aria-label="Open onboarding step view for ${escapeHtml(
          row.community_name || "Unnamed Community"
        )}"
      >
        <td>${escapeHtml(row.company_name || "Unknown Company")}</td>
        <td>${escapeHtml(row.community_name || "Unnamed Community")}</td>
        <td><span class="pill stage">${escapeHtml(toStageLabel(row.current_stage))}</span></td>
        <td><span class="pill ${escapeHtml(row.status || "draft")}">${escapeHtml(row.status || "draft")}</span></td>
        <td>${escapeHtml(formatDate(row.target_go_live_at))}</td>
        <td>${escapeHtml(row.last_submitted_at ? new Date(row.last_submitted_at).toLocaleString() : "Not submitted")}</td>
      </tr>
    `
    )
    .join("");

  setTableLoadingState(state.openingCommunityId);
  updateStats(rows);
}

async function openCommunityDashboard(onboardingClientId, currentStage) {
  const numericId = Number(onboardingClientId);
  if (!numericId) return;

  try {
    setTableLoadingState(numericId);
    await setMyActiveCommunity(numericId);
    const destination =
      currentStage === "account_access"
        ? "/p11-onboarding-account-access.html"
        : "/p11-onboarding-dashboard.html";
    window.location.href = destination;
  } catch (error) {
    setTableLoadingState(null);
    alert(`Unable to open community dashboard: ${error.message}`);
  }
}

async function loadOverview() {
  const search = document.getElementById("searchInput")?.value?.trim() || "";
  const stage = document.getElementById("stageFilter")?.value || null;
  const rows = await internalListOnboardingOverview({
    search,
    stage: stage || null,
    limit: 400,
  });
  state.overviewRows = rows;
  renderOverview(rows);
}

function setSessionInfo(session, context) {
  const el = document.getElementById("sessionInfo");
  if (!el) return;
  if (!session || !context) {
    el.textContent = "";
    return;
  }

  const fullName =
    context.full_name || session.user.user_metadata?.full_name || session.user.email;
  el.textContent = `${fullName} · Internal ${context.portal_role || "user"}`;
}

async function hydrateInternal(session) {
  state.session = session;
  const context = await getInternalPortalContext();
  if (!context) {
    throw new Error("Your account does not have internal portal access.");
  }

  state.context = context;
  showLoggedInView();
  setSessionInfo(session, context);
  await loadOverview();
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  const submitBtn = document.getElementById("internalLoginSubmit");
  const email = document.getElementById("internalEmail")?.value?.trim();
  const password = document.getElementById("internalPassword")?.value || "";

  try {
    setAuthMessage("");
    if (submitBtn) submitBtn.disabled = true;
    await signInUser({ email, password });
  } catch (error) {
    setAuthMessage(error.message, "error");
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function forceSignOutWithMessage(message) {
  try {
    await signOutUser();
  } catch (_error) {
    // ignore signout errors; session may already be invalid
  }
  showLoggedOutView();
  setAuthMessage(message, "error");
}

function bindHandlers() {
  document
    .getElementById("internalLoginForm")
    ?.addEventListener("submit", handleLoginSubmit);

  document.getElementById("refreshBtn")?.addEventListener("click", async () => {
    try {
      await loadOverview();
    } catch (error) {
      alert(error.message);
    }
  });

  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    try {
      await signOutUser();
    } catch (error) {
      alert(error.message);
    }
  });

  document.getElementById("searchInput")?.addEventListener("input", async () => {
    try {
      await loadOverview();
    } catch (error) {
      console.error(error);
    }
  });

  document.getElementById("stageFilter")?.addEventListener("change", async () => {
    try {
      await loadOverview();
    } catch (error) {
      console.error(error);
    }
  });

  document.getElementById("overviewBody")?.addEventListener("click", async (event) => {
    const row = event.target.closest("tr[data-onboarding-client-id]");
    if (!row) return;
    await openCommunityDashboard(row.dataset.onboardingClientId, row.dataset.currentStage);
  });

  document.getElementById("overviewBody")?.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target.closest("tr[data-onboarding-client-id]");
    if (!row) return;
    event.preventDefault();
    await openCommunityDashboard(row.dataset.onboardingClientId, row.dataset.currentStage);
  });
}

async function initialize() {
  bindHandlers();
  const session = await getCurrentSession();
  state.session = session;

  if (session) {
    try {
      await hydrateInternal(session);
    } catch (error) {
      await forceSignOutWithMessage(error.message);
    }
  } else {
    showLoggedOutView();
  }

  onAuthStateChange(async (_event, nextSession) => {
    state.session = nextSession;
    if (!nextSession) {
      showLoggedOutView();
      setSessionInfo(null, null);
      return;
    }

    try {
      await hydrateInternal(nextSession);
    } catch (error) {
      await forceSignOutWithMessage(error.message);
    }
  });
}

document.addEventListener("DOMContentLoaded", initialize);
