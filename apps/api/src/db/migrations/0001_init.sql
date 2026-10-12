-- LOOP MVP 初始数据模型
-- 对应设计文档 docs/design/02-database-design.md
-- 时间统一 timestamptz,统一保存 UTC

CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar(100) NOT NULL,
    email varchar(255) UNIQUE,
    avatar text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar(200) NOT NULL,
    objective text NOT NULL,
    description text,
    success_criteria jsonb NOT NULL DEFAULT '[]'::jsonb,
    constraints jsonb NOT NULL DEFAULT '{}'::jsonb,
    status varchar(30) NOT NULL DEFAULT 'created',
    current_stage varchar(200),
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    archived_at timestamptz,
    CONSTRAINT projects_status_check CHECK (
        status IN ('created', 'active', 'paused', 'completed', 'archived')
    )
);

CREATE INDEX IF NOT EXISTS projects_status_idx ON projects (status);
CREATE INDEX IF NOT EXISTS projects_created_by_idx ON projects (created_by);
CREATE INDEX IF NOT EXISTS projects_updated_at_idx ON projects (updated_at DESC);

CREATE TABLE IF NOT EXISTS project_users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role varchar(30) NOT NULL DEFAULT 'member',
    joined_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT project_users_role_check CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
    CONSTRAINT project_users_unique UNIQUE (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS project_users_project_idx ON project_users (project_id);
CREATE INDEX IF NOT EXISTS project_users_user_idx ON project_users (user_id);

CREATE TABLE IF NOT EXISTS agent_states (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id),
    current_stage varchar(200),
    current_situation text,
    open_issues jsonb NOT NULL DEFAULT '[]'::jsonb,
    active_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
    risks jsonb NOT NULL DEFAULT '[]'::jsonb,
    unknowns jsonb NOT NULL DEFAULT '[]'::jsonb,
    context jsonb NOT NULL DEFAULT '{}'::jsonb,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT agent_states_project_unique UNIQUE (project_id)
);

CREATE TABLE IF NOT EXISTS sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id),
    user_id uuid REFERENCES users(id),
    type varchar(30) NOT NULL DEFAULT 'chat',
    status varchar(30) NOT NULL DEFAULT 'active',
    started_at timestamptz NOT NULL DEFAULT now(),
    ended_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT sessions_type_check CHECK (
        type IN ('chat', 'meeting', 'schedule', 'event', 'api', 'system')
    ),
    CONSTRAINT sessions_status_check CHECK (
        status IN ('active', 'completed', 'cancelled')
    )
);

CREATE INDEX IF NOT EXISTS sessions_project_idx ON sessions (project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS session_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES sessions(id),
    role varchar(30) NOT NULL,
    content text NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT session_messages_role_check CHECK (role IN ('user', 'assistant', 'system', 'tool'))
);

CREATE INDEX IF NOT EXISTS session_messages_session_idx ON session_messages (session_id, created_at);

CREATE TABLE IF NOT EXISTS observations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id),
    session_id uuid REFERENCES sessions(id),
    user_id uuid REFERENCES users(id),
    type varchar(40) NOT NULL,
    content text NOT NULL,
    source varchar(100),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT observations_type_check CHECK (
        type IN (
            'user_input', 'meeting', 'document', 'action_result',
            'external_event', 'schedule', 'api', 'system'
        )
    )
);

CREATE INDEX IF NOT EXISTS observations_project_created_idx ON observations (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS observations_project_type_idx ON observations (project_id, type, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id),
    session_id uuid REFERENCES sessions(id),
    trigger_type varchar(30) NOT NULL,
    trigger_id uuid,
    input_context jsonb NOT NULL DEFAULT '{}'::jsonb,
    output jsonb,
    status varchar(30) NOT NULL DEFAULT 'pending',
    error jsonb,
    attempts integer NOT NULL DEFAULT 0,
    started_at timestamptz,
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT agent_runs_trigger_type_check CHECK (
        trigger_type IN ('user', 'observation', 'schedule', 'event', 'api', 'system', 'manual')
    ),
    CONSTRAINT agent_runs_status_check CHECK (
        status IN ('pending', 'running', 'completed', 'failed', 'cancelled')
    )
);

CREATE INDEX IF NOT EXISTS agent_runs_project_created_idx ON agent_runs (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_runs_project_status_idx ON agent_runs (project_id, status);
CREATE INDEX IF NOT EXISTS agent_runs_pending_idx ON agent_runs (created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS agent_runs_trigger_idx ON agent_runs (trigger_type, trigger_id);

CREATE TABLE IF NOT EXISTS events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id),
    observation_id uuid REFERENCES observations(id),
    agent_run_id uuid REFERENCES agent_runs(id),
    type varchar(50) NOT NULL,
    title varchar(300) NOT NULL,
    content text NOT NULL,
    status varchar(30) NOT NULL DEFAULT 'open',
    occurred_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT events_status_check CHECK (status IN ('open', 'resolved', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS events_project_created_idx ON events (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS events_project_status_idx ON events (project_id, status);

CREATE TABLE IF NOT EXISTS actions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id),
    event_id uuid REFERENCES events(id),
    agent_run_id uuid REFERENCES agent_runs(id),
    recommendation_id uuid,
    title varchar(300) NOT NULL,
    description text,
    executor_type varchar(30) NOT NULL DEFAULT 'human',
    assignee_id uuid REFERENCES users(id),
    status varchar(30) NOT NULL DEFAULT 'pending',
    priority varchar(20) NOT NULL DEFAULT 'medium',
    due_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    CONSTRAINT actions_executor_type_check CHECK (executor_type IN ('human', 'agent', 'system')),
    CONSTRAINT actions_status_check CHECK (
        status IN ('pending', 'running', 'completed', 'failed', 'cancelled')
    ),
    CONSTRAINT actions_priority_check CHECK (priority IN ('low', 'medium', 'high', 'critical'))
);

CREATE INDEX IF NOT EXISTS actions_project_status_idx ON actions (project_id, status);
CREATE INDEX IF NOT EXISTS actions_project_due_idx ON actions (project_id, due_at);
CREATE INDEX IF NOT EXISTS actions_assignee_status_idx ON actions (assignee_id, status);
CREATE INDEX IF NOT EXISTS actions_agent_run_idx ON actions (agent_run_id);

CREATE TABLE IF NOT EXISTS executions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    action_id uuid NOT NULL REFERENCES actions(id),
    executor_type varchar(30) NOT NULL,
    executor_id uuid,
    input jsonb NOT NULL DEFAULT '{}'::jsonb,
    output jsonb NOT NULL DEFAULT '{}'::jsonb,
    status varchar(30) NOT NULL DEFAULT 'running',
    error jsonb,
    idempotency_key varchar(255) UNIQUE,
    started_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    CONSTRAINT executions_status_check CHECK (
        status IN ('running', 'completed', 'failed', 'cancelled')
    )
);

CREATE INDEX IF NOT EXISTS executions_action_idx ON executions (action_id, started_at DESC);

CREATE TABLE IF NOT EXISTS recommendations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id),
    agent_run_id uuid REFERENCES agent_runs(id),
    judgment text,
    type varchar(50) NOT NULL,
    content text NOT NULL,
    priority varchar(20) NOT NULL DEFAULT 'medium',
    requires_confirmation boolean NOT NULL DEFAULT true,
    status varchar(30) NOT NULL DEFAULT 'pending',
    created_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz,
    CONSTRAINT recommendations_status_check CHECK (
        status IN ('pending', 'accepted', 'rejected', 'expired', 'executed')
    ),
    CONSTRAINT recommendations_priority_check CHECK (
        priority IN ('low', 'medium', 'high', 'critical')
    )
);

CREATE INDEX IF NOT EXISTS recommendations_project_status_idx ON recommendations (project_id, status);
CREATE INDEX IF NOT EXISTS recommendations_project_created_idx ON recommendations (project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS memories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id),
    agent_run_id uuid REFERENCES agent_runs(id),
    type varchar(30) NOT NULL,
    content text NOT NULL,
    source_type varchar(50),
    source_id uuid,
    confidence numeric(4, 3),
    status varchar(30) NOT NULL DEFAULT 'active',
    superseded_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT memories_type_check CHECK (
        type IN ('event', 'decision', 'action', 'conclusion', 'context')
    ),
    CONSTRAINT memories_status_check CHECK (
        status IN ('active', 'superseded', 'invalid', 'archived')
    )
);

CREATE INDEX IF NOT EXISTS memories_project_status_idx ON memories (project_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS schedules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id),
    type varchar(30) NOT NULL,
    expression varchar(255),
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    status varchar(30) NOT NULL DEFAULT 'active',
    next_run_at timestamptz,
    last_run_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT schedules_type_check CHECK (type IN ('once', 'interval', 'cron', 'event', 'manual')),
    CONSTRAINT schedules_status_check CHECK (status IN ('active', 'paused', 'completed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS schedules_status_next_run_idx ON schedules (status, next_run_at);
CREATE INDEX IF NOT EXISTS schedules_project_status_idx ON schedules (project_id, status);

CREATE TABLE IF NOT EXISTS tool_calls (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_run_id uuid NOT NULL REFERENCES agent_runs(id),
    tool_name varchar(200) NOT NULL,
    input jsonb NOT NULL DEFAULT '{}'::jsonb,
    output jsonb,
    status varchar(30) NOT NULL DEFAULT 'running',
    error jsonb,
    started_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    CONSTRAINT tool_calls_status_check CHECK (
        status IN ('running', 'completed', 'failed', 'cancelled')
    )
);

CREATE INDEX IF NOT EXISTS tool_calls_agent_run_idx ON tool_calls (agent_run_id);

CREATE TABLE IF NOT EXISTS agent_state_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id),
    state_id uuid NOT NULL REFERENCES agent_states(id),
    version integer NOT NULL,
    state jsonb NOT NULL,
    changed_by_type varchar(30) NOT NULL,
    changed_by_id uuid,
    agent_run_id uuid REFERENCES agent_runs(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT agent_state_versions_unique UNIQUE (project_id, version),
    CONSTRAINT agent_state_versions_changed_by_check CHECK (
        changed_by_type IN ('user', 'agent', 'system')
    )
);
