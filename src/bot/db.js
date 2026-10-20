const mongoose = require('mongoose');
const { Schema, model } = mongoose;
const { Mixed, ObjectId } = Schema.Types;

const clone = (o) => JSON.parse(JSON.stringify(o));
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
function merge(base, extra) {
  for (const [k, v] of Object.entries(extra || {})) {
    if (isObj(v) && isObj(base[k])) merge(base[k], v);
    else if (v !== undefined) base[k] = v;
  }
  return base;
}
const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

const DEFAULTS = {
  servers: { mainId: '', internalId: '', extraGuildIds: [] },
  voice: { channelIds: [], categoryIds: [], movChannelIds: [], movCategoryIds: [], countMuted: true, countDeafened: false, minSessionSec: 60, maxSessionHours: 6 },
  points: { perHour: 10, rounding: 'floor', dailyCap: 0, unit: 'pontos' },
  mov: { points: 20, minMinutes: 10 },
  monitor: { durationMin: 5, minPresencePct: 80, requireAllCriteria: true, allowSelf: false, maxPerTargetPerDay: 0, maxPerMonitorPerDay: 0, types: [{ key: 'padrao', label: 'Monitoria padrão', bonus: 5 }], criteria: ['Permaneceu na call', 'Participou', 'Cumpriu regras'] },
  ranking: { enabled: true, channelId: null, messageId: null, messageKind: null, auto: true, intervalMin: 1, topSize: 100, pageSize: 10, sortBy: 'crystals', style: 'v3', accentBar: false, title: 'Ranking PXK', color: '#2B2D31', banner: '', thumbnail: '', footer: 'Página {pagina}/{paginas}', showTimestamp: true, emptyText: 'Ninguém pontuou ainda.', lineTemplate: '{emoji} {usuario} - **{valor} {unidade}**', legend: true },
  seasons: { weeklyReset: true, weekday: 1, hour: 0, lastKey: '' },
  appearance: { monitorTitle: 'Monitoria', monitorText: 'Painel de monitoria' },
  movCall: { panelChannelId: null, commandChannelId: null, durationMin: 30, minPresencePct: 80, leaveGraceSec: 300, pointsMin: 1, pointsMax: 20, pointsDefault: 5, allowDuplicateMonitoring: false, onLeave: 'review', requireMonitorInCall: true, autoPointsEnabled: true, autoPoints: 5, notifyEnabled: true, notifyDm: true, notifyChannel: false, notifyFallback: false, notifyChannelId: null, msgStart: '{emoji} MOV iniciada!', msgLeave: '{emoji} Saiu da call', msgReturn: '{emoji} Voltou', msgCancel: '{emoji} Cancelada', msgFinish: '{emoji} Finalizada', msgFail: '{emoji} Falhou', msgAuto: '{emoji} Pontos', allowEarlyApproval: true, autoMoveMonitor: false, restartToleranceSec: 600, title: 'PXK CALL' },
  prefixes: { start: 'pxkmov', lista: 'pxklista', cancel: 'pxkmovcancel' },
  listaMov: { channelId: null, collectMode: 'all', launchRoleIds: [], requireStartButton: true, roleIds: [], staffRoleIds: [], durationMin: 60, minPresencePct: 80, waitMin: 30, pointsDefault: 5, pointsMax: 20, notify: true, msgStart: 'Iniciou', msgEnd: 'Terminou' },
  perms: { admin: [], leader: [], monitor: [], points: [], starter: [], selfMonitor: [], discordAdmin: true },
  logs: { geral: null, sessoes: null, movs: null, monitoria: null, pontos: null, admin: null, movcall: null },
  panels: { monitor: { channelId: null, messageId: null } },
  emojis: {},
};

const Config = model('Config', new Schema({ _id: String, data: Mixed }, { minimize: false }));
let cache = null;
async function loadCfg() { const doc = await Config.findById('cfg').lean(); cache = merge(clone(DEFAULTS), doc?.data || {}); return cache; }
const getCfg = () => cache || merge(clone(DEFAULTS), {});
async function setCfg(path, value) { await Config.updateOne({ _id: 'cfg' }, { $set: { [`data.${path}`]: value } }, { upsert: true }); await loadCfg(); }
async function unsetCfg(path) { await Config.updateOne({ _id: 'cfg' }, { $unset: { [`data.${path}`]: '' } }, { upsert: true }); await loadCfg(); }

const Season = model('Season', new Schema({ number: { type: Number, index: true }, name: String, startsAt: { type: Date, default: Date.now }, endsAt: { type: Date, default: null }, endedAt: { type: Date, default: null }, status: { type: String, default: 'active', index: true }, snapshot: [Mixed] }));
const MemberStat = model('MemberStat', new Schema({ userId: { type: String, required: true }, tag: String, seasonId: { type: ObjectId, required: true }, voiceSec: { type: Number, default: 0 }, timePoints: { type: Number, default: 0 }, movPoints: { type: Number, default: 0 }, monitorPoints: { type: Number, default: 0 }, goalPoints: { type: Number, default: 0 }, manualPoints: { type: Number, default: 0 }, crystals: { type: Number, default: 0 }, movs: { type: Number, default: 0 }, monitorsDone: { type: Number, default: 0 }, goalsDone: { type: Number, default: 0 }, mcDone: { type: Number, default: 0 }, mcApproved: { type: Number, default: 0 }, mcRejected: { type: Number, default: 0 }, mcSec: { type: Number, default: 0 }, monitoredCount: { type: Number, default: 0 } }, { collection: 'memberStats' }).index({ userId: 1, seasonId: 1 }, { unique: true }));
const PointTx = model('PointTx', new Schema({ key: { type: String, required: true, unique: true }, userId: { type: String, required: true }, tag: String, seasonId: ObjectId, category: { type: String, required: true }, amount: { type: Number, default: 0 }, seconds: { type: Number, default: 0 }, reason: String, by: String, refId: Mixed, createdAt: { type: Date, default: Date.now } }, { collection: 'pointTransactions' }));
const VoiceSession = model('VoiceSession', new Schema({ userId: { type: String, required: true }, tag: String, guildId: String, channelId: String, channelsVisited: [String], startedAt: { type: Date, default: Date.now }, lastSeenAt: Date, countingSince: { type: Date, default: null }, validSec: { type: Number, default: 0 }, paidSec: { type: Number, default: 0 }, paidPoints: { type: Number, default: 0 }, points: { type: Number, default: 0 }, totalSec: { type: Number, default: 0 }, status: { type: String, default: 'active' }, endedAt: Date, endReason: String }, { collection: 'voiceSessions' }).index({ userId: 1 }, { unique: true, partialFilterExpression: { status: 'active' } }));
const MovEvent = model('MovEvent', new Schema({ name: String, time: { type: String, default: '12:00' }, days: { type: [Number], default: [] }, durationMin: { type: Number, default: 60 }, minMinutes: { type: Number, default: 10 }, points: { type: Number, default: 20 }, maxRewards: { type: Number, default: 0 }, channelIds: { type: [String], default: [] }, categoryIds: { type: [String], default: [] }, enabled: { type: Boolean, default: true } }, { collection: 'movEvents' }));
const MovOccurrence = model('MovOccurrence', new Schema({ eventId: ObjectId, name: String, dateKey: String, startsAt: Date, endsAt: Date, status: { type: String, default: 'active' }, points: Number, minMinutes: Number, maxRewards: Number, channelIds: [String], categoryIds: [String], participants: { type: Number, default: 0 }, rewarded: { type: Number, default: 0 } }, { collection: 'movOccurrences' }).index({ eventId: 1, dateKey: 1 }, { unique: true }));
const MovParticipation = model('MovParticipation', new Schema({ occurrenceId: { type: ObjectId, required: true }, userId: { type: String, required: true }, tag: String, sec: { type: Number, default: 0 }, lastSeenAt: Date, rewarded: { type: Boolean, default: false }, reward: { type: Number, default: 0 } }, { collection: 'movParticipations' }).index({ occurrenceId: 1, userId: 1 }, { unique: true }));
const MonitorSession = model('MonitorSession', new Schema({ targetId: String, targetTag: String, byId: String, byTag: String, type: String, typeLabel: String, channelId: String, startedAt: Date, endsAt: Date, presentSec: { type: Number, default: 0 }, lastSeenAt: Date, status: { type: String, default: 'active' }, criteriaMet: [Number], criteriaSnapshot: [String], observation: String, bonus: { type: Number, default: 0 }, finishedAt: Date, dayKey: String }, { collection: 'monitorSessions' }));
const UserMov = model('UserMov', new Schema({ userId: { type: String, required: true }, tag: String, seasonId: ObjectId, guildId: String, voiceGuildId: String, channelId: String, channelName: String, startChannelId: String, startedAt: { type: Date, default: Date.now }, endsAt: Date, durationMin: Number, presentSec: { type: Number, default: 0 }, inCall: { type: Boolean, default: true }, lastSeenAt: Date, outSince: { type: Date, default: null }, status: { type: String, default: 'active' }, endReason: String, finishedAt: Date, panel: { guildId: String, channelId: String, messageId: String }, result: { type: String, default: 'none' }, autoPoints: { type: Number, default: 0 }, leaveNotified: { type: Boolean, default: false } }, { collection: 'userMovs' }).index({ userId: 1 }, { unique: true, partialFilterExpression: { status: 'active' } }));
const MovMonitoria = model('MovMonitoria', new Schema({ movId: { type: ObjectId, required: true }, targetId: String, targetTag: String, byId: String, byTag: String, seasonId: ObjectId, channelId: String, startedAt: Date, endsAt: Date, presentSec: { type: Number, default: 0 }, monitorSec: { type: Number, default: 0 }, targetIn: { type: Boolean, default: true }, monitorIn: { type: Boolean, default: true }, targetOutSince: { type: Date, default: null }, channelName: String, voiceGuildId: String, lastSeenAt: Date, leftCall: { type: Boolean, default: false }, leftReason: String, status: { type: String, default: 'active' }, criteriaMet: [Number], criteriaSnapshot: [String], observation: String, points: { type: Number, default: 0 }, decidedBy: String, finishedAt: Date, dayKey: String }, { collection: 'movMonitorias' }));
const MovLista = model('MovLista', new Schema({ guildId: String, seasonId: ObjectId, startedById: String, startedByTag: String, sourceChannelId: String, sourceChannelName: String, createdAt: { type: Date, default: Date.now }, durationMin: Number, minPresencePct: Number, waitMin: Number, released: { type: Boolean, default: true }, releasedAt: Date, releasedById: String, collectMode: String, status: { type: String, default: 'active' }, cancelledById: String, stoppedById: String, participants: [{ userId: String, tag: String, status: { type: String, default: 'waiting' }, startedAt: Date, endsAt: Date, presentSec: { type: Number, default: 0 }, lastSeenAt: Date, inCall: { type: Boolean, default: false }, scored: { type: Boolean, default: false }, points: { type: Number, default: 0 }, scoredBy: String, dmWarned: { type: Boolean, default: false } }], list: { channelId: String, messageId: String } }, { collection: 'movListas' }));
const Goal = model('Goal', new Schema({ name: String, description: String, scope: { type: String, default: 'individual' }, period: { type: String, default: 'weekly' }, type: { type: String, default: 'hours' }, target: Number, reward: { type: Number, default: 0 }, maxCompletions: { type: Number, default: 0 }, enabled: { type: Boolean, default: true } }, { collection: 'goals' }));
const GoalCompletion = model('GoalCompletion', new Schema({ key: { type: String, unique: true }, goalId: ObjectId, userId: String, periodKey: String, reward: Number, createdAt: { type: Date, default: Date.now } }, { collection: 'goalCompletions' }));
const AuditLog = model('AuditLog', new Schema({ by: String, byTag: String, action: String, target: String, detail: String, createdAt: { type: Date, default: Date.now, index: true } }, { collection: 'auditLogs' }));

let seasonCache = null;
async function ensureSeason() {
  let s = await Season.findOne({ status: 'active' }).sort({ number: -1 });
  if (!s) {
    const last = await Season.findOne().sort({ number: -1 });
    const number = (last?.number || 0) + 1;
    s = await Season.create({ number, name: `Temporada ${number}` });
  }
  seasonCache = s;
  return s;
}
const getSeason = async () => seasonCache || ensureSeason();
const resetSeasonCache = () => { seasonCache = null; };

async function initDb() {
  await loadCfg();
  const models = [Season, MemberStat, PointTx, VoiceSession, MovEvent, MovOccurrence, MovParticipation, MonitorSession, UserMov, MovMonitoria, MovLista, Goal, GoalCompletion, AuditLog];
  for (const m of models) {
    try { await m.init(); } catch (e) { console.warn(`[db] índice de ${m.modelName}: ${e.message}`); }
  }
  await ensureSeason();
}

module.exports = { DEFAULTS, clone, merge, getPath, getCfg, setCfg, unsetCfg, loadCfg, initDb, getSeason, ensureSeason, resetSeasonCache, Season, MemberStat, PointTx, VoiceSession, MovEvent, MovOccurrence, MovParticipation, MonitorSession, UserMov, MovMonitoria, MovLista, Goal, GoalCompletion, AuditLog };