// Vercel build step: apply database migrations (when a database is connected)
// and copy browser assets into the static output directory.
import {cpSync, mkdirSync, rmSync} from 'node:fs';
import {databaseConfig, runMigrations} from './migrate.mjs';
const config = databaseConfig();
if (config) {
  const applied = await runMigrations(config);
  console.log(`Database (${config.kind}): ${applied.length ? 'migrations applied: ' + applied.join(', ') : 'schema up to date'}.`);
} else {
  console.warn('WARNING: no database connected (DATABASE_URL or TURSO_DATABASE_URL) — migrations skipped. The site will not work until one is connected.');
}
rmSync('vercel-static', {recursive: true, force: true});
mkdirSync('vercel-static/site', {recursive: true});
// Every browser asset (CSS, JS, fonts); HTML pages are rendered by the function.
cpSync('public/site', 'vercel-static/site', {recursive: true, filter: src => !src.endsWith('.html')});
console.log('Static assets ready in vercel-static/.');
