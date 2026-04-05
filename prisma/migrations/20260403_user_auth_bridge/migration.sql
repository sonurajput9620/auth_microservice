-- 002_user_auth_bridge.sql
-- Purpose: Compatibility bridge between external auth identities and legacy user ids.
-- Target: MySQL 8+
--
-- PostgreSQL equivalent notes:
-- 1) CREATE TABLE IF NOT EXISTS user_auth_bridge (...).
-- 2) CREATE UNIQUE INDEX IF NOT EXISTS uq_user_auth_bridge_provider_subject
--      ON user_auth_bridge(provider, provider_subject);
-- 3) CREATE UNIQUE INDEX IF NOT EXISTS uq_user_auth_bridge_cognito_sub
--      ON user_auth_bridge(cognito_sub)
--      WHERE cognito_sub IS NOT NULL;
-- 4) CREATE INDEX IF NOT EXISTS idx_user_auth_bridge_legacy_user_id
--      ON user_auth_bridge(legacy_user_id);
-- 5) For updated_at auto-update in PostgreSQL, use a trigger/function.

SET NAMES utf8mb4;
SET @schema_name := DATABASE();

CREATE TABLE IF NOT EXISTS user_auth_bridge (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  provider VARCHAR(64) NOT NULL,
  provider_subject VARCHAR(255) NOT NULL,
  cognito_sub VARCHAR(255) NULL,
  app_user_id INT NULL,
  legacy_user_id INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_user_auth_bridge_provider_subject (provider, provider_subject),
  UNIQUE KEY uq_user_auth_bridge_cognito_sub (cognito_sub),
  KEY idx_user_auth_bridge_legacy_user_id (legacy_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Ensure unique index on (provider, provider_subject) exists (idempotent safety).
SET @uq_provider_subject_exists := (
  SELECT COUNT(1)
  FROM information_schema.statistics
  WHERE table_schema = @schema_name
    AND table_name = 'user_auth_bridge'
    AND index_name = 'uq_user_auth_bridge_provider_subject'
);
SET @uq_provider_subject_sql := IF(
  @uq_provider_subject_exists = 0,
  'ALTER TABLE user_auth_bridge ADD UNIQUE INDEX uq_user_auth_bridge_provider_subject (provider, provider_subject)',
  'SELECT 1'
);
PREPARE uq_provider_subject_stmt FROM @uq_provider_subject_sql;
EXECUTE uq_provider_subject_stmt;
DEALLOCATE PREPARE uq_provider_subject_stmt;

-- Ensure unique index on cognito_sub exists (idempotent safety).
SET @uq_cognito_sub_exists := (
  SELECT COUNT(1)
  FROM information_schema.statistics
  WHERE table_schema = @schema_name
    AND table_name = 'user_auth_bridge'
    AND index_name = 'uq_user_auth_bridge_cognito_sub'
);
SET @uq_cognito_sub_sql := IF(
  @uq_cognito_sub_exists = 0,
  'ALTER TABLE user_auth_bridge ADD UNIQUE INDEX uq_user_auth_bridge_cognito_sub (cognito_sub)',
  'SELECT 1'
);
PREPARE uq_cognito_sub_stmt FROM @uq_cognito_sub_sql;
EXECUTE uq_cognito_sub_stmt;
DEALLOCATE PREPARE uq_cognito_sub_stmt;

-- Ensure index on legacy_user_id exists (idempotent safety).
SET @idx_legacy_user_id_exists := (
  SELECT COUNT(1)
  FROM information_schema.statistics
  WHERE table_schema = @schema_name
    AND table_name = 'user_auth_bridge'
    AND index_name = 'idx_user_auth_bridge_legacy_user_id'
);
SET @idx_legacy_user_id_sql := IF(
  @idx_legacy_user_id_exists = 0,
  'ALTER TABLE user_auth_bridge ADD INDEX idx_user_auth_bridge_legacy_user_id (legacy_user_id)',
  'SELECT 1'
);
PREPARE idx_legacy_user_id_stmt FROM @idx_legacy_user_id_sql;
EXECUTE idx_legacy_user_id_stmt;
DEALLOCATE PREPARE idx_legacy_user_id_stmt;
