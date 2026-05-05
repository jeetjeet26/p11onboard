# P11 Onboarding Frontend

This folder contains the operational frontend wiring for the multi-page onboarding portal:

- `../p11-onboarding-dashboard.html` (main UI)
- `../client-home.html` (client community switcher and entry point)
- `../p11-onboarding-account-access.html` (Step 3 platform access workflow)
- `../internal.html` (internal operations overview)
- `../internal-client-editor.html` (internal client and Dropbox editor)
- `../internal-company.html` (company directory manager)
- `../internal-signup.html` (invite-only internal signup)
- `src/config.js` (Supabase config)
- `src/supabase.js` (Supabase client)
- `src/api.js` (RPC wrappers)
- `src/stages.js` (canonical seven-stage tracker labels and display rules)
- `src/navigation.js` (shared role-aware navigation and notices)
- `src/styles/shared.css` (shared tokens, focus states, notices, and cross-page helpers)
- `src/main.js` (dashboard UI behavior + data mapping + submit/load flow)

## Run locally

From the repository root:

```bash
npm install
npm run dev
```

Open:

- `http://localhost:3000/p11-onboarding-dashboard.html`
- `http://localhost:3000/client-home.html`
- `http://localhost:3000/internal.html`

## Build + test

```bash
npm run test
npm run build
```

## Notes

- The portal is now login-required.
- Users must sign up or log in with Supabase Auth before the dashboard becomes available.
- Signup includes company search against the data lake and fuzzy matching for near matches.
- Company membership is completed via authenticated RPCs and linked through `portal_user_company_access`.
- Intake submission uses authenticated RPCs, not the old public token flow.
- Step labels and tracker logic should come from `src/stages.js`; do not duplicate stage arrays in page modules.
- Internal-only static pages use `src/internal-static-guard.js` and explain redirects through shared portal notices.
- Dropbox uploads use the community binding when available; otherwise the dashboard copy tells clients that portal storage is used until the folder is linked.
- Supabase config must be provided via `window.__P11_CONFIG__` or Vite env vars:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
  - Optional: `VITE_BRAND_ASSET_BUCKET` (defaults to `onboarding-brand-assets`)
