import { supabase } from "./supabase.js";
import { BRAND_ASSET_BUCKET, SUPABASE_URL } from "./config.js";

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

export async function requestPasswordReset({ email, redirectTo }) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo,
  });
  if (error) {
    throw new Error(`Password reset failed: ${error.message}`);
  }
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

function slugifyFilename(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function uploadBrandAssets({ onboardingClientId, files = [] }) {
  const validClientId = Number(onboardingClientId);
  if (!validClientId || !Array.isArray(files) || !files.length) return [];

  const uploaded = [];
  for (const file of files) {
    const now = Date.now();
    const safeName = slugifyFilename(file.name) || `asset-${now}`;
    const objectPath = `client-${validClientId}/${now}-${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from(BRAND_ASSET_BUCKET)
      .upload(objectPath, file, {
        upsert: false,
        contentType: file.type || undefined,
      });
    if (uploadError) {
      throw new Error(`Brand asset upload failed: ${uploadError.message}`);
    }

    uploaded.push({
      file_name: file.name,
      mime_type: file.type || null,
      file_size_bytes: file.size || null,
      storage_path: objectPath,
      external_url: null,
    });
  }

  return uploaded;
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

export async function listMyPlatformAccess() {
  const { data, error } = await supabase.rpc("list_my_platform_access");
  if (error) {
    throw new Error(`Platform access fetch failed: ${error.message}`);
  }
  return Array.isArray(data) ? data : [];
}

export async function upsertMyPlatformAccess({
  platformCode,
  isAccessGranted,
  notes = null,
}) {
  const { data, error } = await supabase.rpc("upsert_my_platform_access", {
    p_platform_code: platformCode,
    p_is_access_granted: isAccessGranted,
    p_notes: notes,
  });
  if (error) {
    throw new Error(`Platform access update failed: ${error.message}`);
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

export async function internalListClients({
  search = "",
  stage = null,
  status = null,
  limit = 100,
  offset = 0,
  companyDirectoryId = null,
} = {}) {
  const { data, error } = await supabase.rpc("internal_list_clients", {
    p_search: search || null,
    p_stage: stage,
    p_status: status,
    p_limit: limit,
    p_offset: offset,
    p_company_directory_id: companyDirectoryId,
  });

  if (error) {
    throw new Error(`Internal client list failed: ${error.message}`);
  }

  return data || { items: [], total_count: 0, limit, offset };
}

export async function internalListCompanies({
  search = "",
  limit = 200,
  offset = 0,
} = {}) {
  const { data, error } = await supabase.rpc("internal_list_companies", {
    p_search: search || null,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) {
    throw new Error(`Internal company list failed: ${error.message}`);
  }

  return data || { items: [], total_count: 0, limit, offset };
}

export async function internalUpsertCompanyDirectory({
  companyDirectoryId = null,
  companyName = null,
  publicCompanyId = null,
} = {}) {
  const { data, error } = await supabase.rpc("internal_upsert_company_directory", {
    p_company_directory_id: companyDirectoryId,
    p_company_name: companyName,
    p_public_company_id: publicCompanyId,
  });

  if (error) {
    throw new Error(`Internal company save failed: ${error.message}`);
  }

  return data;
}

export async function internalGetClientDetail(onboardingClientId) {
  const numericId = Number(onboardingClientId);
  if (!numericId) {
    throw new Error("Valid onboarding client ID is required.");
  }

  const { data, error } = await supabase.rpc("internal_get_client_detail", {
    p_onboarding_client_id: numericId,
  });

  if (error) {
    throw new Error(`Internal client detail failed: ${error.message}`);
  }

  return data;
}

export async function internalUpsertClientInfo(payload = {}) {
  const { data, error } = await supabase.rpc("internal_upsert_client_info", {
    p_onboarding_client_id: payload.onboardingClientId ?? null,
    p_company_directory_id: payload.companyDirectoryId ?? null,
    p_company_name: payload.companyName ?? null,
    p_community_name: payload.communityName ?? null,
    p_current_stage: payload.currentStage ?? null,
    p_status: payload.status ?? null,
    p_target_go_live_at: payload.targetGoLiveAt ?? null,
    p_community_phone: payload.communityPhone ?? null,
    p_community_email: payload.communityEmail ?? null,
    p_hours_of_operation: payload.hoursOfOperation ?? null,
    p_website_url: payload.websiteUrl ?? null,
    p_property_type: payload.propertyType ?? null,
    p_parent_company: payload.parentCompany ?? null,
    p_community_address: payload.communityAddress ?? null,
    p_preferred_communication_method: payload.preferredCommunicationMethod ?? null,
    p_final_notes: payload.finalNotes ?? null,
    p_reporting_primary_name: payload.reportingPrimaryName ?? null,
    p_reporting_primary_email: payload.reportingPrimaryEmail ?? null,
    p_additional_report_recipients: payload.additionalReportRecipients ?? null,
    p_conversion_actions: payload.conversionActions ?? null,
    p_technical_notes: payload.technicalNotes ?? null,
  });

  if (error) {
    throw new Error(`Internal client save failed: ${error.message}`);
  }

  return data;
}

export async function getMyDashboardResources() {
  const { data, error } = await supabase.rpc("get_my_dashboard_resources");
  if (error) {
    throw new Error(`Dashboard resources fetch failed: ${error.message}`);
  }
  return data || { assignments: [], links: [] };
}

export async function createInternalSignupInvite({
  email,
  fullName = null,
  portalRole = "internal",
  expiresInHours = null,
  inviteBaseUrl = null,
}) {
  const { data, error } = await supabase.rpc("create_internal_signup_invite", {
    p_email: email,
    p_full_name: fullName,
    p_portal_role: portalRole,
    p_expires_in_hours: expiresInHours,
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

// -----------------------------------------------------------------------------
// Dropbox integration
// -----------------------------------------------------------------------------

function getFunctionsBase() {
  if (!SUPABASE_URL) {
    throw new Error(
      "Supabase URL not configured; cannot reach Dropbox edge functions."
    );
  }
  return `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1`;
}

async function getAuthHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) {
    throw new Error("You must be signed in to call Dropbox operations.");
  }
  return {
    Authorization: `Bearer ${token}`,
  };
}

async function invokeDropboxAdmin(action, extra = {}) {
  const { data, error } = await supabase.functions.invoke("dropbox-admin", {
    body: { action, ...extra },
  });
  if (error) {
    const suffix = data?.error ? `: ${data.error}` : "";
    throw new Error(`Dropbox admin (${action}) failed${suffix || `: ${error.message}`}`);
  }
  return data;
}

export async function startDropboxOAuth({ returnTo = window.location.href } = {}) {
  const headers = {
    ...(await getAuthHeaders()),
    "Content-Type": "application/json",
  };
  const resp = await fetch(`${getFunctionsBase()}/dropbox-oauth/start`, {
    method: "POST",
    headers,
    body: JSON.stringify({ returnTo }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Unable to start Dropbox connection: ${text || resp.status}`);
  }
  return resp.json();
}

export async function getDropboxStatus() {
  return invokeDropboxAdmin("status");
}

export async function disconnectDropbox() {
  return invokeDropboxAdmin("disconnect");
}

export async function setDropboxFolderRoot(folderRootPath) {
  return invokeDropboxAdmin("set_root", { folder_root_path: folderRootPath });
}

export async function listDropboxFolder(path = "") {
  return invokeDropboxAdmin("list_folder", { path });
}

export async function createDropboxFolderForClient({
  onboardingClientId,
  folderName = null,
  parentPath = null,
  autorename = true,
}) {
  return invokeDropboxAdmin("create_folder", {
    onboarding_client_id: onboardingClientId,
    folder_name: folderName,
    parent_path: parentPath,
    autorename,
  });
}

export async function linkExistingDropboxFolder({
  onboardingClientId,
  folderPath = null,
  folderId = null,
}) {
  return invokeDropboxAdmin("link_existing_folder", {
    onboarding_client_id: onboardingClientId,
    folder_path: folderPath,
    folder_id: folderId,
  });
}

export async function getDropboxBinding(onboardingClientId) {
  return invokeDropboxAdmin("get_binding", {
    onboarding_client_id: onboardingClientId,
  });
}

export async function unlinkDropboxFolder(onboardingClientId) {
  return invokeDropboxAdmin("unlink_folder", {
    onboarding_client_id: onboardingClientId,
  });
}

export async function refreshDropboxSharedLink(onboardingClientId) {
  return invokeDropboxAdmin("refresh_shared_link", {
    onboarding_client_id: onboardingClientId,
  });
}

export async function uploadFileToDropbox({
  onboardingClientId,
  file,
  subpath = null,
}) {
  const headers = await getAuthHeaders();
  const body = new FormData();
  body.append("onboarding_client_id", String(onboardingClientId));
  body.append("file", file, file.name);
  if (subpath) body.append("subpath", subpath);

  const resp = await fetch(`${getFunctionsBase()}/dropbox-upload`, {
    method: "POST",
    headers,
    body,
  });

  let payload = null;
  try {
    payload = await resp.json();
  } catch (_error) {
    payload = null;
  }

  if (!resp.ok) {
    const message = payload?.error || `Dropbox upload failed (${resp.status})`;
    throw new Error(message);
  }

  return payload;
}

export async function internalGetDropboxStatusRpc() {
  const { data, error } = await supabase.rpc("internal_get_dropbox_status");
  if (error) {
    throw new Error(`Dropbox status fetch failed: ${error.message}`);
  }
  return data || { is_active: false, is_connected: false };
}

export async function internalGetDropboxBinding(onboardingClientId) {
  const { data, error } = await supabase.rpc(
    "internal_get_dropbox_folder_binding",
    { p_onboarding_client_id: onboardingClientId }
  );
  if (error) {
    throw new Error(`Dropbox binding fetch failed: ${error.message}`);
  }
  return data;
}

export async function internalClearDropboxBinding(onboardingClientId) {
  const { data, error } = await supabase.rpc(
    "internal_clear_dropbox_folder_binding",
    { p_onboarding_client_id: onboardingClientId }
  );
  if (error) {
    throw new Error(`Dropbox unlink failed: ${error.message}`);
  }
  return data;
}

export async function getMyDropboxFolder() {
  const { data, error } = await supabase.rpc("get_my_dropbox_folder");
  if (error) {
    throw new Error(`Dropbox folder fetch failed: ${error.message}`);
  }
  return data;
}

export async function internalProcessSyncJobs(limit = 25) {
  const { data, error } = await supabase.rpc("internal_process_sync_jobs", {
    p_limit: limit,
  });
  if (error) {
    throw new Error(`Sync queue processing failed: ${error.message}`);
  }
  return data;
}

export async function internalGetSyncQueueSummary() {
  const { data, error } = await supabase.rpc("internal_get_sync_queue_summary");
  if (error) {
    throw new Error(`Sync queue summary failed: ${error.message}`);
  }
  return data || {};
}
