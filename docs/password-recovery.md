# Password recovery and Account Security

## Implementation and main files

The existing Supabase SSR client, HTTP-only session cookies, login/signup/Google OAuth, and protected layout remain in use. No migration or new dependency is needed. Main files:

- `src/lib/auth/password-validation.ts`: shared Zod schemas and OTP input helpers.
- `src/lib/auth/password-service.ts`: provider operations and server-verified authorization checks, tested with mocked Supabase Auth.
- `src/lib/auth/recovery-{security,context,actions,link}.ts`: signed authorization, request guards, cookie integration, Server Actions, and fixed callback redirects.
- `src/components/auth/{auth-shell,password-fields,password-forms,reset-code-input}.tsx`: shared auth layout, visibility/strength UI, forms, OTP slots, and success state.
- `src/app/(recovery)`: public recovery screens, reset authorization gate, and completion screen.
- `src/app/auth/recovery/route.ts`: recovery callback. Existing `/auth/confirm` also accepts verified recovery hashes without changing signup verification.
- `src/app/(protected)/settings/security/page.tsx`: authenticated account security.
- Existing login, account menu and sidebar expose the new routes. `next.config.mjs` adds recovery/security headers.

Recovery uses `resetPasswordForEmail`, `verifyOtp` with **type `recovery`**, `exchangeCodeForSession` for default PKCE email links, and `updateUser({ password })`. Signup confirmation retains its original `email` type. Supabase alone generates, stores, expires and consumes recovery credentials.

After provider verification, TeamOS signs a short-lived HTTP-only authorization cookie bound to the verified user ID, JWT session ID, and provider user version (`updated_at`). These are checked again immediately before a password update. An ordinary session alone, edited cookie, expired cookie, different user/session, or stale version cannot authorize recovery. The 15-minute application authorization window is additional to provider expiry. This is not an alternate OTP or public token database.

A successful reset signs out the recovery session locally, clears only this project's auth/recovery cookies, and redirects to a completion page requiring fresh login. Existing signed-in browser accounts are never silently replaced: sign out before verifying recovery or use Account Security. Requesting an email does not sign anyone out.

## Environment and local start

1. Preserve the existing Supabase values. Set `TEAMOS_SITE_URL=http://localhost:3000` locally, or the exact deployed HTTPS origin.
2. Configure server-only `TEAMOS_RECOVERY_SECRET` with at least 32 random characters, shared by all instances in a deployment. Generate with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and store privately. Never prefix with `NEXT_PUBLIC_` or commit it. A local value was generated privately during implementation. Rotating it invalidates outstanding application authorization/request cookies, not accounts.
3. Run `pnpm install`, then `pnpm dev`. Restart after environment changes.
4. Open `/forgot-password`. Use the same hostname throughout: localhost and 127.0.0.1 have different cookies.

## Required Supabase configuration

1. **Authentication → URL Configuration**: set Site URL and allow exact callbacks `http://localhost:3000/auth/recovery` and `https://YOUR-APP-HOST/auth/recovery`. Preserve existing Google/signup callbacks. Avoid broad production wildcards. TeamOS builds the callback from the server environment, never user-supplied redirects.
2. **Authentication → Sign In / Providers → Email**: review the actual password policy. TeamOS validates 8–256 characters and matching confirmation without arbitrary character-class restrictions; Supabase enforces stronger configured policies/leaked-password checks. The public SDK cannot read the full hosted policy. Its current settings were not verified or changed; align the UI minimum with your provider, preferably 8 or more.
3. Configure **six-digit email OTPs** for this UI and an appropriate provider expiry, such as 15 minutes. Review impact on signup/invitation/email-change credentials because expiry settings may be shared. Do not truncate longer codes: if configured for 8+ digits, intentionally adapt the provider setting or input/schema before rollout. Supabase enforces actual expiry; the resend countdown is informational.
4. **Authentication → Emails → Reset password / Password recovery**: subject **Reset your TeamOS password**. If editable, paste `supabase/templates/recovery.html`. It uses `{{ .Token }}` for the OTP and `{{ .TokenHash }}` for server verification. App-supplied `{{ .RedirectTo }}` selects the localhost or deployment callback, with Site URL as fallback.
5. If the dashboard says **Set up custom SMTP to edit templates**, customization is unavailable until SMTP is configured. Do not assume every plan/provider permits editing. Keep the default email meanwhile: its PKCE reset link works in the **same browser that requested it**. Default email may omit the numeric code; OTP delivery requires the template to contain `{{ .Token }}`. Custom token-hash links can work across devices.
6. **Authentication → Emails → SMTP Settings**: enter your provider's verified sender address, sender name `TeamOS`, SMTP host, supported TLS port (usually 465 or 587 as specified by the provider), username, and SMTP password/API credential. Obtain real values from the provider; no credentials or domain are invented by TeamOS. A sending domain may require verification. SMTP credentials belong in Supabase, not frontend environment variables.
7. Enable provider-managed password-changed security email notifications if supported and SMTP is ready. No parallel email sender is implemented.
8. Keep provider rate limits enabled. Add trusted ingress/WAF rate limits before public launch. Ingress must overwrite forwarded IP headers. TeamOS's bounded hashed-IP/hashed-email guard is **per-process**; multiple instances/restarts do not share it. Supabase remains the shared rate limiter.

The current project's SMTP/template-editing permission and real delivery were **not verified**. Preparing local HTML does not mean it was saved in the hosted dashboard. Official sources: [email templates](https://supabase.com/docs/guides/auth/auth-email-templates), [SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [password authentication](https://supabase.com/docs/guides/auth/passwords), [password security](https://supabase.com/docs/guides/auth/password-security), and [rate limits](https://supabase.com/docs/guides/auth/rate-limits).

## Settings password change

`/settings/security` verifies the user on the server. A separate, non-persisting Supabase client checks the current password using `signInWithPassword` and verifies its returned user ID. It cannot overwrite browser cookies. The existing authenticated client then calls `updateUser({ password, current_password })`, supported by the installed SDK. Independent verification remains effective even if optional provider current-password enforcement is off. Only the temporary verification session is signed out.

If secure password change requires an email nonce for an older session, the app calls `reauthenticate()` and shows a security-code field. Retry includes the nonce. Google-only users receive guidance to establish a password through recovery first; identity metadata is advisory, so users who already set a password can still enter it. Google OAuth remains available.

## Privacy and operations

Valid email requests always return the same generic message, including unknown addresses, provider send limits, service failures and network errors. Raw provider errors never escape. Per-address diagnostics are intentionally withheld to prevent enumeration; UI explains spam checks/retry/contacting an administrator. Inspect provider logs privately for delivery failures. Invalid format and local IP-wide throttling use fixed errors. Upstream network timing is not guaranteed constant.

No codes/passwords are logged by application code, kept in localStorage, or stored in public tables. Next development Server Function argument logging is disabled, and auth/recovery callback request logs are excluded to avoid leaking URL credentials. Recovery/security pages use no-referrer/no-store, noindex, frame-denial and content-type protection. Exclude them from analytics and configure platform/proxy access logs to redact `token_hash`, `code`, `sb_flow_id`, and request bodies. Link scanners may consume one-use links; codes provide an alternative. Callback redirects are fixed; default PKCE also requires signed request/verifier binding, matching verified email, and the installed SDK's recovery redirect classification. No privileged/admin password API is used.

## Verification and safe live test

Run `node --experimental-strip-types --import ./tests/register.mjs --test tests/password-recovery.test.mjs`, `pnpm test`, `pnpm lint`, `pnpm typecheck`, and `pnpm build`. Tests mock provider authentication and do not change real passwords. They cover validation, generic responses, rate guards, OTP/hash/PKCE verification, replay/expiry rejection, user/session/version binding, failures, current-password checks, and reauthentication.

After configuring mail, use a **disposable development account**:

1. Sign out, request recovery, check pending/cooldown behavior and the generic response for an unknown test email.
2. Receive and verify a real code; test paste/backspace/arrows, wrong/expired/used codes, and matching new passwords.
3. Sign in with the new password and confirm the old password fails.
4. Request another email and test its link, expiry, replay, changed `next`, same-browser PKCE and cross-device token-hash recovery.
5. Test Settings → Account → Security with incorrect/correct current passwords, mismatch validation, provider nonce and notification behavior.
6. Check Google guidance, unauthenticated Settings redirect, unauthorized reset denial, screen readers, keyboard navigation and mobile layout.

Real mail delivery, real password mutation, and rejection of a real old password are separate rollout checks. They are not claimed by mocked tests/screenshots. No real user account was used for destructive credential testing.


## Recorded implementation checks

- `pnpm lint`: passed without warnings.
- `pnpm typecheck`: passed; the final production build also completed its TypeScript pass.
- `pnpm test`: 96 tests total, 95 passed, 0 failed, 1 optional live Realtime test skipped. This includes 19 password-recovery/security tests and an installed-SDK PKCE exchange with mocked network responses.
- `pnpm build`: passed; temporary UI preview removed and absent from the route manifest.
- Browser: login-to-forgot navigation, invalid email HTML validation, mobile six-slot fit, full-code paste, arrow/backspace behavior, password visibility/masking using empty fields, reset access denial, and unauthenticated Settings redirect were checked. A temporary form-only preview was removed afterwards. No real credentials were entered or changed.
- HTTP: login contains Forgot Password; Settings redirects signed-out requests to login; direct reset lacks authorization; recovery callbacks ignore external redirect values and return no-referrer/no-store headers.
- Provider delivery, actual OTP settings, SMTP/template permissions, real reset/change and old-password rejection remain unverified pending the manual configuration/disposable-account checklist above.
