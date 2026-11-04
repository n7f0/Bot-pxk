'use strict';

const { FeatureSeason, FeatureSeasonScore, FeatureSeasonRanking } = require('../../models');
const { state, nextId } = require('../database/store');

function getCurrent() {
  return [...state.seasons.values()].filter((s) => s.status === 'active').sort((a, b) => Number(b.number) - Number(a.number))[0] || null;
}

function getById(id) {
  return state.seasons.get(Number(id)) || null;
}

async function createSeason(startedAt = Date.now()) {
  const current = getCurrent();
  if (current) return current;
  const all = [...state.seasons.values()];
  const number = all.reduce((n, s) => Math.max(n, Number(s.number) || 0), 0) + 1;
  const id = await nextId('feature_seasons');
  const doc = { _id: id, id, number, name: 'Temporada ' + number, status: 'active', started_at: startedAt, ended_at: null, stats: null };
  try {
    await FeatureSeason.create(doc);
    state.seasons.set(id, doc);
    return doc;
  } catch (error) {
    if (error.code === 11000) return getCurrent();
    throw error;
  }
}

async function ensureCurrent() {
  return getCurrent() || createSeason();
}

function requireCurrent() {
  const season = getCurrent();
  if (!season) throw new Error('Nenhuma temporada carregada. A inicialização do banco precisa concluir antes de iniciar o bot.');
  return season;
}

function list(limit = 25) {
  return [...state.seasons.values()].sort((a, b) => Number(b.number) - Number(a.number)).slice(0, Math.max(1, limit));
}

function computeStats(seasonId, from, to = Date.now()) {
  const scores = [...state.scores.values()].filter((s) => Number(s.season_id) === Number(seasonId));
  const rankedScores = scores.filter((s) => Number(s.points) > 0);
  const sessions = [...state.sessions.values()].filter((s) =>
    ['approved', 'rejected'].includes(s.status) &&
    Number(s.started_at) >= Number(from || 0) &&
    Number(s.started_at) <= Number(to)
  );
  const totalAdded = scores.reduce((n, s) => n + (Number(s.total_added) || 0), 0);
  const totalRemoved = scores.reduce((n, s) => n + (Number(s.total_removed) || 0), 0);
  const changes = scores.reduce((n, s) => n + (Number(s.changes) || 0), 0);
  const totalPoints = scores.reduce((n, s) => n + (Number(s.points) || 0), 0);
  return {
    users: scores.length, ranked: rankedScores.length,
    max_points: rankedScores.reduce((n, s) => Math.max(n, Number(s.points) || 0), 0),
    total_points: totalPoints,
    avg_points: rankedScores.length ? Math.round(totalPoints / rankedScores.length) : 0,
    total_added: totalAdded, total_removed: totalRemoved, changes,
    bateponto_total: sessions.length,
    bateponto_approved: sessions.filter((s) => s.status === 'approved').length,
    bateponto_rejected: sessions.filter((s) => s.status === 'rejected').length,
  };
}

/**
 * Fecha a temporada sem depender de transações de replica set. O snapshot do ranking
 * é gravado por upsert antes de marcar a temporada como encerrada. Cada etapa é
 * idempotente, então uma reinicialização pode completar a operação sem duplicar dados.
 */
async function closeAndStartNew({ actorId = null, reason = 'Reset manual' } = {}) {
  const current = requireCurrent();
  const now = Date.now();
  const rows = [...state.scores.values()]
    .filter((s) => Number(s.season_id) === Number(current._id) && Number(s.points) > 0)
    .sort((a, b) =>
      Number(b.points) - Number(a.points) ||
      (Number(a.last_change_at) || 0) - (Number(b.last_change_at) || 0) ||
      String(a.user_id).localeCompare(String(b.user_id))
    );
  const rankDocs = rows.map((r, i) => ({
    _id: String(current._id) + ':' + String(i + 1),
    season_id: Number(current._id), position: i + 1,
    user_id: r.user_id, points: Number(r.points),
  }));
  if (rankDocs.length) {
    await FeatureSeasonRanking.bulkWrite(rankDocs.map((doc) => ({
      updateOne: { filter: { _id: doc._id }, update: { $set: doc }, upsert: true },
    })), { ordered: false });
  }
  const stats = computeStats(current._id, current.started_at, now);
  stats.winner = rows[0] ? { user_id: rows[0].user_id, points: Number(rows[0].points) } : null;
  const closed = {
    ...current, status: 'closed', ended_at: now, closed_by: actorId,
    close_reason: reason, stats,
  };
  await FeatureSeason.updateOne(
    { _id: current._id, status: 'active' },
    { $set: { status: 'closed', ended_at: now, closed_by: actorId, close_reason: reason, stats } }
  ).exec();
  state.seasons.set(Number(current._id), closed);
  const created = await createSeason(now);
  return { closed, created, stats, userIds: rows.map((r) => r.user_id) };
}

function parseStats(season) {
  if (!season?.stats) return null;
  if (typeof season.stats === 'object') return season.stats;
  try { return JSON.parse(season.stats); } catch { return null; }
}

module.exports = {
  getCurrent, getById, createSeason, ensureCurrent, requireCurrent,
  list, computeStats, closeAndStartNew, parseStats,
};
