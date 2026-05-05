import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { corsHeaders, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { createServiceRoleClient, requireInternalUser } from "../_shared/auth.ts";
import {
  dropboxApiCall,
  DropboxError,
  ensureSharedLink,
  fetchIntegration,
  joinDropboxPath,
  refreshAccessToken,
  sanitizeFolderName,
} from "../_shared/dropbox.ts";

// Internal-only admin operations for the Dropbox integration:
//
//   POST /dropbox-admin  body: { action: "status" | "disconnect" | "set_root"
//                                | "list_folder" | "create_folder"
//                                | "link_existing_folder" | "get_binding"
//                                | "unlink_folder" | "refresh_shared_link",
//                                ... }
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return errorResponse(405, "Method not allowed");
  }

  try {
    const { user } = await requireInternalUser(req);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action || "");
    const sb = createServiceRoleClient();

    switch (action) {
      case "status":
        return await handleStatus(sb);
      case "disconnect":
        return await handleDisconnect(sb);
      case "set_root":
        return await handleSetRoot(sb, body);
      case "list_folder":
        return await handleListFolder(sb, body);
      case "create_folder":
        return await handleCreateFolder(sb, body, user);
      case "link_existing_folder":
        return await handleLinkExistingFolder(sb, body, user);
      case "get_binding":
        return await handleGetBinding(sb, body);
      case "unlink_folder":
        return await handleUnlinkFolder(sb, body);
      case "refresh_shared_link":
        return await handleRefreshSharedLink(sb, body);
      default:
        return errorResponse(400, `Unknown action: ${action}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    // deno-lint-ignore no-explicit-any
    const status = (error as any)?.status ?? 500;
    const details = error instanceof DropboxError ? error.body : null;
    console.error("dropbox-admin error", { message, status });
    return errorResponse(status, message, details);
  }
});

type Sb = ReturnType<typeof createServiceRoleClient>;

const STANDARD_COMMUNITY_SUBFOLDERS = [
  "Assets",
  "Logos",
  "Brand Guide",
  "Ad Copy",
  "Campaigns",
  "Other",
];

// deno-lint-ignore no-explicit-any
async function handleStatus(sb: Sb): Promise<Response> {
  const row = await fetchIntegration(sb);
  if (!row) {
    return jsonResponse({ is_connected: false, is_active: false });
  }
  return jsonResponse({
    is_connected: Boolean(row.refresh_token),
    is_active: row.is_active,
    team_id: row.team_id,
    team_name: row.team_name,
    account_email: row.account_email,
    account_display_name: row.account_display_name,
    team_root_namespace_id: row.team_root_namespace_id,
    home_namespace_id: row.home_namespace_id,
    folder_root_path: row.folder_root_path,
    folder_root_display_path: row.folder_root_display_path,
    connected_by_email: row.connected_by_email,
    connected_at: row.connected_at,
    last_error: row.last_error,
    scope: row.scope,
  });
}

async function handleDisconnect(sb: Sb): Promise<Response> {
  const { error } = await sb
    .schema("onboarding")
    .from("dropbox_integration")
    .update({
      is_active: false,
      refresh_token: null,
      access_token: null,
      access_token_expires_at: null,
      connected_by_user_id: null,
      connected_by_email: null,
      connected_at: null,
      last_error: null,
    })
    .eq("id", 1);
  if (error) return errorResponse(500, error.message);
  return jsonResponse({ status: "ok" });
}

async function handleSetRoot(sb: Sb, body: Record<string, unknown>): Promise<Response> {
  const folderPath = normalizeFolderPath(String(body.folder_root_path || "/"));
  const displayPath = folderPath || "/";

  const row = await fetchIntegration(sb);
  if (!row) return errorResponse(412, "Dropbox not connected");
  const namespace = row.team_root_namespace_id || row.home_namespace_id || null;

  if (folderPath && folderPath !== "/") {
    const accessToken = await refreshAccessToken(sb, row);
    try {
      await dropboxApiCall({
        accessToken,
        endpoint: "/files/get_metadata",
        body: { path: folderPath },
        pathRootNamespaceId: namespace,
      });
    } catch (error) {
      if (error instanceof DropboxError && error.status === 409) {
        return errorResponse(404, `Folder not found in Dropbox: ${folderPath}`);
      }
      throw error;
    }
  }

  const { error } = await sb
    .schema("onboarding")
    .from("dropbox_integration")
    .update({
      folder_root_path: folderPath || null,
      folder_root_display_path: displayPath,
    })
    .eq("id", 1);
  if (error) return errorResponse(500, error.message);
  return jsonResponse({ status: "ok", folder_root_path: folderPath || null });
}

async function handleListFolder(sb: Sb, body: Record<string, unknown>): Promise<Response> {
  const row = await fetchIntegration(sb);
  if (!row) return errorResponse(412, "Dropbox not connected");
  const accessToken = await refreshAccessToken(sb, row);
  const namespace = row.team_root_namespace_id || row.home_namespace_id || null;

  const path = normalizeFolderPath(
    typeof body.path === "string" ? body.path : row.folder_root_path || ""
  );

  const payload = (await dropboxApiCall({
    accessToken,
    endpoint: "/files/list_folder",
    body: {
      path: path === "/" ? "" : path,
      recursive: false,
      include_non_downloadable_files: false,
      include_mounted_folders: true,
    },
    pathRootNamespaceId: namespace,
  })) as { entries?: Array<Record<string, unknown>> };

  const entries = (payload.entries || [])
    .filter((entry) => entry[".tag"] === "folder")
    .map((entry) => ({
      id: String(entry.id || ""),
      name: String(entry.name || ""),
      path_display: String(entry.path_display || ""),
      path_lower: String(entry.path_lower || ""),
      shared_folder_id: entry.shared_folder_id ?? null,
    }));

  return jsonResponse({
    path: path || "/",
    namespace_id: namespace,
    entries,
  });
}

async function handleCreateFolder(
  sb: Sb,
  body: Record<string, unknown>,
  user: { id: string; email: string | null }
): Promise<Response> {
  const onboardingClientId = Number(body.onboarding_client_id);
  if (!onboardingClientId) return errorResponse(400, "onboarding_client_id is required");

  const row = await fetchIntegration(sb);
  if (!row) return errorResponse(412, "Dropbox not connected");
  const accessToken = await refreshAccessToken(sb, row);
  const namespace = row.team_root_namespace_id || row.home_namespace_id || null;

  const client = await loadClientSummary(sb, onboardingClientId);

  const rawName = typeof body.folder_name === "string" && body.folder_name.trim()
    ? body.folder_name
    : defaultFolderNameFor(client);
  const folderName = sanitizeFolderName(rawName);
  if (!folderName) return errorResponse(400, "Folder name is required");

  const parentPath = normalizeFolderPath(
    typeof body.parent_path === "string" && body.parent_path.trim()
      ? body.parent_path
      : row.folder_root_path || "/"
  );
  const targetPath = joinDropboxPath(parentPath === "/" ? "" : parentPath, folderName);
  const autorename = Boolean(body.autorename ?? true);

  const created = (await dropboxApiCall({
    accessToken,
    endpoint: "/files/create_folder_v2",
    body: { path: targetPath, autorename },
    pathRootNamespaceId: namespace,
  })) as { metadata?: Record<string, unknown> };

  const metadata = (created.metadata || {}) as Record<string, unknown>;
  const finalPath = String(metadata.path_display || targetPath);
  const folderId = String(metadata.id || "");

  const subfolders = await createStandardSubfolders({
    accessToken,
    parentPath: finalPath,
    pathRootNamespaceId: namespace,
  });

  const shared = await ensureSharedLink(accessToken, finalPath, namespace);

  await writeBinding(sb, {
    onboardingClientId,
    folderId,
    folderPath: String(metadata.path_lower || finalPath.toLowerCase()),
    folderDisplayPath: finalPath,
    namespaceId: namespace,
    sharedLinkUrl: shared.url,
    linkSource: "created",
    linkedByUserId: user.id,
    linkedByEmail: user.email,
  });

  return jsonResponse({
    status: "ok",
    binding: {
      onboarding_client_id: onboardingClientId,
      folder_id: folderId,
      folder_path: metadata.path_lower,
      folder_display_path: finalPath,
      shared_link_url: shared.url,
      link_source: "created",
      subfolders,
    },
  });
}

async function createStandardSubfolders({
  accessToken,
  parentPath,
  pathRootNamespaceId,
}: {
  accessToken: string;
  parentPath: string;
  pathRootNamespaceId: string | null;
}): Promise<Array<{ name: string; path_display: string | null; status: string }>> {
  const results: Array<{ name: string; path_display: string | null; status: string }> = [];

  for (const name of STANDARD_COMMUNITY_SUBFOLDERS) {
    const path = joinDropboxPath(parentPath, name);
    try {
      const created = (await dropboxApiCall({
        accessToken,
        endpoint: "/files/create_folder_v2",
        body: { path, autorename: false },
        pathRootNamespaceId,
      })) as { metadata?: Record<string, unknown> };
      results.push({
        name,
        path_display: String(created.metadata?.path_display || path),
        status: "created",
      });
    } catch (error) {
      if (error instanceof DropboxError && error.status === 409) {
        results.push({ name, path_display: path, status: "exists" });
        continue;
      }
      throw error;
    }
  }

  return results;
}

async function handleLinkExistingFolder(
  sb: Sb,
  body: Record<string, unknown>,
  user: { id: string; email: string | null }
): Promise<Response> {
  const onboardingClientId = Number(body.onboarding_client_id);
  if (!onboardingClientId) return errorResponse(400, "onboarding_client_id is required");

  const row = await fetchIntegration(sb);
  if (!row) return errorResponse(412, "Dropbox not connected");
  const accessToken = await refreshAccessToken(sb, row);
  const namespace = row.team_root_namespace_id || row.home_namespace_id || null;

  const explicitPath = typeof body.folder_path === "string" ? body.folder_path.trim() : "";
  const folderId = typeof body.folder_id === "string" ? body.folder_id.trim() : "";
  if (!explicitPath && !folderId) {
    return errorResponse(400, "Provide folder_path or folder_id");
  }

  const lookupTarget = folderId || normalizeFolderPath(explicitPath);
  const metadata = (await dropboxApiCall({
    accessToken,
    endpoint: "/files/get_metadata",
    body: { path: lookupTarget },
    pathRootNamespaceId: namespace,
  })) as Record<string, unknown>;

  if (metadata[".tag"] !== "folder") {
    return errorResponse(400, "Target path is not a folder");
  }

  const finalPath = String(metadata.path_display || "");
  const resolvedId = String(metadata.id || "");

  const shared = await ensureSharedLink(accessToken, finalPath, namespace);

  await writeBinding(sb, {
    onboardingClientId,
    folderId: resolvedId,
    folderPath: String(metadata.path_lower || finalPath.toLowerCase()),
    folderDisplayPath: finalPath,
    namespaceId: namespace,
    sharedLinkUrl: shared.url,
    linkSource: "linked",
    linkedByUserId: user.id,
    linkedByEmail: user.email,
  });

  return jsonResponse({
    status: "ok",
    binding: {
      onboarding_client_id: onboardingClientId,
      folder_id: resolvedId,
      folder_path: metadata.path_lower,
      folder_display_path: finalPath,
      shared_link_url: shared.url,
      link_source: "linked",
    },
  });
}

async function handleGetBinding(sb: Sb, body: Record<string, unknown>): Promise<Response> {
  const onboardingClientId = Number(body.onboarding_client_id);
  if (!onboardingClientId) return errorResponse(400, "onboarding_client_id is required");

  const { data, error } = await sb
    .schema("onboarding")
    .from("dropbox_folder_binding")
    .select("*")
    .eq("onboarding_client_id", onboardingClientId)
    .maybeSingle();
  if (error) return errorResponse(500, error.message);
  return jsonResponse({ binding: data ?? null });
}

async function handleUnlinkFolder(sb: Sb, body: Record<string, unknown>): Promise<Response> {
  const onboardingClientId = Number(body.onboarding_client_id);
  if (!onboardingClientId) return errorResponse(400, "onboarding_client_id is required");

  const { error: delError } = await sb
    .schema("onboarding")
    .from("dropbox_folder_binding")
    .delete()
    .eq("onboarding_client_id", onboardingClientId);
  if (delError) return errorResponse(500, delError.message);

  const { error: linkError } = await sb
    .schema("onboarding")
    .from("onboarding_link")
    .delete()
    .eq("onboarding_client_id", onboardingClientId)
    .eq("system_code", "dropbox_creative_folder");
  if (linkError) return errorResponse(500, linkError.message);

  return jsonResponse({ status: "ok" });
}

async function handleRefreshSharedLink(sb: Sb, body: Record<string, unknown>): Promise<Response> {
  const onboardingClientId = Number(body.onboarding_client_id);
  if (!onboardingClientId) return errorResponse(400, "onboarding_client_id is required");

  const { data: binding, error } = await sb
    .schema("onboarding")
    .from("dropbox_folder_binding")
    .select("*")
    .eq("onboarding_client_id", onboardingClientId)
    .maybeSingle();
  if (error) return errorResponse(500, error.message);
  if (!binding) return errorResponse(404, "No binding for this community");

  const row = await fetchIntegration(sb);
  if (!row) return errorResponse(412, "Dropbox not connected");
  const accessToken = await refreshAccessToken(sb, row);

  const path = binding.folder_display_path || binding.folder_path;
  const shared = await ensureSharedLink(accessToken, path, binding.namespace_id);

  await sb
    .schema("onboarding")
    .from("dropbox_folder_binding")
    .update({ shared_link_url: shared.url })
    .eq("onboarding_client_id", onboardingClientId);

  await sb
    .schema("onboarding")
    .from("onboarding_link")
    .upsert(
      {
        onboarding_client_id: onboardingClientId,
        system_code: "dropbox_creative_folder",
        external_url: shared.url,
      },
      { onConflict: "onboarding_client_id,system_code" }
    );

  return jsonResponse({ status: "ok", shared_link_url: shared.url });
}

async function writeBinding(
  sb: Sb,
  args: {
    onboardingClientId: number;
    folderId: string;
    folderPath: string;
    folderDisplayPath: string;
    namespaceId: string | null;
    sharedLinkUrl: string;
    linkSource: "linked" | "created";
    linkedByUserId: string;
    linkedByEmail: string | null;
  }
): Promise<void> {
  const { error } = await sb
    .schema("onboarding")
    .from("dropbox_folder_binding")
    .upsert(
      {
        onboarding_client_id: args.onboardingClientId,
        folder_id: args.folderId,
        folder_path: args.folderPath,
        folder_display_path: args.folderDisplayPath,
        namespace_id: args.namespaceId,
        shared_link_url: args.sharedLinkUrl,
        link_source: args.linkSource,
        linked_by_user_id: args.linkedByUserId,
        linked_by_email: args.linkedByEmail,
        linked_at: new Date().toISOString(),
      },
      { onConflict: "onboarding_client_id" }
    );
  if (error) throw new Error(`binding upsert failed: ${error.message}`);

  const { error: linkError } = await sb
    .schema("onboarding")
    .from("onboarding_link")
    .upsert(
      {
        onboarding_client_id: args.onboardingClientId,
        system_code: "dropbox_creative_folder",
        external_id: args.folderId,
        external_url: args.sharedLinkUrl,
        metadata_json: {
          folder_display_path: args.folderDisplayPath,
          link_source: args.linkSource,
          namespace_id: args.namespaceId,
        },
      },
      { onConflict: "onboarding_client_id,system_code" }
    );
  if (linkError) throw new Error(`onboarding_link upsert failed: ${linkError.message}`);
}

async function loadClientSummary(sb: Sb, id: number): Promise<{ id: number; display_name: string }> {
  const { data, error } = await sb
    .schema("onboarding")
    .from("onboarding_client")
    .select("id, display_name")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`onboarding_client lookup failed: ${error.message}`);
  if (!data) throw new Error(`Onboarding client ${id} not found`);
  return data as { id: number; display_name: string };
}

function defaultFolderNameFor(client: { id: number; display_name: string }): string {
  const base = (client.display_name || "").trim();
  return base || `Community ${client.id}`;
}

function normalizeFolderPath(raw: string): string {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "";
  if (trimmed === "/") return "/";
  const prefixed = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return prefixed.replace(/\/+$/, "") || "/";
}
