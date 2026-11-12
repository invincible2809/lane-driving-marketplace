// Instructor admin (/app) and learner portal (/account). No framework, no build step.
const $ = (s, el = document) => el.querySelector(s);
const main = $('#main');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const state = {session: null, tz: 'Europe/London', mode: location.pathname.startsWith('/account') ? 'learner' : 'instructor'};
const STATUS = {requested: 'Requested', confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled', no_show: 'No-show', declined: 'Declined'};
const STAGES = {introduced: 'Introduced', practising: 'Practising', improving: 'Improving', consistent: 'Consistent'};
const STAGE_ORDER = ['introduced', 'practising', 'improving', 'consistent'];
const PAY = {unpaid: 'Unpaid', paid: 'Paid', waived: 'Waived'};
const METHODS = {cash: 'Cash', bank_transfer: 'Bank transfer', card: 'Card', other: 'Other'};
const ENQ = {new: 'New', contacted: 'Contacted', converted: 'Learner added', closed: 'Closed'};
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// ---------- formatting ----------
const fmt = (ms, opts) => new Intl.DateTimeFormat('en-GB', {timeZone: state.tz, ...opts}).format(new Date(ms));
const time = ms => fmt(ms, {hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
const day = ms => fmt(ms, {weekday: 'short', day: 'numeric', month: 'short'});
const longDay = ms => fmt(ms, {weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'});
const when = ms => `${day(ms)}, ${time(ms)}`;
const money = p => '£' + (Number(p || 0) / 100).toFixed(2);
const localDate = ms => fmt(ms, {year: 'numeric', month: '2-digit', day: '2-digit'}).split('/').reverse().join('-');
const today = () => localDate(Date.now());
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const dayLabel = d => new Intl.DateTimeFormat('en-GB', {timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short'}).format(new Date(d + 'T12:00:00Z'));
const chip = (key, label, cls = key) => `<span class="chip ${esc(cls)}">${esc(label)}</span>`;
const statusChip = l => chip(l.status, STATUS[l.status]);

// ---------- network & feedback ----------
async function api(path, method = 'GET', body) {
  const r = await fetch('/api/' + path, {method, headers: body ? {'Content-Type': 'application/json'} : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin'});
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || 'Something went wrong. Please try again.'), {status: r.status, data});
  return data;
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove('show'), 4500); }
function render(html, title) {
  main.innerHTML = html;
  document.title = (title ? title + ' · ' : '') + (state.session?.workspace?.business_name || state.session?.site?.business_name || 'Lessons');
  const h = $('h1', main); if (h) { h.tabIndex = -1; h.focus({preventScroll: true}); }
  window.scrollTo(0, 0);
}
const errorBox = e => `<div class="notice bad" role="alert">${esc(e.message)}</div>`;
const formData = form => Object.fromEntries(new FormData(form).entries());
// Wire a form: handler returns a promise; errors appear inside the form.
function onSubmit(form, handler) {
  if (!form) return;
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    const box = form.querySelector('.form-error') || form.insertAdjacentElement('afterbegin', Object.assign(document.createElement('div'), {className: 'form-error'}));
    box.innerHTML = '';
    const btn = form.querySelector('[type=submit]'); if (btn) btn.disabled = true;
    try { await handler(formData(form), ev.submitter); }
    catch (e) { box.innerHTML = errorBox(e); box.scrollIntoView({block: 'nearest'}); }
    finally { if (btn) btn.disabled = false; }
  });
}
function signInHref(next) { return state.session?.site?.google_sign_in ? `/auth/google/start?next=${encodeURIComponent(next)}` : '/signin-with-chatgpt'; }
function header() {
  const s = state.session, who = $('#who');
  if (!s?.user) { who.innerHTML = `<a class="btn small" href="${signInHref(location.pathname)}">Sign in</a>`; return; }
  const other = state.mode === 'instructor' ? (s.learner_links?.length ? '<a href="/account">My lessons</a>' : '') : (s.workspace ? '<a href="/app">Instructor admin</a>' : '');
  who.innerHTML = `${other}<span class="sr">Signed in as </span><span>${esc(s.user.email)}</span><form method="post" action="/auth/logout"><button class="btn ghost small" type="submit">Sign out</button></form>`;
}
function setNav(name) { document.querySelectorAll('[data-nav]').forEach(a => a.dataset.nav === name ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')); }
function route() {
  const [p, q] = (location.hash.slice(1) || '/').split('?');
  return {parts: p.split('/').filter(Boolean), query: new URLSearchParams(q || '')};
}
const go = hash => { if (location.hash === hash) router(); else location.hash = hash; };

// ---------- boot ----------
async function boot() {
  try { state.session = await api('session'); } catch (e) { render(errorBox(e)); return; }
  if (state.session.workspace) state.tz = state.session.workspace.timezone;
  header();
  window.addEventListener('hashchange', router);
  router();
}
async function router() {
  const {parts, query} = route();
  const s = state.session;
  try {
    if (parts[0] === 'invite') return await inviteView(parts[1]);
    if (!s.user) return signedOut();
    if (state.mode === 'learner') { document.body.classList.remove('instructor'); return await learnerRouter(parts, query); }
    if (!s.workspace) {
      if (s.can_create_workspace) return onboardingView();
      if (s.learner_links.length) { location.href = '/account'; return; }
      return render(`<h1>This area is for the instructor</h1><p>You are signed in as ${esc(s.user.email)}. To see your lessons and progress, go to <a href="/account">your learner account</a>.</p>`);
    }
    document.body.classList.add('instructor');
    const views = {'': dashboardView, calendar: calendarView, learners: learnersRouter, lessons: lessonsRouter, enquiries: enquiriesView, reports: reportsView, settings: settingsView, admin: adminView};
    const view = views[parts[0] || ''];
    setNav(parts[0] || 'dashboard');
    if (!view) return render('<h1>Page not found</h1><p><a href="#/">Back to today</a></p>');
    await view(parts, query);
  } catch (e) {
    if (e.data?.code === 'no_workspace') { s.workspace = null; return router(); }
    render(`<h1>Something went wrong</h1>${errorBox(e)}<p><a href="#/">Go back</a></p>`);
  }
}
function signedOut() {
  const learner = state.mode === 'learner';
  render(`<div class="card"><h1>${learner ? 'Your lessons and progress' : 'Instructor sign in'}</h1>
   <p>${learner ? 'Sign in with your Google account to see your upcoming lessons, book times and read the progress reports your instructor shares with you.' : 'Sign in to manage your diary, learners and enquiries.'}</p>
   <p><a class="btn" href="${signInHref(learner ? '/account' : '/app')}">${state.session.site?.google_sign_in ? 'Sign in with Google' : 'Sign in'}</a></p>
   ${learner ? '<p class="small muted">New to us? Sign in and send an enquiry — once your instructor adds you, your lessons appear here. We only use your Google name and email address.</p>' : ''}</div>`, 'Sign in');
}

// ---------- invitations ----------
async function inviteView(token) {
  let info;
  try { info = await api('invitations/inspect', 'POST', {token}); } catch (e) { return render(`<h1>Invitation</h1>${errorBox(e)}`); }
  if (!state.session.user) { try { sessionStorage.setItem('invite', token); } catch {} return render(`<div class="card"><h1>${esc(info.business_name)} has invited you</h1><p>Hello ${esc(info.first_name)}. Sign in to see your lessons and progress.</p><p><a class="btn" href="${signInHref('/account#/invite/' + token)}">Sign in to accept</a></p></div>`, 'Invitation'); }
  if (info.state !== 'valid') return render(`<h1>Invitation</h1><div class="notice warn">This invitation has ${info.state === 'expired' ? 'expired' : 'already been used'}. Ask ${esc(info.business_name)} for a new link if you need one.</div><p><a href="/account">Go to your account</a></p>`);
  render(`<div class="card"><h1>Join ${esc(info.business_name)}</h1><p>Hello ${esc(info.first_name)}. Accepting links your account (${esc(state.session.user.email)}) to your learner record so you can see your lessons and progress reports.</p><form id="accept"><button class="btn" type="submit">Accept invitation</button></form></div>`, 'Invitation');
  onSubmit($('#accept'), async () => { await api('invitations/accept', 'POST', {token}); location.href = '/account'; });
}

// ---------- onboarding ----------
function hoursEditor(hours) {
  const byDay = d => hours.filter(h => h.weekday === d);
  return WEEKDAYS.map((name, i) => { const h = byDay(i + 1)[0]; return `<div class="hours-row"><label class="check"><input type="checkbox" name="on${i + 1}" ${h ? 'checked' : ''}> ${name}</label><label class="sr" for="s${i + 1}">${name} start</label><input id="s${i + 1}" type="time" name="s${i + 1}" value="${h?.start_time || '09:00'}" step="900"><label class="sr" for="e${i + 1}">${name} end</label><input id="e${i + 1}" type="time" name="e${i + 1}" value="${h?.end_time || '17:00'}" step="900"></div>`; }).join('');
}
const readHours = d => WEEKDAYS.map((_, i) => d['on' + (i + 1)] ? {weekday: i + 1, start_time: d['s' + (i + 1)], end_time: d['e' + (i + 1)]} : null).filter(Boolean);
function settingsFields(w = {}) {
  const pounds = w.lesson_price_pence != null ? (w.lesson_price_pence / 100).toFixed(2) : '40.00';
  const reminders = w.reminder_offsets || [48, 24];
  return `<fieldset><legend>Business</legend>
   <div class="field"><label for="bn">Business name</label><input id="bn" name="business_name" required maxlength="80" value="${esc(w.business_name || state.session.site?.business_name || '')}"></div>
   <div class="two"><div class="field"><label for="ce">Contact email <span class="hint">Lesson requests and enquiries are sent here.</span></label><input id="ce" type="email" name="contact_email" value="${esc(w.contact_email ?? state.session.user.email)}"></div>
   <div class="field"><label for="tz">Time zone</label><input id="tz" name="timezone" value="${esc(w.timezone || 'Europe/London')}" list="tzs"><datalist id="tzs"><option>Europe/London</option></datalist></div></div>
   <div class="field"><label for="sa">Service area <span class="hint">Shown to learners. For example: Sutton Coldfield, Kingstanding, Lichfield</span></label><textarea id="sa" name="service_area" maxlength="500">${esc(w.service_area || '')}</textarea></div>
  </fieldset>
  <fieldset><legend>Lessons</legend>
   <div class="field"><span class="label">Transmission</span>${['manual', 'automatic', 'both'].map(t => `<label class="check"><input type="radio" name="transmission" value="${t}" ${(w.transmission || 'automatic') === t ? 'checked' : ''}> ${t === 'both' ? 'Manual and automatic' : t[0].toUpperCase() + t.slice(1)}</label>`).join('')}</div>
   <div class="three"><div class="field"><label for="lm">Standard lesson (minutes)</label><select id="lm" name="lesson_minutes">${[60, 90, 120].map(m => `<option ${w.lesson_minutes === m ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
   <div class="field"><label for="lp">Price for standard lesson (£)</label><input id="lp" name="price" inputmode="decimal" value="${pounds}" required></div>
   <div class="field"><label for="bm">Travel buffer between lessons (minutes)</label><input id="bm" type="number" min="0" max="120" name="buffer_minutes" value="${w.buffer_minutes ?? 15}"></div></div>
  </fieldset>
  <fieldset><legend>Booking rules</legend>
   <div class="three"><div class="field"><label for="nh">Minimum notice for learner bookings (hours)</label><input id="nh" type="number" min="0" max="336" name="notice_hours" value="${w.notice_hours ?? 24}"></div>
   <div class="field"><label for="hd">How far ahead learners can book (days)</label><input id="hd" type="number" min="1" max="365" name="horizon_days" value="${w.horizon_days ?? 56}"></div>
   <div class="field"><label for="ss">Start times every</label><select id="ss" name="slot_step_minutes">${[15, 30, 60].map(m => `<option value="${m}" ${(w.slot_step_minutes ?? 30) === m ? 'selected' : ''}>${m} minutes</option>`).join('')}</select></div></div>
   <label class="check"><input type="checkbox" name="auto_confirm" ${w.auto_confirm ? 'checked' : ''}> Confirm learner bookings automatically <span class="hint">If off, learner bookings arrive as requests for you to accept.</span></label>
  </fieldset>
  <fieldset><legend>Cancellation terms</legend>
   <div class="field"><label for="cn">Cancellation notice (hours)</label><input id="cn" type="number" min="0" max="336" name="cancellation_notice_hours" value="${w.cancellation_notice_hours ?? 48}"></div>
   <div class="field"><label for="cp">Terms shown to learners before they confirm <span class="hint">Write these in your own words. Lane records which version a learner accepted; it does not decide whether a fee is due.</span></label><textarea id="cp" name="cancellation_policy_text" maxlength="2000">${esc(w.policy?.text || '')}</textarea></div>
  </fieldset>
  <fieldset><legend>Email reminders</legend>${[48, 24].map(h => `<label class="check"><input type="checkbox" name="r${h}" ${reminders.includes(h) ? 'checked' : ''}> ${h} hours before each confirmed lesson</label>`).join('')}</fieldset>`;
}
function readSettings(d) {
  const price = Number(String(d.price).replace(/[£,\s]/g, ''));
  if (!Number.isFinite(price) || price < 0) throw new Error('Enter the lesson price in pounds, for example 40.00.');
  const out = {business_name: d.business_name, contact_email: d.contact_email, timezone: d.timezone, service_area: d.service_area, transmission: d.transmission, lesson_minutes: Number(d.lesson_minutes), lesson_price_pence: Math.round(price * 100), buffer_minutes: Number(d.buffer_minutes), notice_hours: Number(d.notice_hours), horizon_days: Number(d.horizon_days), slot_step_minutes: Number(d.slot_step_minutes), auto_confirm: !!d.auto_confirm, cancellation_notice_hours: Number(d.cancellation_notice_hours), reminder_offsets: [48, 24].filter(h => d['r' + h])};
  if (d.cancellation_policy_text?.trim()) out.cancellation_policy_text = d.cancellation_policy_text;
  return out;
}
function onboardingView() {
  document.body.classList.remove('instructor');
  render(`<h1>Set up your workspace</h1><p class="muted">You can change any of this later in Settings.</p>
  <form id="onboard" class="card">${settingsFields()}<fieldset><legend>Working hours</legend><p class="hint">Learners can only book inside these hours. Add holidays and one-off changes later.</p>${hoursEditor([1, 2, 3, 4, 5].map(d => ({weekday: d, start_time: '09:30', end_time: '19:00'})).concat([6, 7].map(d => ({weekday: d, start_time: '09:00', end_time: '14:00'}))))}</fieldset>
  <button class="btn" type="submit">Create workspace</button></form>`, 'Set up');
  onSubmit($('#onboard'), async d => {
    const r = await api('w/onboarding', 'POST', {...readSettings(d), working_hours: readHours(d)});
    state.session.workspace = r.workspace; state.tz = r.workspace.timezone; toast('Workspace created.'); go('#/');
  });
}

// ---------- shared lesson pieces ----------
const lessonRow = (l, {showDay = true} = {}) => `<li><a class="lesson" href="#/lessons/${l.id}"><span class="t">${time(l.start_ms)}<small>${showDay ? day(l.start_ms) : l.minutes + ' min'}</small></span><span><strong>${esc(l.learner_name || '')}</strong>${l.outside_hours ? ' <span class="small muted">(outside hours)</span>' : ''}${l.late_cancellation ? ' <span class="small muted">(late cancellation)</span>' : ''}</span>${statusChip(l)}</a></li>`;
const lessonList = (ls, empty, opts) => ls.length ? `<ul class="list">${ls.map(l => lessonRow(l, opts)).join('')}</ul>` : `<p class="empty">${empty}</p>`;

// ---------- dashboard ----------
async function dashboardView() {
  const d = await api('w/dashboard');
  render(`<div class="spread"><h1>Today, ${esc(dayLabel(d.today))}</h1><a class="btn" href="#/lessons/new">Add lesson</a></div>
  ${d.new_enquiries.count ? `<a class="notice info row" href="#/enquiries"><strong>${d.new_enquiries.count} new ${d.new_enquiries.count === 1 ? 'enquiry' : 'enquiries'}</strong> — ${d.new_enquiries.latest.map(e => esc(e.name)).join(', ')}</a>` : ''}
  ${d.requests.length ? `<section class="card" aria-labelledby="rq"><h2 id="rq">Lesson requests to answer (${d.requests.length})</h2>${lessonList(d.requests)}</section>` : ''}
  <div class="grid cols-2">
   <section class="card" aria-labelledby="tl"><h2 id="tl">Today's lessons</h2>${lessonList(d.today_lessons, 'No lessons today.', {showDay: false})}</section>
   <section class="card" aria-labelledby="up"><h2 id="up">Next 7 days</h2>${lessonList(d.upcoming, 'No confirmed lessons in the next week.')}</section>
   <section class="card" aria-labelledby="un"><h2 id="un">Unpaid (recorded)</h2><p class="stat">${money(d.unpaid.pence)}</p><p class="muted small">${d.unpaid.n} completed ${d.unpaid.n === 1 ? 'lesson' : 'lessons'} marked unpaid. This is what you recorded, not a bank balance.</p></section>
   <section class="card" aria-labelledby="rp"><h2 id="rp">Progress reports</h2>${d.reports_due.length ? `<p>Lessons without a report:</p>${lessonList(d.reports_due)}` : '<p class="empty">No completed lessons are waiting for a report.</p>'}${d.draft_reports.length ? `<h3>Drafts not yet shared</h3><ul class="list">${d.draft_reports.map(r => `<li><a href="#/lessons/${r.lesson_id}">${esc(r.learner_name)} · ${day(r.lesson_start_ms)}</a> ${chip('draft', 'Draft')}</li>`).join('')}</ul>` : ''}<p class="small muted">${d.published_reports} shared with learners so far.</p></section>
   <section class="card" aria-labelledby="rc"><h2 id="rc">Recent cancellations</h2>${lessonList(d.recent_cancellations, 'No cancellations in the last 14 days.')}</section>
   <section class="card" aria-labelledby="nb"><h2 id="nb">Learners with no future lesson</h2>${d.learners_without_booking.length ? `<ul class="list">${d.learners_without_booking.map(r => `<li class="spread"><a href="#/learners/${r.id}">${esc(r.name)}</a><span class="small muted">${r.last_lesson_ms ? 'Last lesson ' + day(r.last_lesson_ms) : 'No lessons yet'}</span></li>`).join('')}</ul>` : '<p class="empty">Every active learner has a lesson booked.</p>'}</section>
  </div>`, 'Today');
}

// ---------- calendar ----------
async function calendarView(_, q) {
  const view = ['day', 'week', 'list'].includes(q.get('view')) ? q.get('view') : 'day';
  const date = q.get('date') || today();
  const from = view === 'week' ? addDays(date, -((new Date(date + 'T12:00:00Z').getUTCDay() + 6) % 7)) : date;
  const to = view === 'day' ? from : addDays(from, view === 'week' ? 6 : 29);
  const c = await api(`w/calendar?from=${from}&to=${to}`);
  const step = view === 'day' ? 1 : view === 'week' ? 7 : 30;
  const nav = `<div class="spread"><div class="tabs" role="tablist" aria-label="Calendar view">${['day', 'week', 'list'].map(v => `<a role="tab" href="#/calendar?view=${v}&date=${date}" ${v === view ? 'aria-selected="true"' : ''}>${v[0].toUpperCase() + v.slice(1)}</a>`).join('')}</div>
   <div class="row"><a class="btn secondary small" href="#/calendar?view=${view}&date=${addDays(date, -step)}" aria-label="Previous">‹</a><a class="btn secondary small" href="#/calendar?view=${view}&date=${today()}">Today</a><a class="btn secondary small" href="#/calendar?view=${view}&date=${addDays(date, step)}" aria-label="Next">›</a><label class="sr" for="jump">Go to date</label><input id="jump" type="date" value="${date}"></div></div>`;
  const items = d => {
    const dayStart = Date.parse(d + 'T00:00:00Z') - 36e5 * 3, inDay = ms => localDate(ms) === d;
    const rows = [
      ...c.days.find(x => x.date === d).windows.map(w => ({at: w.start_ms, html: `<div class="item window"><span class="small">Available ${time(w.start_ms)}–${time(w.end_ms)}</span></div>`})),
      ...c.blocks.filter(b => inDay(b.start_ms) || inDay(b.end_ms - 1) || (b.start_ms < dayStart && b.end_ms > dayStart)).map(b => ({at: b.start_ms, html: `<div class="item block"><strong>${b.kind === 'holiday' ? 'Holiday' : 'Blocked'}</strong> ${time(b.start_ms)}–${time(b.end_ms)} ${esc(b.reason)}</div>`})),
      ...c.holds.filter(h => inDay(h.start_ms)).map(h => ({at: h.start_ms, html: `<div class="item requested"><span class="small">${time(h.start_ms)} — a learner is reviewing this time</span></div>`})),
      ...c.lessons.filter(l => inDay(l.start_ms)).map(l => ({at: l.start_ms, html: `<a class="item ${l.status} lesson" href="#/lessons/${l.id}"><span class="t">${time(l.start_ms)}<small>${l.minutes} min</small></span><span>${esc(l.learner_name)}</span>${statusChip(l)}</a>`}))
    ].sort((a, b) => a.at - b.at);
    const ex = c.days.find(x => x.date === d).exception;
    return (ex ? `<p class="small muted">${ex.kind === 'closed' ? 'Day off' : 'Changed hours'}${ex.note ? ': ' + esc(ex.note) : ''}</p>` : '') + (rows.length ? rows.map(r => r.html).join('') : '<p class="empty small">Not working.</p>');
  };
  let body;
  if (view === 'day') body = `<section class="card timeline"><h2>${esc(dayLabel(date))}</h2>${items(date)}</section>`;
  else if (view === 'week') body = `<div class="week timeline">${c.days.map(d => `<section class="day ${d.date === today() ? 'today' : ''}"><h3><a href="#/calendar?view=day&date=${d.date}">${esc(dayLabel(d.date))}</a></h3>${items(d.date)}</section>`).join('')}</div>`;
  else {
    const active = c.lessons.filter(l => !['cancelled', 'declined'].includes(l.status));
    const groups = [...new Set(active.map(l => localDate(l.start_ms)))];
    body = groups.length ? groups.map(g => `<section class="card"><h2>${esc(dayLabel(g))}</h2>${lessonList(active.filter(l => localDate(l.start_ms) === g), '', {showDay: false})}</section>`).join('') : '<p class="empty card">No lessons in the next 30 days.</p>';
  }
  render(`<div class="spread"><h1>Calendar</h1><div class="row"><a class="btn" href="#/lessons/new?date=${date}">Add lesson</a><a class="btn secondary" href="#/settings?tab=availability">Hours &amp; holidays</a></div></div>${nav}<p class="small muted">Times shown in ${esc(c.timezone)}. Travel buffer: ${c.buffer_minutes} minutes.</p>${body}`, 'Calendar');
  $('#jump').addEventListener('change', e => e.target.value && go(`#/calendar?view=${view}&date=${e.target.value}`));
}

// ---------- learners ----------
async function learnersRouter(parts, q) {
  if (parts[1] === 'new') return learnerForm();
  if (parts[1]) return learnerDetail(parts[1]);
  const archived = q.get('status') === 'archived';
  const {learners} = await api('w/learners' + (archived ? '?status=archived' : ''));
  render(`<div class="spread"><h1>Learners</h1><a class="btn" href="#/learners/new">Add learner</a></div>
   <div class="tabs"><a href="#/learners" ${!archived ? 'aria-current="page"' : ''}>Active</a><a href="#/learners?status=archived" ${archived ? 'aria-current="page"' : ''}>Archived</a></div>
   <div class="field"><label for="filter" class="sr">Search learners</label><input id="filter" type="search" placeholder="Search by name"></div>
   <section class="card">${learners.length ? `<ul class="list" id="ll">${learners.map(r => `<li data-name="${esc(r.name.toLowerCase())}"><a class="spread" href="#/learners/${r.id}"><span><strong>${esc(r.name)}</strong><br><span class="small muted">${r.next_lesson_ms ? 'Next: ' + when(r.next_lesson_ms) : 'No lesson booked'}</span></span><span class="row">${r.unpaid_pence ? chip('unpaid', money(r.unpaid_pence) + ' unpaid') : ''}${r.linked ? chip('neutral', 'Has account') : ''}</span></a></li>`).join('')}</ul>` : `<p class="empty">${archived ? 'No archived learners.' : 'No learners yet. Add one, or convert a website enquiry.'}</p>`}</section>`, 'Learners');
  $('#filter').addEventListener('input', e => document.querySelectorAll('#ll li').forEach(li => { li.hidden = !li.dataset.name.includes(e.target.value.toLowerCase()); }));
}
function learnerFields(r = {}) {
  const w = state.session.workspace;
  return `<div class="two"><div class="field"><label for="ln">Name</label><input id="ln" name="name" required maxlength="80" value="${esc(r.name || '')}" autocomplete="off"></div>
   <div class="field"><label for="lph">Phone</label><input id="lph" name="phone" type="tel" value="${esc(r.phone || '')}"></div></div>
   <div class="field"><label for="le">Email <span class="hint">Used for lesson emails and Google sign-in matching.</span></label><input id="le" name="email" type="email" value="${esc(r.email || '')}"></div>
   <div class="two"><div class="field"><label for="lt">Transmission</label><select id="lt" name="transmission">${['automatic', 'manual'].map(t => `<option value="${t}" ${(r.transmission || 'automatic') === t ? 'selected' : ''}>${t[0].toUpperCase() + t.slice(1)}</option>`).join('')}</select></div>
   <div class="field"><label for="lpm">Preferred lesson length</label><select id="lpm" name="preferred_minutes"><option value="">Standard</option>${[60, 90, 120].map(m => `<option ${r.preferred_minutes === m ? 'selected' : ''}>${m}</option>`).join('')}</select></div></div>
   <div class="field"><label for="lpu">Pickup location <span class="hint">Private: not included in emails.</span></label><input id="lpu" name="pickup_location" maxlength="200" value="${esc(r.pickup_location || '')}"></div>
   <div class="field"><label for="lav">Availability preferences</label><textarea id="lav" name="availability_notes" maxlength="500">${esc(r.availability_notes || '')}</textarea></div>`;
}
const readLearner = d => ({...d, preferred_minutes: d.preferred_minutes ? Number(d.preferred_minutes) : null});
function learnerForm() {
  render(`<h1>Add learner</h1><form id="lf" class="card">${learnerFields()}<p class="small muted">Do not record driving-licence numbers or other identity documents here.</p><button class="btn" type="submit">Save learner</button></form>`, 'Add learner');
  onSubmit($('#lf'), async d => { const r = await api('w/learners', 'POST', readLearner(d)); toast('Learner added.'); go('#/learners/' + r.learner.id); });
}
const progressBars = progress => `<ul class="list">${progress.map(p => `<li class="skill-row"><span>${esc(p.name)}<br><span class="small muted">${esc(p.area)}</span></span><span><span class="small">${p.stage ? STAGES[p.stage] : 'Not started'}</span><span class="progress-bar" aria-hidden="true">${STAGE_ORDER.map((s, i) => `<span class="${p.stage && STAGE_ORDER.indexOf(p.stage) >= i ? 'on' : ''}"></span>`).join('')}</span></span></li>`).join('')}</ul>`;
async function learnerDetail(id) {
  const d = await api('w/learners/' + id);
  const r = d.learner, upcoming = d.lessons.filter(l => l.start_ms > Date.now() && ['requested', 'confirmed'].includes(l.status)).reverse(), past = d.lessons.filter(l => !upcoming.includes(l));
  const inv = d.invitations[0];
  render(`<div class="spread"><h1>${esc(r.name)}</h1><div class="row"><a class="btn" href="#/lessons/new?learner=${r.id}">Book lesson</a></div></div>
  ${r.status === 'archived' ? '<div class="notice warn">Archived. Restore this learner to book lessons.</div>' : ''}
  <div class="grid cols-2">
   <section class="card"><h2>Lessons</h2><h3>Upcoming</h3>${lessonList(upcoming.map(l => ({...l, learner_name: ''})), 'Nothing booked.')}<h3>History</h3>${lessonList(past.map(l => ({...l, learner_name: ''})), 'No past lessons.')}</section>
   <section class="card"><h2>Account access</h2>${r.linked ? '<p>This learner has signed in and can see their lessons and shared reports.</p>' : `<p>Not linked yet. If their email above matches the Google account they sign in with, it links automatically. Or send an invitation link.</p>${inv && !inv.accepted_ms && !inv.revoked_ms && inv.expires_ms > Date.now() ? `<p class="small muted">Invitation sent ${day(inv.created_ms)}, expires ${day(inv.expires_ms)}.</p>` : ''}<button class="btn secondary" id="invite" ${r.status !== 'active' ? 'disabled' : ''}>Create invitation link</button><div id="invite-out"></div>`}</section>
   <section class="card"><h2>Progress</h2>${d.progress.some(p => p.stage) ? progressBars(d.progress.filter(p => p.stage)) : '<p class="empty">No shared reports yet.</p>'}<h3>Reports</h3>${d.reports.length ? `<ul class="list">${d.reports.map(p => `<li class="spread"><a href="#/lessons/${p.lesson_id}">${day(p.lesson_start_ms)}</a>${chip(p.status, p.status === 'published' ? 'Shared' : 'Draft')}</li>`).join('')}</ul>` : '<p class="empty">None yet.</p>'}</section>
   <section class="card private" aria-labelledby="pn"><h2 id="pn">Private notes</h2><p class="small muted">Only you can see these. They are never shown to the learner or included in reports.</p><form id="note"><label for="nb" class="sr">New note</label><textarea id="nb" name="body" maxlength="4000" required></textarea><button class="btn secondary small" type="submit">Add note</button></form><ul class="list">${d.notes.map(n => `<li><p>${esc(n.body)}</p><div class="spread small muted">${when(n.created_ms)}<button class="btn ghost small" data-del="${n.id}">Delete</button></div></li>`).join('')}</ul></section>
  </div>
  <details class="card"><summary><strong>Edit details</strong></summary><form id="edit">${learnerFields(r)}<div class="row"><button class="btn" type="submit">Save</button><button class="btn danger" type="button" id="archive">${r.status === 'active' ? 'Archive learner' : 'Restore learner'}</button></div></form></details>`, r.name);
  onSubmit($('#edit'), async d2 => { await api('w/learners/' + id, 'PATCH', readLearner(d2)); toast('Saved.'); learnerDetail(id); });
  onSubmit($('#note'), async d2 => { await api(`w/learners/${id}/notes`, 'POST', d2); learnerDetail(id); });
  $('#archive').addEventListener('click', async () => { try { await api('w/learners/' + id, 'PATCH', {status: r.status === 'active' ? 'archived' : 'active'}); learnerDetail(id); } catch (e) { toast(e.message); } });
  main.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => { if (!confirm('Delete this note?')) return; await api(`w/learners/${id}/notes/${b.dataset.del}`, 'DELETE'); learnerDetail(id); }));
  $('#invite')?.addEventListener('click', async () => {
    try {
      const x = await api(`w/learners/${id}/invitations`, 'POST', {});
      $('#invite-out').innerHTML = `<div class="notice ok"><p><strong>Invitation link</strong> (expires ${day(x.expires_ms)}, single use):</p><label class="sr" for="il">Invitation link</label><input id="il" readonly value="${esc(x.link)}"><p class="small">${x.emailed ? (state.session.email_mode === 'preview' ? 'An email was prepared in preview mode only — it was not sent. Copy the link and share it yourself.' : 'An email with this link has been queued.') : 'No email on file — copy the link and share it yourself.'}</p><button class="btn small secondary" id="copy">Copy link</button></div>`;
      $('#copy').addEventListener('click', () => navigator.clipboard?.writeText(x.link).then(() => toast('Copied.')));
    } catch (e) { toast(e.message); }
  });
}

// ---------- lessons ----------
async function lessonsRouter(parts, q) { return parts[1] === 'new' ? newLessonView(q) : lessonDetail(parts[1]); }
async function newLessonView(q) {
  const {learners} = await api('w/learners');
  const w = state.session.workspace;
  if (!learners.length) return render('<h1>Add lesson</h1><p class="empty card">Add a learner first. <a href="#/learners/new">Add learner</a></p>');
  const pre = q.get('learner') || learners[0].id;
  render(`<h1>Add lesson</h1><form id="nl" class="card">
   <div class="field"><label for="nll">Learner</label><select id="nll" name="learner_id">${learners.map(r => `<option value="${r.id}" ${r.id === pre ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></div>
   <div class="two"><div class="field"><label for="nld">Date</label><input id="nld" type="date" name="date" required value="${q.get('date') || today()}"></div>
   <div class="field"><label for="nlm">Length (minutes)</label><select id="nlm" name="minutes">${[60, 90, 120].map(m => `<option>${m}</option>`).join('')}</select></div></div>
   <div class="field"><span class="label" id="fslbl"><strong>Free times</strong> <span class="hint">Based on your hours, lessons, holidays and travel buffer.</span></span><div id="free" class="slots" role="group" aria-labelledby="fslbl"></div></div>
   <div class="field"><label for="nlt">Start time</label><input id="nlt" type="time" name="time" required step="300"></div>
   <div class="field"><label for="nlp">Price (£) <span class="hint">Leave blank to use your standard price.</span></label><input id="nlp" name="price" inputmode="decimal"></div>
   <fieldset><legend>Repeat</legend><label class="check"><input type="checkbox" name="repeat" id="rep"> Repeat weekly</label>
    <div id="repeat-opts" hidden><div class="two"><div class="field"><label for="rc">Number of lessons</label><input id="rc" type="number" name="count" min="2" max="26" value="6"></div><div class="field"><label for="re">Every</label><select id="re" name="every_weeks"><option value="1">week</option><option value="2">2 weeks</option></select></div></div>
     <p><strong>If a date conflicts:</strong></p><label class="check"><input type="radio" name="mode" value="all_or_nothing" checked> <span>Create none of the lessons <span class="hint">Nothing is booked until every date is free.</span></span></label><label class="check"><input type="radio" name="mode" value="skip_conflicts"> <span>Skip conflicting dates and list them <span class="hint">You can then book those dates individually.</span></span></label>
     <button class="btn secondary small" type="submit" name="preview" value="1">Check dates</button><div id="plan"></div></div></fieldset>
   <button class="btn" type="submit">Book lesson</button></form>`, 'Add lesson');
  const f = $('#nl');
  $('#rep').addEventListener('change', e => { $('#repeat-opts').hidden = !e.target.checked; });
  async function loadFree() {
    const d = f.elements.date.value; if (!d) return;
    try { const {slots} = await api(`w/availability?date=${d}&minutes=${f.elements.minutes.value}`); $('#free').innerHTML = slots.length ? slots.map(s => `<button type="button" aria-pressed="false" data-t="${time(s.start_ms)}">${time(s.start_ms)}</button>`).join('') : '<p class="empty small">No free times that day. You can still enter a time outside your hours below.</p>'; }
    catch (e) { $('#free').innerHTML = errorBox(e); }
  }
  $('#free').addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (!b) return; f.elements.time.value = b.dataset.t; $('#free').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); });
  f.elements.date.addEventListener('change', loadFree); f.elements.minutes.addEventListener('change', loadFree); loadFree();
  onSubmit(f, async (d, submitter) => {
    const body = {learner_id: d.learner_id, date: d.date, time: d.time, minutes: Number(d.minutes)};
    if (d.price) body.price_pence = Math.round(Number(d.price) * 100);
    if (d.repeat) {
      Object.assign(body, {count: Number(d.count), every_weeks: Number(d.every_weeks), mode: d.mode});
      if (submitter?.name === 'preview') { const p = await api('w/lessons/series', 'POST', {...body, dry_run: true}); $('#plan').innerHTML = `<ul class="list">${p.plan.map(x => `<li class="spread"><span>${esc(dayLabel(x.date))}</span>${x.ok ? chip('confirmed', 'Free') : `<span>${chip('cancelled', 'Conflict')} <span class="small">${esc(x.message)}</span></span>`}</li>`).join('')}</ul>`; return; }
      try { const r = await api('w/lessons/series', 'POST', body); toast(`${r.created} lessons booked${r.skipped.length ? `, ${r.skipped.length} skipped` : ''}.`); go('#/learners/' + d.learner_id); }
      catch (e) { if (e.data?.plan) $('#plan').innerHTML = `<ul class="list">${e.data.plan.map(x => `<li class="spread"><span>${esc(dayLabel(x.date))}</span>${x.ok ? chip('confirmed', 'Free') : chip('cancelled', 'Conflict')}</li>`).join('')}</ul>`; throw e; }
      return;
    }
    try { const r = await api('w/lessons', 'POST', body); toast('Lesson booked.'); go('#/lessons/' + r.lesson.id); }
    catch (e) {
      if (e.data?.code === 'outside_hours' && confirm('That time is outside your working hours. Book it anyway?')) { const r = await api('w/lessons', 'POST', {...body, allow_outside_hours: true}); toast('Lesson booked.'); go('#/lessons/' + r.lesson.id); return; }
      throw e;
    }
  });
}
async function lessonDetail(id) {
  const d = await api('w/lessons/' + id);
  const l = d.lesson, started = Date.now() >= l.start_ms, active = ['requested', 'confirmed'].includes(l.status);
  const act = (a, label, cls = 'secondary') => `<button class="btn ${cls}" data-act="${a}">${label}</button>`;
  const actions = [l.status === 'requested' && act('confirm', 'Accept request', ''), l.status === 'requested' && act('decline', 'Decline', 'danger'), l.status === 'confirmed' && started && act('complete', 'Mark completed', ''), l.status === 'confirmed' && started && act('no_show', 'Mark no-show'), active && act('cancel', 'Cancel lesson', 'danger')].filter(Boolean).join('');
  const r = d.report, skillStage = id2 => r?.skills.find(s => s.skill_id === id2)?.stage || '';
  const areas = [...new Set(d.skills.map(s => s.area))];
  const reportHtml = l.status !== 'completed' ? '<p class="empty">You can write a progress report once the lesson is marked completed.</p>' : r?.status === 'published'
    ? `<div class="notice ok">Shared with ${esc(d.learner.name)} on ${when(r.published_ms)}.</div><dl class="kv"><dt>Observations</dt><dd>${esc(r.observations) || '—'}</dd><dt>Next goals</dt><dd>${esc(r.next_goals) || '—'}</dd></dl><ul class="list">${r.skills.map(s => `<li class="spread">${esc(d.skills.find(k => k.id === s.skill_id)?.name || '')}${chip('neutral', STAGES[s.stage])}</li>`).join('')}</ul><button class="btn secondary" id="withdraw">Withdraw to edit</button>`
    : `<form id="report"><p class="small muted">Record what you covered. Stages describe progress in your own judgement; they are not DVSA assessments. Your private notes are kept separately and never appear here.</p>${areas.map(a => `<h3>${esc(a)}</h3>${d.skills.filter(s => s.area === a).map(s => `<div class="skill-row"><label for="sk-${s.id}">${esc(s.name)}</label><select id="sk-${s.id}" name="sk:${s.id}"><option value="">Not covered</option>${STAGE_ORDER.map(st => `<option value="${st}" ${skillStage(s.id) === st ? 'selected' : ''}>${STAGES[st]}</option>`).join('')}</select></div>`).join('')}`).join('')}
      <div class="field"><label for="obs">Observations (shared with learner)</label><textarea id="obs" name="observations" maxlength="4000">${esc(r?.observations || '')}</textarea></div>
      <div class="field"><label for="ng">Next goals (shared with learner)</label><textarea id="ng" name="next_goals" maxlength="2000">${esc(r?.next_goals || '')}</textarea></div>
      <div class="row"><button class="btn secondary" type="submit" name="save" value="draft">Save draft</button><button class="btn" type="submit" name="save" value="publish">Save and share with learner</button></div>${r ? `<p class="small muted">${chip('draft', 'Draft')} not visible to the learner yet.</p>` : ''}</form>`;
  render(`<p><a href="#/learners/${l.learner_id}">← ${esc(d.learner.name)}</a></p><div class="spread"><h1>${esc(longDay(l.start_ms))}</h1>${statusChip(l)}</div>
  <div class="grid cols-2">
   <section class="card"><dl class="kv"><dt>Time</dt><dd>${time(l.start_ms)}–${time(l.end_ms)} (${l.minutes} min)</dd><dt>Learner</dt><dd><a href="#/learners/${l.learner_id}">${esc(d.learner.name)}</a>${d.learner.phone ? ` · <a href="tel:${esc(d.learner.phone)}">${esc(d.learner.phone)}</a>` : ''}</dd><dt>Pickup</dt><dd>${esc(l.pickup_location) || '—'}</dd><dt>Transmission</dt><dd>${esc(l.transmission)}</dd><dt>Booked by</dt><dd>${l.created_role === 'learner' ? 'Learner' : 'You'}</dd>${d.policy ? `<dt>Terms accepted</dt><dd>Version ${d.policy.version} (${d.policy.notice_hours} hours' notice)</dd>` : ''}${l.cancel_reason ? `<dt>Reason</dt><dd>${esc(l.cancel_reason)}</dd>` : ''}${l.late_cancellation ? '<dt>Note</dt><dd>Cancelled inside the notice period</dd>' : ''}</dl>
    ${actions ? `<div class="row">${actions}</div>` : ''}
    ${active ? `<details><summary><strong>Move this lesson</strong></summary><form id="move"><div class="two"><div class="field"><label for="md">New date</label><input id="md" type="date" name="date" required value="${localDate(l.start_ms)}"></div><div class="field"><label for="mt">New start time</label><input id="mt" type="time" name="time" required value="${time(l.start_ms)}" step="300"></div></div><p class="small muted">Old reminders are cancelled and the learner is emailed the new time.</p><button class="btn" type="submit">Move lesson</button></form></details>` : ''}</section>
   <section class="card"><h2>Payment record</h2><p class="small muted">For your records only — no money is taken through this system.</p><form id="pay"><div class="three"><div class="field"><label for="pp">Price (£)</label><input id="pp" name="price" inputmode="decimal" value="${(l.price_pence / 100).toFixed(2)}"></div><div class="field"><label for="ps">Status</label><select id="ps" name="payment_status">${Object.entries(PAY).map(([k, v]) => `<option value="${k}" ${l.payment_status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div><div class="field"><label for="pm">Method</label><select id="pm" name="payment_method"><option value="">—</option>${Object.entries(METHODS).map(([k, v]) => `<option value="${k}" ${l.payment_method === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div></div><button class="btn secondary" type="submit">Save payment record</button></form></section>
  </div>
  <section class="card"><h2>Progress report</h2>${reportHtml}</section>
  <details class="card"><summary><strong>History</strong></summary><ul class="list">${d.events.map(e => `<li class="small">${when(e.created_ms)} · ${esc(e.actor_role)} · ${esc(e.action.replace('_', ' '))}${e.to_status && e.to_status !== e.from_status ? ` → ${esc(STATUS[e.to_status])}` : ''}</li>`).join('')}</ul></details>`, 'Lesson');
  const patch = async body => { await api('w/lessons/' + id, 'PATCH', {expected_revision: l.revision, ...body}); lessonDetail(id); };
  main.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', async () => {
    const a = b.dataset.act; let reason;
    if (a === 'cancel' || a === 'decline') { reason = prompt(a === 'cancel' ? 'Reason for cancelling (sent to your records only):' : 'Reason (optional):'); if (reason === null) return; }
    try { await patch({action: a, reason}); toast('Lesson updated.'); } catch (e) { toast(e.message); }
  }));
  onSubmit($('#move'), async m => {
    try { await patch({action: 'reschedule', date: m.date, time: m.time}); toast('Lesson moved.'); }
    catch (e) { if (e.data?.code === 'outside_hours' && confirm('That time is outside your working hours. Move it anyway?')) { await patch({action: 'reschedule', date: m.date, time: m.time, allow_outside_hours: true}); return; } throw e; }
  });
  onSubmit($('#pay'), async p => { await api('w/lessons/' + id, 'PATCH', {action: 'payment', payment_status: p.payment_status, payment_method: p.payment_method || undefined, price_pence: Math.round(Number(p.price) * 100)}); toast('Payment record saved.'); lessonDetail(id); });
  onSubmit($('#report'), async (rp, submitter) => {
    const skills = Object.entries(rp).filter(([k, v]) => k.startsWith('sk:') && v).map(([k, v]) => ({skill_id: k.slice(3), stage: v}));
    await api(`w/lessons/${id}/report`, 'PUT', {skills, observations: rp.observations, next_goals: rp.next_goals});
    if (submitter?.value === 'publish') { await api(`w/lessons/${id}/report/publish`, 'POST', {}); toast('Report shared with learner.'); } else toast('Draft saved.');
    lessonDetail(id);
  });
  $('#withdraw')?.addEventListener('click', async () => { await api(`w/lessons/${id}/report/withdraw`, 'POST', {}); lessonDetail(id); });
}

// ---------- enquiries ----------
async function enquiriesView(_, q) {
  const status = q.get('status') || 'new';
  const d = await api('w/enquiries' + (status === 'all' ? '' : '?status=' + status));
  const count = s => d.counts.find(c => c.status === s)?.n || 0;
  render(`<h1>Website enquiries</h1>
   <div class="tabs">${['new', 'contacted', 'converted', 'closed', 'all'].map(s => `<a href="#/enquiries?status=${s}" ${s === status ? 'aria-current="page"' : ''}>${s === 'all' ? 'All' : ENQ[s]}${s !== 'all' ? ` (${count(s)})` : ''}</a>`).join('')}</div>
   ${d.enquiries.length ? d.enquiries.map(e => `<article class="card"><div class="spread"><h2>${esc(e.name)}</h2>${chip(e.status === 'new' ? 'requested' : e.status === 'converted' ? 'confirmed' : 'neutral', ENQ[e.status])}</div>
    <dl class="kv"><dt>Received</dt><dd>${when(e.created_ms)}</dd>${e.phone ? `<dt>Phone</dt><dd><a href="tel:${esc(e.phone)}">${esc(e.phone)}</a></dd>` : ''}${e.email ? `<dt>Email</dt><dd><a href="mailto:${esc(e.email)}">${esc(e.email)}</a></dd>` : ''}${e.area ? `<dt>Area</dt><dd>${esc(e.area)}</dd>` : ''}${e.package ? `<dt>Interested in</dt><dd>${esc(e.package)}</dd>` : ''}${e.experience ? `<dt>Experience</dt><dd>${esc(e.experience)}</dd>` : ''}${e.preferred_times ? `<dt>Free</dt><dd>${esc(e.preferred_times)}</dd>` : ''}${e.message ? `<dt>Message</dt><dd>${esc(e.message)}</dd>` : ''}<dt>Account</dt><dd>${e.has_account ? 'Signed in with Google' : 'No account yet'}</dd><dt>Marketing</dt><dd>${e.marketing_opt_in ? 'Opted in' : 'Not opted in'}</dd></dl>
    <form data-enq="${e.id}"><label for="en-${e.id}">Your note</label><input id="en-${e.id}" name="instructor_note" value="${esc(e.instructor_note)}" maxlength="1000"><div class="row">${e.status === 'converted' ? `<a class="btn secondary" href="#/learners/${e.learner_id}">Open learner</a>` : `<button class="btn" type="submit" name="do" value="convert">Add as learner</button>${e.status !== 'contacted' ? '<button class="btn secondary" type="submit" name="do" value="contacted">Mark contacted</button>' : ''}${e.status !== 'closed' ? '<button class="btn ghost" type="submit" name="do" value="closed">Close</button>' : ''}`}<button class="btn ghost" type="submit" name="do" value="note">Save note</button></div></form></article>`).join('') : '<p class="empty card">No enquiries here.</p>'}`, 'Enquiries');
  main.querySelectorAll('[data-enq]').forEach(f => onSubmit(f, async (v, submitter) => {
    const id = f.dataset.enq, act = submitter?.value;
    if (act === 'convert') { const r = await api(`w/enquiries/${id}/convert`, 'POST', {}); toast('Learner added.'); go('#/learners/' + r.learner.id); return; }
    await api('w/enquiries/' + id, 'PATCH', {instructor_note: v.instructor_note, ...(act !== 'note' ? {status: act} : {})});
    toast('Saved.'); enquiriesView(_, q);
  }));
}

// ---------- reports ----------
async function reportsView(_, q) {
  const from = q.get('from') || addDays(today(), -29), to = q.get('to') || today();
  const d = await api(`w/reports?from=${from}&to=${to}`);
  const by = s => d.by_status.find(x => x.status === s) || {n: 0, pence: 0};
  const received = d.marked_paid.reduce((a, x) => a + x.pence, 0);
  render(`<h1>Reports</h1><form id="range" class="card row"><div class="field"><label for="rf">From</label><input id="rf" type="date" name="from" value="${from}"></div><div class="field"><label for="rt">To</label><input id="rt" type="date" name="to" value="${to}"></div><button class="btn secondary" type="submit">Show</button></form>
   <div class="grid cols-3">
    <section class="card"><h2>Lessons</h2><dl class="kv">${Object.keys(STATUS).map(s => `<dt>${STATUS[s]}</dt><dd>${by(s).n}</dd>`).join('')}</dl></section>
    <section class="card"><h2>Cancellations</h2><p class="stat">${by('cancelled').n}</p><p class="muted small">${d.late_cancellations} inside your notice period.</p></section>
    <section class="card"><h2>Money</h2><dl class="kv"><dt>Recorded lesson value</dt><dd>${money(d.recorded_value_pence)}</dd><dt>Marked as paid</dt><dd>${money(received)}</dd><dt>Unpaid (recorded)</dt><dd>${money(d.unpaid.pence)}</dd></dl>${d.marked_paid.length ? `<h3>Paid by method</h3><dl class="kv">${d.marked_paid.map(m => `<dt>${METHODS[m.method] || 'Not given'}</dt><dd>${money(m.pence)}</dd>`).join('')}</dl>` : ''}<p class="small muted">Recorded value is the price of completed lessons in this period. "Marked as paid" is what you recorded as received in this period — check your bank statements for actual money received.</p></section>
   </div>`, 'Reports');
  onSubmit($('#range'), async v => go(`#/reports?from=${v.from}&to=${v.to}`));
}

// ---------- settings ----------
async function settingsView(_, q) {
  const tab = q.get('tab') || 'business';
  const tabs = {business: 'Business & booking', availability: 'Hours & holidays', skills: 'Skills checklist', messages: 'Sent emails', audit: 'Activity log'};
  const head = `<h1>Settings</h1><div class="tabs">${Object.entries(tabs).map(([k, v]) => `<a href="#/settings?tab=${k}" ${k === tab ? 'aria-current="page"' : ''}>${v}</a>`).join('')}</div>`;
  if (tab === 'business') {
    const {workspace: w} = await api('w/settings');
    render(`${head}<form id="sf" class="card">${settingsFields(w)}<p class="small muted">Current cancellation terms: version ${w.policy.version}. Changing them creates a new version; existing bookings keep the version the learner accepted.</p><button class="btn" type="submit">Save settings</button></form>`, 'Settings');
    onSubmit($('#sf'), async d => { const r = await api('w/settings', 'PATCH', readSettings(d)); state.session.workspace = r.workspace; state.tz = r.workspace.timezone; toast('Settings saved.'); });
  } else if (tab === 'availability') {
    const [{hours}, {exceptions}, cal] = await Promise.all([api('w/hours'), api('w/exceptions'), api(`w/calendar?from=${today()}&to=${addDays(today(), 60)}`)]);
    render(`${head}
     <form id="hf" class="card"><h2>Weekly working hours</h2>${hoursEditor(hours)}<p class="small muted">One period per day here. Learners can only book inside these hours.</p><button class="btn" type="submit">Save hours</button></form>
     <section class="card"><h2>Holidays and blocked time</h2><form id="hol" class="row"><div class="field"><label for="hf1">From</label><input id="hf1" type="date" name="from_date" required></div><div class="field"><label for="hf2">To</label><input id="hf2" type="date" name="to_date" required></div><div class="field"><label for="hr">Reason (private)</label><input id="hr" name="reason" maxlength="120"></div><button class="btn secondary" type="submit">Add holiday</button></form>
      <form id="blk" class="row"><div class="field"><label for="bd">Date</label><input id="bd" type="date" name="date" required></div><div class="field"><label for="bs">From</label><input id="bs" type="time" name="start_time" required></div><div class="field"><label for="be">To</label><input id="be" type="time" name="end_time" required></div><div class="field"><label for="br">Reason (private)</label><input id="br" name="reason" maxlength="120"></div><button class="btn secondary" type="submit">Block time</button></form>
      <ul class="list">${cal.blocks.map(b => `<li class="spread"><span>${b.kind === 'holiday' ? 'Holiday' : 'Blocked'}: ${when(b.start_ms)} – ${when(b.end_ms)} ${esc(b.reason)}</span><button class="btn ghost small" data-block="${b.id}">Remove</button></li>`).join('') || '<li class="empty">No holidays or blocks in the next 60 days.</li>'}</ul></section>
     <section class="card"><h2>One-off changes</h2><form id="exf" class="row"><div class="field"><label for="exd">Date</label><input id="exd" type="date" name="day" required></div><div class="field"><label for="exk">Change</label><select id="exk" name="kind"><option value="closed">Day off</option><option value="hours">Different hours</option></select></div><div class="field"><label for="exs">From</label><input id="exs" type="time" name="start_time"></div><div class="field"><label for="exe">To</label><input id="exe" type="time" name="end_time"></div><button class="btn secondary" type="submit">Add change</button></form>
      <ul class="list">${exceptions.map(x => `<li class="spread"><span>${esc(dayLabel(x.day))}: ${x.kind === 'closed' ? 'Day off' : `${x.start_time}–${x.end_time}`}</span><button class="btn ghost small" data-ex="${x.id}">Remove</button></li>`).join('') || '<li class="empty">None.</li>'}</ul></section>`, 'Hours & holidays');
    const reload = () => settingsView(_, q);
    onSubmit($('#hf'), async d => { await api('w/hours', 'PUT', {hours: readHours(d)}); toast('Hours saved.'); });
    onSubmit($('#hol'), async d => { await api('w/blocks', 'POST', d); toast('Holiday added.'); reload(); });
    onSubmit($('#blk'), async d => { await api('w/blocks', 'POST', d); toast('Time blocked.'); reload(); });
    onSubmit($('#exf'), async d => { await api('w/exceptions', 'POST', d); toast('Change added.'); reload(); });
    main.querySelectorAll('[data-block]').forEach(b => b.addEventListener('click', async () => { await api('w/blocks/' + b.dataset.block, 'DELETE'); reload(); }));
    main.querySelectorAll('[data-ex]').forEach(b => b.addEventListener('click', async () => { await api('w/exceptions/' + b.dataset.ex, 'DELETE'); reload(); }));
  } else if (tab === 'skills') {
    const {skills} = await api('w/skills');
    render(`${head}<section class="card"><h2>Driving-skills checklist</h2><p class="small muted">Used in progress reports. Archived skills stay in old reports.</p><ul class="list">${skills.map(s => `<li class="spread"><span>${esc(s.name)} <span class="small muted">${esc(s.area)}</span></span><button class="btn ghost small" data-skill="${s.id}" data-arch="${s.archived ? 0 : 1}">${s.archived ? 'Restore' : 'Archive'}</button></li>`).join('')}</ul>
     <form id="skf" class="row"><div class="field"><label for="ska">Area</label><input id="ska" name="area" maxlength="60" placeholder="Road skills"></div><div class="field"><label for="skn">Skill</label><input id="skn" name="name" required maxlength="80"></div><button class="btn secondary" type="submit">Add skill</button></form></section>`, 'Skills');
    onSubmit($('#skf'), async d => { await api('w/skills', 'POST', d); settingsView(_, q); });
    main.querySelectorAll('[data-skill]').forEach(b => b.addEventListener('click', async () => { await api('w/skills/' + b.dataset.skill, 'PATCH', {archived: b.dataset.arch === '1'}); settingsView(_, q); }));
  } else if (tab === 'messages') {
    const {messages, email_mode} = await api('w/messages');
    render(`${head}${email_mode === 'preview' ? '<div class="notice warn"><strong>Preview mode:</strong> emails are prepared and shown here but <strong>not sent</strong>. Live sending needs an email provider to be configured.</div>' : ''}
     ${messages.length ? messages.map(m => `<details class="card"><summary class="spread"><span><strong>${esc(m.subject)}</strong><br><span class="small muted">To ${esc(m.recipient)} · ${when(m.created_ms)}</span></span>${chip(m.status === 'sent' ? 'confirmed' : m.status === 'failed' ? 'cancelled' : 'neutral', {previewed: 'Preview only', sent: 'Sent', queued: 'Queued', failed: 'Failed', skipped: 'Skipped'}[m.status])}</summary><pre class="mail">${esc(m.body)}</pre>${m.last_error ? `<p class="error">${esc(m.last_error)}</p>` : ''}</details>`).join('') : '<p class="empty card">No emails yet.</p>'}`, 'Emails');
  } else {
    const {entries} = await api('w/audit');
    render(`${head}<section class="card"><ul class="list">${entries.map(e => `<li class="small">${when(e.created_ms)} · ${esc(e.actor_role)} · ${esc(e.action)}</li>`).join('') || '<li class="empty">Nothing yet.</li>'}</ul></section>`, 'Activity');
  }
}
async function adminView() {
  const d = await api('platform/overview');
  render(`<h1>Platform overview</h1><p class="small muted">Support view. Learner details are not shown here. Email mode: ${esc(d.email_mode)}.</p><div class="table-wrap card"><table><thead><tr><th>Workspace</th><th>Active learners</th><th>Lessons</th><th>Created</th></tr></thead><tbody>${d.workspaces.map(w => `<tr><td>${esc(w.business_name)}</td><td>${w.active_learners}</td><td>${w.lessons}</td><td>${day(w.created_ms)}</td></tr>`).join('')}</tbody></table></div>
   <section class="card"><h2>Jobs</h2><p>${d.jobs.map(j => `${esc(j.status)}: ${j.n}`).join(' · ') || 'None'}</p>${d.failures.length ? `<h3>Recent failures</h3><ul class="list">${d.failures.map(f => `<li class="small">${esc(f.kind)} · ${f.attempts} attempts · ${esc(f.last_error)}</li>`).join('')}</ul>` : ''}</section>`, 'Platform');
}

// ---------- learner portal ----------
async function learnerRouter(parts) {
  const home = await api('learner/home');
  if (parts[0] === 'book' && parts[1]) return bookView(home, parts[1]);
  if (parts[0] === 'profile' && parts[1]) return profileView(home, parts[1]);
  return learnerHome(home);
}
function learnerHome(home) {
  const s = state.session;
  if (!home.records.length) {
    const pending = home.enquiries.filter(e => e.status !== 'closed');
    render(`<h1>Welcome${s.user.email ? '' : ''}</h1>
     ${pending.length ? `<div class="notice info"><strong>Your enquiry has been received.</strong> ${esc(pending[0].business_name)} will add you as a learner after getting in touch. Your lessons and progress will then appear here.</div>` : `<div class="card"><p>We could not find a learner record for <strong>${esc(s.user.email)}</strong>.</p><p>If you already have lessons with us, ask your instructor to add this email address to your record, or use the invitation link they send you. If you are new, send us an enquiry below.</p></div>`}
     ${pending.length ? '' : `<form id="enq" class="card"><h2>Send an enquiry</h2><div class="field"><label for="qn">Your name</label><input id="qn" name="name" required maxlength="80"></div><div class="field"><label for="qp">Mobile number</label><input id="qp" name="phone" type="tel"></div><div class="field"><label for="qt">When are you usually free?</label><input id="qt" name="preferred_times" maxlength="300"></div><div class="field"><label for="qm">Message</label><textarea id="qm" name="message" maxlength="2000"></textarea></div><label class="check"><input type="checkbox" name="contact_consent" required> I agree you may contact me about this enquiry.</label><button class="btn" type="submit">Send enquiry</button></form>`}`, 'Your account');
    onSubmit($('#enq'), async d => { await api('enquiries', 'POST', {name: d.name, phone: d.phone, email: s.user.email, preferred_times: d.preferred_times, message: d.message, contact_consent: !!d.contact_consent, source: 'account'}); toast('Enquiry sent.'); router(); });
    return;
  }
  render(`<h1>Your lessons</h1>${home.records.map(rec => {
    state.tz = rec.instructor.timezone;
    const now = Date.now(), up = rec.lessons.filter(l => l.start_ms > now && ['requested', 'confirmed'].includes(l.status)).reverse(), past = rec.lessons.filter(l => !up.includes(l)).slice(0, 10);
    return `<section aria-labelledby="h-${rec.learner.id}"><h2 id="h-${rec.learner.id}">${esc(rec.instructor.business_name)}</h2>
     <div class="grid cols-2">
      <div class="card"><div class="spread"><h3>Upcoming</h3>${rec.learner.status === 'active' ? `<a class="btn" href="#/book/${rec.learner.id}">Book a lesson</a>` : ''}</div>
       ${up.length ? `<ul class="list">${up.map(l => `<li><div class="spread"><span><strong>${esc(when(l.start_ms))}</strong><br><span class="small muted">${l.minutes} minutes · ${money(l.price_pence)}</span></span>${statusChip(l)}</div>${l.status === 'requested' ? '<p class="small muted">Waiting for your instructor to confirm.</p>' : ''}<button class="btn danger small" data-cancel="${l.id}" data-rec="${rec.learner.id}" data-rev="${l.revision}">Cancel</button></li>`).join('')}</ul>` : '<p class="empty">No lessons booked.</p>'}
       <details><summary>Cancellation terms</summary><p>${esc(rec.instructor.policy.text)}</p><p class="small muted">Notice period: ${rec.instructor.policy.notice_hours} hours.</p></details></div>
      <div class="card"><h3>Your progress</h3>${rec.progress.some(p => p.stage) ? progressBars(rec.progress.filter(p => p.stage)) : '<p class="empty">Your instructor has not shared a progress report yet.</p>'}<p class="small muted">Stages are your instructor's notes on your progress, not an official assessment.</p></div>
      <div class="card"><h3>Lesson reports</h3>${rec.reports.length ? rec.reports.map(r => `<article><h4>${esc(longDay(r.lesson_start_ms))}</h4>${r.observations ? `<p>${esc(r.observations)}</p>` : ''}${r.next_goals ? `<p><strong>Next time:</strong> ${esc(r.next_goals)}</p>` : ''}${r.skills.length ? `<p class="small">${r.skills.map(sk => `${esc(rec.skills.find(k => k.id === sk.skill_id)?.name || '')}: ${STAGES[sk.stage]}`).join(' · ')}</p>` : ''}</article>`).join('<hr>') : '<p class="empty">No reports yet.</p>'}</div>
      <div class="card"><h3>History</h3>${past.length ? `<ul class="list">${past.map(l => `<li class="spread"><span>${esc(when(l.start_ms))}</span>${statusChip(l)}</li>`).join('')}</ul>` : '<p class="empty">No past lessons.</p>'}<p><a href="#/profile/${rec.learner.id}">Your details and preferences</a></p></div>
     </div></section>`;
  }).join('')}`, 'Your lessons');
  main.querySelectorAll('[data-cancel]').forEach(b => b.addEventListener('click', async () => {
    const path = `learner/${b.dataset.rec}/lessons/${b.dataset.cancel}`, rev = Number(b.dataset.rev);
    if (!confirm('Cancel this lesson?')) return;
    try { await api(path, 'PATCH', {action: 'cancel', expected_revision: rev}); toast('Lesson cancelled.'); router(); }
    catch (e) {
      if (e.data?.code === 'late_cancellation' && confirm(e.message)) { await api(path, 'PATCH', {action: 'cancel', expected_revision: rev, acknowledge_late: true}); toast('Lesson cancelled.'); router(); return; }
      toast(e.message);
    }
  }));
}
async function bookView(home, learnerId) {
  const rec = home.records.find(r => r.learner.id === learnerId);
  if (!rec) return render('<h1>Not found</h1>');
  state.tz = rec.instructor.timezone;
  const minutes = rec.learner.preferred_minutes || rec.instructor.lesson_minutes;
  let selected = today();
  const dates = Array.from({length: 14}, (_, i) => addDays(today(), i));
  render(`<p><a href="#/">← Your lessons</a></p><h1>Book a lesson</h1><p class="muted">${minutes}-minute lesson with ${esc(rec.instructor.business_name)}. Times shown in UK time.</p>
   <div class="days" role="group" aria-label="Choose a day">${dates.map(d => `<button type="button" data-d="${d}" aria-pressed="${d === selected}">${esc(dayLabel(d)).replace(' ', '<br>')}</button>`).join('')}</div>
   <section class="card"><h2 id="slot-h">Available times</h2><div id="slots" class="slots" role="group" aria-labelledby="slot-h"></div></section><div id="review"></div>`, 'Book');
  async function load() {
    $('#slots').innerHTML = '<p class="muted">Loading…</p>';
    try { const r = await api(`learner/${learnerId}/availability?from=${selected}&to=${selected}&minutes=${minutes}`); $('#slots').innerHTML = r.slots.length ? r.slots.map(s => `<button type="button" data-s="${s.start_ms}">${time(s.start_ms)}</button>`).join('') : '<p class="empty">No times available this day. Try another day.</p>'; }
    catch (e) { $('#slots').innerHTML = errorBox(e); }
  }
  main.querySelector('.days').addEventListener('click', e => { const b = e.target.closest('[data-d]'); if (!b) return; selected = b.dataset.d; main.querySelectorAll('[data-d]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); $('#review').innerHTML = ''; load(); });
  $('#slots').addEventListener('click', async e => {
    const b = e.target.closest('[data-s]'); if (!b) return;
    try {
      const h = await api(`learner/${learnerId}/holds`, 'POST', {start_ms: Number(b.dataset.s), minutes});
      const v = h.review;
      $('#review').innerHTML = `<form id="confirm" class="card"><h2>Check the details</h2><p class="small muted">We are holding this time for you for 10 minutes while you review.</p>
       <dl class="kv"><dt>When</dt><dd>${esc(longDay(h.hold.start_ms))}, ${time(h.hold.start_ms)}–${time(h.hold.end_ms)}</dd><dt>Length</dt><dd>${h.hold.minutes} minutes</dd><dt>Price</dt><dd>${money(v.price_pence)} <span class="small muted">(paid to your instructor directly)</span></dd><dt>Transmission</dt><dd>${esc(v.transmission)}</dd></dl>
       <div class="field"><label for="pu">Pickup location</label><input id="pu" name="pickup_location" maxlength="200" value="${esc(v.pickup_location)}"></div>
       <div class="notice info"><strong>Cancellation terms (version ${v.policy.version})</strong><p>${esc(v.policy.text)}</p></div>
       <label class="check"><input type="checkbox" name="accept" required> I have read the cancellation terms.</label>
       <p class="small muted">${v.needs_confirmation ? 'Your instructor will confirm this request. It is not booked until they do.' : 'This lesson will be confirmed straight away.'}</p>
       <div class="row"><button class="btn" type="submit">${v.needs_confirmation ? 'Send request' : 'Confirm booking'}</button><button class="btn ghost" type="button" id="release">Choose another time</button></div></form>`;
      $('#review').scrollIntoView({behavior: 'smooth'});
      onSubmit($('#confirm'), async d => { if (!d.accept) throw new Error('Please confirm you have read the cancellation terms.'); await api(`learner/${learnerId}/holds/${h.hold.id}/confirm`, 'POST', {accept_terms: true, policy_version_id: v.policy.id, pickup_location: d.pickup_location}); toast(v.needs_confirmation ? 'Request sent.' : 'Lesson booked.'); go('#/'); });
      $('#release').addEventListener('click', async () => { await api(`learner/${learnerId}/holds/${h.hold.id}`, 'DELETE'); $('#review').innerHTML = ''; load(); });
    } catch (err) { toast(err.message); load(); }
  });
  load();
}
function profileView(home, learnerId) {
  const rec = home.records.find(r => r.learner.id === learnerId);
  if (!rec) return render('<h1>Not found</h1>');
  const l = rec.learner;
  render(`<p><a href="#/">← Your lessons</a></p><h1>Your details</h1><form id="pf" class="card"><p><strong>${esc(l.name)}</strong> · ${esc(l.email)}</p>
   <div class="field"><label for="pp1">Phone</label><input id="pp1" name="phone" type="tel" value="${esc(l.phone)}"></div>
   <div class="field"><label for="pp2">Pickup location</label><input id="pp2" name="pickup_location" maxlength="200" value="${esc(l.pickup_location)}"></div>
   <div class="field"><label for="pp3">When are you usually free?</label><textarea id="pp3" name="availability_notes" maxlength="500">${esc(l.availability_notes)}</textarea></div>
   <fieldset><legend>Emails</legend><p class="small">You will always get emails about your lessons (confirmations, changes and reminders).</p><label class="check"><input type="checkbox" name="marketing_opt_in" ${l.marketing_opt_in ? 'checked' : ''}> Also send me occasional offers and news</label></fieldset>
   <button class="btn" type="submit">Save</button></form>`, 'Your details');
  onSubmit($('#pf'), async d => { await api(`learner/${learnerId}/profile`, 'PATCH', {phone: d.phone, pickup_location: d.pickup_location, availability_notes: d.availability_notes, marketing_opt_in: !!d.marketing_opt_in}); toast('Saved.'); go('#/'); });
}
boot();
