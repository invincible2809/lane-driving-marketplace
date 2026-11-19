// PostgreSQL (Neon) adapter exposing the same interface as the SQLite and
// libSQL adapters: prepare(sql).bind(...).first() / all() / run(), and atomic
// batch([...]). SQL is written with "?" placeholders, converted to $1, $2, ….
// Works with any node-postgres-compatible pool (pg.Pool, or Neon's Pool).
import pg from 'pg';
const INT8 = 20, NUMERIC = 1700;
// BIGINT (epoch ms, counts) and NUMERIC (sums) arrive as strings by default;
// every value the app stores is well inside Number's safe integer range.
const types = {getTypeParser: (oid, format) => (oid === INT8 || oid === NUMERIC) ? (v => v === null ? null : Number(v)) : pg.types.getTypeParser(oid, format)};
const parsers = new Map();
export function toPositional(sql) {
  if (parsers.has(sql)) return parsers.get(sql);
  let out = '', n = 0, quoted = false;
  for (const ch of sql) {
    if (ch === "'") quoted = !quoted;
    out += ch === '?' && !quoted ? '$' + (++n) : ch;
  }
  parsers.set(sql, out);
  return out;
}
export function pgDatabase(pool, {defaultTypes} = {}) {
  const exec = (runner, sql, args) => runner.query({text: toPositional(sql), values: args, types: defaultTypes || types});
  const statement = (sql, args = []) => ({
    sql, args,
    bind: (...a) => statement(sql, a.map(v => v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v)),
    async first() { return (await exec(pool, sql, args)).rows[0] || null; },
    async all() { return {results: (await exec(pool, sql, args)).rows}; },
    async run() { return {meta: {changes: (await exec(pool, sql, args)).rowCount ?? 0}}; }
  });
  return {
    prepare: sql => statement(sql),
    async batch(stmts) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const results = [];
        for (const s of stmts) results.push({meta: {changes: (await exec(client, s.sql, s.args)).rowCount ?? 0}});
        await client.query('COMMIT');
        return results;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally { client.release(); }
    },
    close: () => pool.end()
  };
}
// Apply migrations-pg/*.sql in order, each in one transaction with its
// bookkeeping row. The lock is transaction-scoped, which is safe through Neon's
// connection pooler (PgBouncer, transaction mode), and serialises concurrent deploys.
export async function migratePg(pool, files) {
  const client = await pool.connect();
  try {
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    const applied = [];
    for (const {name, sql} of files) {
      await client.query('BEGIN');
      try {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['lane-migrations']);
        const done = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
        if (!done.rowCount) {
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
          applied.push(name);
        }
        await client.query('COMMIT');
      } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
    }
    return applied;
  } finally { client.release(); }
}
