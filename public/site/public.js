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
