import { supabase } from "./supabase.js";

export async function signUpUser({ email, password, fullName }) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
        portal_role: "client",
      },
    },
  });

  if (error) {
    throw new Error(`Sign up failed: ${error.message}`);
  }

  return data;
}

export async function signInUser({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    throw new Error(`Login failed: ${error.message}`);
  }

  return data;
}

export async function signOutUser() {
  const { error } = await supabase.auth.signOut();
  if (error) {
    throw new Error(`Logout failed: ${error.message}`);
  }
}

export async function getCurrentSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw new Error(`Session load failed: ${error.message}`);
  }
  return data.session;
}

export function onAuthStateChange(callback) {
  return supabase.auth.onAuthStateChange(callback);
}

export async function searchCompanies(query, limit = 8) {
  const { data, error } = await supabase.rpc("search_companies", {
    p_query: query,
    p_limit: limit,
  });

  if (error) {
    throw new Error(`Company search failed: ${error.message}`);
  }

  return Array.isArray(data) ? data : [];
}

export async function completePortalSignup({
  fullName,
  email,
  companyDirectoryId = null,
  companyName = null,
}) {
  const { data, error } = await supabase.rpc("complete_portal_signup", {
    p_full_name: fullName,
    p_email: email,
    p_company_directory_id: companyDirectoryId,
    p_company_name: companyName,
  });

  if (error) {
    throw new Error(`Portal signup completion failed: ${error.message}`);
  }

  return data;
}

export async function getMyPortalContext() {
  const { data, error } = await supabase.rpc("get_my_portal_context");

  if (error) {
    throw new Error(`Portal context fetch failed: ${error.message}`);
  }

  return data;
}

export async function listMyCommunities() {
  const { data, error } = await supabase.rpc("list_my_communities");

  if (error) {
    throw new Error(`Community list fetch failed: ${error.message}`);
  }

  return Array.isArray(data) ? data : [];
}

export async function setMyActiveCommunity(onboardingClientId) {
  const { data, error } = await supabase.rpc("set_my_active_community", {
    p_onboarding_client_id: onboardingClientId,
  });

  if (error) {
    throw new Error(`Unable to switch community: ${error.message}`);
  }

  return data;
}

export async function submitIntake(payload) {
  const { data, error } = await supabase.rpc("submit_my_intake", {
    p_payload: payload,
  });

  if (error) {
    throw new Error(`Submit failed: ${error.message}`);
  }

  return data;
}

export async function getOnboardingSnapshot() {
  const { data, error } = await supabase.rpc("get_my_portal_context");

  if (error) {
    throw new Error(`Snapshot fetch failed: ${error.message}`);
  }

  return data;
}

export async function getLatestSubmissionPayload(onboardingClientId) {
  if (!onboardingClientId) return null;

  const rpcResult = await supabase.rpc("get_my_latest_submission_payload", {
    p_onboarding_client_id: onboardingClientId,
  });

  if (!rpcResult.error) {
    return rpcResult.data ?? null;
  }

  const { data, error } = await supabase
    .schema("onboarding")
    .from("onboarding_submission")
    .select("raw_payload_json, submitted_at, id")
    .eq("onboarding_client_id", onboardingClientId)
    .in("submission_status", ["submitted", "resubmitted"])
    .order("submitted_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn(
      "Latest submission payload unavailable:",
      rpcResult.error.message,
      error.message
    );
    return null;
  }

  return data?.raw_payload_json ?? null;
}

export async function upsertTaskState({
  taskKey,
  isComplete,
  groupCode = null,
  taskText = null,
}) {
  const { data, error } = await supabase.rpc("upsert_my_task_state", {
    p_task_key: taskKey,
    p_is_complete: isComplete,
    p_group_code: groupCode,
    p_task_text: taskText,
  });

  if (error) {
    throw new Error(`Task update failed: ${error.message}`);
  }

  return data;
}

export async function listTaskStates() {
  const { data, error } = await supabase.rpc("list_my_task_states");

  if (error) {
    throw new Error(`Task state fetch failed: ${error.message}`);
  }

  return Array.isArray(data) ? data : [];
}

export async function getInternalPortalContext() {
  const { data, error } = await supabase.rpc("get_internal_portal_context");

  if (error) {
    throw new Error(`Internal context fetch failed: ${error.message}`);
  }

  return data;
}

export async function internalListOnboardingOverview({ search = "", stage = null, limit = 400 } = {}) {
  const { data, error } = await supabase.rpc("internal_list_onboarding_overview", {
    p_search: search || null,
    p_stage: stage,
    p_limit: limit,
  });

  if (error) {
    throw new Error(`Internal onboarding list failed: ${error.message}`);
  }

  return Array.isArray(data) ? data : [];
}

export async function createInternalSignupInvite({
  email,
  fullName = null,
  portalRole = "internal",
  inviteBaseUrl = null,
}) {
  const { data, error } = await supabase.rpc("create_internal_signup_invite", {
    p_email: email,
    p_full_name: fullName,
    p_portal_role: portalRole,
    p_expires_in_hours: null,
    p_invite_base_url: inviteBaseUrl,
  });

  if (error) {
    throw new Error(`Internal invite creation failed: ${error.message}`);
  }

  return data;
}

export async function getInternalSignupInvite(inviteToken) {
  const { data, error } = await supabase.rpc("get_internal_signup_invite", {
    p_invite_token: inviteToken,
  });

  if (error) {
    throw new Error(`Internal invite lookup failed: ${error.message}`);
  }

  return data;
}

export async function redeemInternalSignupInvite({ inviteToken, fullName = null }) {
  const { data, error } = await supabase.rpc("redeem_internal_signup_invite", {
    p_invite_token: inviteToken,
    p_full_name: fullName,
  });

  if (error) {
    throw new Error(`Internal invite redemption failed: ${error.message}`);
  }

  return data;
}
