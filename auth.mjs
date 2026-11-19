// Google sign-in (OpenID Connect, authorization code flow with PKCE) and
// server-side sessions. Endpoints confirmed against
// https://accounts.google.com/.well-known/openid-configuration.
//
// Required configuration: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (secret) and
// APP_URL (the public origin; the redirect URI registered with Google must be
// exactly APP_URL + '/auth/google/callback').
import {newId} from './lib/jobs.mjs';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const SESSION_DAYS = 30;
const enc = new TextEncoder();
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
export async function sha256Hex(text) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)))].map(b => b.toString(16).padStart(2, '0')).join(''); }
async function s256(text) { return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)))); }
function decodeJwtPayload(jwt) {
  const part = String(jwt).split('.')[1];
  if (!part) throw new Error('Malformed ID token.');
  const json = atob(part.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((part.length + 3) % 4));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(json, c => c.charCodeAt(0))));
}
export const googleConfigured = env => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.APP_URL);
const secureCookies = env => String(env.APP_URL || '').startsWith('https://');
const cookieName = env => secureCookies(env) ? '__Host-lane_session' : 'lane_session';
function sessionCookie(env, token, maxAge) {
  return `${cookieName(env)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureCookies(env) ? '; Secure' : ''}`;
}
const readCookie = (request, name) => new RegExp('(?:^|;\\s*)' + name.replace(/[-_]/g, '\\$&') + '=([A-Za-z0-9_-]+)').exec(request.headers.get('cookie') || '')?.[1];
// Only same-site relative paths are allowed as post-login destinations.
export const safeNext = p => typeof p === 'string' && /^\/(?![\/\\])[\w\-\/#?=&.%]*$/.test(p) ? p : '/account';
const redirect = (location, headers = {}) => new Response(null, {status: 302, headers: {Location: location, 'Cache-Control': 'no-store', ...headers}});
const page = (title, body, status = 400) => new Response(`<!doctype html><html lang="en-GB"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><link rel="stylesheet" href="/site/app.css"><main class="card"><h1>${title}</h1><p>${body}</p><p><a class="btn" href="/">Back to the website</a></p></main></html>`, {status, headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'}});

// Resolve the signed-in identity and return a request carrying it in the
// internal identity headers. Inbound identity headers are always removed unless
// the hosting platform is trusted to set them (TRUST_PLATFORM_IDENTITY=true).
export async function withIdentity(request, db, env) {
  const headers = new Headers(request.headers);
  if (String(env.TRUST_PLATFORM_IDENTITY) !== 'true') { headers.delete('oai-authenticated-user-id'); headers.delete('oai-authenticated-user-email'); }
  const token = readCookie(request, cookieName(env));
  if (token && db) {
    const row = await db.prepare('SELECT u.id, u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_ms>?').bind(await sha256Hex(token), Date.now()).first();
    if (row) { headers.set('oai-authenticated-user-id', row.id); headers.set('oai-authenticated-user-email', row.email); }
  }
  const init = {method: request.method, headers};
  if (!['GET', 'HEAD'].includes(request.method)) { init.body = await request.arrayBuffer(); }
  return new Request(request.url, init);
}
// The workspace whose public website this deployment serves.
export async function siteWorkspace(db, env) {
  if (env.SITE_WORKSPACE_ID) return db.prepare('SELECT * FROM workspaces WHERE id=?').bind(env.SITE_WORKSPACE_ID).first();
  const rows = (await db.prepare('SELECT * FROM workspaces LIMIT 2').all()).results;
  return rows.length === 1 ? rows[0] : null;
}
// Link a newly signed-in Google account to the learner record with the same
// verified email address, when exactly one unlinked active record matches.
async function autoLinkLearner(db, env, user) {
  const w = await siteWorkspace(db, env);
  if (!w || w.owner_id === user.id) return;
  const email = user.email.toLowerCase();
  await db.prepare(`UPDATE learner_records SET user_id=?, updated_ms=? WHERE workspace_id=? AND lower(email)=? AND user_id IS NULL AND status='active'
    AND (SELECT count(*) FROM learner_records WHERE workspace_id=? AND lower(email)=? AND user_id IS NULL AND status='active')=1
    AND NOT EXISTS (SELECT 1 FROM learner_records WHERE workspace_id=? AND user_id=?)`).bind(user.id, Date.now(), w.id, email, w.id, email, w.id, user.id).run();
}
// Record the user and start a session. Returns the Set-Cookie header value.
export async function createSession(db, env, user, provider) {
  const now = Date.now();
  await db.prepare(`INSERT INTO users (id,provider,email,email_verified,name,created_ms,last_login_ms) VALUES (?,?,?,1,?,?,?)
    ON CONFLICT(id) DO UPDATE SET email=excluded.email, name=excluded.name, last_login_ms=excluded.last_login_ms`).bind(user.id, provider, user.email, user.name || '', now, now).run();
  const token = random();
  await db.prepare('INSERT INTO sessions (token_hash,user_id,expires_ms,created_ms) VALUES (?,?,?,?)').bind(await sha256Hex(token), user.id, now + SESSION_DAYS * 86400000, now).run();
  return sessionCookie(env, token, SESSION_DAYS * 86400);
}
export {redirect as authRedirect, page as authPage};
export async function authRoutes(request, db, env) {
  const url = new URL(request.url), path = url.pathname;
  if (!path.startsWith('/auth/')) return null;
  const now = Date.now();
  if (path === '/auth/google/start' && request.method === 'GET') {
    if (!googleConfigured(env)) return page('Google sign-in is not set up yet', 'The website owner needs to add Google sign-in credentials. Please contact the driving school directly for now.', 503);
    const state = random(), verifier = random(48), nonce = random();
    await db.prepare('DELETE FROM oauth_states WHERE expires_ms<?').bind(now).run();
    await db.prepare('INSERT INTO oauth_states (state_hash,code_verifier,nonce,next_path,expires_ms) VALUES (?,?,?,?,?)').bind(await sha256Hex(state), verifier, nonce, safeNext(url.searchParams.get('next')), now + 10 * 60000).run();
    const q = new URLSearchParams({client_id: env.GOOGLE_CLIENT_ID, redirect_uri: env.APP_URL.replace(/\/$/, '') + '/auth/google/callback', response_type: 'code', scope: 'openid email profile', state, nonce, code_challenge: await s256(verifier), code_challenge_method: 'S256', prompt: 'select_account'});
    return redirect(`${AUTH_URL}?${q}`);
  }
  if (path === '/auth/google/callback' && request.method === 'GET') {
    if (!googleConfigured(env)) return page('Google sign-in is not set up yet', 'Please contact the driving school directly.', 503);
    if (url.searchParams.get('error')) return page('Sign-in cancelled', 'Google sign-in was not completed. You can try again from the website.');
    const state = url.searchParams.get('state') || '', code = url.searchParams.get('code') || '';
    const stateHash = await sha256Hex(state);
    const saved = await db.prepare('SELECT * FROM oauth_states WHERE state_hash=?').bind(stateHash).first();
    await db.prepare('DELETE FROM oauth_states WHERE state_hash=?').bind(stateHash).run();
    if (!saved || saved.expires_ms < now || !code) return page('Sign-in link expired', 'That sign-in attempt has expired or was already used. Please start again.');
    let claims;
    try {
      const response = await (env.OAUTH_FETCH || fetch)(TOKEN_URL, {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: env.APP_URL.replace(/\/$/, '') + '/auth/google/callback', grant_type: 'authorization_code', code_verifier: saved.code_verifier})});
      if (!response.ok) throw new Error('token_exchange_failed');
      const tokens = await response.json();
      // The ID token came straight from Google's token endpoint over TLS using our
      // client secret, so Google's guidance allows skipping signature checks; the
      // claims are still validated.
      claims = decodeJwtPayload(tokens.id_token);
    } catch { return page('Sign-in failed', 'We could not complete Google sign-in. Please try again.', 502); }
    const valid = ISSUERS.includes(claims.iss) && claims.aud === env.GOOGLE_CLIENT_ID && Number(claims.exp) * 1000 > now && claims.nonce === saved.nonce && typeof claims.sub === 'string' && claims.sub;
    if (!valid) return page('Sign-in failed', 'The sign-in response could not be verified. Please try again.', 401);
    if (claims.email_verified !== true || !claims.email) return page('Email not verified', 'Your Google account email address must be verified to sign in.', 403);
    const user = {id: 'google:' + claims.sub, email: String(claims.email).toLowerCase(), name: String(claims.name || '').slice(0, 100)};
    const cookie = await createSession(db, env, user, 'google');
    await autoLinkLearner(db, env, user);
    const owner = await db.prepare('SELECT 1 FROM workspaces WHERE owner_id=?').bind(user.id).first();
    const isOwnerEmail = String(env.OWNER_EMAILS || '').toLowerCase().split(',').map(s => s.trim()).includes(user.email);
    const next = saved.next_path === '/account' && (owner || isOwnerEmail) ? '/app' : saved.next_path;
    return redirect(next, {'Set-Cookie': cookie});
  }
  if (path === '/auth/logout' && request.method === 'POST') {
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) return new Response('Forbidden', {status: 403});
    const token = readCookie(request, cookieName(env));
    if (token) await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha256Hex(token)).run();
    return redirect('/', {'Set-Cookie': sessionCookie(env, '', 0)});
  }
  return new Response('Not found', {status: 404});
}
