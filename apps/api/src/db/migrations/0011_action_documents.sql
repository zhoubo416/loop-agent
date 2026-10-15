-- 资料(kind=document)行动的文档:上传的文件或 URL 链接。
-- 服务端在导入时提取文本存进 extracted_text,对话和 AI 整理都基于这份文本;
-- 文件字节存在 UPLOAD_DIR 下,file_path 只保存相对路径。

CREATE TABLE IF NOT EXISTS action_documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id),
    action_id uuid NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
    name varchar(500) NOT NULL,
    source varchar(20) NOT NULL DEFAULT 'upload',
    mime_type varchar(200),
    file_path text,
    file_url text,
    file_size bigint,
    extracted_text text,
    parse_status varchar(30) NOT NULL DEFAULT 'pending',
    parse_error text,
    uploaded_by uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT action_documents_source_check CHECK (source IN ('upload', 'url')),
    CONSTRAINT action_documents_parse_status_check CHECK (
        parse_status IN ('pending', 'ok', 'unsupported', 'failed')
    )
);

CREATE INDEX IF NOT EXISTS action_documents_action_idx ON action_documents (action_id, created_at);
CREATE INDEX IF NOT EXISTS action_documents_project_idx ON action_documents (project_id);