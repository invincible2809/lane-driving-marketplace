// Server-rendered public website for a single driving school. Works without
// JavaScript; /site/public.js only enhances the enquiry form.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
export const SITE_PAGES = ['/', '/services', '/about', '/areas', '/contact', '/faq'];
const NAV = [['/', 'Home'], ['/services', 'Lessons & prices'], ['/about', 'About'], ['/areas', 'Areas'], ['/faq', 'FAQ'], ['/contact', 'Contact']];
function layout(b, {path, title, description, user, body, googleReady}) {
  const account = user
    ? `<a class="btn small" href="/account">My account</a>`
    : `<a class="btn small" href="/auth/google/start?next=/account">${googleReady ? 'Learner sign in' : 'Sign in'}</a>`;
  const schema = {
    '@context': 'https://schema.org', '@type': 'DrivingSchool', name: b.name, telephone: b.phone_e164, email: b.email, url: '/',
    address: {'@type': 'PostalAddress', streetAddress: b.address.street, addressLocality: b.address.locality, addressRegion: b.address.region, postalCode: b.address.postcode, addressCountry: b.address.country},
    geo: {'@type': 'GeoCoordinates', latitude: b.geo.lat, longitude: b.geo.lng},
    areaServed: b.areas,
    openingHoursSpecification: b.hours.map(h => ({'@type': 'OpeningHoursSpecification', dayOfWeek: h.schema, opens: h.open, closes: h.close}))
  };
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#1d6a4f">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="stylesheet" href="/site/app.css">
<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top site-top">
 <a class="brand" href="/">${esc(b.name.replace(/ Driving School$/, ''))}<span>.</span> <span class="small muted">Driving School</span></a>
 <nav class="menu" aria-label="Main"><div class="site-nav">${NAV.map(([href, label]) => `<a href="${href}"${href === path ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</div></nav>
 <div class="who"><a href="tel:${b.phone_e164}">${esc(b.phone)}</a>${account}</div>
</header>
<main id="main" tabindex="-1">${body}</main>
<footer class="site-footer"><div class="wrap">
 <div><strong>${esc(b.name)}</strong><p>${esc(b.tagline)}.</p><p>${esc(b.address.street)}, ${esc(b.address.locality)}, ${esc(b.address.postcode)}</p></div>
 <div><strong>Contact</strong><p><a href="tel:${b.phone_e164}">${esc(b.phone)}</a><br><a href="mailto:${esc(b.email)}">${esc(b.email)}</a><br><a href="${esc(b.whatsapp)}" rel="noopener">WhatsApp us</a><br><a href="${esc(b.social.facebook)}" rel="noopener">Facebook</a></p></div>
 <div><strong>Learners</strong><p><a href="/account">Your lessons and progress</a><br><a href="/privacy">Privacy notice</a><br><a href="/terms">Terms</a></p></div>
</div></footer>
<script type="module" src="/site/public.js"></script>
</body>
</html>`;
}
const packagesHtml = b => `<div class="packages">${b.packages.map(p => `<article class="card package">${p.badge ? `<span class="badge">${esc(p.badge)}</span>` : ''}<h3>${esc(p.name)}</h3><p class="muted">${esc(p.length)}</p><p class="price">${esc(p.price)}</p><ul>${p.points.map(x => `<li>${esc(x)}</li>`).join('')}</ul><a class="btn secondary" href="/contact?package=${esc(p.id)}">Enquire about this</a></article>`).join('')}</div>`;
const ratingHtml = b => b.google_rating ? `<a class="rating" href="${esc(b.google_maps_url)}" rel="noopener">★ ${esc(b.google_rating.score)} on Google · ${b.google_rating.count} reviews <span class="sr">(as of ${esc(b.google_rating.as_of)})</span></a>` : '';
const cta = b => `<section class="band alt"><div class="wrap spread"><div><h2>Ready to start?</h2><p>Tell us a little about yourself and we will get back to you to arrange your first lesson.</p></div><p class="row"><a class="btn" href="/contact">Send an enquiry</a><a class="btn secondary" href="tel:${b.phone_e164}">Call ${esc(b.phone)}</a></p></div></section>`;
function contactForm(b, query) {
  const pick = query.get('package');
  const sent = query.get('sent') === '1';
  const err = query.get('error');
  return `<form id="enquiry" class="card" method="post" action="/api/enquiries" novalidate>
 <h2>Send us an enquiry</h2>
 <div id="enquiry-status" role="status" aria-live="polite">${sent ? '<div class="notice ok"><strong>Thank you — your enquiry has been sent.</strong> We will be in touch soon.</div>' : ''}${err ? `<div class="notice bad">${esc(err)}</div>` : ''}</div>
 <div class="two">
  <div class="field"><label for="f-name">Your name</label><input id="f-name" name="name" autocomplete="name" required maxlength="80"></div>
  <div class="field"><label for="f-phone">Mobile number</label><input id="f-phone" name="phone" type="tel" autocomplete="tel" maxlength="30"></div>
 </div>
 <div class="field"><label for="f-email">Email <span class="hint">We need a phone number or an email address.</span></label><input id="f-email" name="email" type="email" autocomplete="email" maxlength="120"></div>
 <div class="two">
  <div class="field"><label for="f-area">Your area</label><select id="f-area" name="area"><option value="">Choose…</option>${b.areas.map(a => `<option>${esc(a)}</option>`).join('')}<option>Somewhere else</option></select></div>
  <div class="field"><label for="f-package">Interested in</label><select id="f-package" name="package"><option value="">Not sure yet</option>${b.packages.map(p => `<option value="${esc(p.name)}"${p.id === pick ? ' selected' : ''}>${esc(p.name)} (${esc(p.price)})</option>`).join('')}<option>Pass Plus</option><option>Refresher lessons</option></select></div>
 </div>
 <div class="field"><label for="f-exp">Your experience</label><select id="f-exp" name="experience"><option value="">Choose…</option>${b.experience_options.map(o => `<option>${esc(o)}</option>`).join('')}</select></div>
 <div class="field"><label for="f-times">When are you usually free? <span class="hint">For example: weekday evenings, Saturday mornings</span></label><input id="f-times" name="preferred_times" maxlength="300"></div>
 <div class="field"><label for="f-msg">Anything else?</label><textarea id="f-msg" name="message" maxlength="2000"></textarea></div>
 <div class="hp" aria-hidden="true"><label for="f-website">Leave this empty</label><input id="f-website" name="website" tabindex="-1" autocomplete="off"></div>
 <input type="hidden" name="started_ms" value="">
 <label class="check"><input type="checkbox" name="contact_consent" value="true" required> <span>I agree that ${esc(b.name)} may contact me about this enquiry. See the <a href="/privacy">privacy notice</a>.</span></label>
 <label class="check"><input type="checkbox" name="marketing_opt_in" value="true"> <span>Also send me occasional offers and news (optional).</span></label>
 <button class="btn" type="submit">Send enquiry</button>
</form>`;
}
export function renderSitePage(b, path, {user, query = new URLSearchParams(), googleReady = false} = {}) {
  const title = s => `${s} | ${b.name}`;
  const pages = {
    '/': () => ({title: `${b.name} | Automatic driving lessons in Sutton Coldfield`, description: `Patient automatic driving lessons in ${b.areas.slice(0, 4).join(', ')} and nearby. Lessons from ${b.packages[0].price}. Enquire online or call ${b.phone}.`, body: `
<section class="hero-site"><div class="wrap">
 <p>${ratingHtml(b)}</p>
 <h1>Pass your test with confidence.</h1>
 <p>Patient, structured automatic driving lessons in Sutton Coldfield and north Birmingham with ${esc(b.instructor.name)}, ${esc(b.instructor.qualification)}.</p>
 <p class="row"><a class="btn" href="/contact">Book your first lesson</a><a class="btn secondary" href="/services">Lessons &amp; prices</a></p>
</div></section>
<section class="band"><div class="wrap">
 <h2>Lessons &amp; prices</h2>
 ${packagesHtml(b)}
</div></section>
<section class="band"><div class="wrap grid cols-3">
 <div><h3>Patient teaching</h3><p>Calm, clear explanations at your pace — popular with nervous and returning learners.</p></div>
 <div><h3>Flexible times</h3><p>Weekday and weekend lessons with pick-up from home, college or work.</p></div>
 <div><h3>Track your progress online</h3><p>Sign in with Google to see upcoming lessons and the progress notes your instructor shares after each lesson.</p></div>
</div></section>
${cta(b)}`}),
    '/services': () => ({title: title('Driving lessons and prices'), description: `Automatic driving lesson packages from ${b.packages[0].price}: single lessons, blocks, intensive courses and test day packages.`, body: `
<section class="band"><div class="wrap"><h1>Driving lessons &amp; prices</h1><p class="muted">All lessons are in an automatic car.</p>${packagesHtml(b)}</div></section>
<section class="band"><div class="wrap"><h2>Types of lesson</h2><div class="grid cols-3">${b.lesson_types.map(([h, p]) => `<div class="card"><h3>${esc(h)}</h3><p>${esc(p)}</p></div>`).join('')}</div></div></section>${cta(b)}`}),
    '/about': () => ({title: title('About'), description: `Meet ${b.instructor.name}, ${b.instructor.qualification} at ${b.name}.`, body: `
<section class="band"><div class="wrap"><h1>About ${esc(b.name)}</h1>
 <div class="card"><h2>Meet your instructor: ${esc(b.instructor.name)}</h2><p><strong>${esc(b.instructor.qualification)}</strong></p><p>${esc(b.instructor.bio)}</p></div>
 <div class="grid cols-3"><div class="card"><h3>Patience</h3><p>No pressure and no rushing — steady progress at a pace that suits you.</p></div><div class="card"><h3>Structure</h3><p>Each lesson builds on the last, with clear goals for next time.</p></div><div class="card"><h3>Local knowledge</h3><p>Practice on the roads and junctions around local test centres.</p></div></div>
 <p>${ratingHtml(b).replace('class="rating"', 'class="btn secondary"')}</p>
</div></section>${cta(b)}`}),
    '/areas': () => ({title: title('Areas covered'), description: `Automatic driving lessons in ${b.areas.join(', ')}.`, body: `
<section class="band"><div class="wrap"><h1>Areas we cover</h1><p>We offer automatic driving lessons with pick-up in and around:</p><ul class="area-list">${b.areas.map(a => `<li>${esc(a)}</li>`).join('')}</ul><p class="muted">Not sure if we cover your area? <a href="/contact">Send us an enquiry</a> and we will let you know.</p></div></section>${cta(b)}`}),
    '/faq': () => ({title: title('Questions'), description: `Common questions about learning to drive with ${b.name}.`, body: `
<section class="band"><div class="wrap"><h1>Frequently asked questions</h1>${b.faq.map(([q, a]) => `<details class="card"><summary><strong>${esc(q)}</strong></summary><p>${esc(a)}</p></details>`).join('')}</div></section>${cta(b)}`}),
    '/contact': () => ({title: title('Contact and enquiries'), description: `Contact ${b.name} to book automatic driving lessons. Call ${b.phone} or send an enquiry online.`, body: `
<section class="band"><div class="wrap"><h1>Contact us</h1><div class="contact-grid">${contactForm(b, query)}
 <aside class="card"><h2>Other ways to reach us</h2><dl class="kv"><dt>Phone</dt><dd><a href="tel:${b.phone_e164}">${esc(b.phone)}</a></dd><dt>WhatsApp</dt><dd><a href="${esc(b.whatsapp)}" rel="noopener">Message us</a></dd><dt>Email</dt><dd><a href="mailto:${esc(b.email)}">${esc(b.email)}</a></dd><dt>Address</dt><dd>${esc(b.address.street)}<br>${esc(b.address.locality)}<br>${esc(b.address.postcode)}</dd></dl>
 <h3>Office hours</h3><dl class="kv">${b.hours.map(h => `<dt>${esc(h.days)}</dt><dd>${h.open}–${h.close}</dd>`).join('')}</dl>
 <p><a href="${esc(b.google_maps_url)}" rel="noopener">View on Google Maps</a></p>
 <h3>Already a learner?</h3><p><a href="/account">Sign in with Google</a> to see your lessons and progress.</p></aside>
</div></div></section>`})
  };
  const p = pages[path]?.();
  if (!p) return null;
  return layout(b, {path, title: p.title, description: p.description, user, body: p.body, googleReady});
}
