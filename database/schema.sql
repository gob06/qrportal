-- Social Media QR Portal - MariaDB schema
-- Import with: mysql -u <user> -p < database/schema.sql

CREATE DATABASE IF NOT EXISTS uboafojr_qrportal
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE uboafojr_qrportal;

CREATE TABLE IF NOT EXISTS admins (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(100) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_admins_username (username)
) ENGINE=InnoDB;

-- permanent_id and permanent_qr_url are assigned once at creation time and are
-- never modified by application code. A trigger below enforces immutability at
-- the database level as well.
CREATE TABLE IF NOT EXISTS organizations (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  permanent_id VARCHAR(20) NOT NULL,
  name VARCHAR(150) NOT NULL,
  slug VARCHAR(160) NOT NULL,
  logo VARCHAR(255) NULL,
  description VARCHAR(500) NULL,
  primary_color CHAR(7) NOT NULL DEFAULT '#0d6efd',
  secondary_color CHAR(7) NOT NULL DEFAULT '#6c757d',
  background_color CHAR(7) NOT NULL DEFAULT '#f8f9fa',
  contact_info VARCHAR(255) NULL,
  permanent_qr_url VARCHAR(255) NOT NULL,
  status ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  archived_at TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_org_permanent_id (permanent_id),
  UNIQUE KEY uq_org_slug (slug),
  KEY idx_org_status (status),
  KEY idx_org_archived (archived_at)
) ENGINE=InnoDB;

-- Enforce immutability of the permanent QR destination at the DB level.
DELIMITER //
CREATE TRIGGER IF NOT EXISTS trg_org_protect_permanent
BEFORE UPDATE ON organizations
FOR EACH ROW
BEGIN
  IF NEW.permanent_id <> OLD.permanent_id THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'permanent_id is immutable';
  END IF;
  IF NEW.permanent_qr_url <> OLD.permanent_qr_url THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'permanent_qr_url is immutable';
  END IF;
END//
DELIMITER ;

-- Counter used to allocate permanent organization identifiers. Rows are never
-- deleted, so identifiers are never reused even after an organization is
-- archived or deleted.
CREATE TABLE IF NOT EXISTS permanent_id_registry (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  permanent_id VARCHAR(40) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_registry_permanent_id (permanent_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS social_links (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id INT UNSIGNED NOT NULL,
  platform VARCHAR(30) NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  account_url VARCHAR(500) NOT NULL,
  display_order INT NOT NULL DEFAULT 0,
  status ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_social_org (organization_id),
  KEY idx_social_order (organization_id, display_order),
  CONSTRAINT fk_social_org FOREIGN KEY (organization_id)
    REFERENCES organizations (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS qr_scans (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id INT UNSIGNED NOT NULL,
  scanned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  anonymized_metadata VARCHAR(255) NULL,
  PRIMARY KEY (id),
  KEY idx_scans_org_date (organization_id, scanned_at),
  CONSTRAINT fk_scans_org FOREIGN KEY (organization_id)
    REFERENCES organizations (id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS application_settings (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  setting_key VARCHAR(100) NOT NULL,
  setting_value TEXT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_settings_key (setting_key)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS admin_activity_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  admin_id INT UNSIGNED NULL,
  action VARCHAR(100) NOT NULL,
  description VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_activity_admin (admin_id),
  KEY idx_activity_date (created_at),
  CONSTRAINT fk_activity_admin FOREIGN KEY (admin_id)
    REFERENCES admins (id) ON DELETE SET NULL
) ENGINE=InnoDB;
