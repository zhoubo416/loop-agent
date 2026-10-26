-- State Proposal 记录创建时看到的 State 版本,确认时用乐观锁拒绝过期提案
ALTER TABLE state_proposals ADD COLUMN IF NOT EXISTS expected_version integer;

UPDATE state_proposals
SET expected_version = COALESCE(
  expected_version,
  (SELECT version FROM agent_states WHERE agent_states.project_id = state_proposals.project_id),
  1
),
    status = CASE WHEN status = 'pending' THEN 'expired' ELSE status END,
    resolved_at = CASE WHEN status = 'pending' THEN now() ELSE resolved_at END
WHERE expected_version IS NULL;

ALTER TABLE state_proposals ALTER COLUMN expected_version SET NOT NULL;
