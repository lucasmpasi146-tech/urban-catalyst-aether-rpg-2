CREATE TABLE IF NOT EXISTS game_accounts (
  id BIGSERIAL PRIMARY KEY,
  username VARCHAR(20) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at TIMESTAMPTZ,
  role VARCHAR(12) NOT NULL DEFAULT 'player' CHECK (role IN ('player','admin')),
  is_banned BOOLEAN NOT NULL DEFAULT FALSE,
  ban_reason TEXT,
  chat_muted_until TIMESTAMPTZ
);
ALTER TABLE game_accounts ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;
ALTER TABLE game_accounts ADD COLUMN IF NOT EXISTS role VARCHAR(12) NOT NULL DEFAULT 'player';
ALTER TABLE game_accounts ADD COLUMN IF NOT EXISTS is_banned BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE game_accounts ADD COLUMN IF NOT EXISTS ban_reason TEXT;
ALTER TABLE game_accounts ADD COLUMN IF NOT EXISTS chat_muted_until TIMESTAMPTZ;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='game_accounts_role_check') THEN
    ALTER TABLE game_accounts ADD CONSTRAINT game_accounts_role_check CHECK (role IN ('player','admin'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor_id BIGINT REFERENCES game_accounts(id) ON DELETE SET NULL,
  target_id BIGINT REFERENCES game_accounts(id) ON DELETE SET NULL,
  action VARCHAR(40) NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS admin_audit_created_idx ON admin_audit_log(created_at DESC);

CREATE TABLE IF NOT EXISTS game_saves (
  user_id BIGINT PRIMARY KEY REFERENCES game_accounts(id) ON DELETE CASCADE,
  state JSONB NOT NULL CHECK (jsonb_typeof(state) = 'object'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS social_friendships (
  id BIGSERIAL PRIMARY KEY,
  requester_id BIGINT NOT NULL REFERENCES game_accounts(id) ON DELETE CASCADE,
  addressee_id BIGINT NOT NULL REFERENCES game_accounts(id) ON DELETE CASCADE,
  status VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (requester_id <> addressee_id),
  UNIQUE (requester_id, addressee_id)
);
CREATE INDEX IF NOT EXISTS social_friendships_requester_idx ON social_friendships(requester_id,status);
CREATE INDEX IF NOT EXISTS social_friendships_addressee_idx ON social_friendships(addressee_id,status);

CREATE TABLE IF NOT EXISTS social_messages (
  id BIGSERIAL PRIMARY KEY,
  sender_id BIGINT NOT NULL REFERENCES game_accounts(id) ON DELETE CASCADE,
  recipient_id BIGINT REFERENCES game_accounts(id) ON DELETE CASCADE,
  channel VARCHAR(12) NOT NULL CHECK (channel IN ('world','direct')),
  message VARCHAR(250) NOT NULL CHECK (length(trim(message)) BETWEEN 1 AND 250),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((channel='world' AND recipient_id IS NULL) OR (channel='direct' AND recipient_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS social_messages_world_idx ON social_messages(channel,id DESC);
CREATE INDEX IF NOT EXISTS social_messages_direct_idx ON social_messages(sender_id,recipient_id,id DESC);
