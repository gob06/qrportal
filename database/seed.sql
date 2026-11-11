-- Seed data for Social Media QR Portal
-- Default admin: username "admin", password "admin123" (CHANGE AFTER FIRST LOGIN)
-- Hash generated with bcryptjs, 12 rounds.

USE uboafojr_qrportal;

INSERT INTO admins (username, password_hash)
VALUES ('admin', '$2a$12$fj4n3tFj3sNT0ePyaLiTneAkXMZwUby1PNBXNrZ9kj4f1rlScwizW')
ON DUPLICATE KEY UPDATE username = username;

INSERT INTO application_settings (setting_key, setting_value) VALUES
  ('site_name', 'Social QR Portal'),
  ('site_logo', ''),
  ('site_url', 'http://localhost:3000'),
  ('qr_default_fg', '#000000'),
  ('qr_default_bg', '#ffffff'),
  ('qr_default_size', '512'),
  ('qr_default_ec', 'H'),
  ('upload_max_mb', '5'),
  ('analytics_retention_days', '365')
ON DUPLICATE KEY UPDATE setting_key = setting_key;
