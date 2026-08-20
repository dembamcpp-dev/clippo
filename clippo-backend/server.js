require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const paymentRoutes = require('./routes/payments');
const { requireAuth } = require('./lib/session');
const db = require('./lib/db');

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));

// ⚠️ Le webhook Wave a besoin du corps BRUT (raw) pour vérifier la signature HMAC,
// donc on ne peut PAS appliquer express.json() globalement avant lui.
// On monte les routes de paiement AVANT le middleware JSON global,
// et payments.js applique lui-même express.json()/express.raw() route par route.
app.use('/api/payments', paymentRoutes);

app.use(express.json());
app.use('/api/auth', authRoutes);

// Exemple de route protégée : infos du compte connecté
app.get('/api/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, email, name, picture, plan, created_at FROM users WHERE id = ?').get(req.user.sub);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  res.json(user);
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Clippo backend démarré sur http://localhost:${PORT}`);
});
