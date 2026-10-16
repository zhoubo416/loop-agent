-- 同一会话里的 seq 必须唯一:它是消息次序的唯一依据。
-- 连接中途断掉时,重试会让同一条 INSERT 执行两次,留下同 seq 的两行,
-- 这里先把历史重复按原有顺序重新编号,再补上唯一约束,
-- 以后这种重复会直接报错,而不是静默写进对话记录里。

WITH ranked AS (
    SELECT id, row_number() OVER (PARTITION BY session_id ORDER BY seq, created_at, id) AS row_num
    FROM session_messages
)
UPDATE session_messages AS m
SET seq = ranked.row_num
FROM ranked
WHERE m.id = ranked.id AND m.seq <> ranked.row_num;

CREATE UNIQUE INDEX IF NOT EXISTS session_messages_session_seq_key
    ON session_messages (session_id, seq);
