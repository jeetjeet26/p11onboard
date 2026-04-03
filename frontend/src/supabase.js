import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config.js";

if (!window.supabase || !window.supabase.createClient) {
  throw new Error(
    "Supabase client library is not loaded. Ensure the CDN script is included."
  );
}

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    "Missing Supabase configuration. Set window.__P11_CONFIG__.supabaseUrl and supabaseAnonKey, or configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY."
  );
}

export const supabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);

const ACCESS_COOKIE_KEY = "p11_access_token";

function writeAccessCookie(accessToken) {
  if (!accessToken) {
    document.cookie = `${ACCESS_COOKIE_KEY}=; Path=/; Max-Age=0; SameSite=Lax`;
    return;
  }
  document.cookie =
    `${ACCESS_COOKIE_KEY}=${encodeURIComponent(accessToken)}; ` +
    "Path=/; Max-Age=604800; SameSite=Lax";
}

async function syncAccessCookieFromSession() {
  try {
    const { data } = await supabase.auth.getSession();
    writeAccessCookie(data?.session?.access_token || "");
  } catch (_error) {
    writeAccessCookie("");
  }
}

supabase.auth.onAuthStateChange((_event, session) => {
  writeAccessCookie(session?.access_token || "");
});

syncAccessCookieFromSession();
