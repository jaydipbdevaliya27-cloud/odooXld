-- Champions Club - Migration Script
-- Adapts the existing Saumil-branch DB to work with the new server code
-- Run: Get-Content "server\sql\migrate.sql" | mysql -u root -pUmesh@2005 -h 127.0.0.1 --port 3307

USE champions_club;

-- Step 1: Add missing columns to users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS full_name VARCHAR(255) GENERATED ALWAYS AS (name) VIRTUAL,
  ADD COLUMN IF NOT EXISTS role ENUM('visitor','member','staff','owner') NOT NULL DEFAULT 'staff';

-- Step 2: Set roles for existing users
UPDATE users SET role = 'owner' WHERE email IN ('admin@championsclub.in', 'admin@championsclub.com');
UPDATE users SET role = 'staff' WHERE email IN ('frontdesk@championsclub.in','bar@championsclub.in','shop@championsclub.in','accounts@championsclub.in','booking@championsclub.com','shop@championsclub.com','bar@championsclub.com');
UPDATE users SET role = 'member' WHERE email IN ('member@championsclub.in','member@championsclub.com');

-- Step 3: Insert our demo users with proper roles (password = Champions@123)
-- Hash: $2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p4UKiyE9MsrR0YqHAOhCIi
INSERT INTO users (name, email, password_hash, role, phone, assigned_area, is_active) VALUES
('Club Administrator',        'admin@championsclub.com',   '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p4UKiyE9MsrR0YqHAOhCIi', 'owner', '+91 98765 11111', 'all',     1),
('Marcus Sterling',           'owner@championsclub.com',   '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p4UKiyE9MsrR0YqHAOhCIi', 'owner', '+91 98765 11112', 'all',     1),
('Alex Carter',               'shop@championsclub.com',    '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p4UKiyE9MsrR0YqHAOhCIi', 'staff', '+91 98765 43210', 'shop',    1),
('Elena Rostova',             'bar@championsclub.com',     '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p4UKiyE9MsrR0YqHAOhCIi', 'staff', '+91 98765 43211', 'bar',     1),
('David Chen',                'booking@championsclub.com', '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p4UKiyE9MsrR0YqHAOhCIi', 'staff', '+91 98765 43212', 'booking', 1),
('Ravi Verma',                'member@championsclub.com',  '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p4UKiyE9MsrR0YqHAOhCIi', 'member','+91 94000 01111', 'member',  1)
ON DUPLICATE KEY UPDATE
  password_hash = VALUES(password_hash),
  role          = VALUES(role),
  assigned_area = VALUES(assigned_area),
  is_active     = 1;

SELECT 'Migration done! Users in DB:' AS status;
SELECT id, name, email, role, assigned_area, is_active FROM users;
