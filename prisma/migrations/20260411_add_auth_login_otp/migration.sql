CREATE TABLE `auth_login_otp` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(255) NOT NULL,
  `challenge_id` VARCHAR(64) NOT NULL,
  `otp_hash` CHAR(64) NOT NULL,
  `attempt_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `max_attempts` INT UNSIGNED NOT NULL DEFAULT 3,
  `expires_at` DATETIME(0) NOT NULL,
  `consumed_at` DATETIME(0) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) ON UPDATE CURRENT_TIMESTAMP(0),

  UNIQUE INDEX `uq_auth_login_otp_challenge_id`(`challenge_id`),
  INDEX `idx_auth_login_otp_email`(`email`),
  INDEX `idx_auth_login_otp_expires_at`(`expires_at`),
  INDEX `idx_auth_login_otp_consumed_at`(`consumed_at`),
  INDEX `idx_auth_login_otp_email_challenge`(`email`, `challenge_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
