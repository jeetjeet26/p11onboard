export const STAGE_SEQUENCE = [
  "contract_signed",
  "intake_form",
  "account_access",
  "creative_kickoff",
  "campaign_build",
  "prelaunch_review",
  "go_live",
];

export const STAGE_COPY = {
  contract_signed: {
    title: "Step 1 of 7 - Contract Signed",
    text: "Welcome to P11creative onboarding. We are ready for your intake details so we can begin campaign setup.",
  },
  intake_form: {
    title: "Step 2 of 7 - Complete Your Intake Questionnaire",
    text: "Fill out all sections below so we can start building your campaigns. After submission, use Continue Onboarding to grant platform access.",
  },
  account_access: {
    title: "Step 3 of 7 - Grant Admin Access to Your Platforms",
    text: "Questionnaire received. Finish the platform access checklist so implementation can begin.",
  },
  creative_kickoff: {
    title: "Step 4 of 7 - Creative Development",
    text: "Our team is preparing campaign direction, assets, and ad preview materials based on your submitted intake.",
  },
  campaign_build: {
    title: "Step 5 of 7 - Campaign Build",
    text: "Campaigns are being built and configured for launch readiness.",
  },
  prelaunch_review: {
    title: "Step 6 of 7 - Pre-Launch Review",
    text: "Final checks and approvals are in progress before go-live.",
  },
  go_live: {
    title: "Step 7 of 7 - GO LIVE",
    text: "Campaigns are live. Your team and P11creative can now monitor performance and iterate.",
  },
};

export const ACCESS_STEP_COMPLETION_TASK_KEY = "step_3_account_access_complete";

export const STAGE_LABELS = {
  contract_signed: "Contract Signed",
  intake_form: "Intake Form",
  account_access: "Account Access",
  creative_kickoff: "Creative Development",
  campaign_build: "Campaign Build",
  prelaunch_review: "Pre-Launch Review",
  go_live: "Go Live",
};

export function normalizeStage(stageCode, fallback = "intake_form") {
  return STAGE_SEQUENCE.includes(stageCode) ? stageCode : fallback;
}

export function stageIndex(stageCode, fallback = "intake_form") {
  return Math.max(0, STAGE_SEQUENCE.indexOf(normalizeStage(stageCode, fallback)));
}

export function toStageLabel(stageCode) {
  if (STAGE_LABELS[stageCode]) return STAGE_LABELS[stageCode];
  return String(stageCode || "none")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function getStageCopy(stageCode, fallback = "intake_form") {
  return STAGE_COPY[normalizeStage(stageCode, fallback)] || STAGE_COPY[fallback];
}

export function hasSubmittedIntake(context = null, payload = null) {
  if (payload && typeof payload === "object" && Object.keys(payload).length > 0) {
    return true;
  }
  const status = context?.status || "";
  return ["submitted", "resubmitted", "in_review", "approved"].includes(status);
}

export function deriveDisplayStage(stageCode, context = null, payload = null) {
  const normalized = normalizeStage(stageCode, "intake_form");
  if (normalized === "intake_form" && hasSubmittedIntake(context, payload)) {
    return "account_access";
  }
  return normalized;
}

export function stageDestination(stageCode) {
  if (stageCode === "account_access") return "/p11-onboarding-account-access.html";
  return "/p11-onboarding-dashboard.html";
}
