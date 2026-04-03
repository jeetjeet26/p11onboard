const runtimeConfig = window.__P11_CONFIG__ || {};
const envConfig = (typeof import.meta !== "undefined" && import.meta.env) || {};

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

export const SUPABASE_URL = firstDefined(
  runtimeConfig.supabaseUrl,
  envConfig.VITE_SUPABASE_URL
);
export const SUPABASE_ANON_KEY = firstDefined(
  runtimeConfig.supabaseAnonKey,
  envConfig.VITE_SUPABASE_ANON_KEY
);
export const BRAND_ASSET_BUCKET = firstDefined(
  runtimeConfig.brandAssetBucket,
  envConfig.VITE_BRAND_ASSET_BUCKET,
  "onboarding-brand-assets"
);

export const STORAGE_KEYS = {
  onboardingClientId: "p11_onboarding_client_id",
  publicToken: "p11_onboarding_public_token",
};
