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

function stableKey(table, row, rowIndex, primaryKeys) {
  const identity = primaryKeys.length
    ? primaryKeys.map((key) => [key, row[key]])
    : ['rowid', rowIndex];
  return table + ':' + crypto.createHash('sha256')
    .update(JSON.stringify(identity))
    .digest('hex');
}

async function createBackup(sqlite, source) {
  const backupDir = path.resolve(path.dirname(source), 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, 'bot-db-pre-mongodb-migration-' + stamp + '.sqlite');
  await sqlite.backup(backupPath);
  if (!fs.existsSync(backupPath) || fs.statSync(backupPath).size === 0) {
    throw new Error('[bot-db-migration] Backup pré-migração vazio.');
  }
  return backupPath;
}

async function runBotDbMigration() {
  const source = sourcePath();
  if (!fs.existsSync(source)) return { skipped: true, reason: 'bot-db-not-found', source };

  const database = mongoose.connection.db;
  if (!database) throw new Error('[bot-db-migration] MongoDB não está conectado.');
  const migrations = database.collection('legacy_bot_migrations');
  const records = database.collection('legacy_bot_records');
  const marker = await migrations.findOne({ _id: MIGRATION_ID });
  if (marker?.status === 'complete') {
    if (Number(marker.report?.records) > 0) {
      throw new Error('[bot-db-migration] Os dados antigos de bot.db estão preservados no MongoDB, mas ainda não existe um mapeamento funcional validado para todos os módulos legados. Inicialização bloqueada para evitar perda aparente de níveis, tickets, sugestões, votos, logs e horas de staff. Não apague os bancos originais.');
    }
    return { skipped: true, reason: 'already-complete', report: marker.report };
  }

  const sqlite = new Database(source, { readonly: true, fileMustExist: true });
  try {
    const integrity = sqlite.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') {
      throw new Error('[bot-db-migration] integrity_check falhou: ' + integrity);
    }

    // A API de backup do SQLite incorpora transações confirmadas que ainda estejam no WAL.
    // A origem, o WAL e o SHM permanecem intactos.
    const backup = await createBackup(sqlite, source);
    const tables = sqlite.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).all().map((row) => row.name);

    const report = { source, backup, tables: tables.length, records: 0, collections: {} };
    for (const table of tables) {
      const safeTable = quoteIdentifier(table);
      const columns = sqlite.prepare('PRAGMA table_info(' + safeTable + ')').all();
      const primaryKeys = columns
        .filter((column) => Number(column.pk) > 0)
        .sort((a, b) => Number(a.pk) - Number(b.pk))
        .map((column) => column.name);
      const rows = sqlite.prepare(primaryKeys.length
        ? 'SELECT * FROM ' + safeTable
        : 'SELECT rowid AS __pxk_migration_rowid, * FROM ' + safeTable).all();
      let imported = 0;

      for (let offset = 0; offset < rows.length; offset += 250) {
        const batch = rows.slice(offset, offset + 250);
        const ids = [];
        const operations = batch.map((row, batchIndex) => {
          const clean = { ...row };
          const rowIndex = Number(clean.__pxk_migration_rowid ?? (offset + batchIndex));
          delete clean.__pxk_migration_rowid;
          const _id = stableKey(table, clean, rowIndex, primaryKeys);
          ids.push(_id);
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
        if (!operations.length) continue;
        await records.bulkWrite(operations, { ordered: true });
        const verified = await records.countDocuments({
          _id: { $in: ids },
          sourceTable: table,
        });
        if (verified !== batch.length) {
          throw new Error('[bot-db-migration] Lote não validado em ' + table +
            ': esperado=' + batch.length + ', encontrado=' + verified +
            '. O marcador não será concluído; origem e backup foram preservados.');
        }
        imported += batch.length;
      }

      if (imported !== rows.length) {
        throw new Error('[bot-db-migration] Contagem divergente em ' + table +
          ': SQLite=' + rows.length + ', MongoDB=' + imported);
      }
      report.collections[table] = { source: rows.length, imported };
      report.records += rows.length;
    }

    await migrations.updateOne(
      { _id: MIGRATION_ID },
      { $set: { status: 'complete', completedAt: new Date(), report } },
      { upsert: true },
    );
    console.log('[bot-db-migration] Banco legado preservado no MongoDB:', report);
    if (report.records > 0) {
      throw new Error('[bot-db-migration] Os registros antigos foram arquivados e validados no MongoDB, mas ainda não há mapeamento funcional validado para todos os módulos legados. Inicialização bloqueada para evitar que o bot opere como se os dados antigos não existissem.');
    }
    return { skipped: false, report };
  } finally {
    sqlite.close();
  }
}

module.exports = { MIGRATION_ID, runBotDbMigration, sourcePath };
