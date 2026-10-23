'use strict';

const fs = require('fs');
const path = require('path');
const db = require('./index');
const config = require('../config');

const BACKUP_DIR = path.join(path.dirname(config.dbPath), 'backups');
const KEEP = 5;

/** Cria um backup consistente do banco (usa a API de backup do SQLite) e mantém só os mais recentes. */
async function runBackup() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(BACKUP_DIR, `backup-${stamp}.db`);
  await db.backup(file);
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith('backup-') && f.endsWith('.db'))
    .sort();
  while (files.length > KEEP) fs.unlinkSync(path.join(BACKUP_DIR, files.shift()));
  return file;
}

function startAutoBackup(everyMs = 6 * 60 * 60 * 1000) {
  const timer = setInterval(() => {
    runBackup().catch((e) => console.error('[backup] falha:', e.message));
  }, everyMs);
  timer.unref();
  return timer;
}

module.exports = { runBackup, startAutoBackup, BACKUP_DIR };
