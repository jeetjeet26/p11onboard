import {
  createInternalSignupInvite,
  getCurrentSession,
  internalGetSyncQueueSummary,
  getInternalPortalContext,
  internalListOnboardingOverview,
  onAuthStateChange,
  requestPasswordReset,
  setMyActiveCommunity,
  signInUser,
  signOutUser,
} from "./api.js";

const state = {
  session: null,
  context: null,
  overviewRows: [],
  openingCommunityId: null,
  creatingInvite: false,
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

function setInviteMessage(message = "", kind = "") {
  const target = document.getElementById("inviteMessage");
  if (!target) return;
  target.className = `auth-message${kind ? ` ${kind}` : ""}`;
  target.textContent = message;
}

function setSyncStatus(message = "", kind = "") {
  const target = document.getElementById("syncQueueStatus");
  if (!target) return;
  target.className = `sync-status${kind ? ` ${kind}` : ""}`;
  target.textContent = message;
}

function showLoggedOutView() {
  document.getElementById("authCard")?.classList.remove("hide");
  document.getElementById("internalShell")?.classList.remove("show");
  document.body.classList.remove("auth-pending");
  setAuthMessage("");
  setInviteMessage("");
  setSyncStatus("");
}

function showLoggedInView() {
  document.getElementById("authCard")?.classList.add("hide");
  document.getElementById("internalShell")?.classList.add("show");
  document.body.classList.remove("auth-pending");
}

function updateInviteAccess(context) {
  const inviteCard = document.getElementById("inviteCard");
  if (!inviteCard) return;
  const canInvite = context?.portal_role === "admin";
  inviteCard.classList.toggle("show", canInvite);
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
        <td colspan="9" style="color:#767676;">No onboarding communities matched your filters.</td>
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
        <td>${escapeHtml(String(row.required_platform_outstanding_count ?? 0))}</td>
        <td>${escapeHtml(String(row.queued_sync_jobs ?? 0))}</td>
        <td>${escapeHtml(row.last_submitted_at ? new Date(row.last_submitted_at).toLocaleString() : "Not submitted")}</td>
        <td>
          <button
            class="table-action-btn"
            type="button"
            data-edit-client-id="${escapeHtml(row.onboarding_client_id)}"
            aria-label="Edit ${escapeHtml(row.community_name || "community")}"
          >
            Edit
          </button>
        </td>
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
    setSyncStatus(`Unable to open community dashboard: ${error.message}`, "error");
  }
}

function openClientEditor(onboardingClientId = null) {
  const numericId = Number(onboardingClientId);
  const destination = Number.isFinite(numericId) && numericId > 0
    ? `/internal-client-editor.html?clientId=${numericId}`
    : "/internal-client-editor.html";
  window.location.href = destination;
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

async function refreshSyncQueueSummary() {
  try {
    const summary = await internalGetSyncQueueSummary();
    const queued = Number(summary?.queued_count || 0);
    const failed = Number(summary?.failed_count || 0);
    const processed = Number(summary?.processed_count || 0);
    setSyncStatus(
      `Backend sync: ${queued} pending · ${failed} failed · ${processed} completed`,
      failed > 0 ? "error" : ""
    );
  } catch (error) {
    setSyncStatus(`Unable to read sync queue summary: ${error.message}`, "error");
  }
}

function getInviteBaseUrl() {
  return `${window.location.origin}/internal-signup.html`;
}

async function handleCreateInvite(event) {
  event.preventDefault();
  if (state.creatingInvite) return;

  const submitBtn = document.getElementById("inviteSubmit");
  const email = document.getElementById("inviteEmail")?.value?.trim();
  const fullName = document.getElementById("inviteFullName")?.value?.trim() || null;
  const portalRole = document.getElementById("inviteRole")?.value || "internal";
  const expiresHoursRaw = document.getElementById("inviteExpiresHours")?.value?.trim() || "";
  const expiresInHours = expiresHoursRaw ? Number(expiresHoursRaw) : null;
  const linkOutput = document.getElementById("inviteLink");

  if (!email) {
    setInviteMessage("Invite email is required.", "error");
    return;
  }
  if (!email.includes("@")) {
    setInviteMessage("Enter a valid invite email address.", "error");
    return;
  }
  if (expiresInHours !== null && (!Number.isFinite(expiresInHours) || expiresInHours < 1)) {
    setInviteMessage("Invite expiry must be a positive number of hours.", "error");
    return;
  }

  try {
    state.creatingInvite = true;
    setInviteMessage("Generating invite link...");
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Generating...";
    }
    const result = await createInternalSignupInvite({
      email,
      fullName,
      portalRole,
      expiresInHours,
      inviteBaseUrl: getInviteBaseUrl(),
    });
    if (!result?.invite_url) {
      throw new Error("Invite was created, but no invite URL was returned.");
    }
    if (linkOutput) linkOutput.value = result.invite_url;
    setInviteMessage("Invite link generated. Send it directly to the team member.", "success");
  } catch (error) {
    setInviteMessage(`Unable to generate invite: ${error.message}`, "error");
  } finally {
    state.creatingInvite = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Generate Invite Link";
    }
  }
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
  updateInviteAccess(context);
  await Promise.all([loadOverview(), refreshSyncQueueSummary()]);
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

async function handleForgotPassword(event) {
  event.preventDefault();
  const email = document.getElementById("internalEmail")?.value?.trim();
  if (!email) {
    setAuthMessage("Enter your email above, then click forgot password.", "error");
    return;
  }
  try {
    await requestPasswordReset({
      email,
      redirectTo: `${window.location.origin}/internal.html`,
    });
    setAuthMessage("Password reset email sent.", "success");
  } catch (error) {
    setAuthMessage(error.message, "error");
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
      await Promise.all([loadOverview(), refreshSyncQueueSummary()]);
    } catch (error) {
      setAuthMessage(error.message, "error");
    }
  });

  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    try {
      await signOutUser();
    } catch (error) {
      setAuthMessage(error.message, "error");
    }
  });

  document.getElementById("internalForgotPassword")?.addEventListener("click", handleForgotPassword);

  document.getElementById("createClientBtn")?.addEventListener("click", () => {
    openClientEditor(null);
  });

  document.getElementById("inviteForm")?.addEventListener("submit", handleCreateInvite);

  document.getElementById("copyInviteBtn")?.addEventListener("click", async () => {
    const linkOutput = document.getElementById("inviteLink");
    if (!linkOutput?.value) return;
    try {
      await navigator.clipboard.writeText(linkOutput.value);
      setInviteMessage("Invite link copied.", "success");
    } catch (_error) {
      setInviteMessage("Unable to copy automatically. Copy the link manually.", "error");
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
    const editButton = event.target.closest("[data-edit-client-id]");
    if (editButton) {
      event.preventDefault();
      event.stopPropagation();
      openClientEditor(editButton.dataset.editClientId);
      return;
    }
    const row = event.target.closest("tr[data-onboarding-client-id]");
    if (!row) return;
    await openCommunityDashboard(row.dataset.onboardingClientId, row.dataset.currentStage);
  });

  document.getElementById("overviewBody")?.addEventListener("keydown", async (event) => {
    if (event.target.closest("[data-edit-client-id]")) return;
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
    updateInviteAccess(null);
  }

  onAuthStateChange(async (_event, nextSession) => {
    state.session = nextSession;
    if (!nextSession) {
      showLoggedOutView();
      setSessionInfo(null, null);
      updateInviteAccess(null);
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
