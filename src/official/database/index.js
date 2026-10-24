'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('../config');

// Garante que a pasta data/ existe
const dbDir = path.dirname(config.dbPath);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');

// Criar tabelas se não existirem
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    first_seen INTEGER
  );

  CREATE TABLE IF NOT EXISTS seasons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number INTEGER,
    status TEXT,
    started_at INTEGER,
    ended_at INTEGER,
    closed_by TEXT,
    close_reason TEXT,
    stats TEXT
  );

  CREATE TABLE IF NOT EXISTS season_scores (
    season_id INTEGER,
    user_id TEXT,
    points INTEGER DEFAULT 0,
    total_added INTEGER DEFAULT 0,
    total_removed INTEGER DEFAULT 0,
    changes INTEGER DEFAULT 0,
    last_change_at INTEGER,
    PRIMARY KEY(season_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS point_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    season_id INTEGER,
    user_id TEXT,
    actor_id TEXT,
    points_before INTEGER,
    delta INTEGER,
    points_after INTEGER,
    type TEXT,
    reason TEXT,
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS bateponto_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    guild_id TEXT,
    area TEXT,
    role_name TEXT,
    status TEXT,
    started_at INTEGER,
    ends_at INTEGER,
    duration_ms INTEGER,
    goal INTEGER,
    reward INTEGER,
    channel_id TEXT,
    messages INTEGER DEFAULT 0,
    last_counted_at INTEGER,
    goal_reached_at INTEGER,
    points_awarded INTEGER DEFAULT 0,
    result_note TEXT,
    ended_at INTEGER
  );
  
  CREATE UNIQUE INDEX IF NOT EXISTS idx_bp_active ON bateponto_sessions(user_id) WHERE status = 'active';

  CREATE TABLE IF NOT EXISTS bateponto_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER,
    user_id TEXT,
    channel_id TEXT,
    message_id TEXT UNIQUE,
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS role_permissions (
    guild_id TEXT,
    role_id TEXT,
    permission TEXT,
    PRIMARY KEY(guild_id, role_id, permission)
  );

  CREATE TABLE IF NOT EXISTS point_roles (
    points INTEGER PRIMARY KEY,
    guild_id TEXT,
    role_id TEXT,
    remove_previous INTEGER
  );

  CREATE TABLE IF NOT EXISTS season_rankings (
    season_id INTEGER,
    position INTEGER,
    user_id TEXT,
    points INTEGER
  );

  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT,
    action TEXT,
    guild_id TEXT,
    actor_id TEXT,
    target_id TEXT,
    summary TEXT,
    details TEXT,
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

module.exports = db;