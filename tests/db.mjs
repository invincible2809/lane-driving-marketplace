// Test database factory. SQLite in memory by default; with TEST_DATABASE_URL
// (e.g. postgres://postgres@127.0.0.1:54329/postgres) each call creates a fresh
// PostgreSQL database with the production schema, so the same tests run on both.
import {readFileSync, readdirSync} from 'node:fs';
import pg from 'pg';
import {database as sqliteDatabase} from '../server.mjs';
import {pgDatabase, migratePg} from '../lib/pg-db.mjs';
export const usingPostgres = !!process.env.TEST_DATABASE_URL;
export function pgMigrationFiles() {
  const dir = new URL('../migrations-pg/', import.meta.url);
  return readdirSync(dir).filter(f => f.endsWith('.sql')).sort().map(name => ({name, sql: readFileSync(new URL(name, dir), 'utf8')}));
}
export async function freshPgPool() {
  const name = 'lane_test_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const admin = new pg.Client({connectionString: process.env.TEST_DATABASE_URL});
  await admin.connect(); await admin.query(`CREATE DATABASE ${name}`); await admin.end();
  const url = new URL(process.env.TEST_DATABASE_URL); url.pathname = '/' + name;
  const pool = new pg.Pool({connectionString: url.toString(), max: 10});
  // Dropping the test database terminates idle pooled connections; that is expected here.
  pool.on('error', () => {});
  await migratePg(pool, pgMigrationFiles());
  return {pool, name};
}
async function dropDatabase(name) {
  const admin = new pg.Client({connectionString: process.env.TEST_DATABASE_URL});
  await admin.connect(); await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); await admin.end();
}
export function database() {
  if (!usingPostgres) return sqliteDatabase();
  const ready = freshPgPool().then(({pool, name}) => ({db: pgDatabase(pool), name}));
  const statement = (sql, args = []) => ({
    sql, args,
    bind: (...a) => statement(sql, a),
    first: async () => (await ready).db.prepare(sql).bind(...args).first(),
    all: async () => (await ready).db.prepare(sql).bind(...args).all(),
    run: async () => (await ready).db.prepare(sql).bind(...args).run()
  });
  return {
    prepare: sql => statement(sql),
    batch: async stmts => (await ready).db.batch(stmts),
    close: async () => { const {db, name} = await ready; await db.close(); await dropDatabase(name); }
  };
}
