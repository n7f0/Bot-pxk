'use strict';

const fs = require('fs');
const path = require('path');
const db = require('./index');
const config = require('../config');

const BACKUP_DIR = path.resolve(config.rootDir, 'data', 'backups');
const RETENTION = Math.max(1, Number(process.env.SQLITE_BACKUP_RETENTION || 30));
const INTERVAL_MS = Math.max(60 * 60 * 1000, Number(process.env.SQLITE_BACKUP_INTERVAL_MS || 24 * 60 * 60 * 1000));

let timer = null;
let running = false;

function timestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

async function runBackup() {
  if (running) throw new Error('Já existe um backup em andamento.');
  running = true;
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const target = path.join(BACKUP_DIR, 'pxk-' + timestamp() + '.sqlite');
    await db.backup(target);
    const stat = fs.statSync(target);
    if (!stat.size) {
      fs.unlinkSync(target);
      throw new Error('O arquivo de backup ficou vazio.');
    }
    await pruneBackups();
    return target;
  } finally {
    running = false;
  }
}

async function pruneBackups() {
  const files = fs.readdirSync(BACKUP_DIR)
    .filter((name) => /^pxk-.*\.sqlite$/.test(name))
    .map((name) => {
      const full = path.join(BACKUP_DIR, name);
      return { full, mtime: fs.statSync(full).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);

  for (const file of files.slice(RETENTION)) {
    try { fs.unlinkSync(file.full); } catch (error) {
      console.warn('[backup] não foi possível remover backup antigo:', error.message);
    }
  }
}

function startAutoBackup() {
  if (timer) return;
  const run = () => runBackup().catch((error) => console.error('[backup] backup automático falhou:', error.message));
  timer = setInterval(run, INTERVAL_MS);
  timer.unref?.();
  run();
}

function stopAutoBackup() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { runBackup, startAutoBackup, stopAutoBackup, pruneBackups };
