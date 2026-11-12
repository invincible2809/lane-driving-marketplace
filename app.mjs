// Top-level request router shared by the local Node server and the Worker build.
//  SITE_MODE=business (default): the driving school's public website at /, with
//    the learner portal at /account and the instructor admin at /app.
//  SITE_MODE=product: the Lane product landing page at /.
// The legacy learner marketplace is frozen and only reachable when MARKETPLACE_ENABLED=true.
import {handleInstructorApi} from './instructor-api.mjs';
import {api as marketplaceApi} from './api.mjs';
import {authRoutes, withIdentity, googleConfigured} from './auth.mjs';
import {renderSitePage} from './lib/site.mjs';
import {business} from './business.config.mjs';
export const SITE_ASSETS = {
  '/app': 'site/app.html',
  '/account': 'site/app.html',
  '/privacy': 'site/privacy.html',
  '/terms': 'site/terms.html',
  '/site/app.js': 'site/app.js',
  '/site/public.js': 'site/public.js',
  '/site/app.css': 'site/app.css',
  '/site/public.css': 'site/public.css'
};
export const MARKETPLACE_ASSETS = {'/marketplace': 'index.html', '/style.css': 'style.css', '/app.js': 'app.js', '/operations.js': 'operations.js'};
const TYPES = {html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', jpg: 'image/jpeg', ttf: 'font/ttf', woff2: 'font/woff2'};
// The JSON-LD block on public pages is data, not script; its hash is not needed because browsers do not execute it.
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
};
export const marketplaceEnabled = env => String(env.MARKETPLACE_ENABLED || '').toLowerCase() === 'true';
const businessMode = env => (env.SITE_MODE || 'business') === 'business';
const html = (body, status = 200) => new Response(body, {status, headers: {'Content-Type': TYPES.html, 'Cache-Control': 'no-cache', ...SECURITY_HEADERS}});
// readAsset(file) -> string | Uint8Array | null
export async function handle(request, db, env, readAsset) {
  const url = new URL(request.url), path = url.pathname;
  if (path.startsWith('/auth/')) {
    if (!db) return new Response('Database binding is not configured.', {status: 503});
    return authRoutes(request, db, env);
  }
  if (path.startsWith('/api/')) {
    if (!db) return Response.json({error: 'Database binding is not configured.'}, {status: 503});
    const authed = await withIdentity(request, db, env);
    const response = await handleInstructorApi(authed, db, env);
    if (response) return response;
    if (marketplaceEnabled(env)) return marketplaceApi(authed, db, env);
    return Response.json({error: 'Not found.'}, {status: 404, headers: {'Cache-Control': 'no-store'}});
  }
  if (['GET', 'HEAD'].includes(request.method) && businessMode(env)) {
    const user = db ? (await withIdentity(request, db, env)).headers.get('oai-authenticated-user-id') : null;
    const page = renderSitePage(env.BUSINESS || business, path, {user, query: url.searchParams, googleReady: googleConfigured(env)});
    if (page) return html(page);
  }
  let file = SITE_ASSETS[path] || (path === '/' ? 'site/landing.html' : null) || (/^\/site\/fonts\/[a-z0-9-]+\.woff2$/.test(path) ? path.slice(1) : null);
  if (!file && marketplaceEnabled(env)) file = MARKETPLACE_ASSETS[path] || (/^\/assets\/[a-z0-9-]+\.(jpg|ttf)$/.test(path) ? path.slice(1) : null);
  const body = file ? await readAsset(file) : null;
  if (body == null) return new Response('Not found', {status: 404, headers: {'Content-Type': 'text/plain', ...SECURITY_HEADERS}});
  const ext = file.split('.').pop();
  // The frozen marketplace UI keeps its original, looser headers.
  const headers = file.startsWith('site/') ? SECURITY_HEADERS : {'X-Content-Type-Options': 'nosniff'};
  return new Response(body, {headers: {'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': ext === 'html' ? 'no-cache' : 'public, max-age=300', ...headers}});
}
