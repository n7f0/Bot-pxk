'use strict';

const db = require('../database');
const seasons = require('../seasons/service');

function getGlobalStats() {
  const season = seasons.requireCurrent();
  const s = seasons.computeStats(season.id, season.started_at);
  const bpAll = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END), 0) AS approved,
              COALESCE(SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END), 0) AS rejected,
              COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) AS active
       FROM bateponto_sessions WHERE status IN ('approved','rejected','active')`
    )
    .get();
  const totalUsers = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  return { season, season_stats: s, bateponto_all: bpAll, total_users: totalUsers };
}

module.exports = { getGlobalStats };
