'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');
const migrations = require('./migrations');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.pragma('synchronous = NORMAL');

function migrate() {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, name TEXT, applied_at INTEGER NOT NULL)');
  const current = db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_version').get().v;
  const pending = migrations.filter((m) => m.version > current).sort((a, b) => a.version - b.version);
  for (const m of pending) {
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_version(version, name, applied_at) VALUES (?, ?, ?)').run(m.version, m.name, Date.now());
    })();
    console.log(`[database] migração v${m.version} aplicada (${m.name}).`);
  }
}

migrate();

module.exports = db;
