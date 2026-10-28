-- 长期记忆：单表。embedding 列预留给 M5 抽取管线（本版本不写不读）。
CREATE TABLE IF NOT EXISTS memories (
    id bigserial PRIMARY KEY,
    type text NOT NULL CHECK (type IN ('偏好', '事实', '习惯')),
    content text NOT NULL,
    source text NOT NULL DEFAULT 'manual', -- manual=手动添加；M5 抽取管线写 auto
    embedding vector(1024),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS memories_created_at_idx ON memories (created_at DESC, id DESC);
