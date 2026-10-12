-- 可靠性支撑表:幂等、Schedule 去重、Project 运行锁
-- 这三张表是 Runtime 实现并发与幂等的落地手段,对应
-- docs/design/02-database-design.md 的 28/29/30 节与 03 文档的 34/35 节

-- HTTP 层幂等:同一 Idempotency-Key 只产生一次业务效果
CREATE TABLE IF NOT EXISTS idempotency_keys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope varchar(200) NOT NULL,
    key varchar(255) NOT NULL,
    request_hash varchar(64),
    response jsonb NOT NULL DEFAULT '{}'::jsonb,
    status varchar(30) NOT NULL DEFAULT 'completed',
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT idempotency_keys_unique UNIQUE (scope, key),
    CONSTRAINT idempotency_keys_status_check CHECK (status IN ('in_progress', 'completed'))
);

-- Schedule 幂等:同一个 Schedule 的同一个执行窗口只触发一次 Agent Run
CREATE TABLE IF NOT EXISTS schedule_occurrences (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_id uuid NOT NULL REFERENCES schedules(id),
    scheduled_at timestamptz NOT NULL,
    agent_run_id uuid REFERENCES agent_runs(id),
    observation_id uuid REFERENCES observations(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT schedule_occurrences_unique UNIQUE (schedule_id, scheduled_at)
);

CREATE INDEX IF NOT EXISTS schedule_occurrences_schedule_idx ON schedule_occurrences (schedule_id);

-- Project 级运行锁:同一 Project 同一时间只允许一个 Agent Run 修改 State
CREATE TABLE IF NOT EXISTS project_locks (
    project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    holder varchar(200) NOT NULL,
    agent_run_id uuid,
    acquired_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS project_locks_expires_idx ON project_locks (expires_at);
