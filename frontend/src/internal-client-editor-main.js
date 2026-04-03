import {
  getCurrentSession,
  getInternalPortalContext,
  internalGetClientDetail,
  internalUpsertClientInfo,
  searchCompanies,
  setMyActiveCommunity,
} from "./api.js";

const state = {
  clientId: null,
  selectedCompany: null,
  isSearching: false,
  isSaving: false,
  currentStage: null,
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function byId(id) {
  return document.getElementById(id);
}

function valueOf(id) {
  return byId(id)?.value ?? "";
}

function setValue(id, value) {
  const target = byId(id);
  if (target) target.value = value ?? "";
}

function setStatus(message = "", kind = "") {
  const target = byId("editorStatus");
  if (!target) return;
  target.className = `status${kind ? ` ${kind}` : ""}`;
  target.textContent = message;
}

function getClientIdFromUrl() {
  const raw = new URLSearchParams(window.location.search).get("clientId");
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getPreselectedCompanyFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const rawDirectoryId = params.get("companyDirectoryId");
  const parsedDirectoryId = Number(rawDirectoryId);
  const companyDirectoryId =
    Number.isFinite(parsedDirectoryId) && parsedDirectoryId > 0
      ? parsedDirectoryId
      : null;
  const companyName = (params.get("companyName") || "").trim() || null;

  if (!companyDirectoryId && !companyName) return null;
  return {
    company_directory_id: companyDirectoryId,
    company_name: companyName,
  };
}

function setSelectedCompany(company = null) {
  state.selectedCompany = company;
  const label = byId("selectedCompanyLabel");
  if (!label) return;
  if (!company) {
    label.textContent = "";
    return;
  }
  const name = company.company_name || "Unnamed Company";
  const companyDirectoryId = company.company_directory_id || "N/A";
  label.textContent = `Selected company: ${name} (Directory ID ${companyDirectoryId})`;
}

function updateHeaderMeta(detail = null) {
  const title = byId("editorTitle");
  const meta = byId("editorMeta");
  if (!title || !meta) return;

  if (detail?.onboarding_client_id) {
    title.textContent = "Edit Client";
    meta.textContent = `Editing onboarding client #${detail.onboarding_client_id}`;
    return;
  }

  title.textContent = "Create Client";
  meta.textContent = "New internal client setup";
}

function setOpenOnboardingEnabled(enabled) {
  const button = byId("openOnboardingBtn");
  if (!button) return;
  button.disabled = !enabled;
}

function applyDetailToForm(detail) {
  updateHeaderMeta(detail);
  state.clientId = Number(detail.onboarding_client_id);
  state.currentStage = detail.current_stage || null;
  setOpenOnboardingEnabled(Boolean(state.clientId));

  if (detail.company_directory_id || detail.company_name) {
    setSelectedCompany({
      company_directory_id: detail.company_directory_id ?? null,
      company_name: detail.company_name ?? null,
      public_company_id: detail.public_company_id ?? null,
    });
  }

  setValue("communityName", detail.community_name);
  setValue("targetGoLiveAt", detail.target_go_live_at);
  setValue("currentStage", detail.current_stage);
  setValue("status", detail.status);
  setValue("communityPhone", detail.community_phone);
  setValue("communityEmail", detail.community_email);
  setValue("websiteUrl", detail.website_url);
  setValue("hoursOfOperation", detail.hours_of_operation);
  setValue("propertyType", detail.property_type);
  setValue("parentCompany", detail.parent_company);
  setValue("communityAddress", detail.community_address);
  setValue("preferredCommunicationMethod", detail.preferred_communication_method);
  setValue("reportingPrimaryName", detail.reporting_primary_name);
  setValue("reportingPrimaryEmail", detail.reporting_primary_email);
  setValue("additionalReportRecipients", detail.additional_report_recipients);
  setValue("conversionActions", detail.conversion_actions);
  setValue("technicalNotes", detail.technical_notes);
  setValue("finalNotes", detail.final_notes);
}

function renderCompanyResults(rows = []) {
  const list = byId("companyResults");
  if (!list) return;

  if (!rows.length) {
    list.classList.remove("show");
    list.innerHTML = "";
    return;
  }

  list.classList.add("show");
  list.innerHTML = rows
    .map((row) => {
      const name = row.company_name || "Unnamed Company";
      const companyDirectoryId = row.company_directory_id ?? "";
      const publicCompanyId = row.public_company_id ?? "";
      return `
        <button
          type="button"
          class="company-result-btn"
          data-company-directory-id="${companyDirectoryId}"
          data-public-company-id="${publicCompanyId}"
          data-company-name="${encodeURIComponent(String(name))}"
        >
          <div class="company-result-name">${escapeHtml(name)}</div>
          <div class="company-result-meta">Directory ID ${companyDirectoryId}</div>
        </button>
      `;
    })
    .join("");
}

async function handleCompanySearch() {
  if (state.isSearching) return;
  const query = valueOf("companySearch").trim();
  if (!query || query.length < 2) {
    setStatus("Enter at least 2 characters to search companies.", "error");
    renderCompanyResults([]);
    return;
  }

  try {
    state.isSearching = true;
    setStatus("Searching company directory...");
    const rows = await searchCompanies(query, 10);
    renderCompanyResults(rows);
    if (!rows.length) {
      setStatus("No company matches found. You can provide a new company name below.");
    } else {
      setStatus("Select a company result to use it.");
    }
  } catch (error) {
    setStatus(`Company search failed: ${error.message}`, "error");
  } finally {
    state.isSearching = false;
  }
}

function buildPayload() {
  const selectedDirectoryId = state.selectedCompany?.company_directory_id || null;
  const manualCompanyName = valueOf("companyNameOverride").trim();

  return {
    onboardingClientId: state.clientId,
    companyDirectoryId: selectedDirectoryId || null,
    companyName: selectedDirectoryId ? null : manualCompanyName || null,
    communityName: valueOf("communityName").trim() || null,
    currentStage: valueOf("currentStage") || null,
    status: valueOf("status") || null,
    targetGoLiveAt: valueOf("targetGoLiveAt") || null,
    communityPhone: valueOf("communityPhone").trim() || null,
    communityEmail: valueOf("communityEmail").trim() || null,
    websiteUrl: valueOf("websiteUrl").trim() || null,
    hoursOfOperation: valueOf("hoursOfOperation").trim() || null,
    propertyType: valueOf("propertyType").trim() || null,
    parentCompany: valueOf("parentCompany").trim() || null,
    communityAddress: valueOf("communityAddress").trim() || null,
    preferredCommunicationMethod: valueOf("preferredCommunicationMethod").trim() || null,
    reportingPrimaryName: valueOf("reportingPrimaryName").trim() || null,
    reportingPrimaryEmail: valueOf("reportingPrimaryEmail").trim() || null,
    additionalReportRecipients: valueOf("additionalReportRecipients").trim() || null,
    conversionActions: valueOf("conversionActions").trim() || null,
    technicalNotes: valueOf("technicalNotes").trim() || null,
    finalNotes: valueOf("finalNotes").trim() || null,
  };
}

async function handleSave(event) {
  event.preventDefault();
  if (state.isSaving) return;

  const payload = buildPayload();

  if (!payload.communityName) {
    setStatus("Community name is required.", "error");
    return;
  }
  if (!state.clientId && !payload.companyDirectoryId && !payload.companyName) {
    setStatus("Select an existing company or provide a new company name.", "error");
    return;
  }

  const saveButton = byId("saveClientBtn");

  try {
    state.isSaving = true;
    if (saveButton) {
      saveButton.disabled = true;
      saveButton.textContent = "Saving...";
    }
    setStatus("Saving client...");
    const response = await internalUpsertClientInfo(payload);
    const savedId = Number(response?.onboarding_client_id || 0);
    if (!savedId) {
      throw new Error("No onboarding_client_id returned from save.");
    }

    state.clientId = savedId;
    setOpenOnboardingEnabled(true);
    updateHeaderMeta({ onboarding_client_id: savedId });
    if (!state.selectedCompany && response?.company_directory_id && response?.company_name) {
      setSelectedCompany({
        company_directory_id: response.company_directory_id,
        company_name: response.company_name,
        public_company_id: response.public_company_id ?? null,
      });
    }

    const url = new URL(window.location.href);
    url.searchParams.set("clientId", String(savedId));
    window.history.replaceState({}, "", url.toString());

    if (response?.operation === "created") {
      setStatus("Client created successfully.", "success");
    } else {
      setStatus("Client updated successfully.", "success");
    }
    state.currentStage = payload.currentStage || state.currentStage;
  } catch (error) {
    setStatus(`Save failed: ${error.message}`, "error");
  } finally {
    state.isSaving = false;
    if (saveButton) {
      saveButton.disabled = false;
      saveButton.textContent = "Save Client";
    }
  }
}

async function handleOpenOnboarding() {
  if (!state.clientId) {
    setStatus("Save the client first, then open onboarding.", "error");
    return;
  }

  try {
    setStatus("Opening onboarding flow...");
    await setMyActiveCommunity(state.clientId);
    const selectedStage = valueOf("currentStage") || state.currentStage;
    const destination = selectedStage === "account_access"
      ? "/p11-onboarding-account-access.html"
      : "/p11-onboarding-dashboard.html";
    window.location.href = destination;
  } catch (error) {
    setStatus(`Unable to open onboarding flow: ${error.message}`, "error");
  }
}

function bindHandlers() {
  byId("clientEditorForm")?.addEventListener("submit", handleSave);
  byId("companySearchBtn")?.addEventListener("click", handleCompanySearch);
  byId("openOnboardingBtn")?.addEventListener("click", handleOpenOnboarding);

  byId("clearCompanyBtn")?.addEventListener("click", () => {
    setSelectedCompany(null);
    renderCompanyResults([]);
    setStatus("Company selection cleared.");
  });

  byId("companySearch")?.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    await handleCompanySearch();
  });

  byId("companyResults")?.addEventListener("click", (event) => {
    const button = event.target.closest(".company-result-btn");
    if (!button) return;

    const companyDirectoryId = Number(button.dataset.companyDirectoryId);
    const publicCompanyId = Number(button.dataset.publicCompanyId);
    const encodedName = button.dataset.companyName || "";
    const companyName = encodedName ? decodeURIComponent(encodedName) : "";

    setSelectedCompany({
      company_directory_id: Number.isFinite(companyDirectoryId) ? companyDirectoryId : null,
      public_company_id: Number.isFinite(publicCompanyId) ? publicCompanyId : null,
      company_name: companyName || null,
    });
    renderCompanyResults([]);
    setStatus("Company selected.");
  });
}

async function initialize() {
  bindHandlers();
  setOpenOnboardingEnabled(false);

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

  const clientId = getClientIdFromUrl();
  if (!clientId) {
    const preselectedCompany = getPreselectedCompanyFromUrl();
    if (preselectedCompany) {
      setSelectedCompany(preselectedCompany);
      if (preselectedCompany.company_name) {
        setValue("companyNameOverride", preselectedCompany.company_name);
      }
      setStatus("Company preselected. Fill in community details and save.");
    }
  }

  if (!clientId) {
    updateHeaderMeta(null);
    return;
  }

  try {
    setStatus("Loading client details...");
    const detail = await internalGetClientDetail(clientId);
    applyDetailToForm(detail || {});
    setStatus("");
  } catch (error) {
    setStatus(`Unable to load client detail: ${error.message}`, "error");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initialize().catch((error) => {
    setStatus(`Initialization failed: ${error.message}`, "error");
  });
});
