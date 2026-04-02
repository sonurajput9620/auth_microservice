-- 001_role_management_schema.sql
-- Purpose: Initial MySQL schema for dynamic role management backend.
-- Target: MySQL 8+
-- NOTE: This migration reuses existing table `app_user` as user table.

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS permission_catalog_versions (
  id INT NOT NULL AUTO_INCREMENT,
  version_code VARCHAR(64) NOT NULL,
  source ENUM('DEMO', 'IMPORT', 'MANUAL') NOT NULL,
  notes VARCHAR(255) NULL,
  payload_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_permission_catalog_versions_version_code (version_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS permission_features (
  id INT NOT NULL AUTO_INCREMENT,
  feature_key VARCHAR(64) NOT NULL,
  feature_group VARCHAR(64) NOT NULL,
  feature_name VARCHAR(120) NOT NULL,
  feature_description VARCHAR(500) NULL,
  is_system_feature TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  catalog_version_id INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_permission_features_feature_key (feature_key),
  KEY idx_permission_features_group_active (feature_group, is_active, sort_order),
  CONSTRAINT fk_permission_features_catalog_version
    FOREIGN KEY (catalog_version_id)
    REFERENCES permission_catalog_versions (id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS permission_sub_features (
  id INT NOT NULL AUTO_INCREMENT,
  feature_id INT NOT NULL,
  sub_feature_key VARCHAR(80) NOT NULL,
  sub_feature_name VARCHAR(120) NOT NULL,
  sub_feature_description VARCHAR(500) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_permission_sub_features_key (sub_feature_key),
  KEY idx_permission_sub_features_feature_active (feature_id, is_active, sort_order),
  CONSTRAINT fk_permission_sub_features_feature
    FOREIGN KEY (feature_id)
    REFERENCES permission_features (id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS roles (
  id INT NOT NULL AUTO_INCREMENT,
  role_uid CHAR(36) NOT NULL,
  role_name VARCHAR(120) NOT NULL,
  role_description TEXT NOT NULL,
  role_category VARCHAR(80) NULL,
  role_type ENUM('SYSTEM', 'CUSTOM') NOT NULL DEFAULT 'CUSTOM',
  status ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  deleted_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_roles_role_uid (role_uid),
  UNIQUE KEY uq_roles_role_name_not_deleted (role_name, is_deleted),
  KEY idx_roles_status_type_deleted (status, role_type, is_deleted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Integrate existing app_user.role_id with roles.id.
-- app_user is expected to already exist.
SET @schema_name := DATABASE();
SET @app_user_exists := (
  SELECT COUNT(1)
  FROM information_schema.tables
  WHERE table_schema = @schema_name
    AND table_name = 'app_user'
);

SET @idx_exists := (
  SELECT COUNT(1)
  FROM information_schema.statistics
  WHERE table_schema = @schema_name
    AND table_name = 'app_user'
    AND index_name = 'idx_app_user_role_id'
);
SET @idx_sql := IF(
  @app_user_exists = 1 AND @idx_exists = 0,
  'ALTER TABLE app_user ADD INDEX idx_app_user_role_id (role_id)',
  'SELECT 1'
);
PREPARE idx_stmt FROM @idx_sql;
EXECUTE idx_stmt;
DEALLOCATE PREPARE idx_stmt;

-- Clean up orphan role references before adding FK.
-- Existing app_user.role_id values may point to legacy/non-existent role ids.
SET @cleanup_sql := IF(
  @app_user_exists = 1,
  'UPDATE app_user u LEFT JOIN roles r ON r.id = u.role_id SET u.role_id = NULL WHERE u.role_id IS NOT NULL AND r.id IS NULL',
  'SELECT 1'
);
PREPARE cleanup_stmt FROM @cleanup_sql;
EXECUTE cleanup_stmt;
DEALLOCATE PREPARE cleanup_stmt;

SET @fk_exists := (
  SELECT COUNT(1)
  FROM information_schema.referential_constraints
  WHERE constraint_schema = @schema_name
    AND table_name = 'app_user'
    AND constraint_name = 'fk_app_user_role'
);
SET @fk_sql := IF(
  @app_user_exists = 1 AND @fk_exists = 0,
  'ALTER TABLE app_user ADD CONSTRAINT fk_app_user_role FOREIGN KEY (role_id) REFERENCES roles(id) ON UPDATE CASCADE ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE fk_stmt FROM @fk_sql;
EXECUTE fk_stmt;
DEALLOCATE PREPARE fk_stmt;

CREATE TABLE IF NOT EXISTS role_sub_feature_permissions (
  role_id INT NOT NULL,
  sub_feature_id INT NOT NULL,
  is_enabled TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (role_id, sub_feature_id),
  KEY idx_role_sub_feature_permissions_enabled (is_enabled),
  KEY idx_role_sub_feature_permissions_sub_feature (sub_feature_id),
  CONSTRAINT fk_role_sub_feature_permissions_role
    FOREIGN KEY (role_id)
    REFERENCES roles (id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  CONSTRAINT fk_role_sub_feature_permissions_sub_feature
    FOREIGN KEY (sub_feature_id)
    REFERENCES permission_sub_features (id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS role_templates (
  id INT NOT NULL AUTO_INCREMENT,
  template_uid CHAR(36) NOT NULL,
  template_name VARCHAR(120) NOT NULL,
  created_by INT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_role_templates_template_uid (template_uid),
  UNIQUE KEY uq_role_templates_template_name (template_name),
  KEY idx_role_templates_created_by (created_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET @fk_role_templates_exists := (
  SELECT COUNT(1)
  FROM information_schema.referential_constraints
  WHERE constraint_schema = @schema_name
    AND table_name = 'role_templates'
    AND constraint_name = 'fk_role_templates_created_by'
);
SET @fk_role_templates_sql := IF(
  @app_user_exists = 1 AND @fk_role_templates_exists = 0,
  'ALTER TABLE role_templates ADD CONSTRAINT fk_role_templates_created_by FOREIGN KEY (created_by) REFERENCES app_user(id) ON UPDATE CASCADE ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE fk_role_templates_stmt FROM @fk_role_templates_sql;
EXECUTE fk_role_templates_stmt;
DEALLOCATE PREPARE fk_role_templates_stmt;

CREATE TABLE IF NOT EXISTS role_template_sub_feature_permissions (
  template_id INT NOT NULL,
  sub_feature_id INT NOT NULL,
  is_enabled TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (template_id, sub_feature_id),
  KEY idx_role_template_sub_feature_permissions_sub_feature (sub_feature_id),
  CONSTRAINT fk_role_template_sub_feature_permissions_template
    FOREIGN KEY (template_id)
    REFERENCES role_templates (id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  CONSTRAINT fk_role_template_sub_feature_permissions_sub_feature
    FOREIGN KEY (sub_feature_id)
    REFERENCES permission_sub_features (id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS feature_import_jobs (
  id INT NOT NULL AUTO_INCREMENT,
  import_uid CHAR(36) NOT NULL,
  source_filename VARCHAR(255) NULL,
  source_type ENUM('CSV', 'JSON', 'DEMO_RESTORE') NOT NULL,
  status ENUM('VALIDATED', 'APPLIED', 'FAILED') NOT NULL,
  total_rows INT UNSIGNED NOT NULL DEFAULT 0,
  valid_rows INT UNSIGNED NOT NULL DEFAULT 0,
  error_count INT UNSIGNED NOT NULL DEFAULT 0,
  warning_count INT UNSIGNED NOT NULL DEFAULT 0,
  errors_json JSON NULL,
  warnings_json JSON NULL,
  triggered_by INT NULL,
  catalog_version_id INT NULL,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_feature_import_jobs_import_uid (import_uid),
  KEY idx_feature_import_jobs_status_started_at (status, started_at),
  KEY idx_feature_import_jobs_triggered_by (triggered_by),
  CONSTRAINT fk_feature_import_jobs_catalog_version
    FOREIGN KEY (catalog_version_id)
    REFERENCES permission_catalog_versions (id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET @fk_feature_import_jobs_triggered_by_exists := (
  SELECT COUNT(1)
  FROM information_schema.referential_constraints
  WHERE constraint_schema = @schema_name
    AND table_name = 'feature_import_jobs'
    AND constraint_name = 'fk_feature_import_jobs_triggered_by'
);
SET @fk_feature_import_jobs_triggered_by_sql := IF(
  @app_user_exists = 1 AND @fk_feature_import_jobs_triggered_by_exists = 0,
  'ALTER TABLE feature_import_jobs ADD CONSTRAINT fk_feature_import_jobs_triggered_by FOREIGN KEY (triggered_by) REFERENCES app_user(id) ON UPDATE CASCADE ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE fk_feature_import_jobs_triggered_by_stmt FROM @fk_feature_import_jobs_triggered_by_sql;
EXECUTE fk_feature_import_jobs_triggered_by_stmt;
DEALLOCATE PREPARE fk_feature_import_jobs_triggered_by_stmt;

SET @view_sql := IF(
  @app_user_exists = 1,
  'CREATE OR REPLACE VIEW v_role_user_counts AS SELECT r.id AS role_id, COUNT(u.id) AS assigned_users_count FROM roles r LEFT JOIN app_user u ON u.role_id = r.id AND u.status = 1 WHERE r.is_deleted = 0 GROUP BY r.id',
  'CREATE OR REPLACE VIEW v_role_user_counts AS SELECT r.id AS role_id, CAST(0 AS UNSIGNED) AS assigned_users_count FROM roles r WHERE r.is_deleted = 0'
);
PREPARE view_stmt FROM @view_sql;
EXECUTE view_stmt;
DEALLOCATE PREPARE view_stmt;

-- Optional helper for remapping after catalog update:
-- 1) Add missing permission rows for each role x active sub-feature.
-- INSERT INTO role_sub_feature_permissions (role_id, sub_feature_id, is_enabled)
-- SELECT r.id, sf.id, 0
-- FROM roles r
-- CROSS JOIN permission_sub_features sf
-- LEFT JOIN role_sub_feature_permissions rp
--   ON rp.role_id = r.id
--  AND rp.sub_feature_id = sf.id
-- WHERE r.is_deleted = 0
--   AND sf.is_active = 1
--   AND rp.role_id IS NULL;
--
-- 2) Disable permissions for inactive sub-features.
-- UPDATE role_sub_feature_permissions rp
-- INNER JOIN permission_sub_features sf
--   ON sf.id = rp.sub_feature_id
-- SET rp.is_enabled = 0
-- WHERE sf.is_active = 0;
