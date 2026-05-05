const configuredOrigin =
  Deno.env.get("P11_ALLOWED_ORIGIN") ||
  Deno.env.get("ALLOWED_ORIGIN") ||
  "*";

export const corsHeaders = {
  "Access-Control-Allow-Origin": configuredOrigin,
  Vary: "Origin",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-onboarding-client-id, x-file-name, x-file-size",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS, PUT, DELETE",
  "Access-Control-Max-Age": "86400",
};

export function corsResponse(init: ResponseInit = {}): Response {
  return new Response(null, {
    ...init,
    headers: { ...corsHeaders, ...(init.headers || {}) },
  });
}

export function jsonResponse(
  body: unknown,
  init: ResponseInit = {}
): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
      ...(init.headers || {}),
    },
  });
}

export function errorResponse(
  status: number,
  message: string,
  details?: unknown
): Response {
  return jsonResponse(
    { error: message, details: details ?? null },
    { status }
  );
}
