const DEFAULT_SUPABASE_URL = "https://qkkevxnbmaamtdtgtkmb.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFra2V2eG5ibWFhbXRkdGd0a21iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIyMDUwNjEsImV4cCI6MjA3Nzc4MTA2MX0.KI_HVkmcOtlFNOtJNYdOTkzOOJPE73FBvSWWZKcW9W8";

const runtimeConfig = window.__P11_CONFIG__ || {};

export const SUPABASE_URL = runtimeConfig.supabaseUrl || DEFAULT_SUPABASE_URL;
export const SUPABASE_ANON_KEY =
  runtimeConfig.supabaseAnonKey || DEFAULT_SUPABASE_ANON_KEY;

export const STORAGE_KEYS = {
  onboardingClientId: "p11_onboarding_client_id",
  publicToken: "p11_onboarding_public_token",
};
