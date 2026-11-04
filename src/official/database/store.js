'use strict';

const models = require('../../models');

const state = {
  loaded: false,
  users: new Map(),
  seasons: new Map(),
  scores: new Map(),
  pointHistory: new Map(),
  pointHistoryByKey: new Map(),
  sessions: new Map(),
  rolePermissions: new Map(),
  pointRoles: new Map(),
  seasonRankings: [],
  logs: [],
  settings: new Map(),
};

const scoreKey = (seasonId, userId) => String(seasonId) + ':' + String(userId);
const permissionKey = (guildId, roleId, permission) => [guildId, roleId, permission].join(':');

async function loadFeatureStore() {
  const [
    users, seasons, scores, pointHistory, sessions, permissions, roles, rankings, logs, settings,
  ] = await Promise.all([
    models.FeatureUser.find({}).lean().exec(),
    models.FeatureSeason.find({}).lean().exec(),
    models.FeatureSeasonScore.find({}).lean().exec(),
    models.FeaturePointHistory.find({}).lean().exec(),
    models.FeatureBatepontoSession.find({}).lean().exec(),
    models.FeatureRolePermission.find({}).lean().exec(),
    models.FeaturePointRole.find({}).lean().exec(),
    models.FeatureSeasonRanking.find({}).lean().exec(),
    models.FeatureLog.find({}).sort({ _id: -1 }).limit(10000).lean().exec(),
    models.FeatureSetting.find({}).lean().exec(),
  ]);

  state.users = new Map(users.map((x) => [String(x._id), x]));
  state.seasons = new Map(seasons.map((x) => [Number(x._id), x]));
  state.scores = new Map(scores.map((x) => [String(x._id), x]));
  state.pointHistory = new Map(pointHistory.map((x) => [Number(x._id), x]));
  state.pointHistoryByKey = new Map(pointHistory.filter((x) => x.key).map((x) => [String(x.key), x]));
  state.sessions = new Map(sessions.map((x) => [Number(x._id), x]));
  state.rolePermissions = new Map(permissions.map((x) => [String(x._id), x]));
  state.pointRoles = new Map(roles.map((x) => [Number(x._id), x]));
  state.seasonRankings = rankings;
  state.logs = logs.sort((a, b) => Number(b._id) - Number(a._id));
  state.settings = new Map(settings.map((x) => [String(x._id), x.value]));
  state.loaded = true;

  return {
    users: users.length, seasons: seasons.length, scores: scores.length,
    pointHistory: pointHistory.length, sessions: sessions.length, rolePermissions: permissions.length,
    pointRoles: roles.length, seasonRankings: rankings.length,
    logs: logs.length, settings: settings.length,
  };
}

function assertLoaded() {
  if (!state.loaded) throw new Error('O repositório MongoDB ainda não foi carregado.');
}

async function nextId(name) {
  const doc = await models.FeatureCounter.findOneAndUpdate(
    { _id: name },
    { $inc: { value: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean().exec();
  return Number(doc.value);
}

async function seedCounter(name, maxValue) {
  await models.FeatureCounter.updateOne(
    { _id: name },
    { $max: { value: Number(maxValue) || 0 } },
    { upsert: true }
  ).exec();
}

function scoreId(seasonId, userId) { return scoreKey(seasonId, userId); }
function permissionId(guildId, roleId, permission) { return permissionKey(guildId, roleId, permission); }

module.exports = {
  state, models, scoreKey, permissionKey, scoreId, permissionId,
  loadFeatureStore, assertLoaded, nextId, seedCounter,
};
