-- 003_core_user_foundation.sql
-- Purpose: Introduce future-state user tables for tbl_user retirement, without runtime usage yet.
-- Target: MySQL 8+
--
-- IMPORTANT:
-- - This is an expand-only foundation migration.
-- - Current services should continue using app_user + tbl_users + user_auth_bridge.
-- - Do not switch authorization/site mapping reads to these tables yet.
--
-- PostgreSQL equivalent notes:
-- 1) CREATE TABLE IF NOT EXISTS core_user (...).
-- 2) CREATE TABLE IF NOT EXISTS core_user_identity (...).
-- 3) CREATE UNIQUE INDEX IF NOT EXISTS uq_core_user_identity_provider_subject
--      ON core_user_identity(provider, provider_subject);
-- 4) CREATE UNIQUE INDEX IF NOT EXISTS uq_core_user_identity_app_user_id
--      ON core_user_identity(app_user_id) WHERE app_user_id IS NOT NULL;
-- 5) CREATE UNIQUE INDEX IF NOT EXISTS uq_core_user_identity_legacy_user_id
--      ON core_user_identity(legacy_user_id) WHERE legacy_user_id IS NOT NULL;
-- 6) Add FK core_user_identity.core_user_id -> core_user.id.
-- 7) For updated_at auto-update in PostgreSQL, use trigger/function.
--
-- Expand/contract plan for site mappings (future):
-- EXPAND PHASE (later):
-- - Add nullable core_user_id to legacy mapping tables:
--   tbl_siteuser, tbl_corporation_admin, tbl_site_agentuser (and similar user_id-bound tables).
-- - Backfill core_user_id using join path:
--   legacy user_id -> user_auth_bridge.legacy_user_id -> core_user_identity.core_user_id.
-- - Start dual-write: maintain both user_id and core_user_id on new writes.
-- - Add read shadowing/verification (compare user_id path vs core_user_id path).
--
-- CONTRACT PHASE (later, only after stability):
-- - Move reads to core_user_id path.
-- - Stop writing legacy user_id in mapping tables.
-- - Remove legacy user_id FKs/index dependencies in mapping tables.
-- - Finally retire tbl_users/tbl_user dependencies and bridge-only fallback logic.

SET NAMES utf8mb4;
SET @schema_name := DATABASE();

CREATE TABLE IF NOT EXISTS core_user (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  status TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS core_user_identity (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  core_user_id BIGINT UNSIGNED NOT NULL,
  provider VARCHAR(64) NOT NULL,
  provider_subject VARCHAR(255) NOT NULL,
  cognito_sub VARCHAR(255) NULL,
  app_user_id INT NULL,
  legacy_user_id INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_core_user_identity_provider_subject (provider, provider_subject),
  UNIQUE KEY uq_core_user_identity_cognito_sub (cognito_sub),
  UNIQUE KEY uq_core_user_identity_app_user_id (app_user_id),
  UNIQUE KEY uq_core_user_identity_legacy_user_id (legacy_user_id),
  KEY idx_core_user_identity_core_user_id (core_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Ensure FK core_user_identity.core_user_id -> core_user.id exists (idempotent safety).
SET @fk_core_user_identity_exists := (
  SELECT COUNT(1)
  FROM information_schema.referential_constraints
  WHERE constraint_schema = @schema_name
    AND table_name = 'core_user_identity'
    AND constraint_name = 'fk_core_user_identity_core_user'
);
SET @fk_core_user_identity_sql := IF(
  @fk_core_user_identity_exists = 0,
  'ALTER TABLE core_user_identity
     ADD CONSTRAINT fk_core_user_identity_core_user
     FOREIGN KEY (core_user_id) REFERENCES core_user(id)
     ON UPDATE CASCADE ON DELETE RESTRICT',
  'SELECT 1'
);
PREPARE fk_core_user_identity_stmt FROM @fk_core_user_identity_sql;
EXECUTE fk_core_user_identity_stmt;
DEALLOCATE PREPARE fk_core_user_identity_stmt;

-- Ensure unique index on (provider, provider_subject) exists.
SET @uq_provider_subject_exists := (
  SELECT COUNT(1)
  FROM information_schema.statistics
  WHERE table_schema = @schema_name
    AND table_name = 'core_user_identity'
    AND index_name = 'uq_core_user_identity_provider_subject'
);
SET @uq_provider_subject_sql := IF(
  @uq_provider_subject_exists = 0,
  'ALTER TABLE core_user_identity ADD UNIQUE INDEX uq_core_user_identity_provider_subject (provider, provider_subject)',
  'SELECT 1'
);
PREPARE uq_provider_subject_stmt FROM @uq_provider_subject_sql;
EXECUTE uq_provider_subject_stmt;
DEALLOCATE PREPARE uq_provider_subject_stmt;

-- Ensure unique index on cognito_sub exists.
SET @uq_cognito_sub_exists := (
  SELECT COUNT(1)
  FROM information_schema.statistics
  WHERE table_schema = @schema_name
    AND table_name = 'core_user_identity'
    AND index_name = 'uq_core_user_identity_cognito_sub'
);
SET @uq_cognito_sub_sql := IF(
  @uq_cognito_sub_exists = 0,
  'ALTER TABLE core_user_identity ADD UNIQUE INDEX uq_core_user_identity_cognito_sub (cognito_sub)',
  'SELECT 1'
);
PREPARE uq_cognito_sub_stmt FROM @uq_cognito_sub_sql;
EXECUTE uq_cognito_sub_stmt;
DEALLOCATE PREPARE uq_cognito_sub_stmt;

-- Ensure unique index on app_user_id exists.
SET @uq_app_user_id_exists := (
  SELECT COUNT(1)
  FROM information_schema.statistics
  WHERE table_schema = @schema_name
    AND table_name = 'core_user_identity'
    AND index_name = 'uq_core_user_identity_app_user_id'
);
SET @uq_app_user_id_sql := IF(
  @uq_app_user_id_exists = 0,
  'ALTER TABLE core_user_identity ADD UNIQUE INDEX uq_core_user_identity_app_user_id (app_user_id)',
  'SELECT 1'
);
PREPARE uq_app_user_id_stmt FROM @uq_app_user_id_sql;
EXECUTE uq_app_user_id_stmt;
DEALLOCATE PREPARE uq_app_user_id_stmt;

-- Ensure unique index on legacy_user_id exists.
SET @uq_legacy_user_id_exists := (
  SELECT COUNT(1)
  FROM information_schema.statistics
  WHERE table_schema = @schema_name
    AND table_name = 'core_user_identity'
    AND index_name = 'uq_core_user_identity_legacy_user_id'
);
SET @uq_legacy_user_id_sql := IF(
  @uq_legacy_user_id_exists = 0,
  'ALTER TABLE core_user_identity ADD UNIQUE INDEX uq_core_user_identity_legacy_user_id (legacy_user_id)',
  'SELECT 1'
);
PREPARE uq_legacy_user_id_stmt FROM @uq_legacy_user_id_sql;
EXECUTE uq_legacy_user_id_stmt;
DEALLOCATE PREPARE uq_legacy_user_id_stmt;

-- Ensure non-unique lookup index on core_user_id exists.
SET @idx_core_user_id_exists := (
  SELECT COUNT(1)
  FROM information_schema.statistics
  WHERE table_schema = @schema_name
    AND table_name = 'core_user_identity'
    AND index_name = 'idx_core_user_identity_core_user_id'
);
SET @idx_core_user_id_sql := IF(
  @idx_core_user_id_exists = 0,
  'ALTER TABLE core_user_identity ADD INDEX idx_core_user_identity_core_user_id (core_user_id)',
  'SELECT 1'
);
PREPARE idx_core_user_id_stmt FROM @idx_core_user_id_sql;
EXECUTE idx_core_user_id_stmt;
DEALLOCATE PREPARE idx_core_user_id_stmt;
