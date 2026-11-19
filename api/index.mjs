// Vercel Function: every page, API and auth route is handled here (see the
// rewrite in vercel.json). Static CSS/JS is served from vercel-static/.
import {readFile} from 'node:fs/promises';
import {createClient} from '@libsql/client/web';
import {waitUntil} from '@vercel/functions';
import {handle} from '../app.mjs';
import {libsqlDatabase} from '../lib/libsql-db.mjs';
import {processJobs} from '../lib/jobs.mjs';
import {databaseConfig} from '../scripts/migrate.mjs';

let db = null, lastJobRun = 0;
function environment() {
  const env = {...process.env};
  // Fall back to the production domain Vercel provides when APP_URL is not set.
  if (!env.APP_URL && env.VERCEL_PROJECT_PRODUCTION_URL) env.APP_URL = 'https://' + env.VERCEL_PROJECT_PRODUCTION_URL;
  env.TRUST_PLATFORM_IDENTITY = 'false';
  return env;
}
function database(env) {
  if (!db) { const config = databaseConfig(env); if (config) db = libsqlDatabase(env.__LIBSQL_CLIENT || createClient(config)); }
  return db;
}
const readAsset = async file => { try { return await readFile(new URL('../public/' + file, import.meta.url)); } catch { return null; } };
export async function fetchHandler(request, env = environment()) {
  const database_ = database(env);
  const response = await handle(request, database_, env, readAsset);
  // Vercel Hobby cron runs only daily, so due reminders and emails are also
  // processed after ordinary requests (at most once a minute per instance).
  if (database_ && Date.now() - lastJobRun > 60000) {
    lastJobRun = Date.now();
    waitUntil(processJobs(database_, env).catch(e => console.error('job runner error', e.message)));
  }
  return response;
}
export const GET = request => fetchHandler(request);
export const HEAD = request => fetchHandler(request);
export const POST = request => fetchHandler(request);
export const PUT = request => fetchHandler(request);
export const PATCH = request => fetchHandler(request);
export const DELETE = request => fetchHandler(request);
// Test hook: reset cached state.
export const __reset = () => { db = null; lastJobRun = 0; };
