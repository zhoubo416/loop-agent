-- 对话讨论产生的观察类型

ALTER TABLE observations DROP CONSTRAINT observations_type_check;
ALTER TABLE observations ADD CONSTRAINT observations_type_check CHECK (
    type IN (
        'user_input', 'conversation', 'meeting', 'document', 'action_result',
        'external_event', 'schedule', 'api', 'system'
    )
);