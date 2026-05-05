import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { corsHeaders, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { createServiceRoleClient, getEnv, requireInternalUser } from "../_shared/auth.ts";
import {
  DROPBOX_AUTHORIZE_URL,
  DROPBOX_SCOPES,
  exchangeCodeForTokens,
  fetchCurrentAccount,
  getAppCredentials,
  upsertIntegration,
} from "../_shared/dropbox.ts";
import { createNonce, signState, verifyState } from "../_shared/state.ts";

// Edge Function that drives the Dropbox OAuth flow.
//
// Routes (relative to /dropbox-oauth):
//   POST /start           -> internal-only; returns a signed authorize URL
//   GET  /callback        -> Dropbox redirect target; exchanges code, stores
//                            tokens + team context, then redirects back to the
//                            portal UI.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/+dropbox-oauth\/?/, "").replace(/\/+$/, "");

  try {
    if (route === "start") {
      return await handleStart(req);
    }
    if (route === "callback") {
      return await handleCallback(req);
    }
    return errorResponse(404, `Unknown route: ${route}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    // deno-lint-ignore no-explicit-any
    const status = (error as any)?.status ?? 500;
    console.error("dropbox-oauth error", { route, message });
    return errorResponse(status, message);
  }
});

async function handleStart(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return errorResponse(405, "Method not allowed");
  }
  const { user } = await requireInternalUser(req);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch (_error) {
    body = {};
  }
  const returnTo = typeof body.returnTo === "string" ? body.returnTo : undefined;

  const { appKey, redirectUri } = getAppCredentials();
  const state = await signState({
    userId: user.id,
    issuedAt: Date.now(),
    returnTo,
    nonce: createNonce(),
  });

  const authorizeUrl = new URL(DROPBOX_AUTHORIZE_URL);
  authorizeUrl.searchParams.set("client_id", appKey);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("token_access_type", "offline");
  authorizeUrl.searchParams.set("scope", DROPBOX_SCOPES);
  authorizeUrl.searchParams.set("state", state);

  return jsonResponse({
    authorize_url: authorizeUrl.toString(),
    redirect_uri: redirectUri,
  });
}

async function handleCallback(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const errorCode = params.get("error");
  const stateToken = params.get("state") || "";
  const code = params.get("code") || "";

  const fallbackRedirect = getEnv("DROPBOX_POST_AUTH_REDIRECT", false) ||
    "/internal-client-editor.html";

  let returnTo = fallbackRedirect;

  try {
    const state = await verifyState(stateToken);
    if (state.returnTo) {
      returnTo = state.returnTo;
    }

    if (errorCode) {
      return redirectWithStatus(returnTo, {
        dropbox_status: "error",
        dropbox_error: params.get("error_description") || errorCode,
      });
    }
    if (!code) {
      return redirectWithStatus(returnTo, {
        dropbox_status: "error",
        dropbox_error: "Missing authorization code",
      });
    }

    const { redirectUri } = getAppCredentials();
    const tokenPayload = await exchangeCodeForTokens(code, redirectUri);

    const refreshToken = String(tokenPayload.refresh_token || "");
    const accessToken = String(tokenPayload.access_token || "");
    const expiresIn = Number(tokenPayload.expires_in || 14400);
    const scope = String(tokenPayload.scope || DROPBOX_SCOPES);
    const accountId = String(tokenPayload.account_id || "");
    const teamId = tokenPayload.team_id ? String(tokenPayload.team_id) : null;

    if (!refreshToken) {
      return redirectWithStatus(returnTo, {
        dropbox_status: "error",
        dropbox_error: "Dropbox did not return a refresh token. Ensure token_access_type=offline and reconnect.",
      });
    }

    const account = await fetchCurrentAccount(accessToken);
    const rootInfo = (account.root_info || {}) as Record<string, unknown>;
    const teamInfo = (account.team || {}) as Record<string, unknown>;
    const nameInfo = (account.name || {}) as Record<string, unknown>;

    const sb = createServiceRoleClient();
    const expiresAt = new Date(Date.now() + Math.max(60, expiresIn - 30) * 1000).toISOString();

    await upsertIntegration(sb, {
      id: 1,
      is_active: true,
      app_key: getEnv("DROPBOX_APP_KEY"),
      team_id: (teamInfo.id as string) || teamId,
      team_name: (teamInfo.name as string) || null,
      team_member_id: (account.team_member_id as string) || null,
      account_id: accountId || null,
      account_email: (account.email as string) || null,
      account_display_name: (nameInfo.display_name as string) || null,
      team_root_namespace_id: (rootInfo.root_namespace_id as string) || null,
      home_namespace_id: (rootInfo.home_namespace_id as string) || null,
      refresh_token: refreshToken,
      access_token: accessToken,
      access_token_expires_at: expiresAt,
      scope,
      connected_by_user_id: state.userId,
      connected_by_email: null,
      connected_at: new Date().toISOString(),
      last_error: null,
      last_synced_at: new Date().toISOString(),
    });

    return redirectWithStatus(returnTo, {
      dropbox_status: "connected",
      dropbox_account: (account.email as string) || "",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return redirectWithStatus(returnTo, {
      dropbox_status: "error",
      dropbox_error: message,
    });
  }
}

function redirectWithStatus(baseUrl: string, params: Record<string, string>): Response {
  let target: URL;
  try {
    target = new URL(baseUrl);
  } catch (_error) {
    const origin = getEnv("DROPBOX_POST_AUTH_ORIGIN", false) || "";
    target = new URL(baseUrl, origin || "https://example.invalid");
  }
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      target.searchParams.set(key, value);
    }
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: target.toString(),
      "Cache-Control": "no-store",
    },
  });
}
