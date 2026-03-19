# P11 Onboarding Frontend

This folder contains the operational frontend wiring for the existing HTML prototype:

- `../p11-onboarding-dashboard.html` (main UI)
- `src/config.js` (Supabase config)
- `src/supabase.js` (Supabase client)
- `src/api.js` (RPC wrappers)
- `src/main.js` (UI behavior + data mapping + submit/load flow)

## Run locally

From `/Users/jasjitgill/Desktop/onboard`:

```bash
python3 -m http.server 8080
```

Open:

- `http://localhost:8080/p11-onboarding-dashboard.html`

## Notes

- The portal is now login-required.
- Users must sign up or log in with Supabase Auth before the dashboard becomes available.
- Signup includes company search against the data lake and fuzzy matching for near matches.
- Company membership is completed via authenticated RPCs and linked through `portal_user_company_access`.
- Intake submission uses authenticated RPCs, not the old public token flow.
