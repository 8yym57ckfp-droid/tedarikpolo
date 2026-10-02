-- Safepays v20 PostgreSQL schema
-- Set DATABASE_URL before starting. Production refuses file-based storage.
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
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS wallet_id TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS request_key TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS locked_by TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS decision_by TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS decision_at TIMESTAMPTZ;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS requested_amount NUMERIC(20,8);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS received_amount NUMERIC(20,8);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_request_key ON transactions(request_key) WHERE request_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_tx_hash_unique ON transactions(LOWER(tx_hash)) WHERE tx_hash IS NOT NULL AND tx_hash <> '';
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
CREATE TABLE IF NOT EXISTS site_content (
  id TEXT PRIMARY KEY, content JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS wallet_addresses (
  id TEXT PRIMARY KEY, network TEXT NOT NULL CHECK (network IN ('TRC20','ERC20')), address TEXT NOT NULL,
  label TEXT NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE, team_id TEXT, created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  use_count INTEGER NOT NULL DEFAULT 0, last_used_at TIMESTAMPTZ, UNIQUE (network,address)
);
CREATE TABLE IF NOT EXISTS deposit_intents (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), wallet_id TEXT NOT NULL REFERENCES wallet_addresses(id),
  amount NUMERIC(20,8) NOT NULL, network TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS support_tickets (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS support_messages (
  id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('user','admin')), sender_id TEXT NOT NULL,
  message TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_support_ticket_user_updated ON support_tickets(user_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_messages_ticket_created ON support_messages(ticket_id,created_at);
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY, action TEXT NOT NULL, actor TEXT NOT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
