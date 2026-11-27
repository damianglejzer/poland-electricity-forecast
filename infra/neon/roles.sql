-- Least-privilege database users for production (run once in the Neon SQL editor, AFTER the
-- first `make publish` has created the tables). Replace both passwords first.
--
--   owner (neondb_owner)  your laptop only: `make publish` (copies the model and data)
--   gridcast_writer       GitHub Actions daily job: adds data and forecasts, nothing else
--   gridcast_api          Render API: read-only, with a query time limit
--
-- If a credential leaks, the damage is limited to what that user may do: the API user can't
-- change anything, and the writer can't touch the model, delete rows or drop tables.

-- 1. Read-only user for the public API (Render).
CREATE ROLE gridcast_api WITH LOGIN PASSWORD 'CHANGE-ME-api-password' CONNECTION LIMIT 10;
ALTER ROLE gridcast_api SET default_transaction_read_only = on;
ALTER ROLE gridcast_api SET statement_timeout = '10s';
ALTER ROLE gridcast_api SET idle_in_transaction_session_timeout = '30s';
GRANT USAGE ON SCHEMA public TO gridcast_api;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO gridcast_api;
-- Tables the owner creates later are readable too.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO gridcast_api;

-- 2. Writer for the daily job (GitHub Actions): new data, refresh log and forecasts only.
CREATE ROLE gridcast_writer WITH LOGIN PASSWORD 'CHANGE-ME-writer-password' CONNECTION LIMIT 5;
ALTER ROLE gridcast_writer SET statement_timeout = '120s';
GRANT USAGE ON SCHEMA public TO gridcast_writer;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO gridcast_writer;
GRANT INSERT, UPDATE ON load, weather, predictions, refresh_log TO gridcast_writer;
GRANT USAGE ON SEQUENCE refresh_log_id_seq TO gridcast_writer;

-- Check: \du lists the roles; neither has CREATE on the schema, DELETE or TRUNCATE anywhere.
