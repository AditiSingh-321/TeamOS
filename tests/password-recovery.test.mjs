import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { newPasswordSchema, recoveryEmailSchema, resetCodeSchema, codeDigits, codeFocus } from "../src/lib/auth/password-validation.ts";
import { signTicket, readTicket, RecoveryLimiter, emailDigest, verifierDigest } from "../src/lib/auth/recovery-security.ts";
import { requestRecovery, RECOVERY_MESSAGE, INVALID_RECOVERY, verifyRecovery, hasRecovery, resetRecoveredPassword, changeAuthenticatedPassword } from "../src/lib/auth/password-service.ts";
const strong = { password: "a long unique test passphrase!", confirm: "a long unique test passphrase!" };
const secret = "test-only-secret-with-at-least-32-characters";
function mockAuth({ logged = false, verifyError, updateError, requestError, currentError, provider = "email", claimSid = "session-1" } = {}) {
  let active = logged, used = false, version = "2026-11-19T01:00:00Z";
  const calls = { verify: [], update: [], recover: [], signout: [], login: [], reauth: 0 };
  const user = () => ({ id: "user-1", email: "person@example.com", updated_at: version, identities: [{ provider }] });
  const session = () => ({ access_token: "fake-test-token", refresh_token: "fake-test-refresh" });
  const auth = {
    getUser: async () => ({ data: { user: active ? user() : null }, error: null }),
    getClaims: async () => ({ data: { claims: { sub: "user-1", session_id: claimSid } }, error: null }),
    resetPasswordForEmail: async (...args) => { calls.recover.push(args); if (requestError === "network") throw Error("private provider detail"); return { error: requestError ? { code: requestError } : null }; },
    verifyOtp: async input => { calls.verify.push(input); if (verifyError || used) return { error: { code: verifyError ?? "otp_expired" }, data: { session: null, user: null } }; used = true; active = true; return { error: null, data: { session: session(), user: user() } }; },
    exchangeCodeForSession: async code => { active = true; return { data: { user: user(), session: session(), redirectType: code === "recovery-code" ? "recovery" : "oauth" }, error: null }; },
    updateUser: async input => { calls.update.push(input); if (updateError) return { error: { code: updateError } }; version = "2026-11-19T02:00:00Z"; return { data: { user: user() }, error: null }; },
    signInWithPassword: async input => { calls.login.push(input); if (currentError) return { error: { code: "invalid_credentials" }, data: { user: null, session: null } }; active = true; return { data: { user: user(), session: session() }, error: null }; },
    signOut: async input => { calls.signout.push(input); active = false; return { error: null }; },
    reauthenticate: async () => { calls.reauth++; return { error: null }; },
  };
  return { auth, calls, ticket: () => ({ purpose: "recovery", uid: "user-1", sid: "session-1", version, exp: Date.now() + 60_000 }) };
}

test("recovery validation allows passphrases and rejects bad email, code, weak and mismatched passwords", () => {
  assert(recoveryEmailSchema.safeParse(" person@example.com ").success);
  for (const email of ["bad", "a@", "a b@example.com"]) assert(!recoveryEmailSchema.safeParse(email).success);
  assert(resetCodeSchema.safeParse("012345").success);
  for (const token of ["12345", "1234567", "abc123"]) assert(!resetCodeSchema.safeParse(token).success);
  assert(newPasswordSchema.safeParse(strong).success);
  assert(!newPasswordSchema.safeParse({ password: "short", confirm: "short" }).success);
  assert(!newPasswordSchema.safeParse({ ...strong, confirm: "different" }).success);
});
test("registered, unknown, rate-limited and transport-failed requests have identical public responses", async () => {
  for (const requestError of [undefined, "user_not_found", "over_email_send_rate_limit", "network", "unexpected_failure"]) {
    const { auth, calls } = mockAuth({ requestError });
    assert.deepEqual(await requestRecovery(auth, "person@example.com", "http://localhost:3000/auth/recovery"), { message: RECOVERY_MESSAGE, sent: true, cooldown: 60 });
    assert.equal(calls.recover.length, 1);
  }
  const m = mockAuth(); assert((await requestRecovery(m.auth, "bad", "https://example.com")).error); assert.equal(m.calls.recover.length, 0);
});
test("signed recovery tickets reject tampering, wrong secrets, expiry and unbounded future expiry", () => {
  const ticket = mockAuth().ticket(), signed = signTicket(ticket, secret);
  assert.deepEqual(readTicket(signed, secret), ticket);
  assert.equal(readTicket(signed, secret + "x"), null);
  assert.equal(readTicket(signed + "x", secret), null);
  assert.equal(readTicket(signTicket({ ...ticket, uid: "other" }, "attacker"), secret), null);
  assert.equal(readTicket(signed, secret, ticket.exp + 1), null);
  assert.equal(readTicket(signTicket({ ...ticket, exp: Date.now() + 7200_000 }, secret), secret), null);
});
test("server cooldown rejects rapid repeats and renews after the window", () => {
  const limiter = new RecoveryLimiter();
  assert(limiter.allow("email", 1, 60_000, 0)); assert(!limiter.allow("email", 1, 60_000, 59_999)); assert(limiter.allow("email", 1, 60_000, 60_000));
  assert(limiter.allow("ip", 2, 60_000, 0)); assert(limiter.allow("ip", 2, 60_000, 1)); assert(!limiter.allow("ip", 2, 60_000, 2));
});
test("OTP uses recovery type and establishes server-verifiable user/session identity", async () => {
  const m = mockAuth(); const result = await verifyRecovery(m.auth, { email: "person@example.com", token: "012345" });
  assert.equal(result.identity.uid, "user-1"); assert.equal(result.identity.sid, "session-1");
  assert.deepEqual(m.calls.verify, [{ email: "person@example.com", token: "012345", type: "recovery" }]);
});
test("incorrect, expired and consumed OTPs fail closed without issuing authorization", async () => {
  for (const verifyError of ["otp_expired", "invalid_credentials"]) {
    const m = mockAuth({ verifyError }); const result = await verifyRecovery(m.auth, { email: "person@example.com", token: "999999" });
    assert.equal(result.error, INVALID_RECOVERY); assert(!result.identity);
  }
  const m = mockAuth(); await verifyRecovery(m.auth, { email: "person@example.com", token: "012345" }); await m.auth.signOut({ scope: "local" });
  assert.equal((await verifyRecovery(m.auth, { email: "person@example.com", token: "012345" })).error, INVALID_RECOVERY);
});
test("token hashes verify only as recovery, including expiry and replay failures", async () => {
  const m = mockAuth(), token_hash = "a".repeat(64);
  assert((await verifyRecovery(m.auth, { token_hash })).identity);
  assert.deepEqual(m.calls.verify[0], { token_hash, type: "recovery" });
  await m.auth.signOut({ scope: "local" }); assert.equal((await verifyRecovery(m.auth, { token_hash })).error, INVALID_RECOVERY);
  assert.equal((await verifyRecovery(mockAuth({ verifyError: "otp_expired" }).auth, { token_hash })).error, INVALID_RECOVERY);
  assert((await verifyRecovery(mockAuth().auth, { token_hash: "bad" })).error);
});
test("PKCE fallback requires signed request binding, provider recovery type and matching email", async () => {
  const flow = { purpose: "request", email: emailDigest("person@example.com"), verifier: "verifier-digest", exp: Date.now() + 60_000 };
  assert((await verifyRecovery(mockAuth().auth, { code: "recovery-code", flow })).identity);
  for (const input of [{ code: "oauth-code", flow }, { code: "recovery-code" }, { code: "recovery-code", flow: { ...flow, email: emailDigest("other@example.com") } }, { code: "recovery-code", flow: { ...flow, exp: 0 } }]) assert((await verifyRecovery(mockAuth().auth, input)).error);
  assert.equal(verifierDigest([]), null);
  assert.equal(verifierDigest([{ name: "unrelated", value: "private" }, { name: "sb-test-auth-token-code-verifier", value: "one" }]), verifierDigest([{ name: "sb-test-auth-token-code-verifier", value: "one" }]));
});
test("recovery never replaces an already signed-in browser account", async () => {
  const m = mockAuth({ logged: true }); assert((await verifyRecovery(m.auth, { email: "person@example.com", token: "012345" })).error.includes("already signed in")); assert.equal(m.calls.verify.length, 0);
});
test("ordinary sessions, wrong user/session/version and expired tickets cannot reset passwords", async () => {
  const m = mockAuth({ logged: true }), valid = m.ticket();
  for (const ticket of [null, { ...valid, uid: "other" }, { ...valid, sid: "other" }, { ...valid, version: "old" }, { ...valid, exp: 0 }]) {
    assert.equal(await hasRecovery(m.auth, ticket), false); assert((await resetRecoveredPassword(m.auth, ticket, strong)).error);
  }
  assert.equal(m.calls.update.length, 0);
  const expiredSession = mockAuth(); assert(!await hasRecovery(expiredSession.auth, expiredSession.ticket()));
});
test("valid reset updates through provider, signs out locally, and invalidates authorization", async () => {
  const m = mockAuth({ logged: true }), ticket = m.ticket();
  assert.deepEqual(await resetRecoveredPassword(m.auth, ticket, strong), { success: true });
  assert.deepEqual(m.calls.update, [{ password: strong.password }]); assert.deepEqual(m.calls.signout, [{ scope: "local" }]);
  assert(!await hasRecovery(m.auth, ticket));
});
test("failed, weak or mismatched updates never claim success", async () => {
  for (const code of ["weak_password", "same_password", "unexpected_failure"]) {
    const m = mockAuth({ logged: true, updateError: code }); assert((await resetRecoveredPassword(m.auth, m.ticket(), strong)).error); assert.equal(m.calls.signout.length, 0);
  }
  const m = mockAuth({ logged: true }); assert((await resetRecoveredPassword(m.auth, m.ticket(), { ...strong, confirm: "bad" })).error); assert.equal(m.calls.update.length, 0);
});
test("password change verifies credentials independently and passes current_password", async () => {
  const m = mockAuth({ logged: true }), verifier = mockAuth();
  assert.deepEqual(await changeAuthenticatedPassword(m.auth, verifier.auth, { ...strong, current: "test-current" }), { success: true });
  assert.deepEqual(verifier.calls.login, [{ email: "person@example.com", password: "test-current" }]);
  assert.deepEqual(m.calls.update, [{ password: strong.password, current_password: "test-current" }]);
  assert.equal(m.calls.signout.length, 0); assert.deepEqual(verifier.calls.signout, [{ scope: "local" }]);
});
test("incorrect current password, unauthenticated and OAuth-without-password changes cannot write", async () => {
  for (const options of [{ logged: false }, { logged: true }, { logged: true, provider: "google" }]) {
    const m = mockAuth(options), verifier = mockAuth({ currentError: true }); assert((await changeAuthenticatedPassword(m.auth, verifier.auth, { ...strong, current: "incorrect" })).error); assert.equal(m.calls.update.length, 0);
  }
  const m = mockAuth({ logged: true }); assert((await changeAuthenticatedPassword(m.auth, mockAuth().auth, { ...strong, confirm: "bad", current: "test" })).error); assert.equal(m.calls.update.length, 0);
});
test("provider secure-password-change challenge requests reauthentication without claiming success", async () => {
  const m = mockAuth({ logged: true, updateError: "reauthentication_needed" }); const result = await changeAuthenticatedPassword(m.auth, mockAuth().auth, { ...strong, current: "test-current" });
  assert(result.needsNonce); assert(!result.success); assert.equal(m.calls.reauth, 1);
});
test("OTP input helpers preserve leading zeros, paste and keyboard boundaries", () => {
  assert.equal(codeDigits("01 23-45"), "012345"); assert.equal(codeDigits("1234567"), "123456"); assert.equal(codeDigits("abc"), "");
  assert.equal(codeFocus(0, "Backspace"), 0); assert.equal(codeFocus(3, "ArrowLeft"), 2); assert.equal(codeFocus(4, "ArrowRight"), 5); assert.equal(codeFocus(5, "ArrowRight"), 5);
});
test("link adapter ignores redirect inputs and uses fixed trusted routes; no admin or credential logging", () => {
  const link = readFileSync(new URL("../src/lib/auth/recovery-link.ts", import.meta.url), "utf8");
  assert(!link.includes('params.get("next")')); assert(!link.includes('params.get("redirect_to")'));
  assert(link.includes('location = "/reset-password"')); assert(link.includes('flow.verifier === verifierDigest'));
  for (const path of ["password-service.ts", "recovery-actions.ts", "recovery-context.ts", "recovery-link.ts"]) {
    const source = readFileSync(new URL(`../src/lib/auth/${path}`, import.meta.url), "utf8");
    assert(!/console\.|auth\.admin|SERVICE_ROLE|localStorage/.test(source));
  }
});


test("installed SSR SDK creates recovery PKCE cookies and exchanges the default email link", async () => {
  const { createServerClient } = await import("@supabase/ssr");
  const jar = new Map();
  const user = { id: "user-1", email: "person@example.com", updated_at: "2026-11-19T01:00:00Z", app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "2026-01-01T00:00:00Z" };
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, session_id: "session-1", exp: Math.floor(Date.now()/1000)+3600, iat: Math.floor(Date.now()/1000), role: "authenticated" })}.${Buffer.alloc(32).toString("base64url")}`;
  let exchanges = 0;
  const client = createServerClient("https://fixture.supabase.co", "sb_publishable_fixture", {
    cookieOptions: { httpOnly: true },
    cookies: { getAll: () => [...jar].map(([name,value]) => ({ name,value })), setAll: entries => { for (const c of entries) { if (c.options.maxAge === 0) jar.delete(c.name); else jar.set(c.name,c.value); } } },
    global: { fetch: async (url, init) => {
      const path = new URL(url).pathname;
      let data;
      if (path.endsWith("/recover")) data = {};
      else if (path.endsWith("/token")) {
        const body = JSON.parse(init.body); assert.equal(body.auth_code, "sample-recovery-code"); assert(body.code_verifier); exchanges++;
        data = { access_token: token, refresh_token: "test-only-refresh", expires_in: 3600, token_type: "bearer", user };
      } else if (path.endsWith("/user")) data = user;
      else throw Error(`Unexpected test request: ${path}`);
      return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
    } },
  });
  await requestRecovery(client.auth, user.email, "http://localhost:3000/auth/recovery");
  const verifier = verifierDigest([...jar].map(([name,value]) => ({name,value})));
  assert(verifier);
  const flow = { purpose: "request", email: emailDigest(user.email), verifier, exp: Date.now()+60_000 };
  const result = await verifyRecovery(client.auth, { code: "sample-recovery-code", flow });
  assert.equal(result.identity?.uid, user.id, result.error);
  assert.equal(exchanges, 1);
  assert([...jar.keys()].some(key => key.includes("auth-token") && !key.includes("verifier")));
});


test("auth logging suppresses action arguments and credential callback URLs", async () => {
  const { default: config } = await import("../next.config.mjs");
  assert.equal(config.logging.serverFunctions, false);
  for (const path of ["/auth/recovery?code=private", "/auth/confirm?token_hash=private", "/reset-password"]) assert(config.logging.incomingRequests.ignore.some(pattern => pattern.test(path)));
  const headers = await config.headers();
  assert(headers.find(rule => rule.source === "/auth/recovery").headers.some(header => header.key === "Referrer-Policy" && header.value === "no-referrer"));
});
