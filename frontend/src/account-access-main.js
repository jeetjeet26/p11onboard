import {
  getCurrentSession,
  getLatestSubmissionPayload,
  getInternalPortalContext,
  listMyPlatformAccess,
  getMyPortalContext,
  listMyCommunities,
  listTaskStates,
  onAuthStateChange,
  setMyActiveCommunity,
  signOutUser,
  upsertMyPlatformAccess,
  upsertTaskState,
} from "./api.js";
import { escapeHtml, sanitizeUrl } from "./utils/sanitize.js";

const STAGE_SEQUENCE = [
  "contract_signed",
  "intake_form",
  "account_access",
  "creative_kickoff",
  "campaign_build",
  "prelaunch_review",
  "go_live",
];

const STAGE_COPY = {
  contract_signed:
    "Your contract is signed. Complete the intake form to start onboarding.",
  intake_form:
    "Complete and submit your intake form before moving to account access.",
  account_access:
    "Grant access to the selected platforms below so implementation can begin.",
  creative_kickoff:
    "Your team is in creative kickoff. Platform access should already be complete.",
  campaign_build: "Campaign build is in progress.",
  prelaunch_review: "Pre-launch QA and review are in progress.",
  go_live: "Campaigns are live.",
};

const PLATFORM_GUIDES = {
  "Google Ads Manager": "https://support.google.com/google-ads/answer/6372672",
  "Google Analytics 4 (GA4)": "https://www.p11.com/marketing/kb/google-analytics/",
  "Google Tag Manager (GTM)": "https://www.p11.com/marketing/kb/add-user-to-gtm-account/",
  "Google Search Console": "https://www.p11.com/marketing/kb/search-console/",
  "Google Business Profile": "https://www.p11.com/marketing/kb/business-profile/",
  "Meta Business Suite / Pages":
    "https://www.p11.com/marketing/kb/grant-social-media-partner-access/",
  "Meta Ads Manager":
    "https://www.p11.com/marketing/kb/grant-social-media-partner-access/",
};
const ACCESS_STEP_COMPLETION_TASK_KEY = "step_3_account_access_complete";

const state = {
  session: null,
  portalContext: null,
  communities: [],
  currentPlatforms: [],
  switchingCommunity: false,
  baseDisplayStage: "account_access",
  currentStageCode: "account_access",
  hasUnsavedChanges: false,
  savingProgress: false,
};

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeLabel(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function formatDate(dateValue) {
  if (!dateValue) return "TBD";
  const date = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "TBD";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function hasSubmittedIntake(context = null, payload = null) {
  if (payload && typeof payload === "object" && Object.keys(payload).length > 0) {
    return true;
  }
  const status = context?.status || "";
  return ["submitted", "resubmitted", "in_review", "approved"].includes(status);
}

function deriveDisplayStage(stageCode, context = null, payload = null) {
  const normalized = STAGE_SEQUENCE.includes(stageCode) ? stageCode : "intake_form";
  if (normalized === "intake_form" && hasSubmittedIntake(context, payload)) {
    return "account_access";
  }
  return normalized;
}

function applyStage(stageCode) {
  const normalizedStage = STAGE_SEQUENCE.includes(stageCode) ? stageCode : "account_access";
  const idx = Math.max(0, STAGE_SEQUENCE.indexOf(normalizedStage));
  state.currentStageCode = normalizedStage;
  const dots = Array.from(document.querySelectorAll(".stage-dot"));
  const names = Array.from(document.querySelectorAll(".stage-name"));
  const connectors = Array.from(document.querySelectorAll(".connector"));

  dots.forEach((dot, i) => {
    dot.className = "stage-dot";
    if (i < idx) {
      dot.classList.add("done");
      dot.textContent = "✓";
    } else if (i === idx) {
      dot.classList.add("active");
      dot.textContent = i === dots.length - 1 ? "🚀" : String(i + 1);
    } else {
      dot.textContent = i === dots.length - 1 ? "🚀" : String(i + 1);
    }
  });

  names.forEach((name, i) => {
    name.className = "stage-name";
    if (i < idx) name.classList.add("done");
    if (i === idx) name.classList.add("active");
  });

  connectors.forEach((connector, i) => {
    connector.className = "connector";
    if (i < idx) connector.classList.add("done");
    if (i === idx) connector.classList.add("active");
  });

  const stepTitle = document.getElementById("stepTitle");
  const stepText = document.getElementById("stepText");
  if (stepTitle) stepTitle.textContent = `Step ${idx + 1} of ${STAGE_SEQUENCE.length} — ${String(normalizedStage).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}`;
  if (stepText) stepText.textContent = STAGE_COPY[normalizedStage] || STAGE_COPY.account_access;
  updateStageNavigationInteractivity(normalizedStage);
}

function buildTaskKey(platformCode, platformLabel) {
  return `platform_access__${platformCode || slugify(platformLabel)}`;
}

function setSessionInfo() {
  const sessionInfo = document.getElementById("sessionInfo");
  if (!sessionInfo || !state.session || !state.portalContext) return;
  const fullName =
    state.portalContext.full_name ||
    state.session.user.user_metadata?.full_name ||
    state.session.user.email;
  sessionInfo.textContent = `${fullName} · ${state.portalContext.company_name || "Company not set"}`;
}

function applyRoleNavigation() {
  const isInternalRole = ["internal", "admin"].includes(
    state.portalContext?.portal_role || ""
  );
  document.body.classList.toggle("internal-user", isInternalRole);
  const homeLink = document.getElementById("accountAccessHomeLink");
  const backLink = document.getElementById("accountAccessBackLink");
  const returnLink = document.getElementById("accountAccessReturnLink");
  if (homeLink) {
    homeLink.setAttribute("href", isInternalRole ? "/internal.html" : "/client-home.html");
    homeLink.classList.toggle("internal-home-link-active", isInternalRole);
  }
  if (backLink) {
    backLink.textContent = isInternalRole ? "Open Community Intake" : "Back to Step 2 Intake";
  }
  if (returnLink) {
    returnLink.setAttribute("href", isInternalRole ? "/internal.html" : "/p11-onboarding-dashboard.html");
    returnLink.textContent = isInternalRole ? "Return to Internal Home" : "Return to Dashboard";
  }
}

function applyContextHeader() {
  const nameEl = document.getElementById("displayName");
  const companyEl = document.getElementById("displayCompany");
  const liveEl = document.getElementById("displayGoLive");
  if (nameEl) {
    nameEl.textContent =
      state.portalContext?.community_name ||
      state.portalContext?.display_name ||
      "Community";
  }
  if (companyEl) {
    companyEl.textContent = state.portalContext?.company_name || "Not selected";
  }
  if (liveEl) {
    liveEl.textContent = formatDate(state.portalContext?.target_go_live_at);
  }
  setSessionInfo();
  applyRoleNavigation();
}

function renderCommunitySwitcher(communities, activeCommunityId) {
  const switcher = document.getElementById("communitySwitcher");
  if (!switcher) return;
  switcher.innerHTML = "";

  communities.forEach((community) => {
    const option = document.createElement("option");
    option.value = String(community.onboarding_client_id);
    option.textContent = `${community.community_name || "Unnamed Community"} (${String(
      community.current_stage || "contract_signed"
    )
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())})`;
    option.selected = Number(activeCommunityId) === Number(community.onboarding_client_id);
    switcher.appendChild(option);
  });

  switcher.disabled = communities.length <= 1 || state.switchingCommunity;
}

async function refreshCommunitySwitcher() {
  const communities = await listMyCommunities();
  state.communities = communities;
  renderCommunitySwitcher(communities, state.portalContext?.onboarding_client_id || null);
}

function extractSelectedPlatforms(payload) {
  const source = Array.isArray(payload?.platform_access) ? payload.platform_access : [];
  const selected = source.filter((item) => Boolean(item?.requested));
  const deduped = [];
  const seen = new Set();

  selected.forEach((platform) => {
    const label = platform.platform_label || platform.platform_code || "Platform";
    const code = platform.platform_code || slugify(label);
    const key = `${code}__${normalizeLabel(label)}`;
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push({
      platform_code: code,
      platform_label: label,
      guide_url: PLATFORM_GUIDES[label] || null,
    });
  });

  return deduped;
}

function getProgressSnapshot() {
  const checkboxes = Array.from(document.querySelectorAll(".platform-cb"));
  const total = checkboxes.length;
  const complete = checkboxes.filter((cb) => cb.checked).length;
  return {
    total,
    complete,
    isStepComplete: total > 0 && complete === total,
  };
}

function resolveAccessStage(progress) {
  const creativeIndex = STAGE_SEQUENCE.indexOf("creative_kickoff");
  const baseStage = STAGE_SEQUENCE.includes(state.baseDisplayStage)
    ? state.baseDisplayStage
    : "account_access";
  const baseIndex = STAGE_SEQUENCE.indexOf(baseStage);
  if (baseIndex > creativeIndex) return baseStage;
  return progress.isStepComplete ? "creative_kickoff" : "account_access";
}

function applyAccessStage(progress) {
  applyStage(resolveAccessStage(progress));
}

function navigateToStageSection(stageCode) {
  if (stageCode === "contract_signed" || stageCode === "intake_form") {
    window.location.href = "/p11-onboarding-dashboard.html";
    return;
  }

  if (stageCode === "account_access") {
    document.querySelector(".access-card")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
    return;
  }

  document.querySelector(".tracker-card")?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

function updateStageNavigationInteractivity(stageCode) {
  const currentIndex = Math.max(0, STAGE_SEQUENCE.indexOf(stageCode));
  const stages = Array.from(document.querySelectorAll(".tracker .stage"));
  stages.forEach((stageEl, index) => {
    stageEl.dataset.stageCode = STAGE_SEQUENCE[index] || "";
    stageEl.classList.toggle("is-clickable", index <= currentIndex);
  });
}

function initializeStageNavigation() {
  const stages = Array.from(document.querySelectorAll(".tracker .stage"));
  stages.forEach((stageEl, index) => {
    if (stageEl.dataset.bound === "true") return;
    stageEl.dataset.bound = "true";
    stageEl.dataset.stageCode = STAGE_SEQUENCE[index] || "";
    stageEl.addEventListener("click", () => {
      const targetStage = stageEl.dataset.stageCode;
      const currentIndex = Math.max(0, STAGE_SEQUENCE.indexOf(state.currentStageCode));
      const targetIndex = Math.max(0, STAGE_SEQUENCE.indexOf(targetStage));
      if (targetIndex > currentIndex) return;
      navigateToStageSection(targetStage);
    });
  });
}

function updateProgress() {
  const progress = getProgressSnapshot();
  const text = document.getElementById("progressText");
  const fill = document.getElementById("progressFill");

  if (text) {
    text.textContent = progress.total
      ? `Step 3 progress: ${progress.complete}/${progress.total} platforms marked complete`
      : "Step 3 progress: no platforms selected in intake";
  }
  if (fill) {
    const percent = progress.total ? Math.round((progress.complete / progress.total) * 100) : 0;
    fill.style.width = `${percent}%`;
  }
  return progress;
}

function setSaveStatus(message = "", tone = "") {
  const status = document.getElementById("saveStatus");
  if (!status) return;
  status.textContent = message;
  status.className = "save-status";
  if (tone) status.classList.add(tone);
}

function hasUnsavedPlatformChanges() {
  return Array.from(document.querySelectorAll(".platform-cb")).some((checkbox) => {
    const persisted = checkbox.dataset.persisted === "true";
    return persisted !== checkbox.checked;
  });
}

function refreshSaveButtonState() {
  const button = document.getElementById("saveProgressBtn");
  if (!button) return;
  const hasPlatforms = document.querySelectorAll(".platform-cb").length > 0;
  button.disabled = !hasPlatforms || !state.hasUnsavedChanges || state.savingProgress;
  button.textContent = state.savingProgress ? "Saving..." : "Save Progress";
}

function syncUnsavedState() {
  state.hasUnsavedChanges = hasUnsavedPlatformChanges();
  refreshSaveButtonState();
}

function renderPlatformRows(platforms) {
  const list = document.getElementById("platformList");
  if (!list) return;

  if (!platforms.length) {
    list.innerHTML = `
      <div class="empty-state">
        No platforms were selected in the intake form for this community.<br>
        Go back to Step 2 to edit platform scope.
      </div>
    `;
    updateProgress();
    state.hasUnsavedChanges = false;
    refreshSaveButtonState();
    setSaveStatus("No platform tasks to save yet.", "");
    return;
  }

  list.innerHTML = platforms
    .map((platform) => {
      const safeCode = escapeHtml(platform.platform_code);
      const safeLabel = escapeHtml(platform.platform_label);
      const taskKey = buildTaskKey(platform.platform_code, platform.platform_label);
      const safeTaskKey = escapeHtml(taskKey);
      const safeGuideUrl = sanitizeUrl(platform.guide_url);
      const guideCell = safeGuideUrl
        ? `<a class="guide-link" href="${escapeHtml(
            safeGuideUrl
          )}" target="_blank" rel="noopener noreferrer">Guide</a>`
        : `<span class="guide-link muted">No guide</span>`;
      return `
        <div class="platform-row">
          <div>
            <div class="platform-name">${safeLabel}</div>
            <div class="platform-meta">Platform Code: ${safeCode}</div>
          </div>
          <div class="platform-actions">
            ${guideCell}
            <label class="done-toggle">
              <input type="checkbox" class="platform-cb" data-task-key="${safeTaskKey}" data-platform-label="${safeLabel}" data-platform-code="${safeCode}">
              Access Granted
            </label>
          </div>
        </div>
      `;
    })
    .join("");
  updateProgress();
  setSaveStatus("", "");
}

async function hydrateTaskStates() {
  const [taskStates, platformRows] = await Promise.all([listTaskStates(), listMyPlatformAccess()]);
  const byKey = new Map(taskStates.map((row) => [row.task_key, row]));
  const platformByCode = new Map(
    platformRows.map((row) => [String(row.platform_code || "").toLowerCase(), row])
  );
  document.querySelectorAll(".platform-cb").forEach((checkbox) => {
    const key = checkbox.dataset.taskKey;
    const code = String(checkbox.dataset.platformCode || "").toLowerCase();
    const stateRow = byKey.get(key);
    const platformRow = platformByCode.get(code);
    const grantedFromPlatform = platformRow?.granted_status === "granted";
    checkbox.checked = grantedFromPlatform || Boolean(stateRow?.is_complete);
    checkbox.dataset.persisted = checkbox.checked ? "true" : "false";
  });
  const progress = updateProgress();
  applyAccessStage(progress);
  const completionState = Boolean(byKey.get(ACCESS_STEP_COMPLETION_TASK_KEY)?.is_complete);
  if (completionState !== progress.isStepComplete) {
    try {
      await persistStep3Completion(progress);
    } catch (error) {
      console.warn("Unable to sync Step 3 completion state:", error.message);
    }
  }
  state.hasUnsavedChanges = false;
  refreshSaveButtonState();
}

async function persistPlatformState(checkbox) {
  const taskKey = checkbox.dataset.taskKey;
  const platformCode = checkbox.dataset.platformCode;
  const taskText = `${checkbox.dataset.platformLabel || "Platform"} access granted`;
  await upsertMyPlatformAccess({
    platformCode,
    isAccessGranted: checkbox.checked,
  });
  await upsertTaskState({
    taskKey,
    isComplete: checkbox.checked,
    groupCode: "access_step",
    taskText,
  });
}

async function persistStep3Completion(progress) {
  await upsertTaskState({
    taskKey: ACCESS_STEP_COMPLETION_TASK_KEY,
    isComplete: progress.isStepComplete,
    groupCode: "access_step",
    taskText: "Step 3 account access complete",
  });
}

async function savePlatformProgress() {
  const checkboxes = Array.from(document.querySelectorAll(".platform-cb"));
  if (!checkboxes.length) return;

  state.savingProgress = true;
  refreshSaveButtonState();
  setSaveStatus("Saving progress...", "pending");

  try {
    for (const checkbox of checkboxes) {
      const persisted = checkbox.dataset.persisted === "true";
      if (persisted === checkbox.checked) continue;
      await persistPlatformState(checkbox);
      checkbox.dataset.persisted = checkbox.checked ? "true" : "false";
    }

    const progress = updateProgress();
    await persistStep3Completion(progress);
    applyAccessStage(progress);
    state.hasUnsavedChanges = false;
    setSaveStatus("Progress saved.", "success");
  } catch (error) {
    setSaveStatus(`Unable to save progress: ${error.message}`, "error");
  } finally {
    state.savingProgress = false;
    refreshSaveButtonState();
  }
}

function bindPlatformHandlers() {
  document.querySelectorAll(".platform-cb").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const progress = updateProgress();
      applyAccessStage(progress);
      syncUnsavedState();
      setSaveStatus(state.hasUnsavedChanges ? "You have unsaved changes." : "", state.hasUnsavedChanges ? "pending" : "");
    });
  });
}

async function hydrateAccessStep() {
  if (!state.portalContext?.onboarding_client_id) return;

  const payload = await getLatestSubmissionPayload(state.portalContext.onboarding_client_id);
  const selectedPlatforms = extractSelectedPlatforms(payload);
  state.currentPlatforms = selectedPlatforms;
  state.baseDisplayStage = deriveDisplayStage(
    state.portalContext.current_stage,
    state.portalContext,
    payload
  );
  renderPlatformRows(selectedPlatforms);
  await hydrateTaskStates();
  bindPlatformHandlers();
}

async function switchActiveCommunity(onboardingClientId) {
  if (!onboardingClientId || state.switchingCommunity) return;
  if (Number(onboardingClientId) === Number(state.portalContext?.onboarding_client_id)) return;

  state.switchingCommunity = true;
  try {
    await setMyActiveCommunity(Number(onboardingClientId));
    const context = await getMyPortalContext();
    if (!context) throw new Error("Unable to load selected community.");
    state.portalContext = context;
    applyContextHeader();
    await refreshCommunitySwitcher();
    await hydrateAccessStep();
  } finally {
    state.switchingCommunity = false;
  }
}

function bindHandlers() {
  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    try {
      await signOutUser();
      window.location.href = "/client-home.html";
    } catch (error) {
      setSaveStatus(error.message, "error");
    }
  });

  document.getElementById("communitySwitcher")?.addEventListener("change", async (event) => {
    const nextId = Number(event.target.value);
    if (!nextId) return;
    try {
      await switchActiveCommunity(nextId);
    } catch (error) {
      setSaveStatus(`Unable to switch community: ${error.message}`, "error");
    }
  });

  document.getElementById("saveProgressBtn")?.addEventListener("click", async () => {
    await savePlatformProgress();
  });
}

async function hydrateAuthenticated() {
  const internalContext = await getInternalPortalContext().catch(() => null);
  const context = await getMyPortalContext();
  if (!context) {
    window.location.href = internalContext ? "/internal.html" : "/client-home.html";
    return;
  }
  state.portalContext = context;
  applyContextHeader();
  await refreshCommunitySwitcher();
  await hydrateAccessStep();
}

async function initialize() {
  initializeStageNavigation();
  bindHandlers();
  const session = await getCurrentSession();
  state.session = session;
  if (!session) {
    window.location.href = "/client-home.html";
    return;
  }

  await hydrateAuthenticated();

  onAuthStateChange(async (_event, nextSession) => {
    state.session = nextSession;
    if (!nextSession) {
      window.location.href = "/client-home.html";
      return;
    }
    await hydrateAuthenticated();
  });
}

document.addEventListener("DOMContentLoaded", initialize);
