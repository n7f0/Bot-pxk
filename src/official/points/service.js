'use strict';

const db = require('../database');
const config = require('../config');
const seasons = require('../seasons/service');

const WEEK = 7 * 24 * 60 * 60 * 1000;
const MAX = config.limits.maxPoints;

function ensureUser(userId) {
  db.prepare('INSERT OR IGNORE INTO users(user_id, first_seen) VALUES (?, ?)').run(userId, Date.now());
}

function getScore(userId, seasonId) {
  const sid = seasonId ?? seasons.requireCurrent().id;
  return (
    db.prepare('SELECT * FROM season_scores WHERE season_id = ? AND user_id = ?').get(sid, userId) || {
      season_id: sid,
      user_id: userId,
      points: 0,
      total_added: 0,
      total_removed: 0,
      changes: 0,
      last_change_at: null,
    }
  );
}

/**
 * Aplica uma alteração de pontos de forma atômica e grava o histórico.
 * mode: 'add' | 'remove' | 'set'. A pontuação nunca fica negativa.
 * Pode ser chamada dentro de outra transação (ex.: aprovação de bate-ponto).
 */
const applyChange = db.transaction((o) => {
  if (!['add', 'remove', 'set'].includes(o.mode)) throw new Error('Modo de alteração inválido.');
  if (!Number.isInteger(o.amount) || o.amount < (o.mode === 'set' ? 0 : 1) || o.amount > MAX) {
    throw new Error(`Valor inválido (permitido: ${o.mode === 'set' ? 0 : 1} a ${MAX}).`);
  }
  const season = o.seasonId ? seasons.getById(o.seasonId) : seasons.requireCurrent();
  ensureUser(o.userId);
  db.prepare('INSERT OR IGNORE INTO season_scores(season_id, user_id) VALUES (?, ?)').run(season.id, o.userId);
  const row = db.prepare('SELECT points FROM season_scores WHERE season_id = ? AND user_id = ?').get(season.id, o.userId);

  const before = row.points;
  let after;
  if (o.mode === 'add') after = before + o.amount;
  else if (o.mode === 'remove') after = before - o.amount;
  else after = o.amount;
  after = Math.min(MAX, Math.max(0, after));

  const delta = after - before;
  const now = Date.now();
  db.prepare(
    `UPDATE season_scores
     SET points = ?, total_added = total_added + ?, total_removed = total_removed + ?,
         changes = changes + 1, last_change_at = ?
     WHERE season_id = ? AND user_id = ?`
  ).run(after, delta > 0 ? delta : 0, delta < 0 ? -delta : 0, now, season.id, o.userId);

  const info = db
    .prepare(
      `INSERT INTO point_history(season_id, user_id, actor_id, points_before, delta, points_after, type, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(season.id, o.userId, o.actorId || null, before, delta, after, o.type || 'sistema', o.reason || null, now);

  return {
    id: Number(info.lastInsertRowid),
    seasonId: season.id,
    seasonNumber: season.number,
    userId: o.userId,
    actorId: o.actorId || null,
    before,
    delta,
    after,
    type: o.type || 'sistema',
    reason: o.reason || null,
    createdAt: now,
  };
});

function countHistory(userId, seasonId = null) {
  if (seasonId) return db.prepare('SELECT COUNT(*) c FROM point_history WHERE user_id = ? AND season_id = ?').get(userId, seasonId).c;
  return db.prepare('SELECT COUNT(*) c FROM point_history WHERE user_id = ?').get(userId).c;
}

function getHistory(userId, { limit = 5, offset = 0 } = {}) {
  return db
    .prepare(
      `SELECT h.*, s.number AS season_number FROM point_history h
       JOIN seasons s ON s.id = h.season_id
       WHERE h.user_id = ? ORDER BY h.id DESC LIMIT ? OFFSET ?`
    )
    .all(userId, limit, offset);
}

/** Evolução acumulada por "semana" da temporada (semana 1 = primeiros 7 dias). */
function getWeeklyEvolution(userId, season, maxWeeks = 4) {
  const rows = db
    .prepare('SELECT created_at, points_after FROM point_history WHERE user_id = ? AND season_id = ? ORDER BY id ASC')
    .all(userId, season.id);
  if (!rows.length) return [];
  const end = season.ended_at || Date.now();
  const lastBucket = Math.max(0, Math.floor((end - season.started_at) / WEEK));
  const byBucket = new Map();
  for (const r of rows) {
    byBucket.set(Math.max(0, Math.floor((r.created_at - season.started_at) / WEEK)), r.points_after);
  }
  const out = [];
  let carry = 0;
  for (let b = 0; b <= lastBucket; b++) {
    if (byBucket.has(b)) carry = byBucket.get(b);
    out.push({ week: b + 1, points: carry });
  }
  return out.slice(-maxWeeks);
}

function getRecentDelta(userId, seasonId, sinceMs = WEEK) {
  return db
    .prepare('SELECT COALESCE(SUM(delta), 0) AS d FROM point_history WHERE user_id = ? AND season_id = ? AND created_at >= ?')
    .get(userId, seasonId, Date.now() - sinceMs).d;
}

module.exports = { MAX, ensureUser, getScore, applyChange, countHistory, getHistory, getWeeklyEvolution, getRecentDelta };
