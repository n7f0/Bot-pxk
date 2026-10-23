// src/models/index.js
const mongoose = require('mongoose');
const { Schema, model } = mongoose;
const { Mixed, ObjectId } = Schema.Types;

// Importa os emojis para não quebrar o txtmod (ajuste o caminho se necessário)
let setOverrides = () => {};
try { setOverrides = require('../txtmod/emojis').setOverrides || (() => {}); } catch (e) {}

// ==========================================
// 1. UTILITÁRIOS
// ==========================================
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

// ==========================================
// 2. CONFIGURAÇÕES PADRÃO (TUDO AQUI)
// ==========================================
const DEFAULT_DESCRIPTION = [
  'Gostou do servidor e quer se juntar à nossa staff?',
  'Clique no botão abaixo e preencha o formulário.',
  '', '**Áreas disponíveis:**', '', '*Mov Call / Eventos / Design / Jornalismo / Games*', '',
  '**Importante:**', '', '• *Necessário ter mais de 15 anos;*', '• *Necessário deixar seu privado aberto;*', '• *Necessário ter comprometimento pela área que você escolher.*',
].join('\n');

const DEFAULT_QUESTIONS = {
  staff: [
    { label: 'Qual a sua idade?', placeholder: 'Ex: 17', long: false, required: true },
    { label: 'Área (Mov/Eventos/Design/Jornal/Games)', placeholder: 'Ex: Mov Call', long: false, required: true },
    { label: 'Por que quer se juntar à staff?', placeholder: 'Explique o motivo...', long: true, required: true },
    { label: 'Quanto tempo tem disponível por dia?', placeholder: 'Ex: 4 horas', long: false, required: true },
  ],
  migracao: [
    { label: 'Qual a sua idade?', placeholder: 'Ex: 17', long: false, required: true },
    { label: 'De qual servidor você está vindo?', placeholder: 'Nome do servidor', long: false, required: true },
    { label: 'Qual era seu cargo no servidor anterior?', placeholder: 'Ex: Mov Call', long: false, required: true },
    { label: 'Por que quer ser migrado?', placeholder: 'Explique o motivo...', long: true, required: true },
    { label: 'Quanto tempo tem disponível por dia?', placeholder: 'Ex: 4 horas', long: false, required: true },
  ],
};

const DEFAULTS = {
  // --- Configurações do MOV Call (bot) ---
  servers: { mainId: '', internalId: '', extraGuildIds: [] },
  voice: { 
    channelIds: [], categoryIds: [], movChannelIds: [], movCategoryIds: [], 
    countMuted: true, countDeafened: false, minSessionSec: 60, maxSessionHours: 6, 
    main: null, internal: null 
  },
  points: { 
    perHour: 10, rounding: 'floor', dailyCap: 0, unit: 'pontos', 
    recruitment: 20, migration: 20, shiftFlat: 0, shiftPerHour: 0, reject: 0 
  },
  mov: { points: 20, minMinutes: 10 },
  monitor: { 
    durationMin: 5, minPresencePct: 80, requireAllCriteria: true, allowSelf: false, 
    maxPerTargetPerDay: 0, maxPerMonitorPerDay: 0, 
    types: [{ key: 'padrao', label: 'Monitoria padrão', bonus: 5 }], 
    criteria: ['Permaneceu na call durante toda a monitoria', 'Participou da movimentação', 'Cumpriu as regras da call'] 
  },
  ranking: {
    enabled: true, channelId: null, messageId: null, messageKind: null, auto: true, intervalMin: 1, topSize: 100, pageSize: 10, sortBy: 'crystals', style: 'v3', accentBar: false, title: 'Ranking de Pontos - Mov Call', color: '#2B2D31', banner: '', thumbnail: '', footer: 'Página {pagina}/{paginas} • {temporada} • atualizado automaticamente', showTimestamp: true, emptyText: 'Ninguém pontuou nesta temporada ainda.', lineTemplate: '{emoji} {usuario} - **{valor} {unidade}**\n-# {iconMov} MOVs concluídas: {mcfeitas} • {iconOk} Aprovadas: {mcaprov} • {iconBad} Reprovadas: {mcreprov}\n-# {iconTempo} Tempo em call: {horas} • {iconMon} Monitorias feitas: {monitorias}', legend: true,
    view: { style: 'embed', title: 'Ranking de Recrutamento', color: '#2B2D31', banner: '', thumbnail: '', footer: 'Top {top} • atualizado automaticamente', showTimestamp: true, v3Accent: false, sortBy: 'points', unit: 'pontos', emptyText: 'Nenhum recrutador pontuou ainda.', lineTemplate: '{emoji} {usuario} — **{pontos}** {unidade}', description: '', podiumCount: 0, podiumTemplate: '', totalsTemplate: '', spacing: 'auto' }
  },
  seasons: { weeklyReset: true, weekday: 1, hour: 0, lastKey: '' },
  appearance: { monitorTitle: 'Painel de Monitoria', monitorText: 'Use o botão abaixo para monitorar um membro...' },
  movCall: {
    panelChannelId: null, commandChannelId: null, durationMin: 30, minPresencePct: 80, leaveGraceSec: 300, pointsMin: 1, pointsMax: 20, pointsDefault: 5, allowDuplicateMonitoring: false, onLeave: 'review', requireMonitorInCall: true, autoPointsEnabled: true, autoPoints: 5, notifyEnabled: true, notifyDm: true, notifyChannel: false, notifyFallback: false, notifyChannelId: null, msgStart: '...', msgLeave: '...', msgReturn: '...', msgCancel: '...', msgFinish: '...', msgFail: '...', msgAuto: '...', allowEarlyApproval: true, autoMoveMonitor: false, restartToleranceSec: 600, title: 'MOV CALL - UNION'
  },
  prefixes: { start: 'unionmov', lista: 'unionlista', cancel: 'unionmovcancel' },
  listaMov: {
    channelId: null, collectMode: 'all', launchRoleIds: [], requireStartButton: true, roleIds: [], staffRoleIds: [], durationMin: 60, minPresencePct: 80, waitMin: 30, pointsDefault: 5, pointsMax: 20, notify: true, msgStart: '...', msgEnd: '...'
  },
  
  // --- Configurações de Tickets (txtmod) ---
  tickets: {
    style: 'V1', categoryId: null, useThread: false, threadChannelId: null, panelChannelId: null, panelMessageId: null, panelKind: null, accessRoleIds: [], assignableRoleIds: [], hierarchyRoleIds: [], hierarchyMax: 1, inicianteRoleId: null, inicianteRoleIds: [], nameTemplate: '{tipo}-{usuario}', requireShiftToClaim: false,
    panel: { title: 'União — Seja Staff', desc1: DEFAULT_DESCRIPTION, desc2: '', desc3: '', desc4: '', color: '#D4AF37', banner: '', thumbnail: '', footer: '', labelStaff: 'Quero ser staff', labelMig: 'Quero ser migrado', v3Accent: false, selectPlaceholder: 'Selecione uma opção...', optLabelStaff: 'Recrutamento', optLabelMig: 'Migração', optDescStaff: 'Para ser recrutado.', optDescMig: 'Para ser migrado.' },
    messages: { open: 'Olá {usuario}...', claim: '✅ {recrutador} assumiu...', finish: '🎉 {usuario} foi recrutado(a)...', reject: '❌ A candidatura...', close: '🔒 Este ticket será fechado...' },
    questions: clone(DEFAULT_QUESTIONS)
  },
  shift: {
    enabled: true, plannedMinutes: 60, minMinutes: 10, maxHours: 12, requireVoice: false, allowedChannelIds: [], rules: 'Fique disponível...', panelChannelId: null, panelMessageId: null, categoryName: null, categoryId: null, returnMinutes: 5,
    messages: { start: '...', leave: '...', cancel: '...', incomplete: '...', done: '...' }
  },
  logs: { main: { geral: null, tickets: null, recrutamento: null }, internal: { geral: null, tickets: null, recrutamento: null, plantao: null, admin: null }, sessoes: null, movs: null, monitoria: null, pontos: null, movcall: null },
  perms: { main: { admin: [], leader: [], recruiter: [], migrator: [] }, internal: { admin: [], leader: [], recruiter: [], shift: [] }, monitor: [], points: [], starter: [], selfMonitor: [], discordAdmin: true },
  emojis: {},
  presets: {},
  panels: { monitor: { channelId: null, messageId: null } },
};

// ==========================================
// 3. MODELOS DE BANCO (Mongoose)
// ==========================================
const Config = model('Config', new Schema({ key: { type: String, unique: true }, data: Mixed }, { minimize: false }));

const Season = model('Season', new Schema({ number: { type: Number, index: true }, name: String, startsAt: { type: Date, default: Date.now }, endsAt: Date, endedAt: Date, status: { type: String, default: 'active', index: true }, snapshot: [Mixed] }));
const MemberStat = model('MemberStat', new Schema({ userId: String, tag: String, seasonId: ObjectId, voiceSec: Number, timePoints: Number, movPoints: Number, monitorPoints: Number, goalPoints: Number, manualPoints: Number, crystals: Number, movs: Number, monitorsDone: Number, goalsDone: Number, mcDone: Number, mcApproved: Number, mcRejected: Number, mcSec: Number, monitoredCount: Number }, { collection: 'memberStats' }));
const PointTx = model('PointTx', new Schema({ key: { type: String, unique: true }, userId: String, tag: String, seasonId: ObjectId, category: String, amount: Number, seconds: Number, reason: String, by: String, refId: Mixed, createdAt: { type: Date, default: Date.now } }, { collection: 'pointTransactions' }));
const VoiceSession = model('VoiceSession', new Schema({ userId: String, tag: String, guildId: String, channelId: String, channelsVisited: [String], startedAt: Date, lastSeenAt: Date, countingSince: Date, validSec: Number, paidSec: Number, paidPoints: Number, points: Number, totalSec: Number, status: String, endedAt: Date, endReason: String }, { collection: 'voiceSessions' }));
const MovEvent = model('MovEvent', new Schema({ name: String, time: String, days: [Number], durationMin: Number, minMinutes: Number, points: Number, maxRewards: Number, channelIds: [String], categoryIds: [String], enabled: Boolean }, { collection: 'movEvents' }));
const MovOccurrence = model('MovOccurrence', new Schema({ eventId: ObjectId, name: String, dateKey: String, startsAt: Date, endsAt: Date, status: String, points: Number, minMinutes: Number, maxRewards: Number, channelIds: [String], categoryIds: [String], participants: Number, rewarded: Number }, { collection: 'movOccurrences' }));
const MovParticipation = model('MovParticipation', new Schema({ occurrenceId: ObjectId, userId: String, tag: String, sec: Number, lastSeenAt: Date, rewarded: Boolean, reward: Number }, { collection: 'movParticipations' }));
const MonitorSession = model('MonitorSession', new Schema({ targetId: String, targetTag: String, byId: String, byTag: String, type: String, typeLabel: String, channelId: String, startedAt: Date, endsAt: Date, presentSec: Number, lastSeenAt: Date, status: String, criteriaMet: [Number], criteriaSnapshot: [String], observation: String, bonus: Number, finishedAt: Date, dayKey: String }, { collection: 'monitorSessions' }));
const UserMov = model('UserMov', new Schema({ userId: String, tag: String, seasonId: ObjectId, guildId: String, voiceGuildId: String, channelId: String, channelName: String, startChannelId: String, startedAt: Date, endsAt: Date, durationMin: Number, presentSec: Number, inCall: Boolean, lastSeenAt: Date, outSince: Date, status: String, endReason: String, finishedAt: Date, panel: { guildId: String, channelId: String, messageId: String }, result: String, autoPoints: Number, leaveNotified: Boolean }, { collection: 'userMovs' }));
const MovMonitoria = model('MovMonitoria', new Schema({ movId: ObjectId, targetId: String, targetTag: String, byId: String, byTag: String, seasonId: ObjectId, channelId: String, startedAt: Date, endsAt: Date, presentSec: Number, monitorSec: Number, targetIn: Boolean, monitorIn: Boolean, targetOutSince: Date, channelName: String, voiceGuildId: String, lastSeenAt: Date, leftCall: Boolean, leftReason: String, status: String, criteriaMet: [Number], criteriaSnapshot: [String], observation: String, points: Number, decidedBy: String, finishedAt: Date, dayKey: String }, { collection: 'movMonitorias' }));
const MovLista = model('MovLista', new Schema({ guildId: String, seasonId: ObjectId, startedById: String, startedByTag: String, sourceChannelId: String, sourceChannelName: String, createdAt: Date, durationMin: Number, minPresencePct: Number, waitMin: Number, released: Boolean, releasedAt: Date, releasedById: String, collectMode: String, status: String, cancelledById: String, stoppedById: String, participants: [{ _id: false, userId: String, tag: String, status: String, startedAt: Date, endsAt: Date, presentSec: Number, lastSeenAt: Date, inCall: Boolean, scored: Boolean, points: Number, scoredBy: String, dmWarned: Boolean }], list: { channelId: String, messageId: String } }, { collection: 'movListas' }));
const Goal = model('Goal', new Schema({ name: String, description: String, scope: String, period: String, type: String, target: Number, reward: Number, maxCompletions: Number, enabled: Boolean }, { collection: 'goals' }));
const GoalCompletion = model('GoalCompletion', new Schema({ key: { type: String, unique: true }, goalId: ObjectId, userId: String, periodKey: String, reward: Number, createdAt: Date }, { collection: 'goalCompletions' }));
const AuditLog = model('AuditLog', new Schema({ by: String, byTag: String, action: String, target: String, detail: String, createdAt: Date }, { collection: 'auditLogs' }));

const UserStat = model('UserStat', new Schema({ userId: { type: String, unique: true }, name: String, points: { type: Number, default: 0 }, recruitments: { type: Number, default: 0 }, migrations: { type: Number, default: 0 }, shifts: { type: Number, default: 0 }, shiftSeconds: { type: Number, default: 0 }, adjStaff: { type: Number, default: 0 }, adjMig: { type: Number, default: 0 }, adjShifts: { type: Number, default: 0 }, updatedAt: Date }));
const Ticket = model('Ticket', new Schema({ number: Number, guildId: String, channelId: { type: String, index: true }, channelName: String, messageId: String, userId: String, userTag: String, type: String, presetId: { type: String, default: null }, presetName: String, answers: [{ _id: false, q: String, a: String }], openedAt: { type: Date, default: Date.now }, claimedBy: String, claimedAt: Date, status: { type: String, default: 'open' }, result: { type: String, default: null }, rolesGiven: [String], finalizedAt: Date, closedAt: Date, closedBy: String, history: [{ _id: false, at: { type: Date, default: Date.now }, by: String, action: String, detail: String }] }));
const Recruitment = model('Recruitment', new Schema({ ticketId: { type: ObjectId, unique: true }, guildId: String, recruiterId: String, recruitedId: String, type: String, roles: [String], points: Number, shiftId: ObjectId, at: { type: Date, default: Date.now } }));
const Shift = model('Shift', new Schema({ guildId: String, userId: String, userTag: String, startedAt: Date, plannedEnd: Date, endedAt: Date, status: String, voiceChannelId: String, voiceName: String, presence: String, inSince: Date, awayAt: Date, inSec: Number, muteSince: Date, mutedSec: Number, awayCount: Number, dmFailed: Boolean, durationSec: Number, counted: Boolean, points: Number, recruitments: Number, attendances: Number, finalizedBy: String, cancelReason: String, reviewChannelId: String, reviewMessageId: String, reviewedBy: String, reviewedAt: Date, reviewNote: String, endReason: String }));
const LogEntry = model('LogEntry', new Schema({ at: { type: Date, default: Date.now }, category: String, action: String, userId: String, data: Mixed }));
const Counter = model('Counter', new Schema({ _id: String, n: { type: Number, default: 0 } }));
const AdminLog = model('AdminLog', new Schema({ at: { type: Date, default: Date.now, index: true }, userId: String, userTag: String, guildId: String, action: String, label: String, path: String, value: String }));

// ==========================================
// 4. FUNÇÕES DE CONFIGURAÇÃO E CACHE
// ==========================================
let cfgCache = null;
const cfgNow = () => cfgCache ?? merge(clone(DEFAULTS), {});

async function loadCfg() {
  const doc = await Config.findOne({ key: 'main' }).lean();
  const cfg = merge(clone(DEFAULTS), doc?.data ?? {});
  
  // Compatibilidade com configurações antigas
  const saved = doc?.data?.tickets;
  if (saved?.mode === 'thread' && saved.useThread === undefined) cfg.tickets.useThread = true;
  if (!cfg.tickets.inicianteRoleIds?.length && cfg.tickets.inicianteRoleId) {
    cfg.tickets.inicianteRoleIds = [cfg.tickets.inicianteRoleId];
  }
  
  for (const [id, p] of Object.entries(cfg.presets || {})) {
    cfg.presets[id] = merge(presetDefaults(p?.name), clone(p || {}));
  }
  
  if (typeof setOverrides === 'function') setOverrides(cfg.emojis);
  cfgCache = cfg;
  return cfg;
}

const getCfg = async () => cfgCache || loadCfg();

async function setCfg(path, value) {
  await Config.updateOne({ key: 'main' }, { $set: { [`data.${path}`]: value } }, { upsert: true });
  await loadCfg();
}

async function delCfg(path) {
  await Config.updateOne({ key: 'main' }, { $unset: { [`data.${path}`]: '' } });
  await loadCfg();
}
async function unsetCfg(path) { return delCfg(path); }

// ==========================================
// 5. PRESETS E SEASONS
// ==========================================
const PRESET_DESCRIPTION = 'Clique no botão abaixo para abrir um ticket.\n\nUm membro da equipe irá atender você o mais rápido possível.';
function presetDefaults(name = 'Novo preset') {
  return {
    name, recruitMode: false, points: null, handlerRoleIds: [], logChannelId: null,
    tickets: {
      style: 'V1', categoryId: null, useThread: false, threadChannelId: null, panelChannelId: null, panelMessageId: null, panelKind: null, accessRoleIds: [], assignableRoleIds: [], hierarchyRoleIds: [], hierarchyMax: 1, inicianteRoleIds: [], nameTemplate: '{tipo}-{usuario}', requireShiftToClaim: false,
      panel: { title: name, desc1: PRESET_DESCRIPTION, desc2: '', desc3: '', desc4: '', color: '#D4AF37', banner: '', thumbnail: '', footer: '', labelStaff: 'Abrir ticket', labelMig: '', v3Accent: false, selectPlaceholder: 'Selecione...', optLabelStaff: name, optLabelMig: '', optDescStaff: 'Clique para abrir.', optDescMig: '' },
      messages: { open: 'Olá {usuario}...', claim: '✅ {recrutador}...', finish: '🎉 {usuario}...', reject: '❌ O pedido...', close: '🔒 Este ticket...' },
      questions: { staff: [{ label: 'Qual o motivo do ticket?', placeholder: 'Explique...', long: true, required: true }], migracao: [] }
    }
  };
}

function viewCfg(cfg, presetId) {
  if (!presetId) return cfg;
  const saved = cfg.presets?.[presetId];
  const p = merge(presetDefaults(saved?.name || 'Ticket'), clone(saved || {}));
  const handlers = p.handlerRoleIds?.length ? p.handlerRoleIds : p.tickets.accessRoleIds;
  const logId = p.logChannelId;
  const pts = p.points ?? cfg.points.recruitment;
  return {
    ...cfg, tickets: p.tickets, points: { ...cfg.points, recruitment: pts, migration: pts },
    perms: { ...cfg.perms, main: { ...cfg.perms.main, recruiter: handlers, migrator: handlers } },
    logs: logId ? { ...cfg.logs, main: { ...cfg.logs.main, geral: logId, tickets: logId, recrutamento: logId } } : cfg.logs,
    _preset: { id: presetId, name: p.name, recruitMode: !!p.recruitMode, deleted: !saved },
  };
}

let seasonCache = null;
async function ensureSeason() {
  let s = await Season.findOne({ status: 'active' }).sort({ number: -1 });
  if (!s) {
    const last = await Season.findOne().sort({ number: -1 });
    s = await Season.create({ number: (last?.number || 0) + 1, name: `Temporada ${(last?.number || 0) + 1}`, status: 'active', startsAt: new Date() });
  }
  seasonCache = s;
  return s;
}
const getSeason = async () => seasonCache || ensureSeason();
const resetSeasonCache = () => { seasonCache = null; };

async function initDb() {
  await Ticket.collection.dropIndex('userId_1').catch(() => {});
  const models = [Config, Season, MemberStat, PointTx, VoiceSession, MovEvent, MovOccurrence, MovParticipation, MonitorSession, UserMov, MovMonitoria, MovLista, Goal, GoalCompletion, AuditLog, UserStat, Ticket, Recruitment, Shift, LogEntry, Counter, AdminLog];
  for (const m of models) { try { await m.init(); } catch (e) {} }
  await loadCfg();
  await ensureSeason();
}

module.exports = {
  DEFAULTS, DEFAULT_QUESTIONS, clone, merge, getPath, presetDefaults, viewCfg,
  Config, getCfg, cfgNow, setCfg, delCfg, unsetCfg, loadCfg, initDb,
  Season, MemberStat, PointTx, VoiceSession, MovEvent, MovOccurrence, MovParticipation, MonitorSession, UserMov, MovMonitoria, MovLista, Goal, GoalCompletion, AuditLog, getSeason, ensureSeason, resetSeasonCache,
  UserStat, Ticket, Recruitment, Shift, LogEntry, Counter, AdminLog
};
