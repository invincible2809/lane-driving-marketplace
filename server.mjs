import {createServer} from 'node:http';
import {readFileSync,existsSync,mkdirSync,readdirSync,writeFileSync,unlinkSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
export function database(path=':memory:') {
 const sqlite=new DatabaseSync(path);sqlite.exec('PRAGMA foreign_keys=ON;');
 sqlite.exec('CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY)');
 for(const name of readdirSync(new URL('./drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort()) {
  if(sqlite.prepare('SELECT name FROM local_migrations WHERE name=?').get(name))continue;
  // Existing baseline databases already have 0000's tables.
  if(name==='0000_marketplace.sql'&&sqlite.prepare("SELECT name FROM sqlite_master WHERE name='learners'").get()){sqlite.prepare('INSERT INTO local_migrations VALUES (?)').run(name);continue;}
  sqlite.exec('BEGIN');try{sqlite.exec(readFileSync(new URL('./drizzle/'+name,import.meta.url),'utf8'));sqlite.prepare('INSERT INTO local_migrations VALUES (?)').run(name);sqlite.exec('COMMIT')}catch(e){sqlite.exec('ROLLBACK');throw e;}
 }
 // D1-shaped adapter. Batches run synchronously inside one transaction, so (as on D1)
 // no other statement can interleave with a batch.
 const runSync=(sql,args)=>{const r=sqlite.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)},...r}};
 const wrap=(sql,args=[])=>({bind(...a){return wrap(sql,a)},async first(){return sqlite.prepare(sql).get(...args)||null},async all(){return {results:sqlite.prepare(sql).all(...args)}},async run(){return runSync(sql,args)},runSync(){return runSync(sql,args)}});
 return {prepare:sql=>wrap(sql),batch:async stmts=>{sqlite.exec('BEGIN');try{const result=stmts.map(s=>s.runSync());sqlite.exec('COMMIT');return result}catch(e){sqlite.exec('ROLLBACK');throw e}},close:()=>sqlite.close()};
}
export function localBucket(path='.data/documents') {
 mkdirSync(path,{recursive:true});return {async put(key,bytes){writeFileSync(path+'/'+key.replaceAll('/','_'),new Uint8Array(bytes));},async get(key){const p=path+'/'+key.replaceAll('/','_');if(!existsSync(p))return null;return {body:readFileSync(p)}},async delete(key){const p=path+'/'+key.replaceAll('/','_');if(existsSync(p))unlinkSync(p)}};
}

// ---------------- local development server ----------------
// Development-only identities. Hosted deployments receive identity from the
// platform's authenticated headers; this server strips any inbound identity
// headers and substitutes the selected local identity. Never expose it publicly.
export const DEV_USERS = {
 instructor: {id: 'local-preview', email: 'preview@lane.test', label: 'Instructor (demo workspace)'},
 instructor2: {id: 'dev-instructor-2', email: 'second-instructor@lane.test', label: 'Second instructor (empty)'},
 learner: {id: 'dev-learner', email: 'learner@lane.test', label: 'Learner (Amelia)'},
 learner2: {id: 'dev-learner-2', email: 'learner2@lane.test', label: 'Learner (Ben)'},
 admin: {id: 'dev-admin', email: 'admin@lane.test', label: 'Platform administrator'}
};
function devSignInPage() {
 const items = Object.entries(DEV_USERS).map(([k, u]) => `<li><a href="/dev/sign-in?as=${k}">${u.label}</a> <small>${u.email}</small></li>`).join('');
 return `<!doctype html><html lang="en-GB"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Development sign-in</title><body style="font-family:system-ui;max-width:32rem;margin:2rem auto;padding:0 1rem"><h1>Development sign-in</h1><p>Local preview only. Hosted deployments use the platform's real sign-in.</p><ul style="line-height:2">${items}</ul></body></html>`;
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
 const {handle} = await import('./app.mjs');
 const {processJobs} = await import('./lib/jobs.mjs');
 mkdirSync('.data', {recursive: true});
 const db = database(process.env.DATABASE_PATH || '.data/lane.sqlite');
 const bucket = localBucket();
 const port = Number(process.env.PORT || 5173);
 const env = {BUCKET: bucket, ADMIN_EMAIL: process.env.ADMIN_EMAIL || 'admin@lane.test', ADMIN_USER_ID: process.env.ADMIN_USER_ID || '', JOB_SECRET: process.env.JOB_SECRET || '', PRIVATE_JOB_ACCESS: 'false', MARKETPLACE_ENABLED: process.env.MARKETPLACE_ENABLED || 'false', EMAIL_MODE: process.env.EMAIL_MODE || 'preview', RESEND_API_KEY: process.env.RESEND_API_KEY || '', EMAIL_FROM: process.env.EMAIL_FROM || '', EMAIL_REDIRECT_TO: process.env.EMAIL_REDIRECT_TO || '', APP_URL: process.env.APP_URL || 'http://127.0.0.1:' + port};
 const readAsset = file => { const p = new URL('./public/' + file, import.meta.url); return existsSync(p) ? readFileSync(p) : null; };
 const jobTimer = setInterval(() => processJobs(db, env).catch(e => console.error('job runner error', e.message)), Number(process.env.JOB_INTERVAL_MS || 30000));
 jobTimer.unref?.();
 createServer(async (req, res) => {
  try {
   const url = new URL(req.url, 'http://127.0.0.1:' + port);
   if (url.pathname === '/signin-with-chatgpt' || url.pathname === '/dev/sign-in' && !url.searchParams.get('as')) { res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'}); res.end(devSignInPage()); return; }
   if (url.pathname === '/dev/sign-in') { const as = url.searchParams.get('as'); if (!DEV_USERS[as]) { res.writeHead(400); res.end('Unknown identity'); return; } res.writeHead(302, {'Set-Cookie': `lane_dev=${as}; HttpOnly; SameSite=Lax; Path=/`, Location: DEV_USERS[as].id === 'local-preview' || as.startsWith('instructor') ? '/app' : '/app#/learner'}); res.end(); return; }
   if (url.pathname === '/signout-with-chatgpt') { res.writeHead(302, {'Set-Cookie': 'lane_dev=; Max-Age=0; Path=/', Location: '/'}); res.end(); return; }
   const headers = new Headers();
   for (const [k, v] of Object.entries(req.headers)) if (v) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
   headers.delete('oai-authenticated-user-id'); headers.delete('oai-authenticated-user-email');
   const who = /(?:^|;\s*)lane_dev=([a-z0-9]+)/.exec(req.headers.cookie || '')?.[1];
   const dev = who === '1' ? DEV_USERS.instructor : DEV_USERS[who];
   if (dev) { headers.set('oai-authenticated-user-id', dev.id); headers.set('oai-authenticated-user-email', dev.email); }
   const chunks = []; for await (const c of req) chunks.push(c);
   const body = Buffer.concat(chunks);
   const r = await handle(new Request(url, {method: req.method, headers, body: body.length ? body : undefined}), db, env, readAsset);
   res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) { console.error('server error', e.message); res.writeHead(500); res.end('Server error'); }
 }).listen(port, '127.0.0.1', () => console.log(`Lane preview: http://127.0.0.1:${port}  (email mode: ${env.EMAIL_MODE})`));
}
