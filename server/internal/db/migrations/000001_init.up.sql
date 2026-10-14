CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL DEFAULT '新会话',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
    id bigserial PRIMARY KEY,
    session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content text NOT NULL,
    motion text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS messages_session_id_id_idx ON messages (session_id, id);
