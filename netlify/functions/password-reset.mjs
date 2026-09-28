import { getStore } from '@netlify/blobs';
import { randomInt, randomBytes, createHash } from 'node:crypto';

const store = getStore('safepays-password-reset');
const CODE_TTL_MS = 10 * 60 * 1000;
const RESET_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const digest = (value) => createHash('sha256').update(value).digest('hex');
const codeDigest = (email, code) => digest(`${email}:${code}`);

export default async (request) => {
  if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'invalid_json' }, 400); }

  const action = String(body?.action || '');
  const email = normalizeEmail(body?.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: 'invalid_email' }, 400);
  }

  const key = `reset:${digest(email)}`;
  const now = Date.now();

  if (action === 'send') {
    const existing = await store.get(key, { type: 'json' });
    if (existing?.sentAt && now - existing.sentAt < 60_000) {
      return json({ ok: true, status: 'sent' });
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const record = {
      codeHash: codeDigest(email, code),
      sentAt: now,
      expiresAt: now + CODE_TTL_MS,
      attempts: 0,
      used: false
    };

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.RESEND_API_KEY || ''}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [email],
        subject: 'Safepays şifre sıfırlama kodunuz',
        html: `<!doctype html><html lang="tr"><body style="margin:0;background:#071321;font-family:Arial,sans-serif;color:#fff;padding:32px"><div style="max-width:520px;margin:auto;background:#0b1e33;border:1px solid #1e4a72;border-radius:20px;padding:28px"><div style="font-size:13px;letter-spacing:3px;color:#39a8ff;font-weight:700">SAFEPAYS</div><h1 style="font-size:24px;margin:12px 0">Şifre sıfırlama kodunuz</h1><p style="color:#a9bfd5;line-height:1.6">Şifrenizi yenilemek için aşağıdaki tek kullanımlık kodu Safepays ekranına girin.</p><div style="font-size:34px;letter-spacing:8px;font-weight:800;text-align:center;padding:20px;margin:20px 0;background:#07182b;border-radius:14px;color:#fff">${code}</div><p style="color:#7f9ab4;font-size:13px">Bu kod 10 dakika geçerlidir. Bu isteği siz yapmadıysanız bu e-postayı yok sayabilirsiniz.</p></div></body></html>`
      })
    });

    if (!resendResponse.ok) {
      const detail = await resendResponse.text();
      console.error('Resend error', detail);
      return json({ ok: false, error: 'email_send_failed' }, 502);
    }

    await store.setJSON(key, record);
    return json({ ok: true, status: 'sent' });
  }

  if (action === 'verify') {
    const code = String(body?.code || '').trim();
    if (!/^\d{6}$/.test(code)) return json({ ok: false, error: 'invalid_code' }, 400);

    const record = await store.get(key, { type: 'json' });
    if (!record || record.used || now > Number(record.expiresAt || 0)) {
      return json({ ok: false, error: 'code_expired' }, 400);
    }
    if (Number(record.attempts || 0) >= MAX_ATTEMPTS) {
      return json({ ok: false, error: 'too_many_attempts' }, 429);
    }

    if (record.codeHash !== codeDigest(email, code)) {
      await store.setJSON(key, { ...record, attempts: Number(record.attempts || 0) + 1 });
      return json({ ok: false, error: 'invalid_code' }, 400);
    }

    const resetToken = randomBytes(32).toString('hex');
    await store.setJSON(key, {
      used: true,
      resetTokenHash: digest(resetToken),
      resetTokenExpiresAt: now + RESET_TTL_MS,
      sentAt: record.sentAt,
      expiresAt: record.expiresAt
    });
    return json({ ok: true, resetToken });
  }

  return json({ ok: false, error: 'unknown_action' }, 400);
};
