'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');
const {
  FeatureUser, FeatureSeason, FeatureSeasonScore, FeaturePointHistory, FeatureBatepontoSession,
  FeatureRolePermission, FeaturePointRole, FeatureSeasonRanking, FeatureLog,
  FeatureSetting, FeatureMigration, FeatureCounter,
} = require('../../models');

const MIGRATION_ID = 'sqlite-pxk-features-v1';

function decode(value) {
  if (value === null || value === undefined) return value;
  try { return JSON.parse(value); } catch { return value; }
}

function tableExists(db, table) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

function readRows(db, table) {
  return tableExists(db, table) ? db.prepare('SELECT * FROM "' + table + '"').all() : [];
}

async function bulkUpsert(Model, docs) {
  for (let i = 0; i < docs.length; i += 300) {
    const batch = docs.slice(i, i + 300);
    if (!batch.length) continue;
    await Model.bulkWrite(batch.map((doc) => ({
      updateOne: {
        filter: { _id: doc._id },
        update: { $setOnInsert: doc },
        upsert: true,
      },
    })), { ordered: false });
  }
}

async function assertIds(Model, ids, label) {
  if (!ids.length) return;
  const count = await Model.countDocuments({ _id: { $in: ids } }).exec();
  if (count !== ids.length) {
    throw new Error(`Validação da migração falhou em ${label}: esperados ${ids.length} IDs de origem, encontrados ${count}. O marcador não será gravado e o SQLite continuará intacto.`);
  }
}

async function runSqliteMigration() {
  const marker = await FeatureMigration.findById(MIGRATION_ID).lean().exec();
  if (marker?.status === 'complete') {
    console.log('[migration] SQLite legado já foi importado para o MongoDB:', marker.completedAt);
    return { skipped: true, reason: 'already-complete', report: marker.report };
  }

  if (!fs.existsSync(config.dbPath)) {
    if (process.env.ALLOW_EMPTY_FEATURE_DB === 'true') {
      console.warn('[migration] SQLite não encontrado; ALLOW_EMPTY_FEATURE_DB=true autorizou iniciar sem importar dados legados.');
      return { skipped: true, reason: 'explicit-empty-install' };
    }
    throw new Error('[migration] SQLite legado não encontrado em ' + config.dbPath + '. Inicialização bloqueada para evitar subir um banco vazio e ocultar dados antigos. Monte o volume /app/data que contém pxk-features.sqlite; somente uma instalação realmente nova deve definir ALLOW_EMPTY_FEATURE_DB=true.');
  }

  const backupDir = path.resolve(config.rootDir, 'data', 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, 'pxk-pre-mongodb-migration-' + stamp + '.sqlite');
  const db = new Database(config.dbPath, { fileMustExist: true });

  try {
    await db.backup(backupPath);
    if (!fs.statSync(backupPath).size) throw new Error('O backup pré-migração do SQLite ficou vazio.');

    const expectedTables = [
      'users', 'seasons', 'season_scores', 'point_history', 'bateponto_sessions',
      'bateponto_messages', 'role_permissions', 'point_roles', 'season_rankings',
      'logs', 'settings',
    ];
    const missingTables = expectedTables.filter((table) => !tableExists(db, table));
    if (missingTables.length) {
      throw new Error('O SQLite não possui todas as tabelas esperadas (' + missingTables.join(', ') + '). Migração interrompida para não iniciar o bot com dados possivelmente incompletos. O arquivo original e o backup foram preservados.');
    }

    const users = readRows(db, 'users');
    const seasons = readRows(db, 'seasons');
    const scoreRows = readRows(db, 'season_scores');
    const historyRows = readRows(db, 'point_history');
    const sessionRows = readRows(db, 'bateponto_sessions');
    const messageRows = readRows(db, 'bateponto_messages');
    const permissionRows = readRows(db, 'role_permissions');
    const pointRoleRows = readRows(db, 'point_roles');
    const rankingRows = readRows(db, 'season_rankings');
    const logRows = readRows(db, 'logs');
    const settingRows = readRows(db, 'settings');

    const activeSeasons = seasons.filter((s) => s.status === 'active');
    if (activeSeasons.length > 1) {
      throw new Error('O SQLite contém mais de uma temporada ativa. O backup foi criado, mas a migração foi interrompida para não escolher ou descartar uma temporada automaticamente.');
    }

    const seasonNumbers = new Map(seasons.map((s) => [Number(s.id), Number(s.number)]));
    const historyByScore = new Map();
    for (const h of historyRows.sort((a, b) => Number(a.id) - Number(b.id))) {
      const key = String(h.season_id) + ':' + String(h.user_id);
      if (!historyByScore.has(key)) historyByScore.set(key, []);
      historyByScore.get(key).push({
        id: Number(h.id), key: 'sqlite:' + String(h.id),
        season_id: Number(h.season_id),
        season_number: seasonNumbers.get(Number(h.season_id)) || null,
        user_id: String(h.user_id), actor_id: h.actor_id || null,
        points_before: Number(h.points_before) || 0,
        delta: Number(h.delta) || 0, points_after: Number(h.points_after) || 0,
        type: h.type || 'sistema', reason: h.reason || null,
        created_at: Number(h.created_at) || 0,
      });
    }

    const scoreMap = new Map();
    for (const s of scoreRows) {
      const key = String(s.season_id) + ':' + String(s.user_id);
      scoreMap.set(key, {
        _id: key, season_id: Number(s.season_id), user_id: String(s.user_id),
        points: Number(s.points) || 0, total_added: Number(s.total_added) || 0,
        total_removed: Number(s.total_removed) || 0, changes: Number(s.changes) || 0,
        last_change_at: s.last_change_at == null ? null : Number(s.last_change_at),
        history: [],
        appliedKeys: (historyByScore.get(key) || []).slice(-512).map((h) => h.key),
      });
    }
    // Preserva históricos eventualmente sem sua projeção de saldo.
    for (const [key, history] of historyByScore) {
      if (scoreMap.has(key) || !history.length) continue;
      const last = history[history.length - 1];
      scoreMap.set(key, {
        _id: key, season_id: last.season_id, user_id: last.user_id,
        points: last.points_after,
        total_added: history.reduce((n, x) => n + Math.max(0, x.delta), 0),
        total_removed: history.reduce((n, x) => n + Math.max(0, -x.delta), 0),
        changes: history.length, last_change_at: last.created_at,
        history: [], appliedKeys: history.slice(-512).map((h) => h.key),
      });
    }

    const messagesBySession = new Map();
    for (const m of messageRows) {
      const sid = Number(m.session_id);
      if (!messagesBySession.has(sid)) messagesBySession.set(sid, []);
      messagesBySession.get(sid).push({
        id: Number(m.id), user_id: String(m.user_id),
        channel_id: String(m.channel_id), message_id: String(m.message_id),
        created_at: Number(m.created_at) || 0,
      });
    }

    const featureUsers = users.map((u) => ({
      _id: String(u.user_id), user_id: String(u.user_id), first_seen: Number(u.first_seen) || null,
    }));
    const featureSeasons = seasons.map((s) => ({
      ...s, _id: Number(s.id), id: Number(s.id), number: Number(s.number),
      started_at: Number(s.started_at) || 0,
      ended_at: s.ended_at == null ? null : Number(s.ended_at),
      stats: decode(s.stats),
    }));
    const sessions = sessionRows.map((s) => ({
      ...s, _id: Number(s.id), id: Number(s.id),
      messageRecords: messagesBySession.get(Number(s.id)) || [],
      messages: Number(s.messages) || 0,
      started_at: Number(s.started_at) || 0, ends_at: Number(s.ends_at) || 0,
      duration_ms: Number(s.duration_ms) || 0,
      ended_at: s.ended_at == null ? null : Number(s.ended_at),
      last_counted_at: s.last_counted_at == null ? null : Number(s.last_counted_at),
      goal_reached_at: s.goal_reached_at == null ? null : Number(s.goal_reached_at),
      // Sessões concluídas já tiveram o efeito no SQLite; nunca conceda o prêmio de novo.
      rewardApplied: s.status !== 'active',
    }));
    const permissions = permissionRows.map((r) => ({
      ...r, _id: [r.guild_id, r.role_id, r.permission].join(':'),
      guild_id: String(r.guild_id), role_id: String(r.role_id), permission: String(r.permission),
    }));
    const pointRoles = pointRoleRows.map((r) => ({
      ...r, _id: Number(r.points), points: Number(r.points),
      remove_previous: Number(r.remove_previous) || 0,
    }));
    const rankings = rankingRows.map((r) => ({
      ...r, _id: String(r.season_id) + ':' + String(r.position),
      season_id: Number(r.season_id), position: Number(r.position), points: Number(r.points),
    }));
    const logs = logRows.map((r) => ({
      ...r, _id: Number(r.id), id: Number(r.id),
      created_at: Number(r.created_at) || 0, details: decode(r.details),
    }));
    const settings = settingRows.map((r) => ({ _id: String(r.key), value: decode(r.value) }));
    const pointHistory = historyRows.map((h) => {
      const key = String(h.season_id) + ':' + String(h.user_id);
      const season = featureSeasons.find((s) => Number(s._id) === Number(h.season_id));
      return {
        _id: Number(h.id), id: Number(h.id), key: 'sqlite:' + String(h.id),
        season_id: Number(h.season_id), season_number: season?.number || null,
        user_id: String(h.user_id), actor_id: h.actor_id || null,
        points_before: Number(h.points_before) || 0,
        delta: Number(h.delta) || 0, points_after: Number(h.points_after) || 0,
        type: h.type || 'sistema', reason: h.reason || null,
        created_at: Number(h.created_at) || 0,
      };
    });

    // Upserts são idempotentes: repetir a migração não substitui dados já gravados no Mongo.
    await bulkUpsert(FeatureUser, featureUsers);
    await bulkUpsert(FeatureSeason, featureSeasons);
    await bulkUpsert(FeatureSeasonScore, [...scoreMap.values()]);
    await bulkUpsert(FeaturePointHistory, pointHistory);
    await bulkUpsert(FeatureBatepontoSession, sessions);
    await bulkUpsert(FeatureRolePermission, permissions);
    await bulkUpsert(FeaturePointRole, pointRoles);
    await bulkUpsert(FeatureSeasonRanking, rankings);
    await bulkUpsert(FeatureLog, logs);
    await bulkUpsert(FeatureSetting, settings);

    const counters = [
      ['feature_seasons', Math.max(0, ...seasons.map((x) => Number(x.id) || 0))],
      ['feature_sessions', Math.max(0, ...sessionRows.map((x) => Number(x.id) || 0))],
      ['feature_logs', Math.max(0, ...logRows.map((x) => Number(x.id) || 0))],
      ['feature_history', Math.max(0, ...historyRows.map((x) => Number(x.id) || 0))],
    ];
    await Promise.all(counters.map(([name, value]) =>
      FeatureCounter.updateOne({ _id: name }, { $max: { value } }, { upsert: true }).exec()
    ));

    const report = {
      source: config.dbPath, backup: backupPath,
      users: featureUsers.length, seasons: featureSeasons.length,
      seasonScores: scoreMap.size, pointHistory: pointHistory.length,
      batepontoSessions: sessions.length, batepontoMessages: messageRows.length,
      rolePermissions: permissions.length, pointRoles: pointRoles.length,
      seasonRankings: rankings.length, logs: logs.length, settings: settings.length,
    };

    await Promise.all([
      assertIds(FeatureUser, featureUsers.map((x) => x._id), 'users'),
      assertIds(FeatureSeason, featureSeasons.map((x) => x._id), 'seasons'),
      assertIds(FeatureSeasonScore, [...scoreMap.keys()], 'season_scores'),
      assertIds(FeaturePointHistory, pointHistory.map((x) => x._id), 'point_history'),
      assertIds(FeatureBatepontoSession, sessions.map((x) => x._id), 'bateponto_sessions'),
      assertIds(FeatureRolePermission, permissions.map((x) => x._id), 'role_permissions'),
      assertIds(FeaturePointRole, pointRoles.map((x) => x._id), 'point_roles'),
      assertIds(FeatureSeasonRanking, rankings.map((x) => x._id), 'season_rankings'),
      assertIds(FeatureLog, logs.map((x) => x._id), 'logs'),
      assertIds(FeatureSetting, settings.map((x) => x._id), 'settings'),
    ]);

    // Confere a quantidade de eventos do ledger e de mensagens contabilizadas.
    const [actualHistory, sessionDocs] = await Promise.all([
      FeaturePointHistory.countDocuments({ _id: { $in: pointHistory.map((h) => h._id) } }).exec(),
      FeatureBatepontoSession.find({ _id: { $in: sessions.map((s) => s._id) } }, { messageRecords: 1 }).lean().exec(),
    ]);
    const actualMessages = sessionDocs.reduce((n, x) => n + (x.messageRecords?.length || 0), 0);
    if (actualHistory < historyRows.length || actualMessages < messageRows.length) {
      throw new Error('A validação de histórico/mensagens encontrou menos registros no MongoDB que no SQLite. O marcador não será gravado; a origem e o backup foram preservados.');
    }

    await FeatureMigration.updateOne(
      { _id: MIGRATION_ID },
      { $set: { status: 'complete', completedAt: new Date(), report } },
      { upsert: true }
    ).exec();
    console.log('[migration] SQLite -> MongoDB concluído. Origem preservada; backup:', backupPath);
    return { skipped: false, report };
  } finally {
    db.close();
  }
}

module.exports = { MIGRATION_ID, runSqliteMigration };
