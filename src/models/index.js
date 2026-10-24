// src/models/index.js
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
  voice: { channelIds: [], categoryIds: [], movChannelIds: [], movCategoryIds: [], countMuted: true, countDeafened: false, minSessionSec: 60, maxSessionHours: 6, main: null, internal: null },
  points: { perHour: 10, rounding: 'floor', dailyCap: 0, unit: 'pontos', recruitment: 20, migration: 20, shiftFlat: 0, shiftPerHour: 0, reject: 0 },
  mov: { points: 20, minMinutes: 10 },
  monitor: { durationMin: 5, minPresencePct: 80, requireAllCriteria: true, allowSelf: false, maxPerTargetPerDay: 0, maxPerMonitorPerDay: 0, types: [{ key: 'padrao', label: 'Monitoria padrão', bonus: 5 }], criteria: ['Permaneceu na call', 'Participou'] },
  ranking: { enabled: true, channelId: null, messageId: null, messageKind: null, auto: true, intervalMin: 1, topSize: 100, pageSize: 10, sortBy: 'crystals', style: 'v3', accentBar: false, title: 'Ranking', color: '#2B2D31', banner: '', thumbnail: '', footer: 'Página {pagina}/{paginas}', showTimestamp: true, emptyText: 'Ninguém pontuou.', lineTemplate: '{emoji} {usuario} - **{valor} {unidade}**', legend: true, view: {} },
  seasons: { weeklyReset: true, weekday: 1, hour: 0, lastKey: '' },
  appearance: { monitorTitle: 'Painel', monitorText: 'Use...' },
  movCall: {
    enabled: true, // <--- NOVO AQUI (Permite ligar/desligar pelo site)
    panelChannelId: null, commandChannelId: null, durationMin: 30, minPresencePct: 80, leaveGraceSec: 300, pointsMin: 1, pointsMax: 20, pointsDefault: 5, allowDuplicateMonitoring: false, onLeave: 'review', requireMonitorInCall: true, autoPointsEnabled: true, autoPoints: 5, notifyEnabled: true, notifyDm: true, notifyChannel: false, notifyFallback: false, notifyChannelId: null, msgStart: '...', msgLeave: '...', msgReturn: '...', msgCancel: '...', msgFinish: '...', msgFail: '...', msgAuto: '...', allowEarlyApproval: true, autoMoveMonitor: false, restartToleranceSec: 600, title: 'MOV CALL'
  },
  prefixes: { start: 'unionmov', lista: 'unionlista', cancel: 'unionmovcancel' },
  listaMov: { channelId: null, collectMode: 'all', launchRoleIds: [], requireStartButton: true, roleIds: [], staffRoleIds: [], durationMin: 60, minPresencePct: 80, waitMin: 30, pointsDefault: 5, pointsMax: 20, notify: true },
  tickets: { style: 'V1', categoryId: null, useThread: false, questions: {} },
  shift: { enabled: true, plannedMinutes: 60 },
  logs: { 
    main: { geral: null, tickets: null, recrutamento: null }, 
    internal: { geral: null, tickets: null, recrutamento: null, plantao: null, admin: null }, 
    sessoes: null, movs: null, monitoria: null, pontos: null, movcall: null,
    ban: null, punish: null, joinLeave: null // <--- NOVOS CAMPOS AQUI
  },
  perms: { main: { admin: [], leader: [], recruiter: [], migrator: [] }, internal: { admin: [], leader: [], recruiter: [], shift: [] }, monitor: [], points: [], starter: [], selfMonitor: [], discordAdmin: true },
  emojis: {}, presets: {}, panels: { monitor: { channelId: null, messageId: null } },
};

const Config = model('Config', new Schema({ key: { type: String, unique: true }, data: Mixed }, { minimize: false }));
const Season = model('Season', new Schema({ number: Number, name: String, startsAt: Date, endsAt: Date, endedAt: Date, status: String, snapshot: [Mixed] }));
const MemberStat = model('MemberStat', new Schema({ userId: String, tag: String, seasonId: ObjectId, voiceSec: Number, timePoints: Number, movPoints: Number, monitorPoints: Number, goalPoints: Number, manualPoints: Number, crystals: Number, movs: Number, monitorsDone: Number, goalsDone: Number, mcDone: Number, mcApproved: Number, mcRejected: Number, mcSec: Number, monitoredCount: Number }));
const PointTx = model('PointTx', new Schema({ key: String, userId: String, tag: String, seasonId: ObjectId, category: String, amount: Number, seconds: Number, reason: String, by: String, refId: Mixed, createdAt: Date }));
const VoiceSession = model('VoiceSession', new Schema({ userId: String, tag: String, guildId: String, channelId: String, startedAt: Date, lastSeenAt: Date, validSec: Number, status: String, endedAt: Date, endReason: String }));
const MovEvent = model('MovEvent', new Schema({ name: String, time: String, days: [Number], durationMin: Number, minMinutes: Number, points: Number, maxRewards: Number, channelIds: [String], enabled: Boolean }));
const UserMov = model('UserMov', new Schema({ userId: String, tag: String, seasonId: ObjectId, status: String, result: String }));
const Goal = model('Goal', new Schema({ name: String, scope: String, period: String, type: String, target: Number, reward: Number, enabled: Boolean }));
const Ticket = model('Ticket', new Schema({ number: Number, userId: String, status: String }));
const AdminLog = model('AdminLog', new Schema({ at: Date, userId: String, action: String, detail: String }));

let cfgCache = null;
const getCfg = () => cfgCache || merge(clone(DEFAULTS), {});

async function loadCfg() {
  const doc = await Config.findOne({ key: 'main' }).lean();
  cfgCache = merge(clone(DEFAULTS), doc?.data ?? {});
  return cfgCache;
}

async function setCfg(path, value) {
  await Config.updateOne({ key: 'main' }, { $set: { [`data.${path}`]: value } }, { upsert: true });
  await loadCfg();
}

let seasonCache = null;
async function ensureSeason() {
  let s = await Season.findOne({ status: 'active' }).sort({ number: -1 });
  if (!s) s = await Season.create({ number: 1, name: 'Temporada 1', status: 'active', startsAt: new Date() });
  seasonCache = s;
  return s;
}
const getSeason = async () => seasonCache || ensureSeason();

module.exports = {
  DEFAULTS, clone, merge, getPath, Config, getCfg, setCfg, loadCfg, Season, MemberStat, PointTx, VoiceSession, MovEvent, UserMov, Goal, Ticket, AdminLog, getSeason, ensureSeason
};