-- Run this in Supabase SQL Editor to wipe all ACE data and start fresh
UPDATE ace_sync SET data = '{}', updated_at = now() WHERE id = 1;
