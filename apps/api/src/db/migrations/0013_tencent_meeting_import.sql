-- 腾讯会议个人凭证与会议 Action 的导入快照

CREATE TABLE IF NOT EXISTS user_integrations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider varchar(50) NOT NULL,
    encrypted_token text NOT NULL,
    token_hint varchar(8),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT user_integrations_provider_check CHECK (provider IN ('tencent_meeting')),
    CONSTRAINT user_integrations_user_provider_unique UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS user_integrations_user_idx ON user_integrations (user_id);

-- 原始会议资料和 Execution 分工不同:这里保存可反复查看的纪要、逐字稿和参会人,
-- Execution 只保存用户确认完成时提交给 Agent 的结构化结果
CREATE TABLE IF NOT EXISTS action_meeting_imports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    action_id uuid NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
    meeting_id varchar(64),
    meeting_code varchar(20),
    sub_meeting_id varchar(64),
    meeting_title varchar(300),
    started_at timestamptz,
    ended_at timestamptz,
    participants jsonb NOT NULL DEFAULT '[]'::jsonb,
    minutes text,
    todos jsonb NOT NULL DEFAULT '[]'::jsonb,
    transcript text,
    transcript_segments jsonb NOT NULL DEFAULT '[]'::jsonb,
    content_source varchar(20) NOT NULL DEFAULT 'minutes',
    imported_by uuid REFERENCES users(id) ON DELETE SET NULL,
    imported_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT action_meeting_imports_action_unique UNIQUE (action_id),
    CONSTRAINT action_meeting_imports_source_check CHECK (content_source IN ('minutes', 'smart_minutes'))
);

CREATE INDEX IF NOT EXISTS action_meeting_imports_action_idx ON action_meeting_imports (action_id);
