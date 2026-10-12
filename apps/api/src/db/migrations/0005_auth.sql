-- 真实登录:用户密码与访问令牌

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text;

CREATE TABLE IF NOT EXISTS user_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash varchar(64) NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_tokens_user_idx ON user_tokens (user_id);
