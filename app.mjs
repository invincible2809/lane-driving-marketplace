// Top-level request router shared by the local Node server and the Worker build.
// The instructor administration product is the default. The legacy learner
// marketplace is frozen and only reachable when MARKETPLACE_ENABLED=true.
import {handleInstructorApi} from './instructor-api.mjs';
import {api as marketplaceApi} from './api.mjs';
export const SITE_ASSETS = {
  '/': 'site/landing.html',
  '/app': 'site/app.html',
  '/privacy': 'site/privacy.html',
  '/terms': 'site/terms.html',
  '/site/app.js': 'site/app.js',
  '/site/app.css': 'site/app.css'
};
export const MARKETPLACE_ASSETS = {'/marketplace': 'index.html', '/style.css': 'style.css', '/app.js': 'app.js', '/operations.js': 'operations.js'};
const TYPES = {html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', jpg: 'image/jpeg', ttf: 'font/ttf'};
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
};
export const marketplaceEnabled = env => String(env.MARKETPLACE_ENABLED || '').toLowerCase() === 'true';
// readAsset(file) -> string | Uint8Array | null
export async function handle(request, db, env, readAsset) {
  const path = new URL(request.url).pathname;
  if (path.startsWith('/api/')) {
    if (!db) return Response.json({error: 'Database binding is not configured.'}, {status: 503});
    const response = await handleInstructorApi(request, db, env);
    if (response) return response;
    if (marketplaceEnabled(env)) return marketplaceApi(request, db, env);
    return Response.json({error: 'Not found.'}, {status: 404, headers: {'Cache-Control': 'no-store'}});
  }
  let file = SITE_ASSETS[path];
  if (!file && marketplaceEnabled(env)) file = MARKETPLACE_ASSETS[path] || (/^\/assets\/[a-z0-9-]+\.(jpg|ttf)$/.test(path) ? path.slice(1) : null);
  const body = file ? await readAsset(file) : null;
  if (body == null) return new Response('Not found', {status: 404, headers: {'Content-Type': 'text/plain', ...SECURITY_HEADERS}});
  const ext = file.split('.').pop();
  const legacy = !file.startsWith('site/');
  // The frozen marketplace UI uses inline handlers and remote-free assets; it keeps its original, looser headers.
  const headers = legacy ? {'X-Content-Type-Options': 'nosniff'} : SECURITY_HEADERS;
  return new Response(body, {headers: {'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': ext === 'html' ? 'no-cache' : 'public, max-age=300', ...headers}});
}
