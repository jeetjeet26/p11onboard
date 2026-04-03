import {
  getCurrentSession,
  getInternalPortalContext,
  internalListClients,
  internalListCompanies,
  internalUpsertCompanyDirectory,
  setMyActiveCommunity,
} from "./api.js";

const state = {
  companyDirectoryId: null,
  companyName: null,
  loading: false,
  saving: false,
};

function byId(id) {
  return document.getElementById(id);
}

function setStatus(message = "", kind = "") {
  const target = byId("companyStatus");
  if (!target) return;
  target.className = `status${kind ? ` ${kind}` : ""}`;
  target.textContent = message;
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

function getCompanyDirectoryIdFromUrl() {
  const raw = new URLSearchParams(window.location.search).get("companyDirectoryId");
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getCompanyNameFromUrl() {
  const raw = new URLSearchParams(window.location.search).get("companyName") || "";
  return raw.trim() || null;
}

function openClientEditor(onboardingClientId = null) {
  const numericId = Number(onboardingClientId);
  if (Number.isFinite(numericId) && numericId > 0) {
    window.location.href = `/internal-client-editor.html?clientId=${numericId}`;
    return;
  }

  const params = new URLSearchParams({
    companyDirectoryId: String(state.companyDirectoryId || ""),
    companyName: state.companyName || "",
  });
  window.location.href = `/internal-client-editor.html?${params.toString()}`;
}

async function openCommunityDashboard(onboardingClientId, currentStage) {
  const numericId = Number(onboardingClientId);
  if (!numericId) return;
  await setMyActiveCommunity(numericId);
  const destination =
    currentStage === "account_access"
      ? "/p11-onboarding-account-access.html"
      : "/p11-onboarding-dashboard.html";
  window.location.href = destination;
}

function renderCommunityRows(rows) {
  const body = byId("companyCommunityBody");
  if (!body) return;

  if (!rows.length) {
    body.innerHTML = `
      <tr>
        <td colspan="5" style="color:#767676;">No communities found for this company.</td>
      </tr>
    `;
    return;
  }

  body.innerHTML = rows
    .map(
      (row) => `
      <tr data-onboarding-client-id="${row.onboarding_client_id}" data-current-stage="${row.current_stage || ""}">
        <td>${row.community_name || "Unnamed Community"}</td>
        <td>${toStageLabel(row.current_stage)}</td>
        <td>${row.status || "draft"}</td>
        <td>${formatDate(row.target_go_live_at)}</td>
        <td>
          <button class="table-action-btn" type="button" data-edit-client-id="${row.onboarding_client_id}">Edit</button>
          <button class="table-action-btn" type="button" data-open-client-id="${row.onboarding_client_id}" data-open-stage="${row.current_stage || ""}">Open</button>
        </td>
      </tr>
    `
    )
    .join("");
}

async function loadCompanyMeta() {
  const response = await internalListCompanies({
    search: state.companyName || "",
    limit: 500,
    offset: 0,
  });
  const rows = Array.isArray(response?.items) ? response.items : [];
  const match = rows.find(
    (row) => Number(row.company_directory_id) === Number(state.companyDirectoryId)
  );
  if (!match) return;

  state.companyName = match.company_name || state.companyName;
  byId("companyTitle").textContent = state.companyName || "Company";
  byId("companyMeta").textContent = `Directory ID ${state.companyDirectoryId} · Communities: ${match.community_count || 0}`;
  byId("companyNameInput").value = state.companyName || "";
}

async function loadCompanyCommunities() {
  const response = await internalListClients({
    companyDirectoryId: state.companyDirectoryId,
    limit: 400,
    offset: 0,
  });
  const rows = Array.isArray(response?.items) ? response.items : [];
  renderCommunityRows(rows);
}

async function saveCompany() {
  if (state.saving) return;
  const companyName = byId("companyNameInput")?.value?.trim() || "";
  if (!companyName) {
    setStatus("Company name is required.", "error");
    return;
  }

  const saveButton = byId("saveCompanyBtn");
  try {
    state.saving = true;
    if (saveButton) {
      saveButton.disabled = true;
      saveButton.textContent = "Saving...";
    }
    setStatus("Saving company...");
    const result = await internalUpsertCompanyDirectory({
      companyDirectoryId: state.companyDirectoryId,
      companyName,
    });
    state.companyName = result?.company_name || companyName;
    byId("companyTitle").textContent = state.companyName;
    setStatus("Company saved.", "success");
  } catch (error) {
    setStatus(`Unable to save company: ${error.message}`, "error");
  } finally {
    state.saving = false;
    if (saveButton) {
      saveButton.disabled = false;
      saveButton.textContent = "Save Company";
    }
  }
}

function bindHandlers() {
  byId("saveCompanyBtn")?.addEventListener("click", saveCompany);
  byId("newCommunityBtn")?.addEventListener("click", () => openClientEditor(null));

  byId("companyCommunityBody")?.addEventListener("click", async (event) => {
    const editButton = event.target.closest("[data-edit-client-id]");
    if (editButton) {
      openClientEditor(editButton.dataset.editClientId);
      return;
    }

    const openButton = event.target.closest("[data-open-client-id]");
    if (openButton) {
      try {
        await openCommunityDashboard(openButton.dataset.openClientId, openButton.dataset.openStage);
      } catch (error) {
        setStatus(`Unable to open community: ${error.message}`, "error");
      }
    }
  });
}

async function initialize() {
  bindHandlers();
  state.companyDirectoryId = getCompanyDirectoryIdFromUrl();
  state.companyName = getCompanyNameFromUrl();
  if (!state.companyDirectoryId) {
    window.location.replace("/internal.html");
    return;
  }

  const session = await getCurrentSession();
  if (!session) {
    window.location.replace("/internal.html");
    return;
  }

  const context = await getInternalPortalContext();
  if (!context) {
    window.location.replace("/client-home.html");
    return;
  }

  document.body.classList.remove("auth-gate-pending");
  if (state.companyName) {
    byId("companyTitle").textContent = state.companyName;
    byId("companyNameInput").value = state.companyName;
  }
  state.loading = true;
  try {
    await Promise.all([loadCompanyMeta(), loadCompanyCommunities()]);
    setStatus("");
  } catch (error) {
    setStatus(`Unable to load company details: ${error.message}`, "error");
  } finally {
    state.loading = false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initialize().catch((error) => {
    setStatus(`Initialization failed: ${error.message}`, "error");
  });
});
