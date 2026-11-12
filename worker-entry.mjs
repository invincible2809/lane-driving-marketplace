// Cloudflare Worker entry. fetch serves the site, API and auth; the cron
// trigger runs the durable job queue (reminders, emails, hold clean-up).
import {handle} from './app.mjs';
import {processJobs} from './lib/jobs.mjs';
const decode = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
const worker = {
  async fetch(request, env) {
    // __assets is defined by build.mjs in the bundled output.
    const readAsset = file => (typeof __assets !== 'undefined' && __assets[file]) ? decode(__assets[file]) : null;
    return handle(request, env.DB, env, readAsset);
  },
  async scheduled(_event, env, ctx) { ctx.waitUntil(processJobs(env.DB, env)); }
};
export default worker;
