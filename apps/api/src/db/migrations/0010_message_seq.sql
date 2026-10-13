-- 会话消息的稳定序号:同一事务写入的消息 created_at 完全相同,seq 保证次序

ALTER TABLE session_messages ADD COLUMN seq integer NOT NULL DEFAULT 0;

UPDATE session_messages SET seq = sub.row_num
FROM (
    SELECT id, row_number() OVER (PARTITION BY session_id ORDER BY created_at, id) AS row_num
    FROM session_messages
) AS sub
WHERE session_messages.id = sub.id;