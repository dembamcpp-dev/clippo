const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
const SESSION_DURATION = '30d';

function createSessionToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, plan: user.plan },
    JWT_SECRET,
    { expiresIn: SESSION_DURATION }
  );
}

function verifySessionToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

// Middleware Express : protège une route, attache req.user si le token est valide
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Non authentifié' });

  const payload = verifySessionToken(token);
  if (!payload) return res.status(401).json({ error: 'Session invalide ou expirée' });

  req.user = payload;
  next();
}

module.exports = { createSessionToken, verifySessionToken, requireAuth };
