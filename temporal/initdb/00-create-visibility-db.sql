-- Runs once, only when a fresh temporal-db-data volume is initialized by the
-- postgres image. The `temporal` database itself is created by POSTGRES_DB.
-- Pre-creating the visibility database lets the Temporal container run with
-- SKIP_DB_CREATE=true, which keeps container restarts idempotent (the stock
-- auto-setup image aborts on restart with 'database "temporal_visibility"
-- already exists' otherwise).
CREATE DATABASE temporal_visibility;
