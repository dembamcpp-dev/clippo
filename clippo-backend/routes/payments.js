const express = require('express');
const crypto = require('crypto');
const fetch = require('node-fetch');
const db = require('../lib/db');
const { requireAuth } = require('../lib/session');

const router = express.Router();

// Tarifs en FCFA — doivent correspondre à ceux affichés sur la landing page
const PLANS = {
  createur: { amount: 9900, label: 'Créateur' },
  studio: { amount: 24900, label: 'Studio' },
};

function upgradeUserPlan(userId, plan) {
  db.prepare('UPDATE users SET plan = ? WHERE id = ?').run(plan, userId);
}

/* ══════════════════════════════════════════════════════════
   WAVE
   Docs : https://docs.wave.com/checkout
   ══════════════════════════════════════════════════════════ */

// POST /api/payments/wave/checkout   (utilisateur connecté)
// Body: { plan: 'createur' | 'studio' }
router.post('/wave/checkout', requireAuth, async (req, res) => {
  const { plan } = req.body;
  const planInfo = PLANS[plan];
  if (!planInfo) return res.status(400).json({ error: 'Plan invalide' });

  try {
    const response = await fetch('https://api.wave.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.WAVE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: String(planInfo.amount),
        currency: 'XOF',
        client_reference: `${req.user.sub}:${plan}`,
        success_url: `${process.env.FRONTEND_URL}/paiement/succes`,
        error_url: `${process.env.FRONTEND_URL}/paiement/erreur`,
      }),
    });

    const session = await response.json();
    if (!response.ok) {
      return res.status(502).json({ error: 'Erreur Wave', details: session });
    }

    db.prepare(
      `INSERT INTO payments (id, user_id, provider, provider_ref, plan, amount, currency, status)
       VALUES (?, ?, 'wave', ?, ?, ?, 'XOF', 'pending')`
    ).run(crypto.randomUUID(), req.user.sub, session.id, plan, planInfo.amount);

    res.json({ checkout_url: session.wave_launch_url });
  } catch (err) {
    console.error('Erreur création session Wave:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/payments/wave/webhook   (appelé par Wave, PAS par le front)
router.post(
  '/wave/webhook',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    const signatureHeader = req.headers['wave-signature'] || '';
    const [tPart, vPart] = signatureHeader.split(',');
    const timestamp = tPart?.split('=')[1];
    const signature = vPart?.split('=')[1];

    if (!timestamp || !signature) {
      return res.status(400).send('Signature manquante');
    }

    const expected = crypto
      .createHmac('sha256', process.env.WAVE_WEBHOOK_SECRET)
      .update(timestamp + req.body.toString())
      .digest('hex');

    const valid =
      expected.length === signature.length &&
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));

    if (!valid) {
      return res.status(401).send('Signature invalide');
    }

    const event = JSON.parse(req.body.toString());

    if (event.type === 'checkout.session.completed' && event.data.payment_status === 'succeeded') {
      const sessionId = event.data.id;
      const payment = db.prepare('SELECT * FROM payments WHERE provider_ref = ?').get(sessionId);

      if (payment && payment.status !== 'succeeded') {
        db.prepare(`UPDATE payments SET status = 'succeeded', updated_at = datetime('now') WHERE id = ?`).run(payment.id);
        upgradeUserPlan(payment.user_id, payment.plan);
      }
    }

    res.sendStatus(200);
  }
);

/* ══════════════════════════════════════════════════════════
   ORANGE MONEY (Web Payment API)
   Docs : https://developer.orange.com/apis/om-webpay
   ══════════════════════════════════════════════════════════ */

async function getOrangeAccessToken() {
  const basicAuth = Buffer.from(
    `${process.env.ORANGE_CLIENT_ID}:${process.env.ORANGE_CLIENT_SECRET}`
  ).toString('base64');

  const response = await fetch('https://api.orange.com/oauth/v3/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) throw new Error('Échec obtention token Orange');
  const data = await response.json();
  return data.access_token;
}

// POST /api/payments/orange/checkout   (utilisateur connecté)
router.post('/orange/checkout', requireAuth, async (req, res) => {
  const { plan } = req.body;
  const planInfo = PLANS[plan];
  if (!planInfo) return res.status(400).json({ error: 'Plan invalide' });

  const orderId = crypto.randomUUID();

  try {
    const accessToken = await getOrangeAccessToken();

    const response = await fetch('https://api.orange.com/orange-money-webpay/dev/v1/webpayment', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        merchant_key: process.env.ORANGE_MERCHANT_KEY,
        currency: 'OUV',
        order_id: orderId,
        amount: planInfo.amount,
        return_url: `${process.env.FRONTEND_URL}/paiement/succes`,
        cancel_url: `${process.env.FRONTEND_URL}/paiement/annule`,
        notif_url: process.env.ORANGE_NOTIF_URL,
        lang: 'fr',
        reference: `${req.user.sub}:${plan}`,
      }),
    });

    const payment = await response.json();
    if (!response.ok) {
      return res.status(502).json({ error: 'Erreur Orange Money', details: payment });
    }

    db.prepare(
      `INSERT INTO payments (id, user_id, provider, provider_ref, plan, amount, currency, status)
       VALUES (?, ?, 'orange_money', ?, ?, ?, 'XOF', 'pending')`
    ).run(crypto.randomUUID(), req.user.sub, orderId, plan, planInfo.amount);

    res.json({ checkout_url: payment.payment_url });
  } catch (err) {
    console.error('Erreur création paiement Orange Money:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/payments/orange/notify   (appelé par Orange, PAS par le front)
router.post('/orange/notify', express.json(), (req, res) => {
  const { order_id, status } = req.body;

  const payment = db.prepare('SELECT * FROM payments WHERE provider_ref = ?').get(order_id);
  if (!payment) return res.sendStatus(404);

  if (status === 'SUCCESS' && payment.status !== 'succeeded') {
    db.prepare(`UPDATE payments SET status = 'succeeded', updated_at = datetime('now') WHERE id = ?`).run(payment.id);
    upgradeUserPlan(payment.user_id, payment.plan);
  } else if (status === 'FAILED') {
    db.prepare(`UPDATE payments SET status = 'failed', updated_at = datetime('now') WHERE id = ?`).run(payment.id);
  }

  res.sendStatus(200);
});

module.exports = router;
