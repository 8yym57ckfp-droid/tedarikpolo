-- Safepays v20 PostgreSQL schema
-- Set USE_POSTGRES=true and DATABASE_URL before starting.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, first_name TEXT NOT NULL, last_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL, username TEXT UNIQUE NOT NULL, phone TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user', balance NUMERIC(20,8) NOT NULL DEFAULT 0,
  referral_earnings NUMERIC(20,8) NOT NULL DEFAULT 0, referral_code TEXT UNIQUE NOT NULL,
  referred_by TEXT, two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  phone_verified BOOLEAN NOT NULL DEFAULT FALSE, email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), type TEXT NOT NULL,
  amount NUMERIC(20,8) NOT NULL, currency TEXT NOT NULL DEFAULT 'USDT', network TEXT,
  status TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), tx_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_transactions_user_created ON transactions(user_id, created_at DESC);


CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), transaction_id TEXT,
  direction TEXT NOT NULL, amount NUMERIC(20,8) NOT NULL, currency TEXT NOT NULL DEFAULT 'USDT',
  balance_before NUMERIC(20,8) NOT NULL, balance_after NUMERIC(20,8) NOT NULL,
  reason TEXT NOT NULL, metadata JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ledger_user_created ON ledger_entries(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_tx ON ledger_entries(transaction_id);

-- v30 transaction control fields
ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users (LOWER(username));
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS request_key TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS locked_by TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS decision_by TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS decision_at TIMESTAMPTZ;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS requested_amount NUMERIC(20,8);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS received_amount NUMERIC(20,8);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_request_key ON transactions(request_key) WHERE request_key IS NOT NULL;
