-- 会议导入快照补上结论;决定和后续行动不再单独作为表单字段,内容留在纪要正文里

ALTER TABLE action_meeting_imports
    ADD COLUMN IF NOT EXISTS summary text;

-- 旧快照从智能纪要正文里的「会议摘要：」补出结论,补不出来保持 NULL
UPDATE action_meeting_imports
SET summary = NULLIF(btrim(substring(minutes from '会议摘要[：:][[:space:]]*([^\n]+)')), '')
WHERE summary IS NULL
  AND minutes ~ '会议摘要[：:]';
