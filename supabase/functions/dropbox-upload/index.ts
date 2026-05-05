import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { corsHeaders, errorResponse, jsonResponse } from "../_shared/cors.ts";
import {
  assertCanAccessClient,
  createServiceRoleClient,
  requireAuthenticatedUser,
} from "../_shared/auth.ts";
import {
  dropboxContentCall,
  DropboxError,
  ensureSharedLink,
  fetchIntegration,
  joinDropboxPath,
  refreshAccessToken,
  sanitizeFileName,
} from "../_shared/dropbox.ts";

// Authenticated upload endpoint. Clients and internal users with access to a
// community can POST file data here and have it streamed into the community's
// bound Dropbox folder.
//
//   POST /dropbox-upload
//   multipart/form-data:
//     - onboarding_client_id: number (required)
//     - file: File (required)
//     - subpath: string (optional; relative folder under the bound folder)
//
// Response: { status, file: { name, path_display, path_lower, size, ... } }

// ~145 MB in bytes. Dropbox /files/upload single-request limit is 150 MB.
const MAX_SINGLE_UPLOAD_BYTES = 145 * 1024 * 1024;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return errorResponse(405, "Method not allowed");
  }

  try {
    const { user, userClient } = await requireAuthenticatedUser(req);

    const contentType = req.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("multipart/form-data")) {
      return errorResponse(400, "Expected multipart/form-data");
    }

    const form = await req.formData();
    const onboardingClientId = Number(form.get("onboarding_client_id") || 0);
    if (!onboardingClientId) {
      return errorResponse(400, "onboarding_client_id is required");
    }

    await assertCanAccessClient(userClient, onboardingClientId);

    const file = form.get("file");
    if (!(file instanceof File)) {
      return errorResponse(400, "file is required");
    }
    if (file.size <= 0) {
      return errorResponse(400, "File is empty");
    }
    if (file.size > MAX_SINGLE_UPLOAD_BYTES) {
      return errorResponse(
        413,
        `File exceeds ${MAX_SINGLE_UPLOAD_BYTES} byte upload limit. Use the Dropbox folder directly for files larger than 145MB.`
      );
    }

    const subpath = typeof form.get("subpath") === "string" ? String(form.get("subpath")) : "";

    const sb = createServiceRoleClient();
    const [{ data: binding, error: bindingError }, integration] = await Promise.all([
      sb
        .schema("onboarding")
        .from("dropbox_folder_binding")
        .select("*")
        .eq("onboarding_client_id", onboardingClientId)
        .maybeSingle(),
      fetchIntegration(sb),
    ]);

    if (bindingError) return errorResponse(500, bindingError.message);
    if (!binding) {
      return errorResponse(409, "No Dropbox folder is linked for this community yet");
    }
    if (!integration) return errorResponse(412, "Dropbox integration not configured");

    const accessToken = await refreshAccessToken(sb, integration);
    const namespaceId = binding.namespace_id || null;

    const safeName = sanitizeFileName(file.name) || `upload-${Date.now()}`;
    const basePath = binding.folder_display_path || binding.folder_path;
    const targetFolder = subpath
      ? joinDropboxPath(basePath, sanitizeSubpath(subpath))
      : basePath;
    const dropboxPath = joinDropboxPath(targetFolder, `${Date.now()}-${safeName}`);

    let uploadResult: Record<string, unknown>;
    try {
      uploadResult = (await dropboxContentCall({
        accessToken,
        endpoint: "/files/upload",
        apiArgs: {
          path: dropboxPath,
          mode: "add",
          autorename: true,
          mute: true,
          strict_conflict: false,
        },
        body: await file.arrayBuffer(),
        pathRootNamespaceId: namespaceId,
      })) as Record<string, unknown>;
    } catch (error) {
      if (error instanceof DropboxError) {
        return errorResponse(error.status === 401 ? 502 : error.status, error.message, error.body);
      }
      throw error;
    }

    const finalPath = String(uploadResult.path_display || dropboxPath);

    let sharedLinkUrl: string | null = binding.shared_link_url || null;
    if (!sharedLinkUrl) {
      try {
        const shared = await ensureSharedLink(accessToken, basePath, namespaceId);
        sharedLinkUrl = shared.url;
        await sb
          .schema("onboarding")
          .from("dropbox_folder_binding")
          .update({ shared_link_url: shared.url })
          .eq("onboarding_client_id", onboardingClientId);
      } catch (_error) {
        // Non-fatal; upload still succeeded.
      }
    }

    await sb
      .schema("onboarding")
      .from("dropbox_folder_binding")
      .update({ last_upload_at: new Date().toISOString() })
      .eq("onboarding_client_id", onboardingClientId);

    return jsonResponse({
      status: "ok",
      file: {
        name: safeName,
        size: file.size,
        content_hash: uploadResult.content_hash ?? null,
        path_display: finalPath,
        path_lower: uploadResult.path_lower ?? null,
        id: uploadResult.id ?? null,
      },
      folder: {
        shared_link_url: sharedLinkUrl,
        folder_display_path: basePath,
      },
      uploaded_by: { id: user.id, email: user.email },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    // deno-lint-ignore no-explicit-any
    const status = (error as any)?.status ?? 500;
    const details = error instanceof DropboxError ? error.body : null;
    console.error("dropbox-upload error", { message, status });
    return errorResponse(status, message, details);
  }
});

function sanitizeSubpath(raw: string): string {
  return raw
    .split("/")
    .map((segment) => segment.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("/");
}
