// The production Worker bundle builds and serves the site, API, auth and cron.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {database} from '../server.mjs';
test('worker bundle builds and handles requests', async () => {
  execFileSync('node', ['build.mjs'], {stdio: 'ignore'});
  const worker = (await import('../dist/server/index.js?' + Date.now())).default;
  const db = database();
  try {
    const env = {DB: db, APP_URL: 'https://x.test'};
    const home = await worker.fetch(new Request('https://x.test/'), env);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /SRK Driving School/);
    assert.equal((await worker.fetch(new Request('https://x.test/site/app.js'), env)).status, 200);
    assert.equal((await (await worker.fetch(new Request('https://x.test/api/health'), env)).json()).ok, true);
    assert.equal((await worker.fetch(new Request('https://x.test/auth/google/start'), env)).status, 503);
    let scheduled; await worker.scheduled({}, env, {waitUntil: p => { scheduled = p; }}); await scheduled;
  } finally { db.close(); }
});
