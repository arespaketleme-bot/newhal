const SITE_URL = (process.env.SITE_URL || 'https://newhal.com').replace(/\/$/, '');

const htmlEscape = value => String(value || '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
const configured = () => !!(process.env.RESEND_API_KEY && process.env.RESEND_FROM);

function emailHtml(title, body, path = '/?openNotifications=1') {
  const safePath = String(path || '/?openNotifications=1').startsWith('/') ? path : '/?openNotifications=1';
  const url = `${SITE_URL}${safePath}`;
  return `<!doctype html><html lang="tr"><body style="margin:0;background:#f4f7f4;font-family:Arial,sans-serif;color:#17221b">
    <div style="max-width:560px;margin:32px auto;padding:28px;background:#fff;border:1px solid #e1e9e2;border-radius:16px">
      <div style="font-size:14px;font-weight:700;color:#14733e">NewHal</div>
      <h1 style="font-size:22px;line-height:1.35;margin:18px 0 10px">${htmlEscape(title)}</h1>
      <p style="font-size:15px;line-height:1.6;white-space:pre-line;margin:0 0 24px">${htmlEscape(body)}</p>
      <a href="${htmlEscape(url)}" style="display:inline-block;padding:12px 18px;background:#14733e;color:#fff;text-decoration:none;border-radius:9px;font-weight:700">NewHal'i aç</a>
      <p style="font-size:12px;color:#718078;margin:24px 0 0">Bu e-posta NewHal bildirimidir.</p>
    </div></body></html>`;
}

async function sendOne({ to, subject, title, body, path }) {
  if (!validEmail(to)) return 'skipped';
  if (!configured()) return 'unconfigured';
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.RESEND_FROM,
        to: [String(to).trim()],
        subject: String(subject || title || 'NewHal bildirimi').slice(0, 150),
        html: emailHtml(title, body, path),
        text: `${title}\n\n${body}\n\nNewHal'i aç: ${SITE_URL}${path || '/?openNotifications=1'}`,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      console.error('E-posta bildirimi gönderilemedi. Sağlayıcı yanıtı:', response.status);
      return 'failed';
    }
    return 'sent';
  } catch (err) {
    console.error('E-posta bildirimi gönderilemedi:', err.cause?.code || err.name || 'hata');
    return 'failed';
  }
}

async function sendNotificationEmail({ to, subject, title, body, path }) {
  return sendOne({ to, subject, title, body, path });
}

async function sendNotificationEmails(recipients, { subject, title, body, path }) {
  const valid = (recipients || []).filter(user => validEmail(user.email));
  const result = { sent: 0, failed: 0, skipped: (recipients || []).length - valid.length, configured: configured() };
  if (!configured()) {
    result.skipped += valid.length;
    return result;
  }

  for (let offset = 0; offset < valid.length; offset += 100) {
    const batch = valid.slice(offset, offset + 100).map(user => ({
      from: process.env.RESEND_FROM,
      to: [String(user.email).trim()],
      subject: String(subject || title || 'NewHal bildirimi').slice(0, 150),
      html: emailHtml(title, body, path),
      text: `${title}\n\n${body}\n\nNewHal'i aç: ${SITE_URL}${path || '/?openNotifications=1'}`,
    }));
    try {
      const response = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) {
        result.failed += batch.length;
        console.error('Toplu e-posta gönderilemedi. Sağlayıcı yanıtı:', response.status);
      } else {
        const responseBody = await response.json().catch(() => ({}));
        const accepted = Array.isArray(responseBody.data) ? responseBody.data.length : batch.length;
        result.sent += Math.min(accepted, batch.length);
        result.failed += Math.max(0, batch.length - accepted);
      }
    } catch (err) {
      result.failed += batch.length;
      console.error('Toplu e-posta gönderilemedi:', err.cause?.code || err.name || 'hata');
    }
  }
  return result;
}

module.exports = { sendNotificationEmail, sendNotificationEmails };
