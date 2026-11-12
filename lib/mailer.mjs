// Message delivery adapters. Only the adapter selected by configuration is used.
//  EMAIL_MODE=preview (default): nothing leaves the system; messages are stored
//    with status "previewed" and can be read in the workspace message preview.
//  EMAIL_MODE=resend: sends through Resend's HTTP API. Requires RESEND_API_KEY and
//    EMAIL_FROM (a verified sender). EMAIL_REDIRECT_TO routes every message to one
//    safe test inbox instead of the real recipient.
// SMS and WhatsApp are NOT implemented: the adapters below always refuse.
export class DeliveryError extends Error { constructor(message, retryable = true) { super(message); this.retryable = retryable; } }
export function createMailer(env = {}) {
  if (env.MAILER) return env.MAILER;
  const mode = env.EMAIL_MODE || 'preview';
  if (mode === 'preview') return {name: 'preview', live: false, async send() { return {status: 'previewed', provider: 'preview'}; }};
  if (mode === 'resend') {
    const configured = !!(env.RESEND_API_KEY && env.EMAIL_FROM);
    return {
      name: 'resend', live: configured,
      async send({id, to, subject, text}) {
        if (!configured) throw new DeliveryError('Email provider is not configured.', false);
        const recipient = env.EMAIL_REDIRECT_TO || to;
        const response = await (env.MAIL_FETCH || fetch)('https://api.resend.com/emails', {
          method: 'POST',
          headers: {Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': id},
          body: JSON.stringify({from: env.EMAIL_FROM, to: [recipient], subject: env.EMAIL_REDIRECT_TO ? `[test → ${to}] ${subject}` : subject, text})
        });
        if (!response.ok) throw new DeliveryError(`Provider responded ${response.status}.`, response.status >= 500 || response.status === 429);
        const result = await response.json();
        if (!result.id) throw new DeliveryError('Provider returned no message id.');
        return {status: 'sent', provider: 'resend', provider_id: result.id, redirected_to: env.EMAIL_REDIRECT_TO || null};
      }
    };
  }
  throw new Error(`Unknown EMAIL_MODE "${mode}".`);
}
// Placeholders for later channels. They exist so callers can be written against
// one interface; they never report success.
export const smsAdapter = {name: 'sms', live: false, async send() { throw new DeliveryError('SMS is not available in this release.', false); }};
export const whatsappAdapter = {name: 'whatsapp', live: false, async send() { throw new DeliveryError('WhatsApp is not available in this release.', false); }};
