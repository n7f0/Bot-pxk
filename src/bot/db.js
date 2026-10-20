const mongoose = require('mongoose');
const { Schema, model } = mongoose;
const { Mixed, ObjectId } = Schema.Types;

// utilidades
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
  voice: {
    channelIds: [],
    categoryIds: [],
    movChannelIds: [],
    movCategoryIds: [], // categorias válidas especificamente para MOV Call
    countMuted: true, // membro mutado continua acumulando?
    countDeafened: false, // membro ensurdecido continua acumulando?
    minSessionSec: 60, // tempo mínimo para validar uma sessão
    maxSessionHours: 6, // limite de duração de uma sessão
  },
  points: {
    perHour: 10, // cristais por hora válida
    rounding: 'floor', // floor | round | ceil | exact
    dailyCap: 0,
    unit: 'pontos',
  },
  mov: { points: 20, minMinutes: 10 }, // padrões para novos MOVs
  monitor: {
    durationMin: 5,
    minPresencePct: 80,
    requireAllCriteria: true,
    allowSelf: false,
    maxPerTargetPerDay: 0,
    maxPerMonitorPerDay: 0,
    types: [{ key: 'padrao', label: 'Monitoria padrão', bonus: 5 }],
    criteria: ['Permaneceu na call durante toda a monitoria', 'Participou da movimentação', 'Cumpriu as regras da call'],
  },
  ranking: {
    enabled: true,
    channelId: null,
    messageId: null,
    messageKind: null,
    auto: true,
    intervalMin: 1,
    topSize: 100,
    pageSize: 10, // posições por página
    sortBy: 'crystals', // crystals | hours | movs | monitor | goals
    style: 'v3',
    accentBar: false, // barra lateral colorida no formato v3
    title: 'Ranking de Pontos - Mov Call',
    color: '#2B2D31',
    banner: '',
    thumbnail: '',
    footer: 'Página {pagina}/{paginas} • {temporada} • atualizado automaticamente',
    showTimestamp: true,
    emptyText: 'Ninguém pontuou nesta temporada ainda.',
    lineTemplate:
      '{emoji} {usuario} - **{valor} {unidade}**\n-# {iconMov} MOVs concluídas: {mcfeitas} • {iconOk} Aprovadas: {mcaprov} • {iconBad} Reprovadas: {mcreprov}\n-# {iconTempo} Tempo em call: {horas} • {iconMon} Monitorias feitas: {monitorias}',
    legend: true,
  },
  seasons: { weeklyReset: true, weekday: 1, hour: 0, lastKey: '' }, // weekday: 0=dom ... 6=sáb
  appearance: {
    monitorTitle: 'Painel de Monitoria',
    monitorText:
      'Use o botão abaixo para monitorar um membro que está em uma call autorizada.\n' +
      'A monitoria dura **{duracao} minutos**. Ao final, avalie os critérios e conclua para conceder o bônus.',
  },
  movCall: {
    panelChannelId: null, // canal onde o painel público da MOV é publicado
    commandChannelId: null,
    durationMin: 30, // duração padrão da MOV
    minPresencePct: 80,
    leaveGraceSec: 300,
    pointsMin: 1, // limites da pontuação definida pelo monitor
    pointsMax: 20,
    pointsDefault: 5,
    allowDuplicateMonitoring: false,
    onLeave: 'review',
    requireMonitorInCall: true,
    autoPointsEnabled: true,
    autoPoints: 5,
    notifyEnabled: true,
    notifyDm: true,
    notifyChannel: false,
    notifyFallback: false,
    notifyChannelId: null, // vazio = canal do painel da MOV
    msgStart: '{emoji} Sua **MOV Call** foi iniciada! Duração: **{duracao} min** • termina {fim}. Permaneça na call.',
    msgLeave: '{emoji} Você saiu da call! Tem **{tolerancia}** para voltar. Se não voltar a tempo, a MOV será **cancelada**.',
    msgReturn: '{emoji} Você voltou para a call. A MOV continua normalmente.',
    msgCancel: '{emoji} Sua MOV foi **cancelada**: {motivo}.',
    msgFinish: '{emoji} Sua MOV foi **finalizada**! Presença: **{presenca}%**. {pontuacao}',
    msgFail: '{emoji} Sua MOV **não foi validada**: {motivo}.',
    msgAuto: '{emoji} Você recebeu **{pontos} {moeda}** pela sua MOV (sem monitor).',
    allowEarlyApproval: true,
    autoMoveMonitor: false,
    restartToleranceSec: 600,
    title: 'MOV CALL - UNION',
  },
  prefixes: { start: 'unionmov', lista: 'unionlista', cancel: 'unionmovcancel' },
  listaMov: {
    channelId: null,
    collectMode: 'all',
    launchRoleIds: [],
    requireStartButton: true,
    roleIds: [],
    staffRoleIds: [],
    durationMin: 60,
    minPresencePct: 80, // presença mínima para o botão "Pontuar"
    waitMin: 30,
    pointsDefault: 5, // pontuação sugerida nos formulários de pontuar
    pointsMax: 20, // limite de pontuação por pessoa
    notify: true, // DMs automáticas
    msgStart:
      '{emoji} Você está **participando da MOV**! Fique na call pública por **{duracao} min** (termina {fim}). Sua presença está sendo registrada.',
    msgEnd: '{emoji} Sua MOV terminou e foi **enviada para análise** da gestão. Presença registrada: **{presenca}%**.',
  },
  perms: { admin: [], leader: [], monitor: [], points: [], starter: [], selfMonitor: [], discordAdmin: true },
  logs: { geral: null, sessoes: null, movs: null, monitoria: null, pontos: null, admin: null, movcall: null },
  panels: { monitor: { channelId: null, messageId: null } },
  emojis: {},
};

// configuração em cache
const Config = model('Config', new Schema({ _id: String, data: Mixed }, { minimize: false }));
let cache = null;
async function loadCfg() {
  const doc = await Config.findById('cfg').lean();
  cache = merge(clone(DEFAULTS), doc?.data || {});
  return cache;
}
const getCfg = () => cache || merge(clone(DEFAULTS), {});
async function setCfg(path, value) {
  await Config.updateOne({ _id: 'cfg' }, { $set: { [`data.${path}`]: value } }, { upsert: true });
  await loadCfg();
}
async function unsetCfg(path) {
  await Config.updateOne({ _id: 'cfg' }, { $unset: { [`data.${path}`]: '' } }, { upsert: true });
  await loadCfg();
}

// coleções
const Season = model(
  'Season',
  new Schema({
    number: { type: Number, index: true },
    name: String,
    startsAt: { type: Date, default: Date.now },
    endsAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    status: { type: String, default: 'active', index: true },
    snapshot: [Mixed],
  }),
);

const MemberStat = model(
  'MemberStat',
  (() => {
    const s = new Schema(
      {
        userId: { type: String, required: true },
        tag: String,
        seasonId: { type: ObjectId, required: true },
        voiceSec: { type: Number, default: 0 },
        timePoints: { type: Number, default: 0 },
        movPoints: { type: Number, default: 0 },
        monitorPoints: { type: Number, default: 0 },
        goalPoints: { type: Number, default: 0 },
        manualPoints: { type: Number, default: 0 },
        crystals: { type: Number, default: 0 },
        movs: { type: Number, default: 0 },
        monitorsDone: { type: Number, default: 0 },
        goalsDone: { type: Number, default: 0 },
        mcDone: { type: Number, default: 0 },
        mcApproved: { type: Number, default: 0 }, // aprovadas na monitoria
        mcRejected: { type: Number, default: 0 }, // reprovadas na monitoria
        mcSec: { type: Number, default: 0 },
        monitoredCount: { type: Number, default: 0 }, // monitorias realizadas como monitor
      },
      { collection: 'memberStats' },
    );
    s.index({ userId: 1, seasonId: 1 }, { unique: true });
    s.index({ seasonId: 1, crystals: -1 });
    return s;
  })(),
);

const PointTx = model(
  'PointTx',
  (() => {
    const s = new Schema(
      {
        key: { type: String, required: true, unique: true }, // identificador único: impede recompensa duplicada
        userId: { type: String, required: true },
        tag: String,
        seasonId: ObjectId,
        category: { type: String, required: true }, // time | mov | monitor | goal | manual
        amount: { type: Number, default: 0 },
        seconds: { type: Number, default: 0 },
        reason: String,
        by: String,
        refId: Mixed,
        createdAt: { type: Date, default: Date.now },
      },
      { collection: 'pointTransactions' },
    );
    s.index({ userId: 1, createdAt: -1 });
    s.index({ category: 1, createdAt: -1 });
    s.index({ seasonId: 1, userId: 1 });
    return s;
  })(),
);

const VoiceSession = model(
  'VoiceSession',
  (() => {
    const s = new Schema(
      {
        userId: { type: String, required: true },
        tag: String,
        guildId: String,
        channelId: String,
        channelsVisited: [String],
        startedAt: { type: Date, default: Date.now },
        lastSeenAt: Date,
        countingSince: { type: Date, default: null }, // início do trecho que está contando agora
        validSec: { type: Number, default: 0 },
        paidSec: { type: Number, default: 0 }, // segundos válidos já convertidos em pontos
        paidPoints: { type: Number, default: 0 },
        points: { type: Number, default: 0 },
        totalSec: { type: Number, default: 0 },
        status: { type: String, default: 'active' }, // active | done | invalid
        endedAt: Date,
        endReason: String,
      },
      { collection: 'voiceSessions' },
    );
    // garante uma sessão ativa por membro
    s.index({ userId: 1 }, { unique: true, partialFilterExpression: { status: 'active' } });
    s.index({ userId: 1, startedAt: -1 });
    s.index({ status: 1 });
    return s;
  })(),
);

const MovEvent = model(
  'MovEvent',
  new Schema(
    {
      name: String,
      time: { type: String, default: '12:00' },
      days: { type: [Number], default: [] },
      durationMin: { type: Number, default: 60 },
      minMinutes: { type: Number, default: 10 },
      points: { type: Number, default: 20 },
      maxRewards: { type: Number, default: 0 },
      channelIds: { type: [String], default: [] },
      categoryIds: { type: [String], default: [] },
      enabled: { type: Boolean, default: true },
    },
    { collection: 'movEvents' },
  ),
);

const MovOccurrence = model(
  'MovOccurrence',
  (() => {
    const s = new Schema(
      {
        eventId: ObjectId,
        name: String,
        dateKey: String,
        startsAt: Date,
        endsAt: Date,
        status: { type: String, default: 'active' }, // active | done
        points: Number,
        minMinutes: Number,
        maxRewards: Number,
        channelIds: [String],
        categoryIds: [String],
        participants: { type: Number, default: 0 },
        rewarded: { type: Number, default: 0 },
      },
      { collection: 'movOccurrences' },
    );
    s.index({ eventId: 1, dateKey: 1 }, { unique: true });
    s.index({ status: 1, endsAt: 1 });
    return s;
  })(),
);

const MovParticipation = model(
  'MovParticipation',
  (() => {
    const s = new Schema(
      {
        occurrenceId: { type: ObjectId, required: true },
        userId: { type: String, required: true },
        tag: String,
        sec: { type: Number, default: 0 },
        lastSeenAt: Date,
        rewarded: { type: Boolean, default: false },
        reward: { type: Number, default: 0 },
      },
      { collection: 'movParticipations' },
    );
    s.index({ occurrenceId: 1, userId: 1 }, { unique: true });
    s.index({ userId: 1 });
    return s;
  })(),
);

const MonitorSession = model(
  'MonitorSession',
  (() => {
    const s = new Schema(
      {
        targetId: String,
        targetTag: String,
        byId: String,
        byTag: String,
        type: String,
        typeLabel: String,
        channelId: String,
        startedAt: Date,
        endsAt: Date,
        presentSec: { type: Number, default: 0 },
        lastSeenAt: Date,
        status: { type: String, default: 'active' },
        criteriaMet: [Number],
        criteriaSnapshot: [String],
        observation: String,
        bonus: { type: Number, default: 0 },
        finishedAt: Date,
        dayKey: String,
      },
      { collection: 'monitorSessions' },
    );
    s.index({ targetId: 1, status: 1 });
    s.index({ byId: 1, status: 1 });
    return s;
  })(),
);

const UserMov = model(
  'UserMov',
  (() => {
    const s = new Schema(
      {
        userId: { type: String, required: true },
        tag: String,
        seasonId: ObjectId,
        guildId: String, // servidor onde o comando foi usado
        voiceGuildId: String, // servidor da call
        channelId: String, // call atual
        channelName: String,
        startChannelId: String,
        startedAt: { type: Date, default: Date.now },
        endsAt: Date,
        durationMin: Number,
        presentSec: { type: Number, default: 0 },
        inCall: { type: Boolean, default: true }, // estava em call autorizada na última verificação
        lastSeenAt: Date,
        outSince: { type: Date, default: null },
        status: { type: String, default: 'active' }, // active | finished | failed | cancelled
        endReason: String,
        finishedAt: Date,
        panel: { guildId: String, channelId: String, messageId: String },
        result: { type: String, default: 'none' }, // none | approved | rejected | review | auto
        autoPoints: { type: Number, default: 0 },
        leaveNotified: { type: Boolean, default: false }, // aviso de saída da call já enviado
      },
      { collection: 'userMovs' },
    );
    s.index({ userId: 1 }, { unique: true, partialFilterExpression: { status: 'active' } }); // uma MOV ativa por membro
    s.index({ userId: 1, startedAt: -1 });
    s.index({ status: 1, endsAt: 1 });
    return s;
  })(),
);

const MovMonitoria = model(
  'MovMonitoria',
  (() => {
    const s = new Schema(
      {
        movId: { type: ObjectId, required: true },
        targetId: String,
        targetTag: String,
        byId: String,
        byTag: String,
        seasonId: ObjectId,
        channelId: String,
        startedAt: Date,
        endsAt: Date,
        presentSec: { type: Number, default: 0 }, // presença do monitorado na call autorizada
        monitorSec: { type: Number, default: 0 }, // presença do monitor na mesma call
        targetIn: { type: Boolean, default: true },
        monitorIn: { type: Boolean, default: true },
        targetOutSince: { type: Date, default: null },
        channelName: String,
        voiceGuildId: String,
        lastSeenAt: Date,
        leftCall: { type: Boolean, default: false },
        leftReason: String,
        status: { type: String, default: 'active' },
        criteriaMet: [Number],
        criteriaSnapshot: [String],
        observation: String,
        points: { type: Number, default: 0 },
        decidedBy: String,
        finishedAt: Date,
        dayKey: String,
      },
      { collection: 'movMonitorias' },
    );
    s.index({ movId: 1, status: 1 });
    s.index({ byId: 1, status: 1 });
    s.index({ targetId: 1, status: 1 });
    return s;
  })(),
);

const MovLista = model(
  'MovLista',
  (() => {
    const p = new Schema(
      {
        userId: String,
        tag: String,
        status: { type: String, default: 'waiting' },
        startedAt: Date, // quando entrou na call pública
        endsAt: Date,
        presentSec: { type: Number, default: 0 },
        lastSeenAt: Date,
        inCall: { type: Boolean, default: false },
        scored: { type: Boolean, default: false },
        points: { type: Number, default: 0 },
        scoredBy: String,
        dmWarned: { type: Boolean, default: false },
      },
      { _id: false },
    );
    const s = new Schema(
      {
        guildId: String,
        seasonId: ObjectId,
        startedById: String,
        startedByTag: String,
        sourceChannelId: String,
        sourceChannelName: String,
        createdAt: { type: Date, default: Date.now },
        durationMin: Number,
        minPresencePct: Number,
        waitMin: Number,
        released: { type: Boolean, default: true },
        releasedAt: Date,
        releasedById: String,
        collectMode: String,
        status: { type: String, default: 'active' },
        cancelledById: String,
        stoppedById: String,
        participants: [p],
        list: { channelId: String, messageId: String },
      },
      { collection: 'movListas' },
    );
    s.index({ status: 1 });
    s.index({ 'participants.userId': 1, status: 1 });
    return s;
  })(),
);

const Goal = model(
  'Goal',
  new Schema(
    {
      name: String,
      description: String,
      scope: { type: String, default: 'individual' }, // individual | collective
      period: { type: String, default: 'weekly' }, // daily | weekly | monthly | season
      type: { type: String, default: 'hours' }, // hours | movs | monitors | points
      target: Number,
      reward: { type: Number, default: 0 },
      maxCompletions: { type: Number, default: 0 },
      enabled: { type: Boolean, default: true },
    },
    { collection: 'goals' },
  ),
);

const GoalCompletion = model(
  'GoalCompletion',
  (() => {
    const s = new Schema(
      {
        key: { type: String, unique: true },
        goalId: ObjectId,
        userId: String,
        periodKey: String,
        reward: Number,
        createdAt: { type: Date, default: Date.now },
      },
      { collection: 'goalCompletions' },
    );
    s.index({ goalId: 1, userId: 1 });
    return s;
  })(),
);

const AuditLog = model(
  'AuditLog',
  new Schema(
    {
      by: String,
      byTag: String,
      action: String,
      target: String,
      detail: String,
      createdAt: { type: Date, default: Date.now, index: true },
    },
    { collection: 'auditLogs' },
  ),
);

// temporada atual
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
const resetSeasonCache = () => {
  seasonCache = null;
};

async function initDb() {
  await loadCfg();
  const models = [
    Season,
    MemberStat,
    PointTx,
    VoiceSession,
    MovEvent,
    MovOccurrence,
    MovParticipation,
    MonitorSession,
    UserMov,
    MovMonitoria,
    MovLista,
    Goal,
    GoalCompletion,
    AuditLog,
  ];
  for (const m of models) {
    try {
      await m.init();
    } catch (e) {
      console.warn(`[db] índice de ${m.modelName}: ${e.message}`);
    }
  }
  await ensureSeason();
}

module.exports = {
  DEFAULTS,
  clone,
  merge,
  getPath,
  getCfg,
  setCfg,
  unsetCfg,
  loadCfg,
  initDb,
  getSeason,
  ensureSeason,
  resetSeasonCache,
  Season,
  MemberStat,
  PointTx,
  VoiceSession,
  MovEvent,
  MovOccurrence,
  MovParticipation,
  MonitorSession,
  UserMov,
  MovMonitoria,
  MovLista,
  Goal,
  GoalCompletion,
  AuditLog,
};
