'use strict';

const db = require('../database');

function getCurrent() {
  return db.prepare("SELECT * FROM seasons WHERE status = 'active' ORDER BY id DESC LIMIT 1").get();
}

function getById(id) {
  return db.prepare('SELECT * FROM seasons WHERE id = ?').get(id);
}

function createSeason(startedAt = Date.now()) {
  const last = db.prepare('SELECT COALESCE(MAX(number), 0) AS n FROM seasons').get().n;
  const info = db.prepare("INSERT INTO seasons(number, status, started_at) VALUES (?, 'active', ?)").run(last + 1, startedAt);
  return getById(info.lastInsertRowid);
}

/** Garante que exista uma temporada ativa (cria a #01 na primeira execução). */
function requireCurrent() {
  return getCurrent() || createSeason();
}

function list(limit = 25) {
  return db.prepare('SELECT * FROM seasons ORDER BY number DESC LIMIT ?').all(limit);
}

/** Estatísticas de uma temporada (usadas no arquivamento e no /estatisticas). */
function computeStats(seasonId, from, to = Date.now()) {
  const scores = db
    .prepare(
      `SELECT COUNT(*) AS users,
              COALESCE(SUM(CASE WHEN points > 0 THEN 1 ELSE 0 END), 0) AS ranked,
              COALESCE(MAX(points), 0) AS max_points,
              COALESCE(SUM(points), 0) AS total_points,
              COALESCE(SUM(total_added), 0) AS total_added,
              COALESCE(SUM(total_removed), 0) AS total_removed,
              COALESCE(SUM(changes), 0) AS changes
       FROM season_scores WHERE season_id = ?`
    )
    .get(seasonId);
  const bp = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END), 0) AS approved,
              COALESCE(SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END), 0) AS rejected
       FROM bateponto_sessions
       WHERE status IN ('approved','rejected') AND started_at BETWEEN ? AND ?`
    )
    .get(from, to);
  return {
    users: scores.users,
    ranked: scores.ranked,
    max_points: scores.max_points,
    total_points: scores.total_points,
    avg_points: scores.ranked ? Math.round(scores.total_points / scores.ranked) : 0,
    total_added: scores.total_added,
    total_removed: scores.total_removed,
    changes: scores.changes,
    bateponto_total: bp.total,
    bateponto_approved: bp.approved,
    bateponto_rejected: bp.rejected,
  };
}

/**
 * Encerra a temporada atual (salvando ranking final + estatísticas) e cria a próxima.
 * Os dados antigos NUNCA são apagados. Executa em uma única transação.
 */
const closeAndStartNew = db.transaction(({ actorId = null, reason = 'Reset manual' } = {}) => {
  const current = requireCurrent();
  const now = Date.now();

  const rows = db
    .prepare(
      `SELECT user_id, points FROM season_scores
       WHERE season_id = ? AND points > 0
       ORDER BY points DESC, COALESCE(last_change_at, 0) ASC, user_id ASC`
    )
    .all(current.id);
  const ins = db.prepare('INSERT INTO season_rankings(season_id, position, user_id, points) VALUES (?, ?, ?, ?)');
  rows.forEach((r, i) => ins.run(current.id, i + 1, r.user_id, r.points));

  const stats = computeStats(current.id, current.started_at, now);
  stats.winner = rows[0] ? { user_id: rows[0].user_id, points: rows[0].points } : null;

  db.prepare(
    "UPDATE seasons SET status = 'closed', ended_at = ?, closed_by = ?, close_reason = ?, stats = ? WHERE id = ?"
  ).run(now, actorId, reason, JSON.stringify(stats), current.id);

  const created = createSeason(now);
  return {
    closed: { ...current, status: 'closed', ended_at: now, stats },
    created,
    stats,
    userIds: rows.map((r) => r.user_id),
  };
});

function parseStats(season) {
  if (!season?.stats) return null;
  try {
    return JSON.parse(season.stats);
  } catch {
    return null;
  }
}

module.exports = { getCurrent, getById, createSeason, requireCurrent, list, computeStats, closeAndStartNew, parseStats };
