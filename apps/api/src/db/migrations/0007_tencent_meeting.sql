-- 腾讯会议凭证与会议 Action 的最近一次同步结果

CREATE TABLE IF NOT EXISTS user_integrations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider varchar(50) NOT NULL,
    encrypted_token text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT user_integrations_provider_check CHECK (provider IN ('tencent_meeting')),
    CONSTRAINT user_integrations_user_provider_unique UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS user_integrations_user_idx ON user_integrations (user_id);

CREATE TABLE IF NOT EXISTS action_meeting_syncs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    action_id uuid NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
    meeting_code varchar(9) NOT NULL,
    meeting_id varchar(200),
    record_file_id varchar(200),
    meeting_title varchar(300),
    started_at timestamptz,
    ended_at timestamptz,
    participants jsonb NOT NULL DEFAULT '[]'::jsonb,
    summary text,
    todo text,
    transcript text,
    transcript_segments jsonb NOT NULL DEFAULT '[]'::jsonb,
    synced_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT action_meeting_syncs_action_unique UNIQUE (action_id),
    CONSTRAINT action_meeting_syncs_code_check CHECK (meeting_code ~ '^[0-9]{9}$')
);

CREATE INDEX IF NOT EXISTS action_meeting_syncs_action_idx ON action_meeting_syncs (action_id);
