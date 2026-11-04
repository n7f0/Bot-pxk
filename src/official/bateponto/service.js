'use strict';

const { FeatureBatepontoSession } = require('../../models');
const { state, nextId } = require('../database/store');
const settings = require('../database/settings');
const pointsService = require('../points/service');

function getConfig() {
  return {
    enabled: Boolean(settings.get('bp_enabled')),
    area: settings.get('bp_area'),
    durationMin: Number(settings.get('bp_duration_min')),
    goal: Number(settings.get('bp_goal')),
    channelId: settings.get('bp_channel_id'),
    reward: Number(settings.get('bp_reward')),
    cooldownSec: Number(settings.get('bp_cooldown_sec')),
  };
}

const getById = (id) => state.sessions.get(Number(id)) || null;
const getActiveByUser = (userId) => [...state.sessions.values()].find((s) => s.status === 'active' && String(s.user_id) === String(userId)) || null;
const getLastByUser = (userId) => [...state.sessions.values()]
  .filter((s) => String(s.user_id) === String(userId) && s.status !== 'active')
  .sort((a, b) => Number(b._id) - Number(a._id))[0] || null;
const listActive = () => [...state.sessions.values()].filter((s) => s.status === 'active').sort((a, b) => Number(a.started_at) - Number(b.started_at));
const listRecent = (limit = 10) => [...state.sessions.values()].filter((s) => s.status !== 'active').sort((a, b) => Number(b._id) - Number(a._id)).slice(0, limit);
const listDue = (now = Date.now()) => [...state.sessions.values()].filter((s) => s.status === 'active' && Number(s.ends_at) <= now);

async function start({ userId, guildId, roleName }) {
  const cfg = getConfig();
  if (!cfg.enabled) return { error: 'O bate-ponto está **desativado** no momento.' };
  if (!cfg.channelId) return { error: 'O bate-ponto ainda não foi configurado (canal de contagem ausente). Avise a administração.' };
  if (!(cfg.durationMin > 0) || !(cfg.goal >= 0)) return { error: 'Configuração de bate-ponto inválida. Avise a administração.' };

  const now = Date.now();
  const duration = cfg.durationMin * 60000;
  await pointsService.ensureUser(userId);
  const existing = getActiveByUser(userId);
  if (existing) return { error: 'Você já possui um bate-ponto **ativo**.', existing };

  const id = await nextId('feature_sessions');
  const doc = {
    _id: id, id, user_id: String(userId), guild_id: String(guildId),
    area: cfg.area, role_name: roleName || null, status: 'active',
    started_at: now, ends_at: now + duration, duration_ms: duration,
    goal: cfg.goal, reward: cfg.reward, channel_id: String(cfg.channelId),
    messages: 0, messageRecords: [], last_counted_at: null,
    goal_reached_at: null, points_awarded: 0, rewardApplied: false,
    result_note: null, ended_at: null,
  };
  try {
    await FeatureBatepontoSession.create(doc);
    state.sessions.set(id, doc);
    return { session: doc };
  } catch (error) {
    if (error.code === 11000) return { error: 'Você já possui um bate-ponto **ativo**.', existing: getActiveByUser(userId) };
    throw error;
  }
}

async function countMessage({ userId, channelId, messageId, at = Date.now(), hasContent = true }) {
  if (!hasContent) return { counted: false };
  const session = getActiveByUser(userId);
  if (!session || String(session.channel_id) !== String(channelId)) return { counted: false };
  if (at >= Number(session.ends_at) || at < Number(session.started_at)) return { counted: false };
  const cooldown = Number(settings.get('bp_cooldown_sec')) * 1000;
  if (session.last_counted_at && at - session.last_counted_at < cooldown && at >= session.last_counted_at) return { counted: false, session };
  if ((session.messageRecords || []).some((m) => String(m.message_id) === String(messageId))) return { counted: false, session };

  const record = {
    id: 'msg:' + String(messageId), user_id: String(userId),
    channel_id: String(channelId), message_id: String(messageId), created_at: Number(at),
  };
  const filter = {
    _id: Number(session._id), status: 'active',
    channel_id: String(channelId), ends_at: { $gt: Number(at) }, started_at: { $lte: Number(at) },
    'messageRecords.message_id': { $ne: String(messageId) },
  };
  if (cooldown > 0) {
    filter.$or = [
      { last_counted_at: { $exists: false } },
      { last_counted_at: null },
      { last_counted_at: { $lte: Number(at) - cooldown } },
    ];
  }
  const updated = await FeatureBatepontoSession.findOneAndUpdate(
    filter,
    [
      { $set: { __nextMessages: { $add: [{ $ifNull: ['$messages', 0] }, 1] } } },
      { $set: {
        messages: '$__nextMessages',
        last_counted_at: { $max: [Number(at), { $ifNull: ['$last_counted_at', 0] }] },
        goal_reached_at: {
          $cond: [
            { $and: [{ $eq: [{ $ifNull: ['$goal_reached_at', null] }, null] }, { $gte: ['$__nextMessages', '$goal'] }] },
            Number(at), '$goal_reached_at',
          ],
        },
        messageRecords: { $concatArrays: [{ $ifNull: ['$messageRecords', []] }, [{ $literal: record }]] },
      } },
      { $unset: '__nextMessages' },
    ],
    { new: true, lean: true }
  ).exec();
  if (!updated) return { counted: false, session: getById(session._id) || session };
  state.sessions.set(Number(updated._id), updated);
  return {
    counted: true, session: updated,
    goalJustReached: !session.goal_reached_at && Number(updated.messages) >= Number(updated.goal),
  };
}

async function uncountMessage(messageId) {
  const session = [...state.sessions.values()].find((s) =>
    s.status === 'active' && (s.messageRecords || []).some((m) => String(m.message_id) === String(messageId))
  );
  if (!session) return false;
  const updated = await FeatureBatepontoSession.findOneAndUpdate(
    { _id: Number(session._id), status: 'active', 'messageRecords.message_id': String(messageId) },
    [
      { $set: {
        messageRecords: {
          $filter: {
            input: { $ifNull: ['$messageRecords', []] }, as: 'm',
            cond: { $ne: ['$$m.message_id', { $literal: String(messageId) }] },
          },
        },
        messages: { $max: [0, { $subtract: [{ $ifNull: ['$messages', 0] }, 1] }] },
      } },
    ],
    { new: true, lean: true }
  ).exec();
  if (!updated) return false;
  state.sessions.set(Number(updated._id), updated);
  return true;
}

async function finalize(sessionId, { actorId = null } = {}) {
  const now = Date.now();
  const updated = await FeatureBatepontoSession.findOneAndUpdate(
    { _id: Number(sessionId), status: 'active' },
    [
      { $set: {
        status: { $cond: [{ $gte: [{ $ifNull: ['$messages', 0] }, { $ifNull: ['$goal', 0] }] }, 'approved', 'rejected'] },
        ended_at: { $literal: now },
        result_note: {
          $cond: [
            { $gte: [{ $ifNull: ['$messages', 0] }, { $ifNull: ['$goal', 0] }] },
            'Tempo e meta cumpridos', 'Meta de mensagens não atingida',
          ],
        },
        rewardApplied: false,
      } },
    ],
    { new: true, lean: true }
  ).exec();
  if (!updated) return null;
  state.sessions.set(Number(updated._id), updated);

  let entry = null;
  if (updated.status === 'approved' && Number(updated.reward) > 0) {
    entry = await pointsService.applyChange({
      userId: updated.user_id, actorId, mode: 'add', amount: Number(updated.reward),
      type: 'bate-ponto', reason: 'Bate-ponto aprovado (' + updated.area + ')',
      idempotencyKey: 'bateponto:' + updated._id,
    });
  }
  const awarded = entry ? Number(entry.delta) : 0;
  const final = {
    ...updated, points_awarded: awarded, rewardApplied: true,
  };
  await FeatureBatepontoSession.updateOne(
    { _id: Number(updated._id) },
    { $set: { points_awarded: awarded, rewardApplied: true } }
  ).exec();
  state.sessions.set(Number(updated._id), final);
  return { session: final, entry };
}

async function cancel(sessionId, note) {
  const now = Date.now();
  const updated = await FeatureBatepontoSession.findOneAndUpdate(
    { _id: Number(sessionId), status: 'active' },
    { $set: { status: 'cancelled', ended_at: now, result_note: note || 'Cancelado', rewardApplied: true } },
    { new: true, lean: true }
  ).exec();
  if (!updated) return null;
  state.sessions.set(Number(updated._id), updated);
  return updated;
}

async function recoverPendingRewards() {
  let recovered = 0;
  for (const session of state.sessions.values()) {
    if (session.status !== 'approved' || session.rewardApplied || !(Number(session.reward) > 0)) continue;
    const entry = await pointsService.applyChange({
      userId: session.user_id, actorId: null, mode: 'add', amount: Number(session.reward),
      type: 'bate-ponto', reason: 'Bate-ponto aprovado (' + session.area + ')',
      idempotencyKey: 'bateponto:' + session._id,
    });
    await FeatureBatepontoSession.updateOne(
      { _id: Number(session._id) },
      { $set: { points_awarded: Number(entry.delta) || 0, rewardApplied: true } }
    ).exec();
    const refreshed = { ...session, points_awarded: Number(entry.delta) || 0, rewardApplied: true };
    state.sessions.set(Number(session._id), refreshed);
    recovered++;
  }
  return recovered;
}

function snapshot(s, now = Date.now()) {
  const elapsed = Math.min(Math.max(0, now - s.started_at), s.duration_ms);
  return {
    elapsed, remaining: Math.max(0, s.ends_at - now),
    goalMet: s.messages >= s.goal, timeDone: now >= s.ends_at,
  };
}

module.exports = {
  getConfig, getById, getActiveByUser, getLastByUser, listActive, listRecent, listDue,
  start, countMessage, uncountMessage, finalize, cancel, snapshot, recoverPendingRewards,
};
