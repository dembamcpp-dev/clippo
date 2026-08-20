const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'clippo.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    picture TEXT,
    auth_provider TEXT NOT NULL DEFAULT 'google',
    plan TEXT NOT NULL DEFAULT 'decouverte',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL,             -- 'wave' | 'orange_money'
    provider_ref TEXT NOT NULL,         -- checkout session id / order id
    plan TEXT NOT NULL,                 -- 'createur' | 'studio'
    amount INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'XOF',
    status TEXT NOT NULL DEFAULT 'pending',  -- pending | succeeded | failed | expired
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_payments_provider_ref ON payments(provider_ref);
`);

module.exports = db;
