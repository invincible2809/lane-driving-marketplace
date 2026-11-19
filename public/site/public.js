// Progressive enhancement for the public website's enquiry form.
const form = document.getElementById('enquiry');
if (form) {
  form.elements.started_ms.value = String(Date.now());
  const status = document.getElementById('enquiry-status');
  const show = (kind, text) => { status.innerHTML = ''; const d = document.createElement('div'); d.className = 'notice ' + kind; d.textContent = text; status.append(d); status.scrollIntoView({block: 'nearest'}); };
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const f = form.elements;
    if (!f.name.value.trim()) { show('bad', 'Please enter your name.'); f.name.focus(); return; }
    if (!f.email.value.trim() && !f.phone.value.trim()) { show('bad', 'Please give a mobile number or an email address so we can reply.'); f.phone.focus(); return; }
    if (!f.contact_consent.checked) { show('bad', 'Please confirm we may contact you about your enquiry.'); f.contact_consent.focus(); return; }
    const button = form.querySelector('button[type=submit]');
    button.disabled = true; button.textContent = 'Sending…';
    const body = {name: f.name.value, phone: f.phone.value, email: f.email.value, area: f.area.value, package: f.package.value, experience: f.experience.value, preferred_times: f.preferred_times.value, message: f.message.value, website: f.website.value, started_ms: Number(f.started_ms.value), contact_consent: f.contact_consent.checked, marketing_opt_in: f.marketing_opt_in.checked};
    try {
      const r = await fetch('/api/enquiries', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Sorry, something went wrong. Please call or WhatsApp us instead.');
      form.reset(); f.started_ms.value = String(Date.now());
      show('ok', 'Thank you — your enquiry has been sent. We will be in touch soon.');
    } catch (e) { show('bad', e.message); }
    finally { button.disabled = false; button.textContent = 'Send enquiry'; }
  });
}

// Test-day photo reel: a film strip that winds on one frame every 2 seconds.
// Pauses on hover, keyboard focus, when off screen or the tab is hidden, and
// has a Pause button (WCAG 2.2.2). With reduced motion it never moves by itself.
const reel = document.querySelector('.pass-reel');
if (reel) {
  const HOLD_MS = 2000;
  const windowEl = reel.querySelector('.reel-window');
  const track = reel.querySelector('.reel-track');
  const frames = [...track.children];
  const count = reel.querySelector('.reel-count');
  const toggle = reel.querySelector('.reel-toggle');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  // A copy of the first frame at the end lets the strip loop without jumping backwards.
  const clone = frames[0].cloneNode(true);
  clone.setAttribute('aria-hidden', 'true'); clone.removeAttribute('aria-label'); clone.removeAttribute('aria-roledescription');
  clone.querySelector('img').alt = '';
  track.append(clone);
  let index = 0, timer = null, userPaused = false, hovering = false, focused = false, visible = true;
  const step = () => frames[0].offsetHeight + parseFloat(getComputedStyle(frames[0]).marginBottom);
  const peek = () => (windowEl.clientHeight - frames[0].offsetHeight) / 2;   // centre the current frame
  const load = i => { const img = (track.children[i] || clone).querySelector('img'); if (img) img.loading = 'eager'; };
  function place(animate) {
    track.style.transition = animate && !reduced.matches ? 'transform .55s cubic-bezier(.65,0,.35,1)' : 'none';
    track.style.transform = `translateY(${peek() - index * step()}px)`;
    const shown = index % frames.length;
    frames.forEach((f, i) => f.setAttribute('aria-hidden', String(i !== shown)));
    count.textContent = `${shown + 1} / ${frames.length}`;
    load(index + 1); load(index + 2);
  }
  function go(delta) {
    if (index === frames.length && delta > 0) { index = 0; place(false); void track.offsetHeight; }
    if (index === 0 && delta < 0) { index = frames.length; place(false); void track.offsetHeight; }
    index += delta;
    place(true);
  }
  track.addEventListener('transitionend', () => { if (index === frames.length) { index = 0; place(false); } });
  const running = () => !userPaused && !hovering && !focused && visible && !document.hidden && !reduced.matches;
  function schedule() {
    clearInterval(timer); timer = null;
    if (running()) timer = setInterval(() => go(1), HOLD_MS);
    toggle.textContent = userPaused || reduced.matches ? 'Play' : 'Pause';
    toggle.setAttribute('aria-pressed', String(userPaused));
  }
  reel.querySelector('.reel-next').addEventListener('click', () => { go(1); schedule(); });
  reel.querySelector('.reel-prev').addEventListener('click', () => { go(-1); schedule(); });
  toggle.addEventListener('click', () => {
    if (reduced.matches) { go(1); return; }          // reduced motion: the button steps instead
    userPaused = !userPaused; schedule();
  });
  reel.addEventListener('pointerenter', () => { hovering = true; schedule(); });
  reel.addEventListener('pointerleave', () => { hovering = false; schedule(); });
  reel.addEventListener('focusin', () => { focused = true; schedule(); });
  reel.addEventListener('focusout', () => { focused = false; schedule(); });
  document.addEventListener('visibilitychange', schedule);
  reduced.addEventListener?.('change', schedule);
  if ('IntersectionObserver' in window) new IntersectionObserver(([e]) => { visible = e.isIntersecting; schedule(); }).observe(reel);
  addEventListener('resize', () => place(false));
  reel.querySelector('.reel-controls').hidden = false;
  place(false); schedule();
}
