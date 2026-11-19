// Vercel build step: apply database migrations (when the database is
// configured) and copy browser assets into the static output directory.
import {cpSync, mkdirSync, rmSync} from 'node:fs';
import {createClient} from '@libsql/client';
import {migrate} from '../lib/libsql-db.mjs';
import {migrationFiles, databaseConfig} from './migrate.mjs';
const config = databaseConfig();
if (config) {
  const client = createClient(config);
  const applied = await migrate(client, migrationFiles());
  console.log(applied.length ? `Migrations applied: ${applied.join(', ')}` : 'Database schema up to date.');
  client.close();
} else {
  console.warn('WARNING: TURSO_DATABASE_URL is not set — migrations skipped. The site will not work until a database is connected.');
}
rmSync('vercel-static', {recursive: true, force: true});
mkdirSync('vercel-static/site', {recursive: true});
// Every browser asset (CSS, JS, fonts); HTML pages are rendered by the function.
cpSync('public/site', 'vercel-static/site', {recursive: true, filter: src => !src.endsWith('.html')});
console.log('Static assets ready in vercel-static/.');
