CREATE TABLE IF NOT EXISTS game_accounts (
  id BIGSERIAL PRIMARY KEY,
  username VARCHAR(20) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS game_saves (
  user_id BIGINT PRIMARY KEY REFERENCES game_accounts(id) ON DELETE CASCADE,
  state JSONB NOT NULL CHECK (jsonb_typeof(state) = 'object'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
