-- Run this in Supabase SQL Editor for the ACE World project
-- supabase.com → ACE World project → SQL Editor

CREATE TABLE IF NOT EXISTS ace_sync (
  id integer PRIMARY KEY DEFAULT 1,
  data jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT single_row CHECK (id = 1)
);

-- Insert the initial row
INSERT INTO ace_sync (id, data) VALUES (1, '{}')
ON CONFLICT (id) DO NOTHING;

-- Enable RLS
ALTER TABLE ace_sync ENABLE ROW LEVEL SECURITY;

-- Allow all operations using service role key (server-side only)
CREATE POLICY "Service role full access" ON ace_sync
  FOR ALL USING (true) WITH CHECK (true);
