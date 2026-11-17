// Kripto ödeme (NOWPayments): ödeme alma herkese açık, ödeme gönderme yalnız yönetici.
const path = require('path');
const crypto = require('crypto');

const API = 'https://api.nowpayments.io/v1';
const STORE_FILE = 'crypto-payments.json';
const MAX_RECORDS = 500;

module.exports = function registerPayments(app, { db, requireAdmin, siteUrl }) {
  const apiKey = () => process.env.NOWPAYMENTS_API_KEY || '';
  const ipnSecret = () => process.env.NOWPAYMENTS_IPN_SECRET || '';
  const site = (siteUrl || 'https://newhal.com').replace(/\/$/, '');

  async function np(method, endpoint, body, bearer) {
    const headers = { 'x-api-key': apiKey(), 'Content-Type': 'application/json' };
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    const res = await fetch(API + endpoint, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = { message: text }; }
    if (!res.ok) {
      const err = new Error(data.message || `NOWPayments ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async function loadRecords() {
    const saved = await db.getPrivateJson(STORE_FILE);
    return Array.isArray(saved && saved.items) ? saved.items : [];
  }
  async function upsertRecord(rec) {
    const items = await loadRecords();
    const i = items.findIndex(x => x.key === rec.key);
    if (i >= 0) items[i] = { ...items[i], ...rec, updated_at: new Date().toISOString() };
    else items.unshift({ ...rec, created_at: new Date().toISOString() });
    await db.savePrivateJson(STORE_FILE, { items: items.slice(0, MAX_RECORDS) });
  }

  // Basit sınır: aynı adresten dakikada en çok 5 ödeme bağlantısı
  const hits = new Map();
  function tooMany(ip) {
    const now = Date.now();
    const list = (hits.get(ip) || []).filter(t => now - t < 60_000);
    list.push(now);
    hits.set(ip, list);
    return list.length > 5;
  }

  // Sayfa
  for (const p of ['/payments', '/paymets']) {
    app.get(p, (req, res) => res.sendFile(path.join(__dirname, 'public', 'payments.html')));
  }

  app.get('/api/payments/config', (req, res) => {
    res.json({ enabled: !!apiKey(), payoutsEnabled: !!(apiKey() && process.env.NOWPAYMENTS_EMAIL && process.env.NOWPAYMENTS_PASSWORD) });
  });

  // Ödeme al: müşteri tutarı girer, NOWPayments ödeme sayfasına gider
  app.post('/api/payments/invoice', async (req, res) => {
    if (!apiKey()) return res.status(503).json({ error: 'Kripto ödeme henüz açılmadı' });
    if (tooMany(req.ip)) return res.status(429).json({ error: 'Çok fazla deneme, bir dakika sonra tekrar deneyin' });
    const amount = Math.round(Number(req.body && req.body.amount) * 100) / 100;
    if (!Number.isFinite(amount) || amount < 1 || amount > 100000) {
      return res.status(400).json({ error: 'Tutar 1 ile 100.000 USD arasında olmalı' });
    }
    const note = String((req.body && req.body.note) || '').slice(0, 120).trim();
    const orderId = `nh-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    try {
      const inv = await np('POST', '/invoice', {
        price_amount: amount,
        price_currency: 'usd',
        order_id: orderId,
        order_description: note || 'NewHal ödemesi',
        ipn_callback_url: `${site}/api/payments/ipn`,
        success_url: `${site}/payments?durum=basarili`,
        cancel_url: `${site}/payments?durum=iptal`,
      });
      await upsertRecord({ key: `in:${orderId}`, type: 'in', order_id: orderId, invoice_id: inv.id, amount_usd: amount, note, status: 'waiting' });
      res.json({ url: inv.invoice_url });
    } catch (err) {
      console.error('Kripto ödeme bağlantısı açılamadı:', err.message);
      res.status(502).json({ error: 'Ödeme bağlantısı açılamadı, biraz sonra tekrar deneyin' });
    }
  });

  // NOWPayments ödeme durumu bildirimi (imzası doğrulanır)
  const sortDeep = o => (o && typeof o === 'object' && !Array.isArray(o))
    ? Object.keys(o).sort().reduce((a, k) => { a[k] = sortDeep(o[k]); return a; }, {})
    : o;
  app.post('/api/payments/ipn', async (req, res) => {
    const sig = String(req.headers['x-nowpayments-sig'] || '');
    if (!ipnSecret() || !sig) return res.status(401).end();
    const expected = crypto.createHmac('sha512', ipnSecret()).update(JSON.stringify(sortDeep(req.body || {}))).digest('hex');
    const ok = sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    if (!ok) return res.status(401).end();
    const b = req.body || {};
    try {
      if (b.order_id) {
        await upsertRecord({
          key: `in:${b.order_id}`, type: 'in', order_id: b.order_id, payment_id: b.payment_id,
          status: b.payment_status, pay_currency: b.pay_currency, actually_paid: b.actually_paid,
          amount_usd: b.price_amount,
        });
      } else if (b.batch_withdrawal_id || b.id) {
        await upsertRecord({ key: `out:${b.batch_withdrawal_id || b.id}`, type: 'out', status: b.status, currency: b.currency, amount: b.amount, address: b.address });
      }
    } catch (err) { console.error('Kripto bildirim kaydı:', err.message); }
    res.json({ ok: true });
  });

  // ── Yönetici ──
  app.get('/api/admin/payments', requireAdmin, async (req, res) => {
    let balance = null;
    if (apiKey()) { try { balance = await np('GET', '/balance'); } catch (err) { balance = { error: err.message }; } }
    res.json({ items: await loadRecords(), balance });
  });

  async function payoutToken() {
    const r = await np('POST', '/auth', { email: process.env.NOWPAYMENTS_EMAIL, password: process.env.NOWPAYMENTS_PASSWORD });
    return r.token;
  }

  // Ödeme gönder: 1) talep oluştur, 2) iki adımlı doğrulama koduyla onayla
  app.post('/api/admin/payments/payout', requireAdmin, async (req, res) => {
    if (!apiKey() || !process.env.NOWPAYMENTS_EMAIL || !process.env.NOWPAYMENTS_PASSWORD) {
      return res.status(503).json({ error: 'Ödeme gönderme için NOWPayments hesap bilgileri sunucuya eklenmeli' });
    }
    const address = String(req.body.address || '').trim();
    const currency = String(req.body.currency || '').trim().toLowerCase();
    const amount = Number(req.body.amount);
    if (!/^[A-Za-z0-9:_-]{20,120}$/.test(address)) return res.status(400).json({ error: 'Cüzdan adresi geçersiz' });
    if (!/^[a-z0-9]{2,20}$/.test(currency)) return res.status(400).json({ error: 'Para birimi geçersiz' });
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Tutar geçersiz' });
    try {
      const token = await payoutToken();
      const r = await np('POST', '/payout', {
        ipn_callback_url: `${site}/api/payments/ipn`,
        withdrawals: [{ address, currency, amount, ipn_callback_url: `${site}/api/payments/ipn` }],
      }, token);
      await upsertRecord({ key: `out:${r.id}`, type: 'out', batch_id: r.id, address, currency, amount, status: 'onay bekliyor' });
      res.json({ id: r.id });
    } catch (err) {
      console.error('Kripto gönderim talebi:', err.message);
      res.status(502).json({ error: `Gönderim talebi oluşmadı: ${err.message}` });
    }
  });

  app.post('/api/admin/payments/payout/:id/verify', requireAdmin, async (req, res) => {
    const id = String(req.params.id).replace(/[^A-Za-z0-9-]/g, '');
    const code = String(req.body.code || '').replace(/\D/g, '');
    if (!code) return res.status(400).json({ error: 'Doğrulama kodu gerekli' });
    try {
      const token = await payoutToken();
      await np('POST', `/payout/${id}/verify`, { verification_code: code }, token);
      await upsertRecord({ key: `out:${id}`, type: 'out', status: 'onaylandı' });
      res.json({ ok: true });
    } catch (err) {
      res.status(502).json({ error: `Onaylanamadı: ${err.message}` });
    }
  });
};
