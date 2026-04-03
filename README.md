# P11 Onboarding Portal

Multi-page onboarding portal for P11creative clients and internal teams.

## App Surfaces

- `index.html` - workspace home
- `client-home.html` - client community switcher + entrypoint
- `p11-onboarding-dashboard.html` - intake workflow (Step 2)
- `p11-onboarding-account-access.html` - platform access workflow (Step 3)
- `internal.html` - internal operations portal
- `internal-signup.html` - invite-only internal signup
- `p11-onboarding-automation-flow.html` - onboarding automation reference
- `p11-onboarding-project-brief.html` - project brief and implementation notes

## Local Setup

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Required Config

Provide Supabase config via one of these:

1. Runtime script:

```html
<script>
  window.__P11_CONFIG__ = {
    supabaseUrl: "https://YOUR_PROJECT.supabase.co",
    supabaseAnonKey: "YOUR_ANON_KEY",
    brandAssetBucket: "onboarding-brand-assets"
  };
</script>
```

2. Vite env vars:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- Optional: `VITE_BRAND_ASSET_BUCKET`

## Validation

```bash
npm run test
npm run build
```

## Database

- Schema + RPC implementation: `p11_onboarding_implementation.sql`
- Includes onboarding ingest normalization, dashboard/internal RPCs, and sync queue processing helpers.

