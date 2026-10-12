-- Action 是“可执行的工作”,而不是只翻状态的待办。
-- kind 说明这次行动对应哪一类工作,完成时按种类采集结构化结果。

ALTER TABLE actions ADD COLUMN IF NOT EXISTS kind varchar(30) NOT NULL DEFAULT 'task';
ALTER TABLE actions DROP CONSTRAINT IF EXISTS actions_kind_check;
ALTER TABLE actions ADD CONSTRAINT actions_kind_check CHECK (kind IN ('task', 'meeting', 'document'));
