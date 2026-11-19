// Apply database migrations.
//  PostgreSQL / Neon:  DATABASE_URL=postgres://...            (migrations-pg/*.sql)
//  Turso / libSQL:     TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=...  (drizzle/*.sql)
// Usage: npm run migrate
import {readFileSync, readdirSync} from 'node:fs';
function files(dirName) {
  const dir = new URL(`../${dirName}/`, import.meta.url);
  return readdirSync(dir).filter(f => f.endsWith('.sql')).sort().map(name => ({name, sql: readFileSync(new URL(name, dir), 'utf8')}));
}
export const migrationFiles = () => files('drizzle');
export const pgMigrationFiles = () => files('migrations-pg');
// Which database this environment points at.
export function databaseConfig(env = process.env) {
  const pgUrl = [env.DATABASE_URL, env.POSTGRES_URL].find(u => /^postgres(ql)?:\/\//.test(u || ''));
  if (pgUrl) return {kind: 'postgres', url: pgUrl};
  const url = env.TURSO_DATABASE_URL || env.LIBSQL_URL;
  return url ? {kind: 'libsql', url, authToken: env.TURSO_AUTH_TOKEN || env.LIBSQL_AUTH_TOKEN || undefined} : null;
}
export async function runMigrations(config) {
  if (config.kind === 'postgres') {
    const {default: pg} = await import('pg');
    const {migratePg} = await import('../lib/pg-db.mjs');
    const pool = new pg.Pool({connectionString: config.url, max: 1});
    try { return await migratePg(pool, pgMigrationFiles()); } finally { await pool.end(); }
  }
  const {createClient} = await import('@libsql/client');
  const {migrate} = await import('../lib/libsql-db.mjs');
  const client = createClient({url: config.url, authToken: config.authToken});
  try { return await migrate(client, migrationFiles()); } finally { client.close(); }
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const config = databaseConfig();
  if (!config) { console.error('Set DATABASE_URL (Neon / PostgreSQL) or TURSO_DATABASE_URL.'); process.exit(1); }
  const applied = await runMigrations(config);
  console.log(`${config.kind}: ${applied.length ? 'applied ' + applied.join(', ') : 'already up to date'}.`);
}
