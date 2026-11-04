'use strict';

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const config = require('../config');

const BACKUP_DIR = path.resolve(config.rootDir, 'data', 'backups');
const RETENTION = Math.max(1, Number(process.env.MONGODB_BACKUP_RETENTION || 30));
const INTERVAL_MS = Math.max(60 * 60 * 1000, Number(process.env.MONGODB_BACKUP_INTERVAL_MS || 24 * 60 * 60 * 1000));
let timer = null;
let running = false;

function timestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

async function runBackup() {
  if (running) throw new Error('Já existe um backup em andamento.');
  if (mongoose.connection.readyState !== 1) throw new Error('MongoDB não está conectado.');
  running = true;
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const target = path.join(BACKUP_DIR, 'pxk-mongodb-' + timestamp() + '.json');
    const db = mongoose.connection.db;
    const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((x) => x.name).sort();
    const output = [];
    for (const name of names) {
      const docs = await db.collection(name).find({}).toArray();
      output.push({ name, documents: docs });
    }
    const ejson = mongoose.mongo.BSON?.EJSON;
    const payload = ejson
      ? ejson.stringify({ createdAt: new Date(), database: db.databaseName, collections: output }, null, 2)
      : JSON.stringify({ createdAt: new Date(), database: db.databaseName, collections: output }, null, 2);
    fs.writeFileSync(target, payload, { encoding: 'utf8', flag: 'wx' });
    if (!fs.statSync(target).size) {
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
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const files = fs.readdirSync(BACKUP_DIR)
    .filter((name) => /^pxk-mongodb-.*\.json$/.test(name))
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
