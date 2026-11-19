// Apply database migrations to Turso (or any libSQL URL).
// Usage: TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... node scripts/migrate.mjs
import {readFileSync, readdirSync} from 'node:fs';
import {createClient} from '@libsql/client';
import {migrate} from '../lib/libsql-db.mjs';
export function migrationFiles() {
  const dir = new URL('../drizzle/', import.meta.url);
  return readdirSync(dir).filter(f => f.endsWith('.sql')).sort().map(name => ({name, sql: readFileSync(new URL(name, dir), 'utf8')}));
}
export function databaseConfig(env = process.env) {
  const url = env.TURSO_DATABASE_URL || env.LIBSQL_URL || env.DATABASE_URL;
  return url ? {url, authToken: env.TURSO_AUTH_TOKEN || env.LIBSQL_AUTH_TOKEN || undefined} : null;
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const config = databaseConfig();
  if (!config) { console.error('Set TURSO_DATABASE_URL (and TURSO_AUTH_TOKEN).'); process.exit(1); }
  const client = createClient(config);
  const applied = await migrate(client, migrationFiles());
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database already up to date.');
  client.close();
}
