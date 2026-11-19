// Seeds the local development database with the demo workspace, owned by the
// development identities used by the local dev server's sign-in chooser.
// Usage: npm run seed   (writes to .data/lane.sqlite unless DATABASE_PATH is set)
import {mkdirSync} from 'node:fs';
import {database, DEV_USERS} from '../server.mjs';
import {seedDemo} from '../lib/demo.mjs';
mkdirSync('.data', {recursive: true});
const db = database(process.env.DATABASE_PATH || '.data/lane.sqlite');
if (await db.prepare('SELECT 1 FROM workspaces').first()) { console.log('Database already has a workspace; nothing seeded.'); process.exit(0); }
await seedDemo(db, {APP_URL: 'http://127.0.0.1:5173'}, {instructor: DEV_USERS.instructor, learner: DEV_USERS.learner, learner2: DEV_USERS.learner2});
console.log('Seeded demo workspace, 2 learners, 3 lessons, 1 shared report and 2 enquiries.');
