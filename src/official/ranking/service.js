'use strict';

const db = require('../database');
const settings = require('../database/settings');

const ORDER = 'points DESC, COALESCE(last_change_at, 0) ASC, user_id ASC';

const RANK_MAX_LIMIT = 500;

/** Máximo de membros exibidos no ranking (padrão 100, até 500). */
function maxMembers() {
  return Math.max(1, Math.min(RANK_MAX_LIMIT, Number(settings.get('rank_max')) || 100));
}

function countRanked(seasonId) {
  const c = db.prepare('SELECT COUNT(*) AS c FROM season_scores WHERE season_id = ? AND points > 0').get(seasonId).c;
  return Math.min(c, maxMembers());
}

function getPage(seasonId, page, perPage) {
  const offset = (page - 1) * perPage;
  const limit = Math.max(0, Math.min(perPage, maxMembers() - offset));
  const rows = db
    .prepare(`SELECT user_id, points FROM season_scores WHERE season_id = ? AND points > 0 ORDER BY ${ORDER} LIMIT ? OFFSET ?`)
    .all(seasonId, limit, offset);
  return rows.map((r, i) => ({ ...r, position: offset + i + 1 }));
}

/** Posição (1-based) do usuário no ranking da temporada, ou null se não pontuou. */
function getPosition(seasonId, userId) {
  const row = db.prepare('SELECT points, last_change_at FROM season_scores WHERE season_id = ? AND user_id = ?').get(seasonId, userId);
  if (!row || row.points <= 0) return null;
  const l = row.last_change_at || 0;
  const ahead = db
    .prepare(
      `SELECT COUNT(*) AS c FROM season_scores
       WHERE season_id = ? AND points > 0
         AND (points > ? OR (points = ? AND (COALESCE(last_change_at, 0) < ? OR (COALESCE(last_change_at, 0) = ? AND user_id < ?))))`
    )
    .get(seasonId, row.points, row.points, l, l, userId).c;
  return ahead + 1;
}

/** Total de mensagens contadas em bate-pontos (e nº de bate-pontos aprovados) por usuário, na temporada. */
function getMessageTotals(userIds, season) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const marks = ids.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT user_id, COALESCE(SUM(messages), 0) AS messages,
              COALESCE(SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END), 0) AS approved
       FROM bateponto_sessions
       WHERE user_id IN (${marks}) AND status != 'cancelled' AND started_at >= ? AND started_at <= ?
       GROUP BY user_id`
    )
    .all(...ids, season.started_at, season.ended_at || Date.now());
  return new Map(rows.map((r) => [r.user_id, r]));
}

const pageOfPosition = (position, perPage) => Math.max(1, Math.ceil(position / perPage));

module.exports = { RANK_MAX_LIMIT, maxMembers, getMessageTotals, countRanked, getPage, getPosition, pageOfPosition };
