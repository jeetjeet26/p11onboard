import {
  getCurrentSession,
  getInternalPortalContext,
  getMyPortalContext,
  listMyCommunities,
  onAuthStateChange,
  requestPasswordReset,
  setMyActiveCommunity,
  signInUser,
  signOutUser,
} from "./api.js";
import {
  applyRoleChrome,
  consumeRedirectNotice,
  renderNotice,
} from "./navigation.js";
import { stageDestination } from "./stages.js";

const state = {
  session: null,
  context: null,
  communities: [],
  communityPage: 0,
  communityPageSize: 25,
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

function setAuthMessage(message = "", kind = "") {
  const target = document.getElementById("clientAuthMessage");
  if (!target) return;
  target.className = `auth-message${kind ? ` ${kind}` : ""}`;
  target.textContent = message;
}

function formatDate(value) {
  if (!value) return "None";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "None";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(value) {
  if (!value) return "None";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "None";
  return date.toLocaleString();
}

function toStageLabel(stageCode) {
  return String(stageCode || "none")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function showLoggedOutView() {
  document.getElementById("authCard")?.classList.remove("hide");
  document.getElementById("clientShell")?.classList.remove("show");
  document.body.classList.remove("internal-user");
  document.body.classList.remove("client-authenticated");
  setAuthMessage("");
}

function showLoggedInView() {
  document.getElementById("authCard")?.classList.add("hide");
  document.getElementById("clientShell")?.classList.add("show");
  document.body.classList.add("client-authenticated");
}

function updateHeaderAuthControls(session) {
  const logoutButton = document.getElementById("logoutBtn");
  if (!logoutButton) return;
  logoutButton.classList.toggle("show", Boolean(session));
}

function applyRoleNavigation(context = null) {
  applyRoleChrome(context);
}

function setCompanySummary(context, communities) {
  const activeCommunity = communities.find((community) => community.is_active) || communities[0] || null;
  const companyName =
    context?.company_name || activeCommunity?.company_name || communities[0]?.company_name || "None";

  const companyNameEl = document.getElementById("companyName");
  const communityCountEl = document.getElementById("communityCount");
  const activeCommunityEl = document.getElementById("activeCommunity");

  if (companyNameEl) companyNameEl.textContent = companyName || "None";
  if (communityCountEl) communityCountEl.textContent = String(communities.length || 0);
  if (activeCommunityEl) {
    activeCommunityEl.textContent = activeCommunity?.community_name || "None";
  }
}

function updateStats(communities) {
  const total = communities.length;
  const inIntake = communities.filter((community) => community.current_stage === "intake_form").length;
  const inAccess = communities.filter((community) => community.current_stage === "account_access").length;
  const goLive = communities.filter((community) => community.current_stage === "go_live").length;

  const totalEl = document.getElementById("totalCommunities");
  const intakeEl = document.getElementById("intakeCount");
  const accessEl = document.getElementById("accessCount");
  const goLiveEl = document.getElementById("goLiveCount");

  if (totalEl) totalEl.textContent = String(total);
  if (intakeEl) intakeEl.textContent = String(inIntake);
  if (accessEl) accessEl.textContent = String(inAccess);
  if (goLiveEl) goLiveEl.textContent = String(goLive);
}

function setTableLoadingState(onboardingClientId = null) {
  state.openingCommunityId = onboardingClientId;
  const body = document.getElementById("communityBody");
  if (!body) return;

  body.querySelectorAll("tr[data-onboarding-client-id]").forEach((row) => {
    const rowId = Number(row.dataset.onboardingClientId);
    const isActive = onboardingClientId && rowId === Number(onboardingClientId);
    row.classList.toggle("is-opening", Boolean(isActive));
    row.setAttribute("aria-busy", isActive ? "true" : "false");
  });
}

function renderCommunities(communities) {
  const body = document.getElementById("communityBody");
  if (!body) return;

  if (!communities.length) {
    body.innerHTML = `
      <tr>
        <td colspan="6" class="empty-cell">
          No communities yet. Click <strong>Add Community</strong> to start onboarding.
        </td>
      </tr>
    `;
    updateStats(communities);
    return;
  }

  body.innerHTML = communities
    .map(
      (community) => {
        const stageCode = String(community.current_stage || "");
        const actionLabel =
          stageCode === "go_live" || stageCode === "prelaunch_review"
            ? "View Onboarding"
            : "Continue Onboarding";
        return `
      <tr
        data-onboarding-client-id="${escapeHtml(community.onboarding_client_id)}"
        data-current-stage="${escapeHtml(community.current_stage || "")}"
        tabindex="0"
        role="button"
        aria-label="Open ${escapeHtml(community.community_name || "community")}"
      >
        <td>${escapeHtml(community.community_name || "None")}</td>
        <td><span class="pill stage">${escapeHtml(toStageLabel(community.current_stage))}</span></td>
        <td><span class="pill ${escapeHtml(community.status || "draft")}">${escapeHtml(community.status || "draft")}</span></td>
        <td>${escapeHtml(formatDate(community.target_go_live_at))}</td>
        <td>${escapeHtml(formatDateTime(community.last_submitted_at))}</td>
        <td>${escapeHtml(actionLabel)}</td>
      </tr>
    `
      }
    )
    .join("");

  setTableLoadingState(state.openingCommunityId);
  updateStats(communities);
}

function renderCommunityPagination(total) {
  const target = document.getElementById("clientCommunityPagination");
  if (!target) return;
  const totalPages = Math.max(1, Math.ceil(total / state.communityPageSize));
  const start = total ? state.communityPage * state.communityPageSize + 1 : 0;
  const end = Math.min(total, (state.communityPage + 1) * state.communityPageSize);
  target.innerHTML = `
    <span>Showing ${start}-${end} of ${total}</span>
    <span class="pagination-actions">
      <button type="button" data-client-prev ${state.communityPage <= 0 ? "disabled" : ""}>Previous</button>
      <span>Page ${state.communityPage + 1} of ${totalPages}</span>
      <button type="button" data-client-next ${state.communityPage >= totalPages - 1 ? "disabled" : ""}>Next</button>
    </span>
  `;
  target.querySelector("[data-client-prev]")?.addEventListener("click", () => {
    state.communityPage = Math.max(0, state.communityPage - 1);
    renderCommunityPage();
  });
  target.querySelector("[data-client-next]")?.addEventListener("click", () => {
    const maxPage = Math.max(0, Math.ceil(state.communities.length / state.communityPageSize) - 1);
    state.communityPage = Math.min(maxPage, state.communityPage + 1);
    renderCommunityPage();
  });
}

function renderCommunityPage() {
  const start = state.communityPage * state.communityPageSize;
  renderCommunities(state.communities.slice(start, start + state.communityPageSize));
  updateStats(state.communities);
  renderCommunityPagination(state.communities.length);
}

async function openCommunity(onboardingClientId, currentStage) {
  const numericId = Number(onboardingClientId);
  if (!numericId) return;

  try {
    setTableLoadingState(numericId);
    await setMyActiveCommunity(numericId);
    const destination = stageDestination(currentStage);
    window.location.href = destination;
  } catch (error) {
    setTableLoadingState(null);
    setAuthMessage(`Unable to open community: ${error.message}`, "error");
  }
}

async function loadClientHomeData() {
  const [context, communities] = await Promise.all([getMyPortalContext(), listMyCommunities()]);
  state.context = context || null;
  state.communities = Array.isArray(communities) ? communities : [];
  state.communityPage = 0;

  applyRoleNavigation(state.context);
  setCompanySummary(state.context, state.communities);
  renderCommunityPage();
}

async function redirectInternalSessionHome() {
  try {
    const internalContext = await getInternalPortalContext();
    if (internalContext) {
      window.location.replace("/internal.html");
      return true;
    }
  } catch (_error) {
    // client sessions are expected to fail this internal check
  }
  return false;
}

async function hydrateClient(session) {
  state.session = session;
  showLoggedInView();
  updateHeaderAuthControls(session);
  await loadClientHomeData();
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  const submitButton = document.getElementById("clientLoginSubmit");
  const email = document.getElementById("clientEmail")?.value?.trim();
  const password = document.getElementById("clientPassword")?.value || "";

  try {
    setAuthMessage("");
    if (submitButton) submitButton.disabled = true;
    await signInUser({ email, password });
  } catch (error) {
    setAuthMessage(error.message, "error");
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
}

async function handleForgotPassword(event) {
  event.preventDefault();
  const email = document.getElementById("clientEmail")?.value?.trim();
  if (!email) {
    setAuthMessage("Enter your email above, then click forgot password.", "error");
    return;
  }
  try {
    await requestPasswordReset({
      email,
      redirectTo: `${window.location.origin}/client-home.html`,
    });
    setAuthMessage("Password reset email sent.", "success");
  } catch (error) {
    setAuthMessage(error.message, "error");
  }
}

function bindHandlers() {
  document.getElementById("clientLoginForm")?.addEventListener("submit", handleLoginSubmit);

  document.getElementById("addCommunityBtn")?.addEventListener("click", () => {
    // New communities are created when a submitted client starts intake with a different community name.
    window.location.href = "/p11-onboarding-dashboard.html?startNewCommunity=1";
  });

  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    try {
      await signOutUser();
    } catch (error) {
      setAuthMessage(error.message, "error");
    }
  });

  document.getElementById("clientForgotPassword")?.addEventListener("click", handleForgotPassword);

  document.getElementById("communityBody")?.addEventListener("click", async (event) => {
    const row = event.target.closest("tr[data-onboarding-client-id]");
    if (!row) return;
    await openCommunity(row.dataset.onboardingClientId, row.dataset.currentStage);
  });

  document.getElementById("communityBody")?.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target.closest("tr[data-onboarding-client-id]");
    if (!row) return;
    event.preventDefault();
    await openCommunity(row.dataset.onboardingClientId, row.dataset.currentStage);
  });
}

async function initialize() {
  renderNotice(consumeRedirectNotice());
  bindHandlers();
  const session = await getCurrentSession();
  state.session = session;
  updateHeaderAuthControls(session);

  if (session) {
    try {
      if (await redirectInternalSessionHome()) return;
      await hydrateClient(session);
    } catch (error) {
      setAuthMessage(`Unable to load client home: ${error.message}`, "error");
      showLoggedOutView();
    }
  } else {
    showLoggedOutView();
  }

  onAuthStateChange(async (_event, nextSession) => {
    state.session = nextSession;
    updateHeaderAuthControls(nextSession);
    if (!nextSession) {
      showLoggedOutView();
      return;
    }

    try {
      if (await redirectInternalSessionHome()) return;
      await hydrateClient(nextSession);
    } catch (error) {
      setAuthMessage(`Unable to load client home: ${error.message}`, "error");
      showLoggedOutView();
    }
  });
}

document.addEventListener("DOMContentLoaded", initialize);
