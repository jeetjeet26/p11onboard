import {
  completePortalSignup,
  getCurrentSession,
  getLatestSubmissionPayload,
  getMyPortalContext,
  getOnboardingSnapshot,
  listMyCommunities,
  listTaskStates,
  onAuthStateChange,
  searchCompanies,
  setMyActiveCommunity,
  signInUser,
  signOutUser,
  signUpUser,
  submitIntake,
  upsertTaskState,
} from "./api.js";

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
  contract_signed: {
    title: "Step 1 of 7 — Contract Signed",
    text: "Welcome to P11creative onboarding. We are ready for your intake details so we can begin campaign setup.",
  },
  intake_form: {
    title: "Step 2 of 7 — Complete Your Intake Questionnaire",
    text: "Fill out all sections below so we can start building your campaigns. After submission, you will move to the dedicated Account Access step.",
  },
  account_access: {
    title: "Step 3 of 7 — Grant Admin Access to Your Platforms",
    text: "Questionnaire received. Continue to the dedicated Account Access page to complete platform invites.",
  },
  creative_kickoff: {
    title: "Step 4 of 7 — Creative Kickoff",
    text: "Our team is preparing campaign direction and assets based on your submitted intake.",
  },
  campaign_build: {
    title: "Step 5 of 7 — Campaign Build",
    text: "Campaigns are being built and configured for launch readiness.",
  },
  prelaunch_review: {
    title: "Step 6 of 7 — Pre-Launch Review",
    text: "Final checks and approvals are in progress before go-live.",
  },
  go_live: {
    title: "Step 7 of 7 — GO LIVE",
    text: "Campaigns are live. Your team and P11creative can now monitor performance and iterate.",
  },
};

const SERVICE_ID_TO_CODE = {
  ps: "paid_search",
  social: "paid_social",
  seo: "seo",
  display: "display",
  email: "email_marketing",
  ctv: "ctv",
  ils: "ils_management",
  reporting: "reporting_analytics",
};

const SERVICE_CODE_TO_ID = Object.fromEntries(
  Object.entries(SERVICE_ID_TO_CODE).map(([serviceId, serviceCode]) => [
    serviceCode,
    serviceId,
  ])
);

const PLATFORM_LABEL_TO_CODE = {
  "Google Ads Manager": "google_ads",
  "Google Analytics 4 (GA4)": "ga4",
  "Google Tag Manager (GTM)": "gtm",
  "Google Search Console": "google_search_console",
  "Google Business Profile": "google_business_profile",
  "Meta Business Suite / Pages": "meta_business_suite",
  "Meta Ads Manager": "meta_ads",
  "Website CMS (login credentials)": "website_cms",
  "CRM Platform": "crm",
  "ILS Platform (Zillow / CoStar)": "ils",
};

const PENDING_SIGNUP_KEY = "p11_pending_signup";

const state = {
  session: null,
  portalContext: null,
  latestSubmissionPayload: null,
  currentStageCode: "intake_form",
  communities: [],
  selectedCompanies: {
    signup: null,
    complete: null,
  },
  switchingCommunity: false,
  searchTimers: {},
};

function normalizeLabel(value) {
  return value.replace(/\*/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseFullName(fullName) {
  const trimmed = (fullName || "").trim();
  if (!trimmed) return { first_name: null, last_name: null };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { first_name: parts[0], last_name: null };
  return {
    first_name: parts[0],
    last_name: parts.slice(1).join(" "),
  };
}

function getInputValue(fieldGroup) {
  const input = fieldGroup.querySelector("input, select, textarea");
  if (!input) return null;
  if (input.type === "checkbox") return input.checked;
  return input.value?.trim() || null;
}

function toFormFieldKey(labelText) {
  return normalizeLabel(labelText).replace(/[^\w\s]/g, "").replace(/\s+/g, "_");
}

function findFieldGroupByLabel(labelText, scope = document) {
  const target = normalizeLabel(labelText);
  const labels = scope.querySelectorAll(".fg .fl");
  for (const label of labels) {
    if (normalizeLabel(label.textContent) !== target) continue;
    return label.closest(".fg");
  }
  return null;
}

function normalizeDateInputValue(value) {
  if (!value) return "";
  const text = String(value).trim();
  const yyyyMmDd = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (yyyyMmDd) return yyyyMmDd[1];
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toISOString().slice(0, 10);
}

function setInputElementValue(input, value) {
  if (!input || value === null || value === undefined) return false;

  if (input.type === "checkbox") {
    input.checked = Boolean(value);
    return true;
  }

  if (input.tagName === "SELECT") {
    const normalized = String(value).trim();
    const options = Array.from(input.options || []);
    const exactValue = options.find((option) => option.value === normalized);
    const exactLabel = options.find(
      (option) => option.textContent.trim().toLowerCase() === normalized.toLowerCase()
    );
    const match = exactValue || exactLabel;

    if (match) {
      input.value = match.value;
    } else {
      input.value = normalized;
    }
    return true;
  }

  if (input.type === "date") {
    input.value = normalizeDateInputValue(value);
    return true;
  }

  input.value = String(value);
  return true;
}

function setFieldValueByLabel(labelText, value, scope = document) {
  const fieldGroup = findFieldGroupByLabel(labelText, scope);
  if (!fieldGroup) return false;
  const input = fieldGroup.querySelector("input, select, textarea");
  if (!input) return false;

  const didSet = setInputElementValue(input, value);
  if (!didSet) return false;

  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function getFieldValueByLabel(labelText, scope = document) {
  const fieldGroup = findFieldGroupByLabel(labelText, scope);
  if (!fieldGroup) return null;
  return getInputValue(fieldGroup);
}

function collectAllLabeledFields() {
  const all = {};
  document.querySelectorAll(".fg").forEach((fieldGroup) => {
    const label = fieldGroup.querySelector(".fl");
    if (!label) return;
    const key = normalizeLabel(label.textContent)
      .replace(/[^\w\s]/g, "")
      .replace(/\s+/g, "_");
    all[key] = getInputValue(fieldGroup);
  });
  return all;
}

function deriveServiceId(chip) {
  if (chip.dataset.serviceId) return chip.dataset.serviceId;
  const inline = chip.getAttribute("onclick") || "";
  const match = inline.match(/toggleSvc\(this,\s*'([^']+)'\)/);
  return match ? match[1] : null;
}

function collectSelectedServices() {
  const selected = [];
  document.querySelectorAll(".svc-chip.on").forEach((chip) => {
    const serviceId = deriveServiceId(chip);
    if (!serviceId) return;
    const serviceCode = SERVICE_ID_TO_CODE[serviceId];
    if (!serviceCode) return;
    selected.push({
      service_id: serviceId,
      service_code: serviceCode,
      label: chip.textContent.trim(),
    });
  });
  return selected;
}

function getSectionValue(container, labelText) {
  return getFieldValueByLabel(labelText, container);
}

function collectServiceConfigs(selectedServices) {
  const configs = {};
  selectedServices.forEach((service) => {
    const section = document.getElementById(`svc-${service.service_id}`);
    if (!section) return;

    if (service.service_id === "ps") {
      configs[service.service_code] = {
        monthly_budget: getSectionValue(section, "Monthly SEM Budget"),
        account_exists: getSectionValue(section, "Existing Google Ads Account?"),
        keyword_themes: getSectionValue(
          section,
          "Primary keyword themes / search intent"
        ),
      };
      return;
    }

    if (service.service_id === "social") {
      configs[service.service_code] = {
        monthly_budget: getSectionValue(section, "Monthly Social Ad Budget"),
        account_exists: getSectionValue(section, "Active Meta Business Page?"),
        target_audience: getSectionValue(section, "Target audience description"),
      };
      return;
    }

    if (service.service_id === "seo") {
      configs[service.service_code] = {
        primary_goals: getSectionValue(section, "Primary SEO goals"),
      };
      return;
    }

    if (service.service_id === "display") {
      configs[service.service_code] = {
        monthly_budget: getSectionValue(section, "Monthly Display Budget"),
        remarketing_focus: getSectionValue(section, "Primary remarketing focus"),
      };
      return;
    }

    if (service.service_id === "email") {
      configs[service.service_code] = {
        email_platform: getSectionValue(section, "Email platform (if existing)"),
        list_size: getSectionValue(section, "Approximate existing list size"),
        email_goals: getSectionValue(section, "Email frequency & goals"),
      };
      return;
    }

    if (service.service_id === "ctv") {
      configs[service.service_code] = {
        monthly_budget: getSectionValue(section, "Monthly CTV Budget"),
        video_assets_status: getSectionValue(section, "Video assets available?"),
      };
      return;
    }

    if (service.service_id === "ils") {
      const ilsSelections = Array.from(section.querySelectorAll("input[type='checkbox']:checked"))
        .map((cb) => cb.closest("label")?.textContent?.trim())
        .filter(Boolean);
      configs[service.service_code] = {
        ils_platforms: ilsSelections,
      };
      return;
    }

    if (service.service_id === "reporting") {
      configs[service.service_code] = {
        report_frequency: getSectionValue(section, "Report frequency"),
        report_delivery_preference: getSectionValue(
          section,
          "Report delivery preference"
        ),
        key_metrics: getSectionValue(section, "Key metrics you care most about"),
      };
    }
  });
  return configs;
}

function collectPlatformAccess() {
  return Array.from(document.querySelectorAll(".acc-item")).map((item) => {
    const label = item.querySelector(".acc-name")?.textContent?.trim() || "Unknown";
    const checkbox = item.querySelector("input[type='checkbox']");
    return {
      platform_label: label,
      platform_code: PLATFORM_LABEL_TO_CODE[label] || slugify(label),
      requested: Boolean(checkbox?.checked),
    };
  });
}

function applyTaskRowState(taskRow, isComplete) {
  const checkbox = taskRow.querySelector(".task-cb");
  const text = taskRow.querySelector(".task-text");
  if (checkbox) checkbox.checked = Boolean(isComplete);
  if (text) text.classList.toggle("done", Boolean(isComplete));
}

function deriveTaskRowKey(taskRow, index) {
  const groupCode = taskRow.closest(".task-group")?.dataset?.grp || "all";
  const taskText = taskRow.querySelector(".task-text")?.textContent?.trim() || `task_${index}`;
  const stableText = slugify(taskText).slice(0, 80);
  return `${groupCode}__${stableText}__${index}`;
}

function initializeTaskRows() {
  document.querySelectorAll(".task-row").forEach((taskRow, index) => {
    const taskKey = deriveTaskRowKey(taskRow, index);
    const groupCode = taskRow.closest(".task-group")?.dataset?.grp || "all";
    const checkbox = taskRow.querySelector(".task-cb");
    if (checkbox && !("defaultChecked" in taskRow.dataset)) {
      taskRow.dataset.defaultChecked = checkbox.checked ? "true" : "false";
    }
    taskRow.dataset.taskKey = taskKey;
    taskRow.dataset.groupCode = groupCode;
    applyTaskRowState(taskRow, taskRow.dataset.defaultChecked === "true");
  });
}

function resetTaskRowsToBase() {
  document.querySelectorAll(".task-row").forEach((taskRow) => {
    applyTaskRowState(taskRow, taskRow.dataset.defaultChecked === "true");
  });
}

async function persistTaskCheckbox(taskRow, checked) {
  if (!state.session || !state.portalContext?.onboarding_client_id) {
    return;
  }

  const taskKey = taskRow.dataset.taskKey;
  const groupCode = taskRow.dataset.groupCode || null;
  const taskText = taskRow.querySelector(".task-text")?.textContent?.trim() || null;

  try {
    await upsertTaskState({
      taskKey,
      isComplete: Boolean(checked),
      groupCode,
      taskText,
    });
  } catch (error) {
    console.error(error);
    alert(`Unable to persist task update: ${error.message}`);
  }
}

function initializeTaskSyncHandlers() {
  document.querySelectorAll(".task-row .task-cb").forEach((checkbox) => {
    checkbox.addEventListener("change", async () => {
      const taskRow = checkbox.closest(".task-row");
      if (!taskRow) return;
      applyTaskRowState(taskRow, checkbox.checked);
      await persistTaskCheckbox(taskRow, checkbox.checked);
    });
  });
}

async function loadPersistedTaskStates() {
  resetTaskRowsToBase();
  const states = await listTaskStates();
  if (!states.length) return;

  const stateByKey = new Map(states.map((state) => [state.task_key, state]));
  document.querySelectorAll(".task-row").forEach((taskRow) => {
    const taskKey = taskRow.dataset.taskKey;
    if (!taskKey || !stateByKey.has(taskKey)) return;
    const state = stateByKey.get(taskKey);
    applyTaskRowState(taskRow, Boolean(state.is_complete));
  });
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

function setActionItemRowState(row, stateLabel) {
  if (!row) return;
  const dot = row.querySelector(".cl-dot");
  const text = row.querySelector(".cl-text");
  const meta = row.querySelector(".cl-meta");
  if (!dot || !text || !meta) return;

  dot.className = "cl-dot";
  text.classList.remove("done");
  meta.className = "cl-meta";

  if (stateLabel === "done") {
    dot.classList.add("cl-done");
    dot.textContent = "✓";
    text.classList.add("done");
    meta.textContent = "Complete";
    return;
  }

  if (stateLabel === "now") {
    dot.classList.add("cl-now");
    dot.textContent = "!";
    meta.classList.add("now");
    meta.textContent = "Your turn";
    return;
  }

  dot.classList.add("cl-pend");
  dot.textContent = "·";
  meta.textContent = "Coming soon";
}

function updateActionItems(stageCode) {
  const cards = Array.from(document.querySelectorAll(".card"));
  const actionCard = cards.find((card) =>
    card.querySelector(".card-title")?.textContent?.includes("Your Action Items")
  );
  if (!actionCard) return;

  const rows = actionCard.querySelectorAll(".cl-row");
  if (rows.length < 3) return;

  const currentIndex = Math.max(0, STAGE_SEQUENCE.indexOf(stageCode));
  const intakeIndex = STAGE_SEQUENCE.indexOf("intake_form");
  const accessIndex = STAGE_SEQUENCE.indexOf("account_access");

  setActionItemRowState(rows[0], "done");
  setActionItemRowState(rows[1], currentIndex > intakeIndex ? "done" : "now");
  setActionItemRowState(
    rows[2],
    currentIndex > accessIndex ? "done" : currentIndex === accessIndex ? "now" : "pending"
  );
}

function navigateToStageSection(stageCode) {
  if (stageCode === "intake_form") {
    document.querySelector(".q-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  if (stageCode === "account_access") {
    window.location.href = "/p11-onboarding-account-access.html";
    return;
  }

  document.querySelector(".tracker-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function updateStageNavigationInteractivity(stageCode) {
  const currentIndex = Math.max(0, STAGE_SEQUENCE.indexOf(stageCode));
  const stages = Array.from(document.querySelectorAll(".tracker .stage"));
  stages.forEach((stageEl, index) => {
    stageEl.dataset.stageCode = STAGE_SEQUENCE[index] || "";
    stageEl.style.cursor = index <= currentIndex ? "pointer" : "default";
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

function applyStage(stageCode) {
  const normalizedStage = STAGE_SEQUENCE.includes(stageCode) ? stageCode : "intake_form";
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

  const copy = STAGE_COPY[normalizedStage] || STAGE_COPY.intake_form;
  const stepTitle = document.getElementById("stepTitle");
  const stepText = document.getElementById("stepText");
  if (stepTitle) stepTitle.textContent = copy.title;
  if (stepText) stepText.textContent = copy.text;

  document.querySelectorAll(".step-pill").forEach((pill) => {
    pill.textContent = `Step ${idx + 1} of ${STAGE_SEQUENCE.length}`;
  });
  updateActionItems(normalizedStage);
  updateStageNavigationInteractivity(normalizedStage);
}

function applySnapshot(snapshot) {
  if (!snapshot) return;
  state.portalContext = snapshot;
  const nameEl = document.getElementById("displayName");
  const companyEl = document.getElementById("displayCompany");
  const liveEl = document.getElementById("displayGoLive");
  const sessionInfo = document.getElementById("sessionInfo");
  const isNascentContext =
    (snapshot.community_name || snapshot.display_name) === "New Community" &&
    snapshot.current_stage === "contract_signed" &&
    snapshot.status === "draft";
  const communityName = isNascentContext
    ? "Nascent Onboarding"
    : snapshot.community_name || snapshot.display_name || "New Community";
  if (nameEl) nameEl.textContent = communityName;
  if (companyEl) companyEl.textContent = snapshot.company_name || "Not selected";
  const communitySwitcher = document.getElementById("communitySwitcher");
  if (communitySwitcher && snapshot.onboarding_client_id) {
    communitySwitcher.value = String(snapshot.onboarding_client_id);
  }
  if (liveEl) liveEl.textContent = formatDate(snapshot.target_go_live_at);
  if (sessionInfo && state.session?.user) {
    const fullName =
      state.session.user.user_metadata?.full_name ||
      snapshot.full_name ||
      state.session.user.email;
    sessionInfo.textContent = `${fullName} · ${snapshot.company_name || "Company not set"}`;
  }
  const displayStage = deriveDisplayStage(
    snapshot.current_stage,
    snapshot,
    state.latestSubmissionPayload
  );
  applyStage(displayStage);
}

function getPayloadValue(payload, keys = [], labelText = "") {
  if (!payload || typeof payload !== "object") return null;

  for (const key of keys) {
    if (!(key in payload)) continue;
    const value = payload[key];
    if (value !== null && value !== undefined && value !== "") return value;
  }

  if (payload.all_fields && typeof payload.all_fields === "object" && labelText) {
    const value = payload.all_fields[toFormFieldKey(labelText)];
    if (value !== null && value !== undefined && value !== "") return value;
  }

  return null;
}

function setServiceSelectionByCodes(selectedServiceCodes = []) {
  const selectedIds = new Set(
    selectedServiceCodes
      .map((serviceCode) => SERVICE_CODE_TO_ID[serviceCode])
      .filter(Boolean)
  );

  document.querySelectorAll(".svc-chip").forEach((chip) => {
    const serviceId = deriveServiceId(chip);
    if (!serviceId) return;
    const isSelected = selectedIds.has(serviceId);
    chip.classList.toggle("on", isSelected);
    const detail = document.getElementById(`svc-${serviceId}`);
    if (detail) {
      detail.style.display = isSelected ? "block" : "none";
    }
  });
}

function setIlsSelections(values = []) {
  const normalized = new Set(values.map((value) => normalizeLabel(String(value))));
  const section = document.getElementById("svc-ils");
  if (!section) return;

  section.querySelectorAll("label").forEach((label) => {
    const checkbox = label.querySelector("input[type='checkbox']");
    if (!checkbox) return;
    checkbox.checked = normalized.has(normalizeLabel(label.textContent || ""));
  });
}

function applyServiceConfigValues(serviceConfigs = {}) {
  const setIfPresent = (serviceCode, labelText, key) => {
    const section = document.getElementById(`svc-${SERVICE_CODE_TO_ID[serviceCode] || ""}`);
    const value = serviceConfigs?.[serviceCode]?.[key];
    if (!section || value === null || value === undefined || value === "") return;
    setFieldValueByLabel(labelText, value, section);
  };

  setIfPresent("paid_search", "Monthly SEM Budget", "monthly_budget");
  setIfPresent("paid_search", "Existing Google Ads Account?", "account_exists");
  setIfPresent(
    "paid_search",
    "Primary keyword themes / search intent",
    "keyword_themes"
  );

  setIfPresent("paid_social", "Monthly Social Ad Budget", "monthly_budget");
  setIfPresent("paid_social", "Active Meta Business Page?", "account_exists");
  setIfPresent("paid_social", "Target audience description", "target_audience");

  setIfPresent("seo", "Primary SEO goals", "primary_goals");
  setIfPresent("display", "Monthly Display Budget", "monthly_budget");
  setIfPresent("display", "Primary remarketing focus", "remarketing_focus");
  setIfPresent("email_marketing", "Email platform (if existing)", "email_platform");
  setIfPresent("email_marketing", "Approximate existing list size", "list_size");
  setIfPresent("email_marketing", "Email frequency & goals", "email_goals");
  setIfPresent("ctv", "Monthly CTV Budget", "monthly_budget");
  setIfPresent("ctv", "Video assets available?", "video_assets_status");
  setIfPresent("reporting_analytics", "Report frequency", "report_frequency");
  setIfPresent(
    "reporting_analytics",
    "Report delivery preference",
    "report_delivery_preference"
  );
  setIfPresent(
    "reporting_analytics",
    "Key metrics you care most about",
    "key_metrics"
  );

  const ilsPlatforms = serviceConfigs?.ils_management?.ils_platforms;
  if (Array.isArray(ilsPlatforms)) {
    setIlsSelections(ilsPlatforms);
  }
}

function applyPlatformAccessSelections(platformAccess = []) {
  const rows = Array.isArray(platformAccess) ? platformAccess : [];
  const byCode = new Map();
  const byLabel = new Map();

  rows.forEach((row) => {
    const code = String(row.platform_code || "").trim().toLowerCase();
    const label = normalizeLabel(row.platform_label || "");
    if (code) byCode.set(code, row);
    if (label) byLabel.set(label, row);
  });

  document.querySelectorAll(".acc-item").forEach((item) => {
    const label = item.querySelector(".acc-name")?.textContent?.trim() || "";
    const checkbox = item.querySelector("input[type='checkbox']");
    if (!checkbox) return;

    const code = PLATFORM_LABEL_TO_CODE[label] || slugify(label);
    const row = byCode.get(code) || byLabel.get(normalizeLabel(label));
    const requested = Boolean(row?.requested);
    checkbox.checked = requested;
    item.classList.toggle("granted", requested);
  });
}

function hydrateFormFromPayload(payload) {
  if (!payload || typeof payload !== "object") return;

  setFieldValueByLabel(
    "Community Name",
    getPayloadValue(payload, ["community_name"], "Community Name")
  );
  setFieldValueByLabel(
    "Community Type",
    getPayloadValue(payload, ["community_type"], "Community Type")
  );
  setFieldValueByLabel(
    "Community Address",
    getPayloadValue(payload, ["community_address"], "Community Address")
  );
  setFieldValueByLabel(
    "Community Phone",
    getPayloadValue(payload, ["community_phone"], "Community Phone")
  );
  setFieldValueByLabel(
    "Community Email",
    getPayloadValue(payload, ["community_email"], "Community Email")
  );
  setFieldValueByLabel(
    "Hours of Operation",
    getPayloadValue(payload, ["hours_of_operation"], "Hours of Operation")
  );
  setFieldValueByLabel(
    "Parent Company / Developer",
    getPayloadValue(payload, ["parent_company"], "Parent Company / Developer")
  );
  setFieldValueByLabel(
    "Primary Reporting Contact Name",
    getPayloadValue(payload, ["reporting_contact_name"], "Primary Reporting Contact Name")
  );
  setFieldValueByLabel(
    "Reporting Contact Email",
    getPayloadValue(payload, ["reporting_contact_email"], "Reporting Contact Email")
  );
  setFieldValueByLabel(
    "Additional Report Recipients",
    getPayloadValue(payload, ["additional_report_recipients"], "Additional Report Recipients")
  );
  setFieldValueByLabel(
    "Property Website URL",
    getPayloadValue(payload, ["property_website_url"], "Property Website URL")
  );
  setFieldValueByLabel(
    "Preferred communication method",
    getPayloadValue(
      payload,
      ["preferred_communication_method"],
      "Preferred communication method"
    )
  );
  setFieldValueByLabel(
    "Target campaign go-live date",
    getPayloadValue(
      payload,
      ["target_campaign_go_live_date", "target_go_live_at"],
      "Target campaign go-live date"
    )
  );
  setFieldValueByLabel(
    "Anything else we should know before building your campaigns?",
    getPayloadValue(
      payload,
      ["final_notes"],
      "Anything else we should know before building your campaigns?"
    )
  );

  const allFields = payload.all_fields;
  if (allFields && typeof allFields === "object") {
    document.querySelectorAll(".fg").forEach((fieldGroup) => {
      const label = fieldGroup.querySelector(".fl");
      if (!label) return;
      const key = toFormFieldKey(label.textContent || "");
      const value = allFields[key];
      if (value === null || value === undefined || value === "") return;
      const input = fieldGroup.querySelector("input, select, textarea");
      if (!input) return;
      setInputElementValue(input, value);
    });
  }

  const selectedServices = Array.isArray(payload.selected_services)
    ? payload.selected_services
    : [];
  setServiceSelectionByCodes(selectedServices);
  applyServiceConfigValues(payload.service_configs || {});
  applyPlatformAccessSelections(payload.platform_access || []);

  calcProg();
  const targetDate =
    getPayloadValue(
      payload,
      ["target_campaign_go_live_date", "target_go_live_at"],
      "Target campaign go-live date"
    ) || "";
  setGoLive(normalizeDateInputValue(targetDate));
}

async function hydrateLatestSubmissionForActiveCommunity() {
  const onboardingClientId = state.portalContext?.onboarding_client_id;
  state.latestSubmissionPayload = null;
  if (!onboardingClientId) return;

  const payload = await getLatestSubmissionPayload(onboardingClientId);
  if (!payload) return;

  state.latestSubmissionPayload = payload;
  hydrateFormFromPayload(payload);
  const stage = deriveDisplayStage(
    state.portalContext?.current_stage,
    state.portalContext,
    payload
  );
  applyStage(stage);
}

function updateTeamToggleAccess(context) {
  const isInternalRole = ["internal", "admin"].includes(context?.portal_role || "");
  document.body.classList.toggle("internal-user", isInternalRole);

  const teamToggleBtn = document.getElementById("teamToggleBtn");
  if (teamToggleBtn) {
    teamToggleBtn.style.display = isInternalRole ? "inline-flex" : "none";
  }

  if (!isInternalRole) {
    setView("client");
  }
}

function buildCommunityOptionLabel(community) {
  const isNascent =
    community.community_name === "New Community" &&
    community.current_stage === "contract_signed" &&
    community.status === "draft" &&
    !community.last_submitted_at;
  const displayStage = deriveDisplayStage(
    community.current_stage || "contract_signed",
    community,
    community.last_submitted_at ? { has_submission: true } : null
  );
  const stage = String(displayStage)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  const baseName = isNascent
    ? "Nascent Onboarding"
    : community.community_name || "Unnamed Community";
  return `${baseName} (${stage})`;
}

function renderCommunitySwitcher(communities, activeCommunityId) {
  const switcher = document.getElementById("communitySwitcher");
  if (!switcher) return;

  switcher.innerHTML = "";
  if (!communities.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No communities yet";
    switcher.appendChild(option);
  } else {
    communities.forEach((community) => {
      const id = Number(community.onboarding_client_id);
      const option = document.createElement("option");
      option.value = String(id);
      option.textContent = buildCommunityOptionLabel(community);
      option.selected = Number(activeCommunityId) === id;
      switcher.appendChild(option);
    });
  }

  switcher.disabled = communities.length <= 1 || state.switchingCommunity;
  if (activeCommunityId && communities.length) {
    switcher.value = String(activeCommunityId);
  }
}

async function refreshCommunitySwitcher(activeCommunityId = null) {
  if (!state.session) return;
  const communities = await listMyCommunities();
  state.communities = communities;

  const selectedId =
    activeCommunityId ||
    state.portalContext?.onboarding_client_id ||
    communities[0]?.onboarding_client_id ||
    null;
  renderCommunitySwitcher(communities, selectedId);
}

async function switchActiveCommunity(onboardingClientId) {
  if (!onboardingClientId || !state.session) return;
  if (Number(onboardingClientId) === Number(state.portalContext?.onboarding_client_id)) {
    return;
  }

  state.switchingCommunity = true;
  try {
    await setMyActiveCommunity(Number(onboardingClientId));
    const context = await getMyPortalContext();
    if (!context) {
      throw new Error("Unable to load selected community context.");
    }
    state.portalContext = context;
    state.latestSubmissionPayload = null;
    applySnapshot(context);
    updateSessionUi(state.session, context);
    updateTeamToggleAccess(context);
    await refreshCommunitySwitcher(context.onboarding_client_id);
    await loadPersistedTaskStates();
    await hydrateLatestSubmissionForActiveCommunity();
  } finally {
    state.switchingCommunity = false;
  }
}

function initializeCommunitySwitcher() {
  const switcher = document.getElementById("communitySwitcher");
  if (!switcher || switcher.dataset.bound === "true") return;

  switcher.dataset.bound = "true";
  switcher.addEventListener("change", async () => {
    const onboardingClientId = Number(switcher.value);
    if (!onboardingClientId) return;

    try {
      await switchActiveCommunity(onboardingClientId);
    } catch (error) {
      console.error(error);
      alert(`Unable to switch communities: ${error.message}`);
      renderCommunitySwitcher(
        state.communities,
        state.portalContext?.onboarding_client_id || null
      );
    }
  });
}

function buildPayload() {
  const communityName = getFieldValueByLabel("Community Name");
  const communityType = getFieldValueByLabel("Community Type");
  const communityAddress = getFieldValueByLabel("Community Address");
  const communityPhone = getFieldValueByLabel("Community Phone");
  const communityEmail = getFieldValueByLabel("Community Email");
  const hoursOfOperation = getFieldValueByLabel("Hours of Operation");
  const parentCompanyInput = getFieldValueByLabel("Parent Company / Developer");
  const reportingContactName = getFieldValueByLabel(
    "Primary Reporting Contact Name"
  );
  const reportingContactEmail = getFieldValueByLabel("Reporting Contact Email");
  const additionalReportRecipients = getFieldValueByLabel(
    "Additional Report Recipients"
  );
  const websiteUrl = getFieldValueByLabel("Property Website URL");
  const preferredCommunicationMethod = getFieldValueByLabel(
    "Preferred communication method"
  );
  const targetGoLiveDate = getFieldValueByLabel("Target campaign go-live date");
  const finalNotes = getFieldValueByLabel(
    "Anything else we should know before building your campaigns?"
  );

  const selectedServices = collectSelectedServices();
  const serviceConfigs = collectServiceConfigs(selectedServices);
  const platformAccess = collectPlatformAccess();
  const { first_name, last_name } = parseFullName(reportingContactName);

  const selectedCompanyName = state.portalContext?.company_name || null;
  const selectedCompanyDirectoryId = state.portalContext?.company_directory_id || null;

  const payload = {
    community_name: communityName,
    community_type: communityType,
    community_address: communityAddress,
    community_phone: communityPhone,
    community_email: communityEmail,
    hours_of_operation: hoursOfOperation,
    parent_company: parentCompanyInput || selectedCompanyName,
    reporting_contact_name: reportingContactName,
    reporting_contact_first_name: first_name,
    reporting_contact_last_name: last_name,
    reporting_contact_email: reportingContactEmail,
    additional_report_recipients: additionalReportRecipients,
    property_website_url: websiteUrl,
    preferred_communication_method: preferredCommunicationMethod,
    target_campaign_go_live_date: targetGoLiveDate,
    final_notes: finalNotes,
    selected_services: selectedServices.map((s) => s.service_code),
    service_configs: serviceConfigs,
    platform_access: platformAccess,
    company_directory_id: selectedCompanyDirectoryId,
    company_name: selectedCompanyName,
    all_fields: collectAllLabeledFields(),
    submitted_at_client: new Date().toISOString(),
  };

  return payload;
}

function setAuthMessage(targetId, message, kind = "") {
  const target = document.getElementById(targetId);
  if (!target) return;
  target.className = `auth-message${kind ? ` ${kind}` : ""}`;
  target.textContent = message || "";
}

function savePendingSignup(data) {
  localStorage.setItem(PENDING_SIGNUP_KEY, JSON.stringify(data));
}

function loadPendingSignup() {
  try {
    return JSON.parse(localStorage.getItem(PENDING_SIGNUP_KEY) || "null");
  } catch {
    return null;
  }
}

function clearPendingSignup() {
  localStorage.removeItem(PENDING_SIGNUP_KEY);
}

function getAuthRoot() {
  return document.getElementById("authRoot");
}

function showAuthRoot() {
  document.body.classList.add("auth-pending");
}

function hideAuthRoot() {
  document.body.classList.remove("auth-pending");
}

function switchAuthForm(formName) {
  document.querySelectorAll(".auth-form").forEach((form) => {
    form.classList.toggle("active", form.dataset.form === formName);
  });
  document.querySelectorAll(".auth-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.form === formName);
  });
}

function resetCompanySelection(prefix) {
  state.selectedCompanies[prefix] = null;
  const selected = document.getElementById(`${prefix}CompanySelected`);
  if (selected) {
    selected.classList.remove("show");
    selected.textContent = "";
  }
}

function renderCompanyResults(prefix, companies, query) {
  const results = document.getElementById(`${prefix}CompanyResults`);
  if (!results) return;

  if (!query || !companies.length) {
    results.classList.remove("show");
    results.innerHTML = "";
    return;
  }

  results.innerHTML = companies
    .map(
      (company) => `
        <div class="company-result" data-prefix="${prefix}" data-company-id="${company.company_directory_id}" data-company-name="${company.company_name}">
          <div class="company-name">${company.company_name}</div>
          <div class="company-meta">Score: ${(company.score || 0).toFixed(2)}${company.public_company_id ? " · Existing data lake company" : ""}</div>
        </div>
      `
    )
    .join("");

  if (query.trim()) {
    results.innerHTML += `
      <div class="company-result" data-prefix="${prefix}" data-company-id="" data-company-name="${query.trim()}">
        <div class="company-name">Use "${query.trim()}" as a new company</div>
        <div class="company-meta">No exact match selected. This will create a new company directory record if a close fuzzy match is not found.</div>
      </div>
    `;
  }

  results.classList.add("show");

  results.querySelectorAll(".company-result").forEach((item) => {
    item.addEventListener("click", () => {
      state.selectedCompanies[prefix] = {
        companyDirectoryId: item.dataset.companyId
          ? Number(item.dataset.companyId)
          : null,
        companyName: item.dataset.companyName,
      };

      const selected = document.getElementById(`${prefix}CompanySelected`);
      if (selected) {
        selected.classList.add("show");
        selected.textContent = item.dataset.companyId
          ? `Selected existing company: ${item.dataset.companyName}`
          : `Will create or fuzzy-match company: ${item.dataset.companyName}`;
      }
      results.classList.remove("show");
    });
  });
}

function setupCompanySearch(prefix) {
  const input = document.getElementById(`${prefix}CompanyInput`);
  if (!input) return;

  input.addEventListener("input", () => {
    resetCompanySelection(prefix);
    const query = input.value.trim();
    clearTimeout(state.searchTimers[prefix]);

    if (query.length < 2) {
      renderCompanyResults(prefix, [], query);
      return;
    }

    state.searchTimers[prefix] = setTimeout(async () => {
      try {
        const companies = await searchCompanies(query, 8);
        renderCompanyResults(prefix, companies, query);
      } catch (error) {
        console.error(error);
        setAuthMessage(
          prefix === "signup" ? "signupMessage" : "completeMessage",
          error.message,
          "error"
        );
      }
    }, 200);
  });
}

function buildAuthMarkup() {
  return `
    <div class="auth-shell">
      <div class="auth-panel">
        <div class="auth-eyebrow">Secure Client Access</div>
        <div class="auth-title">Log in to access your P11creative onboarding workspace.</div>
        <div class="auth-copy">
          Every onboarding intake is tied to an authenticated company membership. During signup, search for
          your company in the existing data lake or create a new one if needed. After login, each new
          questionnaire submission onboards a community under that selected company account.
        </div>
      </div>
      <div class="auth-card">
        <div class="auth-tabs">
          <button class="auth-tab active" type="button" data-form="login">Log In</button>
          <button class="auth-tab" type="button" data-form="signup">Sign Up</button>
        </div>

        <form class="auth-form active" data-form="login" id="loginForm">
          <div class="auth-form-title">Welcome back</div>
          <div class="auth-form-copy">Use your email and password to enter the portal.</div>
          <div class="auth-field">
            <label class="auth-label" for="loginEmail">Email</label>
            <input class="auth-input" id="loginEmail" type="email" required />
          </div>
          <div class="auth-field">
            <label class="auth-label" for="loginPassword">Password</label>
            <input class="auth-input" id="loginPassword" type="password" required />
          </div>
          <button class="auth-submit" id="loginSubmit" type="submit">Log In</button>
          <div class="auth-message" id="loginMessage"></div>
        </form>

        <form class="auth-form" data-form="signup" id="signupForm">
          <div class="auth-form-title">Create your portal account</div>
          <div class="auth-form-copy">Search for your company account first. If we do not find a close match, we will create a new company record at the same level as existing imported data-lake companies.</div>
          <div class="auth-field">
            <label class="auth-label" for="signupFullName">Full name</label>
            <input class="auth-input" id="signupFullName" type="text" required />
          </div>
          <div class="auth-field">
            <label class="auth-label" for="signupEmail">Email</label>
            <input class="auth-input" id="signupEmail" type="email" required />
          </div>
          <div class="auth-field">
            <label class="auth-label" for="signupPassword">Password</label>
            <input class="auth-input" id="signupPassword" type="password" minlength="8" required />
          </div>
          <div class="auth-field">
            <label class="auth-label" for="signupCompanyInput">Company</label>
            <input class="auth-input" id="signupCompanyInput" type="text" autocomplete="off" placeholder="Search your company" required />
            <div class="company-results" id="signupCompanyResults"></div>
            <div class="company-selected" id="signupCompanySelected"></div>
          </div>
          <button class="auth-submit" id="signupSubmit" type="submit">Create Account</button>
          <div class="auth-message" id="signupMessage"></div>
        </form>

        <form class="auth-form" data-form="complete" id="completeForm">
          <div class="auth-form-title">Complete your company setup</div>
          <div class="auth-form-copy">We found your login, but this account is not linked to a company yet. Search for your company or create it now.</div>
          <div class="auth-field">
            <label class="auth-label" for="completeFullName">Full name</label>
            <input class="auth-input" id="completeFullName" type="text" required />
          </div>
          <div class="auth-field">
            <label class="auth-label" for="completeEmail">Email</label>
            <input class="auth-input" id="completeEmail" type="email" required />
          </div>
          <div class="auth-field">
            <label class="auth-label" for="completeCompanyInput">Company</label>
            <input class="auth-input" id="completeCompanyInput" type="text" autocomplete="off" placeholder="Search your company" required />
            <div class="company-results" id="completeCompanyResults"></div>
            <div class="company-selected" id="completeCompanySelected"></div>
          </div>
          <button class="auth-submit" id="completeSubmit" type="submit">Finish Setup</button>
          <div class="auth-message" id="completeMessage"></div>
        </form>
      </div>
    </div>
  `;
}

function renderAuthRoot() {
  const authRoot = getAuthRoot();
  if (!authRoot) return;
  authRoot.innerHTML = buildAuthMarkup();

  authRoot.querySelectorAll(".auth-tab").forEach((tab) => {
    tab.addEventListener("click", () => switchAuthForm(tab.dataset.form));
  });

  setupCompanySearch("signup");
  setupCompanySearch("complete");

  const loginForm = document.getElementById("loginForm");
  const signupForm = document.getElementById("signupForm");
  const completeForm = document.getElementById("completeForm");

  loginForm?.addEventListener("submit", handleLoginSubmit);
  signupForm?.addEventListener("submit", handleSignupSubmit);
  completeForm?.addEventListener("submit", handleCompleteSubmit);
}

function showCompleteForm(prefill = {}) {
  switchAuthForm("complete");
  const fullNameInput = document.getElementById("completeFullName");
  const emailInput = document.getElementById("completeEmail");
  if (fullNameInput) fullNameInput.value = prefill.fullName || "";
  if (emailInput) emailInput.value = prefill.email || "";
  setAuthMessage("completeMessage", "", "");
}

function updateSessionUi(session, context = null) {
  const info = document.getElementById("sessionInfo");
  const logoutBtn = document.getElementById("logoutBtn");
  if (!info || !logoutBtn) return;

  if (session && context) {
    const fullName =
      context.full_name ||
      session.user.user_metadata?.full_name ||
      session.user.email;
    info.textContent = `${fullName} · ${context.company_name || context.display_name}`;
    info.classList.add("show");
    logoutBtn.classList.add("show");
  } else {
    info.textContent = "";
    info.classList.remove("show");
    logoutBtn.classList.remove("show");
  }
}

async function finalizeSignupLink(signupData) {
  const result = await completePortalSignup({
    fullName: signupData.fullName,
    email: signupData.email,
    companyDirectoryId: signupData.companyDirectoryId,
    companyName: signupData.companyName,
  });
  clearPendingSignup();
  return result;
}

async function hydrateAuthenticatedApp(session) {
  state.session = session;
  let context = await getMyPortalContext();

  if (!context) {
    const pending = loadPendingSignup();
    if (pending) {
      await finalizeSignupLink(pending);
      context = await getMyPortalContext();
    }
  }

  if (!context) {
    showAuthRoot();
    renderAuthRoot();
    showCompleteForm({
      fullName: session.user.user_metadata?.full_name || "",
      email: session.user.email || "",
    });
    updateSessionUi(session, null);
    return;
  }

  state.portalContext = context;
  hideAuthRoot();
  updateSessionUi(session, context);
  updateTeamToggleAccess(context);
  state.latestSubmissionPayload = null;
  applySnapshot(context);
  await refreshCommunitySwitcher(context.onboarding_client_id);
  await loadPersistedTaskStates();
  await hydrateLatestSubmissionForActiveCommunity();
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  const submitButton = document.getElementById("loginSubmit");
  const email = document.getElementById("loginEmail")?.value?.trim();
  const password = document.getElementById("loginPassword")?.value || "";

  try {
    setAuthMessage("loginMessage", "", "");
    submitButton.disabled = true;
    await signInUser({ email, password });
  } catch (error) {
    setAuthMessage("loginMessage", error.message, "error");
  } finally {
    submitButton.disabled = false;
  }
}

async function handleSignupSubmit(event) {
  event.preventDefault();
  const submitButton = document.getElementById("signupSubmit");
  const fullName = document.getElementById("signupFullName")?.value?.trim();
  const email = document.getElementById("signupEmail")?.value?.trim();
  const password = document.getElementById("signupPassword")?.value || "";
  const companyInput = document.getElementById("signupCompanyInput")?.value?.trim();
  const selectedCompany = state.selectedCompanies.signup;

  if (!fullName || !email || !password || !(selectedCompany?.companyName || companyInput)) {
    setAuthMessage(
      "signupMessage",
      "Full name, email, password, and company are required.",
      "error"
    );
    return;
  }

  const pending = {
    fullName,
    email,
    companyDirectoryId: selectedCompany?.companyDirectoryId || null,
    companyName: selectedCompany?.companyName || companyInput,
  };

  try {
    setAuthMessage("signupMessage", "", "");
    submitButton.disabled = true;
    savePendingSignup(pending);
    const result = await signUpUser({ email, password, fullName });

    if (!result.session) {
      setAuthMessage(
        "signupMessage",
        "Account created. Check your email to verify your account, then log in to complete setup.",
        "success"
      );
      switchAuthForm("login");
      const loginEmail = document.getElementById("loginEmail");
      if (loginEmail) loginEmail.value = email;
      return;
    }
  } catch (error) {
    clearPendingSignup();
    setAuthMessage("signupMessage", error.message, "error");
  } finally {
    submitButton.disabled = false;
  }
}

async function handleCompleteSubmit(event) {
  event.preventDefault();
  const submitButton = document.getElementById("completeSubmit");
  const fullName = document.getElementById("completeFullName")?.value?.trim();
  const email = document.getElementById("completeEmail")?.value?.trim();
  const companyInput = document.getElementById("completeCompanyInput")?.value?.trim();
  const selectedCompany = state.selectedCompanies.complete;

  if (!fullName || !email || !(selectedCompany?.companyName || companyInput)) {
    setAuthMessage(
      "completeMessage",
      "Full name, email, and company are required.",
      "error"
    );
    return;
  }

  try {
    setAuthMessage("completeMessage", "", "");
    submitButton.disabled = true;
    await completePortalSignup({
      fullName,
      email,
      companyDirectoryId: selectedCompany?.companyDirectoryId || null,
      companyName: selectedCompany?.companyName || companyInput,
    });
    const context = await getMyPortalContext();
    if (context) {
      state.portalContext = context;
      hideAuthRoot();
      updateSessionUi(state.session, context);
      updateTeamToggleAccess(context);
      state.latestSubmissionPayload = null;
      applySnapshot(context);
      await refreshCommunitySwitcher(context.onboarding_client_id);
      await loadPersistedTaskStates();
      await hydrateLatestSubmissionForActiveCommunity();
    }
  } catch (error) {
    setAuthMessage("completeMessage", error.message, "error");
  } finally {
    submitButton.disabled = false;
  }
}

async function bootstrapAuth() {
  renderAuthRoot();
  const logoutBtn = document.getElementById("logoutBtn");
  logoutBtn?.addEventListener("click", async () => {
    try {
      await signOutUser();
    } catch (error) {
      alert(error.message);
    }
  });

  const session = await getCurrentSession();
  state.session = session;
  if (session) {
    await hydrateAuthenticatedApp(session);
  } else {
    showAuthRoot();
    updateSessionUi(null, null);
    updateTeamToggleAccess(null);
  }

  onAuthStateChange(async (_event, nextSession) => {
    state.session = nextSession;
    state.portalContext = null;
    state.latestSubmissionPayload = null;

    if (nextSession) {
      await hydrateAuthenticatedApp(nextSession);
    } else {
      showAuthRoot();
      renderAuthRoot();
      updateSessionUi(null, null);
      updateTeamToggleAccess(null);
      initializeTaskRows();
      initializeTaskSyncHandlers();
      renderCommunitySwitcher([], null);
    }
  });
}

function setView(view) {
  const clientToggleBtn = document.getElementById("clientToggleBtn");
  const teamToggleBtn = document.getElementById("teamToggleBtn");
  if (clientToggleBtn) clientToggleBtn.classList.add("active");
  if (teamToggleBtn) teamToggleBtn.classList.remove("active");
  // Client portal pages should always stay in client mode.
  document.body.classList.remove("int");
}

function toggleAcc(element) {
  const checkbox = element.querySelector("input");
  checkbox.checked = !checkbox.checked;
  element.classList.toggle("granted", checkbox.checked);
}

function toggleSvc(chip, id) {
  chip.classList.toggle("on");
  chip.dataset.serviceId = id;
  const detail = document.getElementById(`svc-${id}`);
  if (detail) {
    detail.style.display = chip.classList.contains("on") ? "block" : "none";
  }
}

function filterGrp(group, button) {
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.remove("active"));
  button.classList.add("active");
  document.querySelectorAll(".task-group").forEach((taskGroup) => {
    taskGroup.style.display =
      group === "all" || taskGroup.dataset.grp === group ? "block" : "none";
  });
}

function calcProg() {
  const requiredFields = document.querySelectorAll(".rq");
  let filledCount = 0;
  requiredFields.forEach((field) => {
    if (field.value && field.value.trim()) filledCount += 1;
  });
  const progressFill = document.getElementById("progFill");
  if (progressFill) {
    progressFill.style.width = `${Math.round((filledCount / requiredFields.length) * 100)}%`;
  }
}

function setGoLive(value) {
  const display = document.getElementById("displayGoLive");
  if (!display) return;
  display.textContent = formatDate(value);
}

function showFiles(input) {
  if (!input.files.length) return;
  let html =
    '<div style="margin-top:8px; border:1px solid var(--border); border-radius:7px; overflow:hidden;">';
  Array.from(input.files).forEach((file) => {
    html += `<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--border);font-size:12px;">
      <span>📄</span><span style="flex:1;color:var(--charcoal);font-weight:600;">${file.name}</span>
      <span style="color:var(--gray-light)">${(file.size / 1024 / 1024).toFixed(1)} MB</span></div>`;
  });
  html += "</div>";
  document.getElementById("fileList").innerHTML = html;
}

async function submitForm() {
  if (!state.session) {
    alert("Please log in before submitting your questionnaire.");
    showAuthRoot();
    return;
  }

  const communityName = getFieldValueByLabel("Community Name");
  if (!communityName) {
    alert("Please enter the Community Name before submitting.");
    return;
  }

  const submitButton = document.querySelector(".submit-btn");
  const originalLabel = submitButton?.textContent || "Submit";

  try {
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Submitting...";
    }

    const payload = buildPayload();
    state.latestSubmissionPayload = payload;
    const result = await submitIntake(payload);
    if (result?.onboarding_client_id) {
      await setMyActiveCommunity(result.onboarding_client_id);
    }
    const snapshot = await getOnboardingSnapshot();
    await refreshCommunitySwitcher(result?.onboarding_client_id || null);
    await loadPersistedTaskStates();

    if (snapshot) {
      applySnapshot(snapshot);
      hydrateFormFromPayload(payload);
      applyStage(deriveDisplayStage(snapshot.current_stage, snapshot, payload));
      await hydrateLatestSubmissionForActiveCommunity();
    } else if (result?.status === "ok") {
      applyStage("account_access");
      setGoLive(payload.target_campaign_go_live_date);
    }

    const displayName = document.getElementById("displayName");
    if (displayName) displayName.textContent = communityName;
    const displayCompany = document.getElementById("displayCompany");
    if (displayCompany && state.portalContext?.company_name) {
      displayCompany.textContent = state.portalContext.company_name;
    }

    alert(
      `Submitted successfully.\n\nReference ID: ${result?.onboarding_client_id ?? "n/a"}\nNext step: Continue to Account Access.`
    );
    window.location.href = "/p11-onboarding-account-access.html";
  } catch (error) {
    console.error(error);
    alert(`Submission failed: ${error.message}`);
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = originalLabel;
    }
  }
}

async function bootstrapFromRemote() {
  if (!state.session) return;

  try {
    const snapshot = await getOnboardingSnapshot();
    if (!snapshot) return;
    state.latestSubmissionPayload = null;
    applySnapshot(snapshot);
    await loadPersistedTaskStates();
    await hydrateLatestSubmissionForActiveCommunity();
  } catch (error) {
    console.warn("Unable to load remote onboarding snapshot:", error.message);
  }
}

function initializeServiceChipMetadata() {
  document.querySelectorAll(".svc-chip").forEach((chip) => {
    const serviceId = deriveServiceId(chip);
    if (serviceId) chip.dataset.serviceId = serviceId;
  });
}

function initializeAccessVisuals() {
  document.querySelectorAll(".acc-item").forEach((item) => {
    const checkbox = item.querySelector("input[type='checkbox']");
    item.classList.toggle("granted", Boolean(checkbox?.checked));
  });

  document.querySelectorAll(".acc-item .acc-cb").forEach((checkbox) => {
    checkbox.addEventListener("click", (event) => event.stopPropagation());
    checkbox.addEventListener("change", () => {
      const item = checkbox.closest(".acc-item");
      if (item) item.classList.toggle("granted", checkbox.checked);
    });
  });
}

function initialize() {
  initializeServiceChipMetadata();
  initializeAccessVisuals();
  initializeStageNavigation();
  initializeTaskRows();
  initializeTaskSyncHandlers();
  initializeCommunitySwitcher();
  calcProg();
  bootstrapAuth().then(() => {
    if (state.session) {
      bootstrapFromRemote();
    }
  });
}

window.setView = setView;
window.toggleAcc = toggleAcc;
window.toggleSvc = toggleSvc;
window.filterGrp = filterGrp;
window.calcProg = calcProg;
window.setGoLive = setGoLive;
window.showFiles = showFiles;
window.submitForm = submitForm;

document.addEventListener("DOMContentLoaded", initialize);
