import {
  createDropboxFolderForClient,
  disconnectDropbox,
  getCurrentSession,
  getDropboxStatus,
  getInternalPortalContext,
  internalClearDropboxBinding,
  internalGetClientDetail,
  internalGetDropboxBinding,
  internalUpsertClientInfo,
  linkExistingDropboxFolder,
  listDropboxFolder,
  searchCompanies,
  setDropboxFolderRoot,
  setMyActiveCommunity,
  startDropboxOAuth,
} from "./api.js";

const state = {
  clientId: null,
  selectedCompany: null,
  isSearching: false,
  isSaving: false,
  currentStage: null,
  dropboxStatus: null,
  dropboxBinding: null,
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

  refreshDropboxBinding({ silent: true }).catch((error) => {
    console.warn("Dropbox binding load failed:", error.message);
  });
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
    refreshDropboxBinding({ silent: true }).catch(() => {});
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

function setDropboxCommunityStatus(message = "", kind = "") {
  const target = byId("dropboxCommunityStatus");
  if (!target) return;
  target.className = `status${kind ? ` ${kind}` : ""}`;
  target.textContent = message;
}

function setDropboxRootStatus(message = "", kind = "") {
  const target = byId("dropboxRootStatus");
  if (!target) return;
  target.className = `status${kind ? ` ${kind}` : ""}`;
  target.textContent = message;
}

function renderDropboxStatus(status) {
  state.dropboxStatus = status || null;
  const connEl = byId("dropboxConnection");
  const accountEl = byId("dropboxAccount");
  const teamEl = byId("dropboxTeam");
  const rootEl = byId("dropboxRoot");
  const connectBtn = byId("dropboxConnectBtn");
  const disconnectBtn = byId("dropboxDisconnectBtn");
  const rootInput = byId("dropboxRootPath");

  if (!status || !status.is_connected) {
    if (connEl) {
      connEl.innerHTML = '<span class="dropbox-pill err">Not Connected</span>';
    }
    if (accountEl) accountEl.textContent = "—";
    if (teamEl) teamEl.textContent = "—";
    if (rootEl) rootEl.textContent = "—";
    if (connectBtn) connectBtn.textContent = "Connect P11 Dropbox";
    if (disconnectBtn) disconnectBtn.disabled = true;
    if (rootInput) rootInput.value = "";
    return;
  }

  if (connEl) {
    const badge = status.last_error
      ? '<span class="dropbox-pill warn">Connected (see error)</span>'
      : '<span class="dropbox-pill ok">Connected</span>';
    connEl.innerHTML = status.last_error
      ? `${badge}<div style="font-size:11px;color:#a0281a;margin-top:4px;">${escapeHtml(status.last_error)}</div>`
      : badge;
  }
  if (accountEl) {
    accountEl.textContent = status.account_display_name
      ? `${status.account_display_name} (${status.account_email || ""})`
      : status.account_email || "Connected account";
  }
  if (teamEl) {
    teamEl.textContent = status.team_name || "Personal Dropbox";
  }
  if (rootEl) {
    rootEl.textContent = status.folder_root_path || "/";
  }
  if (connectBtn) connectBtn.textContent = "Reconnect P11 Dropbox";
  if (disconnectBtn) disconnectBtn.disabled = false;
  if (rootInput && !rootInput.value) {
    rootInput.value = status.folder_root_path || "";
  }
}

function renderDropboxBinding(binding) {
  state.dropboxBinding = binding || null;
  const card = byId("dropboxBindingCard");
  const pathEl = byId("dropboxBindingPath");
  const metaEl = byId("dropboxBindingMeta");
  const openEl = byId("dropboxBindingOpen");
  const intro = byId("dropboxCommunityIntro");

  if (!state.clientId) {
    card?.classList.add("dropbox-hidden");
    if (intro) intro.textContent = "Save the client first to manage their Dropbox folder.";
    return;
  }

  if (!binding) {
    card?.classList.add("dropbox-hidden");
    if (intro) intro.textContent = "No Dropbox folder linked yet for this community.";
    return;
  }

  card?.classList.remove("dropbox-hidden");
  if (pathEl) {
    pathEl.textContent = binding.folder_display_path || binding.folder_path || "(no path)";
  }
  if (metaEl) {
    const source = binding.link_source === "created" ? "Created via P11" : "Linked existing folder";
    const when = binding.linked_at ? new Date(binding.linked_at).toLocaleString() : "";
    metaEl.textContent = `${source}${binding.linked_by_email ? ` • ${binding.linked_by_email}` : ""}${when ? ` • ${when}` : ""}`;
  }
  if (openEl) {
    const href = binding.shared_link_url || "#";
    openEl.setAttribute("href", href);
    if (!binding.shared_link_url) {
      openEl.setAttribute("aria-disabled", "true");
      openEl.style.opacity = "0.5";
      openEl.style.pointerEvents = "none";
    } else {
      openEl.removeAttribute("aria-disabled");
      openEl.style.opacity = "";
      openEl.style.pointerEvents = "";
    }
  }
  if (intro) {
    intro.textContent = "Linked Dropbox folder below. Use the actions to replace or unlink it.";
  }
}

async function refreshDropboxStatus({ silent = false } = {}) {
  try {
    const status = await getDropboxStatus();
    renderDropboxStatus(status);
  } catch (error) {
    if (!silent) {
      setDropboxCommunityStatus(`Dropbox status unavailable: ${error.message}`, "error");
    }
    renderDropboxStatus(null);
  }
}

async function refreshDropboxBinding({ silent = false } = {}) {
  if (!state.clientId) {
    renderDropboxBinding(null);
    return;
  }
  try {
    const binding = await internalGetDropboxBinding(state.clientId);
    renderDropboxBinding(binding);
  } catch (error) {
    if (!silent) {
      setDropboxCommunityStatus(`Dropbox binding fetch failed: ${error.message}`, "error");
    }
    renderDropboxBinding(null);
  }
}

async function handleDropboxConnect() {
  try {
    setDropboxCommunityStatus("Preparing Dropbox authorization...", "");
    const url = new URL(window.location.href);
    const result = await startDropboxOAuth({ returnTo: url.toString() });
    if (result?.authorize_url) {
      window.location.href = result.authorize_url;
    } else {
      throw new Error("No authorize URL returned");
    }
  } catch (error) {
    setDropboxCommunityStatus(`Connect failed: ${error.message}`, "error");
  }
}

async function handleDropboxDisconnect() {
  if (!window.confirm("Disconnect the shared P11 Dropbox? You will need to reauthorize to upload again.")) {
    return;
  }
  try {
    await disconnectDropbox();
    await refreshDropboxStatus();
    setDropboxCommunityStatus("Dropbox disconnected.", "success");
  } catch (error) {
    setDropboxCommunityStatus(`Disconnect failed: ${error.message}`, "error");
  }
}

async function handleDropboxSaveRoot() {
  const input = byId("dropboxRootPath");
  const value = (input?.value || "").trim();
  if (!state.dropboxStatus?.is_connected) {
    setDropboxRootStatus("Connect Dropbox first.", "error");
    return;
  }
  try {
    setDropboxRootStatus("Saving root folder...", "");
    await setDropboxFolderRoot(value || "/");
    await refreshDropboxStatus({ silent: true });
    setDropboxRootStatus("Root folder saved.", "success");
  } catch (error) {
    setDropboxRootStatus(`Save failed: ${error.message}`, "error");
  }
}

async function handleDropboxCreateFolder() {
  if (!state.clientId) {
    setDropboxCommunityStatus("Save the client first, then create a folder.", "error");
    return;
  }
  if (!state.dropboxStatus?.is_connected) {
    setDropboxCommunityStatus("Connect Dropbox first.", "error");
    return;
  }
  const nameInput = byId("dropboxCreateName");
  const parentInput = byId("dropboxCreateParent");
  try {
    setDropboxCommunityStatus("Creating folder in Dropbox...", "");
    const result = await createDropboxFolderForClient({
      onboardingClientId: state.clientId,
      folderName: nameInput?.value?.trim() || null,
      parentPath: parentInput?.value?.trim() || null,
    });
    const subfolderCount = Array.isArray(result?.binding?.subfolders)
      ? result.binding.subfolders.length
      : 0;
    setDropboxCommunityStatus(
      `Folder created and linked: ${result?.binding?.folder_display_path || "(unknown path)"}${subfolderCount ? ` with ${subfolderCount} standard subfolders` : ""}`,
      "success"
    );
    await refreshDropboxBinding({ silent: true });
  } catch (error) {
    setDropboxCommunityStatus(`Folder creation failed: ${error.message}`, "error");
  }
}

async function handleDropboxLinkExisting() {
  if (!state.clientId) {
    setDropboxCommunityStatus("Save the client first, then link a folder.", "error");
    return;
  }
  if (!state.dropboxStatus?.is_connected) {
    setDropboxCommunityStatus("Connect Dropbox first.", "error");
    return;
  }
  const input = byId("dropboxLinkPath");
  const value = (input?.value || "").trim();
  if (!value) {
    setDropboxCommunityStatus("Provide a folder path or Dropbox ID to link.", "error");
    return;
  }
  try {
    setDropboxCommunityStatus("Linking folder...", "");
    const payload = value.startsWith("id:")
      ? { onboardingClientId: state.clientId, folderId: value }
      : { onboardingClientId: state.clientId, folderPath: value };
    const result = await linkExistingDropboxFolder(payload);
    setDropboxCommunityStatus(
      `Linked: ${result?.binding?.folder_display_path || "(unknown path)"}`,
      "success"
    );
    await refreshDropboxBinding({ silent: true });
  } catch (error) {
    setDropboxCommunityStatus(`Link failed: ${error.message}`, "error");
  }
}

async function handleDropboxUnlink() {
  if (!state.clientId) return;
  if (!window.confirm("Unlink this community's Dropbox folder? The folder stays in Dropbox, only the portal link is cleared.")) {
    return;
  }
  try {
    setDropboxCommunityStatus("Unlinking...", "");
    await internalClearDropboxBinding(state.clientId);
    await refreshDropboxBinding({ silent: true });
    setDropboxCommunityStatus("Community Dropbox folder unlinked.", "success");
  } catch (error) {
    setDropboxCommunityStatus(`Unlink failed: ${error.message}`, "error");
  }
}

async function handleDropboxBrowse() {
  const section = byId("dropboxBrowserSection");
  if (!section) return;
  section.classList.toggle("dropbox-hidden");
  if (section.classList.contains("dropbox-hidden")) return;
  const pathInput = byId("dropboxBrowsePath");
  if (pathInput && !pathInput.value) {
    pathInput.value = state.dropboxStatus?.folder_root_path || "/";
  }
  await loadDropboxBrowse();
}

async function loadDropboxBrowse() {
  const pathInput = byId("dropboxBrowsePath");
  const resultsEl = byId("dropboxBrowseResults");
  if (!resultsEl) return;
  resultsEl.innerHTML = '<div style="padding:12px;font-size:12px;color:#767676;">Loading...</div>';
  try {
    const path = (pathInput?.value || "").trim() || "/";
    const payload = await listDropboxFolder(path);
    const entries = Array.isArray(payload?.entries) ? payload.entries : [];
    if (!entries.length) {
      resultsEl.innerHTML = '<div style="padding:12px;font-size:12px;color:#767676;">No folders in this path.</div>';
      return;
    }
    resultsEl.innerHTML = entries
      .map(
        (entry) => `
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;border-bottom:1px solid var(--border);font-size:12px;">
            <div>
              <div style="font-weight:700;">${escapeHtml(entry.name || "")}</div>
              <div style="color:#767676;font-size:11px;">${escapeHtml(entry.path_display || "")}</div>
            </div>
            <div style="display:flex;gap:6px;">
              <button type="button" class="btn" data-dropbox-browse-into="${escapeHtml(entry.path_display || "")}">Open</button>
              <button type="button" class="btn" data-dropbox-use-path="${escapeHtml(entry.path_display || "")}">Use This</button>
            </div>
          </div>
        `
      )
      .join("");
  } catch (error) {
    resultsEl.innerHTML = `<div style="padding:12px;font-size:12px;color:#a0281a;">Browse failed: ${escapeHtml(error.message)}</div>`;
  }
}

function bindDropboxHandlers() {
  byId("dropboxConnectBtn")?.addEventListener("click", handleDropboxConnect);
  byId("dropboxRefreshBtn")?.addEventListener("click", () => refreshDropboxStatus());
  byId("dropboxDisconnectBtn")?.addEventListener("click", handleDropboxDisconnect);
  byId("dropboxSaveRootBtn")?.addEventListener("click", handleDropboxSaveRoot);
  byId("dropboxCreateBtn")?.addEventListener("click", handleDropboxCreateFolder);
  byId("dropboxLinkBtn")?.addEventListener("click", handleDropboxLinkExisting);
  byId("dropboxUnlinkBtn")?.addEventListener("click", handleDropboxUnlink);
  byId("dropboxBrowseBtn")?.addEventListener("click", handleDropboxBrowse);
  byId("dropboxBrowseGoBtn")?.addEventListener("click", loadDropboxBrowse);

  byId("dropboxBrowseResults")?.addEventListener("click", (event) => {
    const into = event.target?.dataset?.dropboxBrowseInto;
    const use = event.target?.dataset?.dropboxUsePath;
    if (into) {
      const pathInput = byId("dropboxBrowsePath");
      if (pathInput) pathInput.value = into;
      loadDropboxBrowse();
      return;
    }
    if (use) {
      const linkInput = byId("dropboxLinkPath");
      if (linkInput) linkInput.value = use;
      linkInput?.focus();
    }
  });
}

function handleDropboxCallbackParams() {
  const params = new URLSearchParams(window.location.search);
  const status = params.get("dropbox_status");
  if (!status) return;
  if (status === "connected") {
    setDropboxCommunityStatus("Dropbox connected successfully.", "success");
  } else if (status === "error") {
    const err = params.get("dropbox_error") || "Unknown Dropbox error";
    setDropboxCommunityStatus(`Dropbox connection failed: ${err}`, "error");
  }
  params.delete("dropbox_status");
  params.delete("dropbox_error");
  params.delete("dropbox_account");
  const query = params.toString();
  const url = new URL(window.location.href);
  url.search = query ? `?${query}` : "";
  window.history.replaceState({}, "", url.toString());
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
  bindDropboxHandlers();
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

  handleDropboxCallbackParams();
  refreshDropboxStatus({ silent: true }).catch(() => {});

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
    renderDropboxBinding(null);
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
