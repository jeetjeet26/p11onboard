import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config.js";

if (!window.supabase || !window.supabase.createClient) {
  throw new Error(
    "Supabase client library is not loaded. Ensure the CDN script is included."
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
