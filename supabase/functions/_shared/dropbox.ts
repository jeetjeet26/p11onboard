import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getEnv } from "./auth.ts";

export const DROPBOX_AUTHORIZE_URL = "https://www.dropbox.com/oauth2/authorize";
export const DROPBOX_TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";
export const DROPBOX_API_BASE = "https://api.dropboxapi.com/2";
export const DROPBOX_CONTENT_BASE = "https://content.dropboxapi.com/2";

// Minimal scopes for shared business Dropbox connection. Team spaces are
// reachable via the path-root header when the admin authorizes with a Dropbox
// Business member account.
export const DROPBOX_SCOPES = [
  "account_info.read",
  "files.metadata.read",
  "files.metadata.write",
  "files.content.read",
  "files.content.write",
  "sharing.read",
  "sharing.write",
].join(" ");

export interface DropboxIntegrationRow {
  id: number;
  is_active: boolean;
  app_key: string | null;
  team_id: string | null;
  team_name: string | null;
  team_member_id: string | null;
  account_id: string | null;
  account_email: string | null;
  account_display_name: string | null;
  team_root_namespace_id: string | null;
  home_namespace_id: string | null;
  folder_root_path: string | null;
  folder_root_display_path: string | null;
  refresh_token: string | null;
  access_token: string | null;
  access_token_expires_at: string | null;
  scope: string | null;
  connected_by_user_id: string | null;
  connected_by_email: string | null;
  connected_at: string | null;
  last_error: string | null;
  last_synced_at: string | null;
  metadata_json: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export class DropboxError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown = null) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export function getAppCredentials(): { appKey: string; appSecret: string; redirectUri: string } {
  const appKey = getEnv("DROPBOX_APP_KEY");
  const appSecret = getEnv("DROPBOX_APP_SECRET");
  const redirectUri = getEnv("DROPBOX_REDIRECT_URI");
  return { appKey, appSecret, redirectUri };
}

export async function fetchIntegration(sb: SupabaseClient): Promise<DropboxIntegrationRow | null> {
  const { data, error } = await sb
    .schema("onboarding")
    .from("dropbox_integration")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw new DropboxError(500, `integration fetch failed: ${error.message}`);
  return (data as DropboxIntegrationRow | null) ?? null;
}

export async function upsertIntegration(
  sb: SupabaseClient,
  patch: Partial<DropboxIntegrationRow>
): Promise<DropboxIntegrationRow> {
  const payload: Record<string, unknown> = { id: 1, ...patch };
  const { data, error } = await sb
    .schema("onboarding")
    .from("dropbox_integration")
    .upsert(payload, { onConflict: "id" })
    .select("*")
    .single();
  if (error) throw new DropboxError(500, `integration upsert failed: ${error.message}`);
  return data as DropboxIntegrationRow;
}

export async function refreshAccessToken(
  sb: SupabaseClient,
  row: DropboxIntegrationRow
): Promise<string> {
  if (!row.refresh_token) {
    throw new DropboxError(412, "Dropbox is not connected. Complete the OAuth flow first.");
  }

  const nowMs = Date.now();
  const bufferMs = 60_000;
  if (
    row.access_token &&
    row.access_token_expires_at &&
    new Date(row.access_token_expires_at).getTime() - bufferMs > nowMs
  ) {
    return row.access_token;
  }

  const { appKey, appSecret } = getAppCredentials();
  const form = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: row.refresh_token,
    client_id: appKey,
    client_secret: appSecret,
  });

  const resp = await fetch(DROPBOX_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });

  const payload = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    await sb
      .schema("onboarding")
      .from("dropbox_integration")
      .update({ last_error: `refresh_token failed: ${JSON.stringify(payload)}` })
      .eq("id", 1);
    throw new DropboxError(resp.status, "Unable to refresh Dropbox token", payload);
  }

  const accessToken = String(payload.access_token || "");
  const expiresInSec = Number(payload.expires_in || 0);
  const expiresAt = new Date(Date.now() + Math.max(60, expiresInSec - 30) * 1000).toISOString();

  await sb
    .schema("onboarding")
    .from("dropbox_integration")
    .update({
      access_token: accessToken,
      access_token_expires_at: expiresAt,
      last_error: null,
      last_synced_at: new Date().toISOString(),
    })
    .eq("id", 1);

  return accessToken;
}

export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string
): Promise<Record<string, unknown>> {
  const { appKey, appSecret } = getAppCredentials();
  const form = new URLSearchParams({
    code,
    grant_type: "authorization_code",
    client_id: appKey,
    client_secret: appSecret,
    redirect_uri: redirectUri,
  });

  const resp = await fetch(DROPBOX_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });

  const payload = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new DropboxError(resp.status, "Dropbox token exchange failed", payload);
  }
  return payload as Record<string, unknown>;
}

export interface DropboxApiOptions {
  accessToken: string;
  endpoint: string;
  body?: unknown;
  pathRootNamespaceId?: string | null;
  method?: string;
}

export async function dropboxApiCall(opts: DropboxApiOptions): Promise<unknown> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${opts.accessToken}`,
    "Content-Type": "application/json",
  };
  if (opts.pathRootNamespaceId) {
    headers["Dropbox-API-Path-Root"] = JSON.stringify({
      ".tag": "namespace_id",
      namespace_id: String(opts.pathRootNamespaceId),
    });
  }

  const resp = await fetch(`${DROPBOX_API_BASE}${opts.endpoint}`, {
    method: opts.method || "POST",
    headers,
    body: opts.body === undefined ? "null" : JSON.stringify(opts.body),
  });

  const text = await resp.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (_error) {
    payload = { raw: text };
  }

  if (!resp.ok) {
    throw new DropboxError(resp.status, extractDropboxMessage(payload), payload);
  }
  return payload;
}

export interface DropboxContentOptions {
  accessToken: string;
  endpoint: string;
  apiArgs: unknown;
  body: ReadableStream<Uint8Array> | Uint8Array | Blob | ArrayBuffer;
  contentType?: string;
  pathRootNamespaceId?: string | null;
}

export async function dropboxContentCall(opts: DropboxContentOptions): Promise<unknown> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${opts.accessToken}`,
    "Content-Type": opts.contentType || "application/octet-stream",
    "Dropbox-API-Arg": safeDropboxArg(opts.apiArgs),
  };
  if (opts.pathRootNamespaceId) {
    headers["Dropbox-API-Path-Root"] = JSON.stringify({
      ".tag": "namespace_id",
      namespace_id: String(opts.pathRootNamespaceId),
    });
  }

  const resp = await fetch(`${DROPBOX_CONTENT_BASE}${opts.endpoint}`, {
    method: "POST",
    headers,
    body: opts.body as BodyInit,
  });

  const text = await resp.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (_error) {
    payload = { raw: text };
  }

  if (!resp.ok) {
    throw new DropboxError(resp.status, extractDropboxMessage(payload), payload);
  }
  return payload;
}

function extractDropboxMessage(payload: unknown): string {
  if (!payload) return "Dropbox API error";
  if (typeof payload === "string") return payload;
  const p = payload as Record<string, unknown>;
  if (typeof p.error_summary === "string") return p.error_summary;
  if (typeof p.error_description === "string") return p.error_description;
  if (typeof p.error === "string") return p.error;
  return "Dropbox API error";
}

// Dropbox only accepts ASCII in the Dropbox-API-Arg header. Any non-ASCII
// character (for example, an accented community name) must be escaped.
function safeDropboxArg(value: unknown): string {
  const raw = JSON.stringify(value ?? null);
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code <= 0x7f) {
      out += raw[i];
    } else {
      out += "\\u" + code.toString(16).padStart(4, "0");
    }
  }
  return out;
}

export function joinDropboxPath(base: string | null, segment: string): string {
  const cleanedBase = (base || "").replace(/\/+$/, "");
  const cleanedSegment = segment.replace(/^\/+/, "").replace(/\/+$/, "");
  const combined = [cleanedBase, cleanedSegment].filter(Boolean).join("/");
  if (!combined) return "";
  return combined.startsWith("/") ? combined : `/${combined}`;
}

export function sanitizeFolderName(raw: string): string {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "";
  // Dropbox disallows: / \\ < > : " | ? * and control characters
  const cleaned = trimmed
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/[\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, 200);
}

export function sanitizeFileName(raw: string): string {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "";
  const cleaned = trimmed
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/[\u0000-\u001f]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, 220);
}

export async function fetchCurrentAccount(accessToken: string): Promise<Record<string, unknown>> {
  return (await dropboxApiCall({
    accessToken,
    endpoint: "/users/get_current_account",
  })) as Record<string, unknown>;
}

export interface EnsureSharedLinkResult {
  url: string;
  isExisting: boolean;
}

export async function ensureSharedLink(
  accessToken: string,
  path: string,
  pathRootNamespaceId: string | null
): Promise<EnsureSharedLinkResult> {
  try {
    const created = (await dropboxApiCall({
      accessToken,
      endpoint: "/sharing/create_shared_link_with_settings",
      body: {
        path,
        settings: { access: "viewer", allow_download: true },
      },
      pathRootNamespaceId,
    })) as Record<string, unknown>;
    return { url: String(created.url || ""), isExisting: false };
  } catch (error) {
    if (error instanceof DropboxError && error.status === 409) {
      const listed = (await dropboxApiCall({
        accessToken,
        endpoint: "/sharing/list_shared_links",
        body: { path, direct_only: true },
        pathRootNamespaceId,
      })) as { links?: Array<Record<string, unknown>> };
      const link = (listed.links || [])[0];
      if (link && typeof link.url === "string") {
        return { url: String(link.url), isExisting: true };
      }
    }
    throw error;
  }
}
