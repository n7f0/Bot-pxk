'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const mongoose = require('mongoose');

const MIGRATION_ID = 'legacy-bot-db-v1';

function quoteIdentifier(value) {
  return '"' + String(value).replace(/"/g, '""') + '"';
}

function sourcePath() {
  return path.resolve(
    path.dirname(require('../config').dbPath),
    process.env.BOT_DB_PATH || 'bot.db',
  );
}

function stableKey(table, row, index, primaryKeys) {
  const identity = primaryKeys.length
    ? primaryKeys.map((key) => [key, row[key]])
    : ['row', index];
  const digest = crypto.createHash('sha256')
    .update(JSON.stringify(identity))
    .digest('hex');
  return table + ':' + digest;
}

async function backupDatabase(db, source, label) {
  const backupDir = path.resolve(path.dirname(source), 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, label + '-' + stamp + '.sqlite');
  await db.backup(backupPath);
  if (!fs.existsSync(backupPath) || fs.statSync(backupPath).size === 0) {
    throw new Error('Backup pré-migração vazio: ' + backupPath);
  }
  return backupPath;
}

async function runBotDbMigration() {
  const source = sourcePath();
  if (!fs.existsSync(source)) {
    return { skipped: true, reason: 'bot-db-not-found', source };
  }

  const database = mongoose.connection.db;
  if (!database) throw new Error('[bot-db-migration] MongoDB não está conectado.');

  const migrations = database.collection('legacy_bot_migrations');
  const records = database.collection('legacy_bot_records');
  const marker = await migrations.findOne({ _id: MIGRATION_ID });
  if (marker?.status === 'complete') {
    return { skipped: true, reason: 'already-complete', report: marker.report };
  }

  const sqlite = new Database(source, { readonly: true, fileMustExist: true });
  try {
    const integrity = sqlite.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') {
      throw new Error('[bot-db-migration] integrity_check falhou: ' + integrity);
    }

    // O backup da API SQLite inclui transações confirmadas que ainda estejam no WAL.
    // O arquivo original, WAL e SHM nunca são removidos nem modificados.
    const backup = await backupDatabase(sqlite, source, 'bot-db-pre-mongodb-migration');
    const tables = sqlite.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).all().map((row) => row.name);

    if (!tables.length) {
      const report = { source, backup, tables: 0, records: 0, collections: {} };
      await migrations.updateOne(
        { _id: MIGRATION_ID },
        { $set: { status: 'complete', completedAt: new Date(), report } },
        { upsert: true },
      );
      return { skipped: false, report };
    }

    const report = { source, backup, tables: tables.length, records: 0, collections: {} };
    for (const table of tables) {
      const safeTable = quoteIdentifier(table);
      const columns = sqlite.prepare('PRAGMA table_info(' + safeTable + ')').all();
      const primaryKeys = columns
        .filter((column) => Number(column.pk) > 0)
        .sort((a, b) => Number(a.pk) - Number(b.pk))
        .map((column) => column.name);
      const rows = sqlite.prepare('SELECT rowid AS __migration_rowid, * FROM ' + safeTable).all();
      const collection = records;
      let imported = 0;

      for (let offset = 0; offset < rows.length; offset += 250) {
        const batch = rows.slice(offset, offset + 250);
        if (!batch.length) continue;
        const operations = batch.map((row, batchIndex) => {
          const clean = { ...row };
          const rowIndex = Number(clean.__migration_rowid ?? (offset + batchIndex));
          delete clean.__migration_rowid;
          const _id = stableKey(table, clean, rowIndex, primaryKeys);
          return {
            replaceOne: {
              filter: { _id },
              replacement: {
                _id,
                sourceTable: table,
                sourceKey: primaryKeys.length
                  ? Object.fromEntries(primaryKeys.map((key) => [key, clean[key]]))
                  : { rowid: rowIndex },
                data: clean,
              },
              upsert: true,
            },
          };
        });
        await collection.bulkWrite(operations, { ordered: true });
        imported += batch.length;
      }

      const verified = await collection.countDocuments({ sourceTable: table });
      if (verified < rows.length) {
        throw new Error('[bot-db-migration] Validação falhou em ' + table +
          ': SQLite=' + rows.length + ', MongoDB=' + verified +
          '. O marcador não será concluído; origem e backup foram preservados.');
      }
      report.collections[table] = { source: rows.length, imported: verified };
      report.records += rows.length;
    }

    await migrations.updateOne(
      { _id: MIGRATION_ID },
      { $set: { status: 'complete', completedAt: new Date(), report } },
      { upsert: true },
    );
    console.log('[bot-db-migration] Arquivo legado preservado no MongoDB:', report);
    return { skipped: false, report };
  } finally {
    sqlite.close();
  }
}

module.exports = { MIGRATION_ID, runBotDbMigration, sourcePath };
