// Adapter giving a libSQL / Turso client the same small interface the app uses
// everywhere (D1-shaped): prepare(sql).bind(...).first() / all() / run(), and
// atomic batch([...]). Database triggers and SQL are identical to local SQLite.
export function libsqlDatabase(client) {
  const toObjects = rs => rs.rows.map(row => Object.fromEntries(rs.columns.map((c, i) => [c, row[i]])));
  const statement = (sql, args = []) => ({
    sql, args,
    bind: (...a) => statement(sql, a.map(v => v === undefined ? null : v)),
    async first() { return toObjects(await client.execute({sql, args}))[0] || null; },
    async all() { return {results: toObjects(await client.execute({sql, args}))}; },
    async run() { const rs = await client.execute({sql, args}); return {meta: {changes: rs.rowsAffected}}; }
  });
  return {
    prepare: sql => statement(sql),
    // "write" takes the write lock up front; any failure rolls back every statement.
    batch: async stmts => (await client.batch(stmts.map(s => ({sql: s.sql, args: s.args})), 'write')).map(rs => ({meta: {changes: rs.rowsAffected}})),
    close: () => client.close()
  };
}
// Apply drizzle/*.sql in order. Each file runs in one transaction together with
// its bookkeeping row, so a failed migration leaves nothing half-applied.
export async function migrate(client, files) {
  await client.execute('CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY)');
  const done = new Set((await client.execute('SELECT name FROM local_migrations')).rows.map(r => r[0]));
  const applied = [];
  for (const {name, sql} of files) {
    if (done.has(name)) continue;
    await client.executeMultiple(`BEGIN;\n${sql}\nINSERT INTO local_migrations (name) VALUES ('${name.replace(/'/g, "''")}');\nCOMMIT;`);
    applied.push(name);
  }
  return applied;
}
