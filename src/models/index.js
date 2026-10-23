// src/models/index.js
const mongoose = require('mongoose');
const { Schema, model } = mongoose;
const { Mixed, ObjectId } = Schema.Types;

// ---------- UTILITÁRIOS ----------
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
// 1. CONFIGURAÇÕES PADRÃO (TUDO AQUI)
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
  // --- Configurações do MOV Call (db.js) ---
  servers: { mainId: '', internalId: '', extraGuildIds: [] },
  voice: { channelIds: [], categoryIds: [], movChannelIds: [], movCategoryIds: [], countMuted: true, countDeafened: false, minSessionSec: 60, maxSessionHours: 6, main: null, internal: null },
  points: { perHour: 10, rounding: 'floor', dailyCap: 0, unit: 'pontos', recruitment: 20, migration: 20, shiftFlat: 0, shiftPerHour: 0, reject: 0 },
  mov: { points: 20, minMinutes: 10 },
  monitor: { durationMin: 5, minPresencePct: 80, requireAllCriteria: true, allowSelf: false, maxPerTargetPerDay: 0, maxPerMonitorPerDay: 0, types: [{ key: 'padrao', label: 'Monitoria padrão', bonus: 5 }], criteria: ['Permaneceu na call durante toda a monitoria', 'Participou da movimentação', 'Cumpriu as regras da call'] },
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
  
  // --- Configurações de Tickets (db (1).js) ---
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
// 2. MODELO DE CONFIGURAÇÃO ÚNICO
// ==========================================
const Config = model('Config', new Schema({ key: { type: String, unique: true }, data: Mixed }, { minimize: false }));
let cache = null;
async function loadCfg() {
  const doc = await Config.findOne({ key: 'main' }).lean();
  cache = merge(clone(DEFAULTS), doc?.data || {});
  return cache;
}
const getCfg = () => cache || merge(clone(DEFAULTS), {});
async function setCfg(path, value) {
  await Config.updateOne({ key: 'main' }, { $set: { [`data.${path}`]: value } }, { upsert: true });
  await loadCfg();
}
async function unsetCfg(path) {
  await Config.updateOne({ key: 'main' }, { $unset: { [`data.${path}`]: '' } }, { upsert: true });
  await loadCfg();
}

// ==========================================
// 3. MODELOS DO MOV CALL / PONTOS
// ==========================================
const Season = model('Season', new Schema({ number: Number, name: String, startsAt: Date, endsAt: Date, endedAt: Date, status: String, snapshot: [Mixed] }));
const MemberStat = model('MemberStat', new Schema({ userId: String, tag: String, seasonId: ObjectId, voiceSec: Number, timePoints: Number, movPoints: Number, monitorPoints: Number, goalPoints: Number, manualPoints: Number, crystals: Number, movs: Number, monitorsDone: Number, goalsDone: Number, mcDone: Number, mcApproved: Number, mcRejected: Number, mcSec: Number, monitoredCount: Number }));
const PointTx = model('PointTx', new Schema({ key: { type: String, unique: true }, userId: String, tag: String, seasonId: ObjectId, category: String, amount: Number, seconds: Number, reason: String, by: String, refId: Mixed, createdAt: Date }));
const VoiceSession = model('VoiceSession', new Schema({ userId: String, tag: String, guildId: String, channelId: String, startedAt: Date, validSec: Number, status: String }));
const MovEvent = model('MovEvent', new Schema({ name: String, time: String, days: [Number], durationMin: Number, points: Number, enabled: Boolean }));
const MovOccurrence = model('MovOccurrence', new Schema({ eventId: ObjectId, name: String, startsAt: Date, endsAt: Date, status: String }));
const UserMov = model('UserMov', new Schema({ userId: String, tag: String, startedAt: Date, endsAt: Date, status: String, result: String }));
const Goal = model('Goal', new Schema({ name: String, type: String, target: Number, reward: Number, enabled: Boolean }));

// ==========================================
// 4. MODELOS DE TICKETS / RECRUTAMENTO
// ==========================================
const UserStat = model('UserStat', new Schema({ userId: { type: String, unique: true }, points: { type: Number, default: 0 }, recruitments: { type: Number, default: 0 }, migrations: { type: Number, default: 0 }, shifts: { type: Number, default: 0 }, shiftSeconds: { type: Number, default: 0 }, updatedAt: Date }));
const Ticket = model('Ticket', new Schema({ number: Number, guildId: String, channelId: String, userId: String, type: String, presetId: String, status: String, claimedBy: String, openedAt: Date }));
const Recruitment = model('Recruitment', new Schema({ ticketId: ObjectId, guildId: String, recruiterId: String, recruitedId: String, type: String, points: Number, at: Date }));
const Shift = model('Shift', new Schema({ guildId: String, userId: String, startedAt: Date, endedAt: Date, status: String, durationSec: Number, points: Number }));
const LogEntry = model('LogEntry', new Schema({ at: Date, category: String, action: String, userId: String, data: Mixed }));
const AdminLog = model('AdminLog', new Schema({ at: Date, userId: String, action: String, label: String, path: String, value: String }));

// ==========================================
// 5. INICIALIZAÇÃO E EXPORTAÇÃO
// ==========================================
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
  await loadCfg();
  await ensureSeason();
}

module.exports = {
  DEFAULTS, clone, merge, getPath,
  Config, getCfg, setCfg, unsetCfg, loadCfg, initDb,
  Season, MemberStat, PointTx, VoiceSession, MovEvent, MovOccurrence, UserMov, Goal, getSeason, ensureSeason, resetSeasonCache,
  UserStat, Ticket, Recruitment, Shift, LogEntry, AdminLog
};
