import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export function getEnv(name: string, required = true): string {
  const value = Deno.env.get(name) ?? "";
  if (required && !value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export function createServiceRoleClient(): SupabaseClient {
  const url = getEnv("SUPABASE_URL");
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createUserClient(authorizationHeader: string): SupabaseClient {
  const url = getEnv("SUPABASE_URL");
  const anonKey = getEnv("SUPABASE_ANON_KEY");
  return createClient(url, anonKey, {
    global: { headers: { Authorization: authorizationHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface AuthenticatedUser {
  id: string;
  email: string | null;
  user: Record<string, unknown>;
}

export async function requireAuthenticatedUser(
  req: Request
): Promise<{ user: AuthenticatedUser; userClient: SupabaseClient; authHeader: string }> {
  const authHeader = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    throw new AuthError(401, "Missing Authorization header");
  }
  const userClient = createUserClient(authHeader);
  const { data, error } = await userClient.auth.getUser();
  if (error || !data?.user) {
    throw new AuthError(401, "Invalid session");
  }
  return {
    user: {
      id: data.user.id,
      email: data.user.email ?? null,
      user: data.user as unknown as Record<string, unknown>,
    },
    userClient,
    authHeader,
  };
}

export async function requireInternalUser(req: Request): Promise<{
  user: AuthenticatedUser;
  userClient: SupabaseClient;
  authHeader: string;
}> {
  const result = await requireAuthenticatedUser(req);
  const { data, error } = await result.userClient.rpc("get_internal_portal_context");
  if (error) {
    throw new AuthError(403, `Internal check failed: ${error.message}`);
  }
  if (!data) {
    throw new AuthError(403, "Internal access required");
  }
  return result;
}

export async function assertCanAccessClient(
  userClient: SupabaseClient,
  onboardingClientId: number
): Promise<{ isInternal: boolean }> {
  const { data, error } = await userClient.rpc("can_access_onboarding_client", {
    p_onboarding_client_id: onboardingClientId,
  });
  if (error) {
    throw new AuthError(403, `Access check failed: ${error.message}`);
  }
  const payload = (data ?? {}) as Record<string, unknown>;
  if (!payload.authenticated) {
    throw new AuthError(401, "Authentication required");
  }
  if (!payload.can_access) {
    throw new AuthError(403, "You do not have access to this community");
  }
  return { isInternal: Boolean(payload.is_internal) };
}

export class AuthError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
