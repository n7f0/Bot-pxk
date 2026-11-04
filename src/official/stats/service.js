'use strict';

const seasons = require('../seasons/service');
const { state } = require('../database/store');

function getGlobalStats() {
  const season = seasons.requireCurrent();
  const s = seasons.computeStats(season._id, season.started_at);
  const all = [...state.sessions.values()].filter((x) => ['approved', 'rejected', 'active'].includes(x.status));
  const bpAll = {
    total: all.length,
    approved: all.filter((x) => x.status === 'approved').length,
    rejected: all.filter((x) => x.status === 'rejected').length,
    active: all.filter((x) => x.status === 'active').length,
  };
  return { season, season_stats: s, bateponto_all: bpAll, total_users: state.users.size };
}

module.exports = { getGlobalStats };
