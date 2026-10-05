-- ==============================================================================
-- National Unified Material Master Framework (NUMMF) - PostgreSQL Initialization
-- ==============================================================================

-- Enable Vector Similarity Search extension (pgvector)
CREATE EXTENSION IF NOT EXISTS vector;

-- Enable UUID generation extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Log extension statuses
DO $$
BEGIN
  RAISE NOTICE 'NUMMF Database initialized successfully.';
  RAISE NOTICE 'Installed extensions: pgvector (vector), uuid-ossp.';
END $$;
