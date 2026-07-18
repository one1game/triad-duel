-- Auth codes for bot-based login (Vercel serverless compatible)
CREATE TABLE IF NOT EXISTS kart_auth_codes (
  code TEXT PRIMARY KEY,
  telegram_id BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-cleanup codes older than 5 minutes
CREATE INDEX IF NOT EXISTS kart_auth_codes_created_idx ON kart_auth_codes(created_at);
