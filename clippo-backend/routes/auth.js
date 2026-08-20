const express = require('express');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const db = require('../lib/db');
const { createSessionToken } = require('../lib/session');

const router = express.Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

/**
 * POST /api/auth/google
 * Body: { credential: "<id_token JWT renvoyé par Google Identity Services côté front>" }
 *
 * C'est ICI que la vérification de sécurité a lieu — jamais côté front.
 * On vérifie la signature du token auprès de Google avant de faire confiance
 * à quoi que ce soit dans son contenu.
 */
router.post('/google', async (req, res) => {
  const { credential } = req.body;
  if (!credential) {
    return res.status(400).json({ error: 'credential manquant' });
  }

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch (err) {
    return res.status(401).json({ error: 'Token Google invalide' });
  }

  if (!payload.email_verified) {
    return res.status(401).json({ error: 'Email Google non vérifié' });
  }

  // Cherche l'utilisateur existant, sinon le crée
  let user = db.prepare('SELECT * FROM users WHERE email = ?').get(payload.email);

  if (!user) {
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO users (id, email, name, picture, auth_provider, plan)
       VALUES (?, ?, ?, ?, 'google', 'decouverte')`
    ).run(id, payload.email, payload.name || null, payload.picture || null);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  }

  const token = createSessionToken(user);
  res.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, picture: user.picture, plan: user.plan },
  });
});

/**
 * POST /api/auth/email
 * Body: { email: "..." }
 * Inscription simple sans mot de passe (magic-link à implémenter plus tard).
 * Sert de secours pour le formulaire email de la modale d'inscription.
 */
router.post('/email', (req, res) => {
  const { email } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Email invalide' });
  }

  let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) {
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO users (id, email, auth_provider, plan) VALUES (?, ?, 'email', 'decouverte')`
    ).run(id, email);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  }

  const token = createSessionToken(user);
  res.json({ token, user: { id: user.id, email: user.email, plan: user.plan } });
});

module.exports = router;
