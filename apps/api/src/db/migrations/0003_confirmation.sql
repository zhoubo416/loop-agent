-- 人工确认闸门
-- 对应 docs/design/03-agent-runtime.md 第 25 节的“建议确认/必须确认”,
-- 以及 docs/design/04-api-design.md 第 9 节的 State 确认通道。

-- Action 增加 proposed 状态:Agent 产出的 Action 先待确认,用户确认后才进入 pending
ALTER TABLE actions DROP CONSTRAINT IF EXISTS actions_status_check;
ALTER TABLE actions ADD CONSTRAINT actions_status_check CHECK (
    status IN ('pending', 'running', 'completed', 'failed', 'cancelled', 'proposed')
);

-- State Proposal:Agent 提出的结构性 State 变更,待用户确认后再应用
CREATE TABLE IF NOT EXISTS state_proposals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id),
    agent_run_id uuid REFERENCES agent_runs(id),
    proposal jsonb NOT NULL DEFAULT '{}'::jsonb,
    status varchar(20) NOT NULL DEFAULT 'pending',
    created_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz,
    CONSTRAINT state_proposals_status_check CHECK (status IN ('pending', 'applied', 'rejected', 'expired'))
);

CREATE INDEX IF NOT EXISTS state_proposals_project_status_idx ON state_proposals (project_id, status);
