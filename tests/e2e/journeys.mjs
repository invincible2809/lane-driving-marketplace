// End-to-end journeys in Chromium at phone width against the local dev server.
// Starts its own server on a fresh database, seeds demo data, then drives:
//  visitor enquiry → instructor sees and converts it → instructor books a lesson
//  → learner signs in, sees progress (no private notes) and requests a lesson.
// Optional: AXE_PATH=/path/to/axe.min.js runs automated accessibility checks.
import {spawn, execFileSync} from 'node:child_process';
import {mkdtempSync, existsSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {chromium} = require('playwright');
const port = 5199, base = `http://127.0.0.1:${port}`;
const dir = mkdtempSync(join(tmpdir(), 'lane-e2e-'));
const env = {...process.env, PORT: String(port), DATABASE_PATH: join(dir, 'db.sqlite'), APP_URL: base, JOB_INTERVAL_MS: '1000'};
execFileSync('node', ['scripts/seed-demo.mjs'], {env, stdio: 'ignore'});
const server = spawn('node', ['server.mjs'], {env, stdio: 'ignore'});
const results = [], a11y = [];
const check = (name, ok, detail = '') => { results.push({name, ok, detail}); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const shots = process.env.SHOTS_DIR;
try {
  for (let i = 0; i < 50; i++) { try { await fetch(base + '/'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
  const browser = await chromium.launch();
  const ctx = async () => browser.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: shots ? 2 : 1});
  const errors = [];
  const watch = page => { page.on('pageerror', e => errors.push(e.message)); page.on('console', m => m.type() === 'error' && errors.push(m.text())); };
  const noOverflow = async (page, label) => { const w = await page.evaluate(() => document.documentElement.scrollWidth); check(`no horizontal scroll: ${label}`, w <= 390, `scrollWidth ${w}`); };
  const axe = async (page, label) => {
    if (!process.env.AXE_PATH) return;
    await page.evaluate(readFileSync(process.env.AXE_PATH, 'utf8')); // evaluate is not subject to the page CSP
    const r = await page.evaluate(async () => (await window.axe.run(document, {runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']})).violations.map(v => `${v.id} (${v.impact}) ×${v.nodes.length}`));
    a11y.push({page: label, violations: r});
    check(`axe WCAG A/AA: ${label}`, r.length === 0, r.join('; '));
  };
  const shot = async (page, name) => { if (shots) await page.screenshot({path: join(shots, name + '.png'), fullPage: true}); };

  // 1. Visitor sends an enquiry from the public website.
  const visitorCtx = await ctx(); const v = await visitorCtx.newPage(); watch(v);
  await v.goto(base + '/');
  check('home page shows business name', await v.getByRole('heading', {level: 1}).isVisible() && (await v.content()).includes('SRK'));
  await noOverflow(v, 'home'); await axe(v, 'home'); await shot(v, '01-home');
  await v.goto(base + '/contact?package=intensive');
  await v.getByLabel('Your name').fill('Eva Visitor');
  await v.getByLabel('Mobile number').fill('07000 000009');
  await v.getByLabel('Your area').selectOption('Lichfield');
  await v.getByLabel('When are you usually free?').fill('Weekday evenings');
  await v.waitForTimeout(2600); // minimum fill time used by the spam filter
  await v.getByRole('button', {name: 'Send enquiry'}).click();
  await v.getByText('Please confirm we may contact you').waitFor();
  check('enquiry requires contact consent', true);
  await v.getByLabel(/may contact me about this enquiry/).check();
  await v.getByRole('button', {name: 'Send enquiry'}).click();
  await v.getByText('your enquiry has been sent').waitFor();
  check('visitor enquiry submitted', true);
  await noOverflow(v, 'contact'); await axe(v, 'contact'); await shot(v, '02-contact-sent');

  // 2. Instructor sees and converts the enquiry, books a lesson.
  const instCtx = await ctx(); const p = await instCtx.newPage(); watch(p);
  await p.goto(base + '/dev/sign-in?as=instructor');
  await p.getByRole('heading', {level: 1, name: /^Today/}).waitFor();
  check('dashboard shows new enquiries banner', await p.getByText(/new enquir/).first().isVisible());
  await noOverflow(p, 'dashboard'); await axe(p, 'dashboard'); await shot(p, '03-dashboard');
  await p.goto(base + '/app#/enquiries');
  const card = p.locator('article', {hasText: 'Eva Visitor'});
  await card.waitFor();
  check('enquiry appears in instructor inbox', await card.getByText('Weekday evenings').isVisible());
  await shot(p, '04-enquiries');
  await card.getByRole('button', {name: 'Add as learner'}).click();
  await p.getByRole('heading', {name: 'Eva Visitor'}).waitFor();
  check('enquiry converted to learner record', true);
  await p.getByLabel('New note').fill('PRIVATE-E2E-NOTE');
  await p.getByRole('button', {name: 'Add note'}).click();
  await p.getByText('PRIVATE-E2E-NOTE').waitFor();
  await p.getByRole('link', {name: 'Book lesson'}).click();
  await p.getByRole('heading', {name: 'Add lesson'}).waitFor();
  const tomorrowPlus = new Date(Date.now() + 4 * 864e5).toISOString().slice(0, 10);
  await p.locator('#nld').fill(tomorrowPlus);
  await p.locator('#free button').first().waitFor();
  await p.locator('#free button').first().click();
  await p.getByRole('button', {name: 'Book lesson'}).click();
  await p.getByRole('heading', {name: 'Payment record'}).waitFor();
  check('instructor booked a lesson from free times', await p.locator('.chip.confirmed').first().isVisible());
  await noOverflow(p, 'lesson detail'); await shot(p, '05-lesson');
  for (const view of ['day', 'week', 'list']) {
    await p.goto(`${base}/app#/calendar?view=${view}&date=${tomorrowPlus}`);
    await p.getByRole('heading', {name: 'Calendar'}).waitFor();
    await noOverflow(p, 'calendar ' + view);
  }
  await axe(p, 'calendar'); await shot(p, '06-calendar-list');

  // 3. Learner sees own lessons and shared report, never private notes; requests a lesson.
  const lCtx = await ctx(); const l = await lCtx.newPage(); watch(l);
  await l.goto(base + '/dev/sign-in?as=learner');
  await l.getByRole('heading', {name: 'Your lessons'}).waitFor();
  const text = await l.textContent('main');
  check('learner sees shared progress report', text.includes('Good cockpit checks'));
  check('learner never sees private notes', !text.includes('Private demo note') && !text.includes('PRIVATE-E2E-NOTE'));
  await noOverflow(l, 'learner home'); await axe(l, 'learner home'); await shot(l, '07-learner-home');
  await l.getByRole('link', {name: 'Book a lesson'}).click();
  await l.locator('.days button').first().waitFor();
  let booked = false;
  for (const btn of await l.locator('.days button').all()) {
    await btn.click();
    await l.locator('#slots button, #slots .empty').first().waitFor();
    const slot = l.locator('#slots button').first();
    if (await slot.count()) { await slot.click(); booked = true; break; }
  }
  check('learner found an available time', booked);
  await l.getByRole('heading', {name: 'Check the details'}).waitFor();
  check('cancellation terms shown before confirming', await l.getByText('DEMO TEXT').isVisible());
  await shot(l, '08-learner-review');
  await l.getByLabel('I have read the cancellation terms.').check();
  await l.getByRole('button', {name: /Send request|Confirm booking/}).click();
  await l.getByRole('heading', {name: 'Your lessons'}).waitFor();
  check('learner request created', await l.locator('.chip.requested').first().isVisible());

  // 4. A second learner cannot see the first learner's data.
  const l2Ctx = await ctx(); const l2 = await l2Ctx.newPage(); watch(l2);
  await l2.goto(base + '/dev/sign-in?as=learner2');
  await l2.getByRole('heading', {name: 'Your lessons'}).waitFor();
  check('second learner sees no other learner data', !(await l2.textContent('main')).includes('Good cockpit checks'));

  // 5. Instructor accepts the request.
  await p.goto(base + '/app#/');
  await p.getByRole('heading', {name: /Lesson requests to answer/}).waitFor();
  await p.locator('section', {hasText: 'Lesson requests'}).locator('a.lesson').first().click();
  await p.getByRole('button', {name: 'Accept request'}).click();
  await p.locator('.chip.confirmed').first().waitFor();
  check('instructor accepted learner request', true);
  check('no browser errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
} catch (e) { check('journey completed', false, e.message.split('\n')[0]); }
finally { server.kill(); }
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
