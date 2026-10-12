-- Notification:Agent 判断值得用户知道的事,而不是“有东西更新了”。
-- 对应 docs/design/05-frontend-ui-design.md 第 10、24 节。

CREATE TABLE IF NOT EXISTS notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id),
    type varchar(30) NOT NULL,
    severity varchar(20) NOT NULL DEFAULT 'info',
    title varchar(300) NOT NULL,
    content text NOT NULL,
    source_type varchar(30),
    source_id uuid,
    dedup_key varchar(255),
    status varchar(20) NOT NULL DEFAULT 'unread',
    created_at timestamptz NOT NULL DEFAULT now(),
    read_at timestamptz,
    CONSTRAINT notifications_type_check CHECK (
        type IN ('recommendation', 'risk', 'completion', 'event', 'system')
    ),
    CONSTRAINT notifications_severity_check CHECK (
        severity IN ('info', 'warning', 'critical')
    ),
    CONSTRAINT notifications_status_check CHECK (status IN ('unread', 'read'))
);

CREATE INDEX IF NOT EXISTS notifications_project_status_idx ON notifications (project_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_dedup_idx ON notifications (project_id, dedup_key);
