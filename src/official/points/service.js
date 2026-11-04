'use strict';

const crypto = require('crypto');
const { FeatureUser, FeatureSeasonScore, FeaturePointHistory } = require('../../models');
const { state, scoreId, nextId } = require('../database/store');
const seasons = require('../seasons/service');
const config = require('../config');

const WEEK = 7 * 24 * 60 * 60 * 1000;
const MAX = config.limits.maxPoints;
const locks = new Map();

async function withScoreLock(key, callback) {
  const previous = locks.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  locks.set(key, current);
  await previous.catch(() => {});
  try {
    return await callback();
  } finally {
    release();
    if (locks.get(key) === current) locks.delete(key);
  }
}

async function ensureUser(userId) {
  const id = String(userId);
  if (!state.users.has(id)) {
    const doc = { _id: id, user_id: id, first_seen: Date.now() };
    await FeatureUser.updateOne({ _id: id }, { $setOnInsert: doc }, { upsert: true }).exec();
    state.users.set(id, doc);
  }
}

function getScore(userId, seasonId) {
  const sid = seasonId ?? seasons.requireCurrent()._id;
  return state.scores.get(scoreId(sid, userId)) || {
    _id: scoreId(sid, userId), season_id: Number(sid), user_id: String(userId),
    points: 0, total_added: 0, total_removed: 0, changes: 0, last_change_at: null,
    appliedKeys: [], lastEvent: null,
  };
}

function normalizeHistory(h) {
  return {
    id: h.id, key: h.key,
    seasonId: h.season_id, seasonNumber: h.season_number,
    userId: h.user_id, actorId: h.actor_id || null,
    before: Number(h.points_before) || 0, delta: Number(h.delta) || 0,
    after: Number(h.points_after) || 0, type: h.type || 'sistema',
    reason: h.reason || null, createdAt: Number(h.created_at) || 0,
  };
}

function historyDocument(event) {
  return {
    _id: Number(event.id), id: Number(event.id), key: String(event.key),
    season_id: Number(event.season_id), season_number: Number(event.season_number),
    user_id: String(event.user_id), actor_id: event.actor_id || null,
    points_before: Number(event.points_before) || 0,
    delta: Number(event.delta) || 0, points_after: Number(event.points_after) || 0,
    type: event.type || 'sistema', reason: event.reason || null,
    created_at: Number(event.created_at) || 0,
  };
}

async function persistPendingHistory(score) {
  const event = score?.lastEvent;
  if (!event?.key || state.pointHistoryByKey.has(String(event.key))) return;
  const doc = historyDocument(event);
  await FeaturePointHistory.updateOne(
    { _id: doc._id },
    { $setOnInsert: doc },
    { upsert: true }
  ).exec();
  state.pointHistory.set(doc._id, doc);
  state.pointHistoryByKey.set(doc.key, doc);
}

async function recoverPendingHistory() {
  let recovered = 0;
  for (const score of state.scores.values()) {
    const event = score.lastEvent;
    if (event?.key && !state.pointHistoryByKey.has(String(event.key))) {
      await persistPendingHistory(score);
      recovered++;
    }
  }
  return recovered;
}

/**
 * Mantém o saldo e a última alteração pendente em um único documento atômico.
 * O ledger completo fica em documentos independentes, evitando o limite de 16 MB
 * do MongoDB para usuários com muitos lançamentos. A última alteração é recuperada
 * no próximo start caso o processo caia entre o update de saldo e o insert do ledger.
 */
async function applyChange(o) {
  if (!['add', 'remove', 'set'].includes(o.mode)) throw new Error('Modo de alteração inválido.');
  if (!Number.isInteger(o.amount) || o.amount < (o.mode === 'set' ? 0 : 1) || o.amount > MAX) {
    throw new Error(`Valor inválido (permitido: ${o.mode === 'set' ? 0 : 1} a ${MAX}).`);
  }
  const season = o.seasonId ? seasons.getById(o.seasonId) : seasons.requireCurrent();
  if (!season) throw new Error('Temporada informada não encontrada.');
  const userId = String(o.userId);
  await ensureUser(userId);

  const sid = Number(season._id);
  const id = scoreId(sid, userId);
  return withScoreLock(id, async () => {
    const cached = state.scores.get(id);
    await persistPendingHistory(cached);

    const key = String(o.idempotencyKey || crypto.randomUUID());
    const duplicate = state.pointHistoryByKey.get(key) ||
      await FeaturePointHistory.findOne({ key }).lean().exec();
    if (duplicate) {
      const doc = historyDocument(duplicate);
      state.pointHistory.set(doc._id, doc);
      state.pointHistoryByKey.set(doc.key, doc);
      return normalizeHistory(doc);
    }

    const eventId = await nextId('feature_history');
    const now = Date.now();
    const type = o.type || 'sistema';
    const reason = o.reason || null;
    const actorId = o.actorId ? String(o.actorId) : null;
    const afterExpr = o.mode === 'add'
      ? { $add: [{ $ifNull: ['$points', 0] }, o.amount] }
      : o.mode === 'remove'
        ? { $subtract: [{ $ifNull: ['$points', 0] }, o.amount] }
        : { $literal: o.amount };

    const pipeline = [
      { $set: {
        __before: { $ifNull: ['$points', 0] },
        __after: { $max: [0, { $min: [MAX, afterExpr] }] },
      } },
      { $set: {
        user_id: { $literal: userId },
        season_id: { $literal: sid },
        points: '$__after',
        total_added: { $add: [{ $ifNull: ['$total_added', 0] }, { $max: [0, { $subtract: ['$__after', '$__before'] }] }] },
        total_removed: { $add: [{ $ifNull: ['$total_removed', 0] }, { $max: [0, { $subtract: ['$__before', '$__after'] }] }] },
        changes: { $add: [{ $ifNull: ['$changes', 0] }, 1] },
        last_change_at: { $literal: now },
        lastEvent: {
          id: { $literal: eventId }, key: { $literal: key },
          season_id: { $literal: sid }, season_number: { $literal: Number(season.number) },
          user_id: { $literal: userId }, actor_id: { $literal: actorId },
          points_before: '$__before',
          delta: { $subtract: ['$__after', '$__before'] },
          points_after: '$__after',
          type: { $literal: type }, reason: { $literal: reason },
          created_at: { $literal: now },
        },
      } },
      { $unset: ['__before', '__after'] },
    ];

    let updated;
    try {
      updated = await FeatureSeasonScore.findOneAndUpdate(
        { _id: id },
        pipeline,
        { new: true, upsert: true, lean: true }
      ).exec();
    } catch (error) {
      if (error.code !== 11000) throw error;
      // Outro request pode ter criado o score no intervalo entre leitura e upsert.
      updated = await FeatureSeasonScore.findOneAndUpdate(
        { _id: id }, pipeline, { new: true, upsert: false, lean: true }
      ).exec();
      if (!updated) throw error;
    }
    if (!updated?.lastEvent || updated.lastEvent.key !== key) {
      const already = await FeaturePointHistory.findOne({ key }).lean().exec();
      if (already) return normalizeHistory(already);
      throw new Error('Não foi possível confirmar o lançamento de pontos. Não tente repetir manualmente; consulte o histórico antes.');
    }
    state.scores.set(id, updated);
    await persistPendingHistory(updated);
    return normalizeHistory(updated.lastEvent);
  });
}

function countHistory(userId, seasonId = null) {
  let total = 0;
  for (const h of state.pointHistory.values()) {
    if (String(h.user_id) !== String(userId)) continue;
    if (seasonId != null && Number(h.season_id) !== Number(seasonId)) continue;
    total++;
  }
  return total;
}

function getHistory(userId, { limit = 5, offset = 0 } = {}) {
  return [...state.pointHistory.values()]
    .filter((h) => String(h.user_id) === String(userId))
    .sort((a, b) => Number(b.created_at) - Number(a.created_at) || Number(b.id) - Number(a.id))
    .slice(offset, offset + limit)
    .map((h) => ({
      id: h.id, season_id: h.season_id, season_number: h.season_number,
      user_id: h.user_id, actor_id: h.actor_id, points_before: h.points_before,
      delta: h.delta, points_after: h.points_after, type: h.type,
      reason: h.reason, created_at: h.created_at,
    }));
}

function getWeeklyEvolution(userId, season, maxWeeks = 4) {
  const sid = Number(season._id ?? season.id);
  const rows = [...state.pointHistory.values()]
    .filter((h) => String(h.user_id) === String(userId) && Number(h.season_id) === sid)
    .sort((a, b) => Number(a.created_at) - Number(b.created_at) || Number(a.id) - Number(b.id));
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
  const since = Date.now() - sinceMs;
  return [...state.pointHistory.values()].reduce((sum, h) =>
    sum + (String(h.user_id) === String(userId) &&
      Number(h.season_id) === Number(seasonId) &&
      Number(h.created_at) >= since ? Number(h.delta) || 0 : 0), 0);
}

module.exports = {
  MAX, ensureUser, getScore, applyChange, countHistory, getHistory,
  getWeeklyEvolution, getRecentDelta, recoverPendingHistory,
};
