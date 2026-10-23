const mongoose = require('mongoose');
const { Schema, model } = mongoose;
const { setOverrides } = require('./emojis');

// ---------- utilidades ----------
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

// ---------- configuração padrão (tudo editável pelo /admin) ----------
const DEFAULT_DESCRIPTION = [
  'Gostou do servidor e quer se juntar à nossa staff?',
  'Clique no botão abaixo e preencha o formulário.',
  '',
  '**Áreas disponíveis:**',
  '',
  '*Mov Call / Eventos / Design / Jornalismo / Games*',
  '',
  '**Importante:**',
  '',
  '• *Necessário ter mais de 15 anos;*',
  '• *Necessário deixar seu privado aberto;*',
  '• *Necessário ter comprometimento pela área que você escolher.*',
].join('\n');

const DEFAULT_QUESTIONS = {
  staff: [
    { label: 'Qual a sua idade?', placeholder: 'Ex: 17', long: false, required: true },
    { label: 'Área (Mov/Eventos/Design/Jornal/Games)', placeholder: 'Ex: Mov Call', long: false, required: true },
    { label: 'Por que quer se juntar à staff?', placeholder: 'Explique o motivo de querer se juntar a nós...', long: true, required: true },
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
  tickets: {
    style: 'V1', // V1 = embed única • V2 = embeds em blocos (descrições 1 a 4) • V3 = container de bordas finas (Componentes V2)
    categoryId: null,
    useThread: false, // false = ticket em canal (categoria) • true = ticket em tópico privado (sem perguntar ao candidato)
    threadChannelId: null, // canal de texto onde os tópicos dos tickets são criados (modo thread)
    panelChannelId: null,
    panelMessageId: null,
    panelKind: null, // 'embed' | 'v3' (tipo da mensagem publicada)
    accessRoleIds: [], // cargos que enxergam os tickets
    assignableRoleIds: [], // cargos que o recrutador pode setar (Mov Call, Mov Chat...)
    hierarchyRoleIds: [], // cargos de hierarquia pré-definidos (ticket de MIGRAÇÃO: o migrador seta área + hierarquia)
    hierarchyMax: 1, // quantos cargos de hierarquia podem ser setados por migração
    inicianteRoleId: null, // legado (migrado automaticamente para inicianteRoleIds)
    inicianteRoleIds: [], // cargos iniciais (Promessa, Staff cargo inicial...) dados junto ao setar cargos
    nameTemplate: '{tipo}-{usuario}',
    requireShiftToClaim: false,
    panel: {
      title: 'União — Seja Staff',
      desc1: DEFAULT_DESCRIPTION,
      desc2: '',
      desc3: '',
      desc4: '',
      color: '#D4AF37',
      banner: '',
      thumbnail: '',
      footer: '',
      labelStaff: 'Quero ser staff',
      labelMig: 'Quero ser migrado',
      // ---- V3 ----
      // No V3 o painel usa SEMPRE o menu de seleção (as opções abaixo)
      v3Accent: false, // false = só a borda fina; true = barra colorida com a cor do painel
      selectPlaceholder: 'Selecione uma opção...',
      optLabelStaff: 'Recrutamento',
      optLabelMig: 'Migração',
      optDescStaff: 'Para ser recrutado.',
      optDescMig: 'Para ser migrado.',
    },
    messages: {
      open: 'Olá {usuario}! Sua candidatura de **{tipo}** foi recebida. Aguarde um recrutador assumir o atendimento.\n<a:05:1478416934319161365>',
      claim: '✅ {recrutador} assumiu o atendimento de {usuario}.',
      finish: '🎉 {usuario} foi recrutado(a) por {recrutador}!\n**Cargos:** {cargos}',
      reject: '❌ A candidatura de {usuario} foi reprovada por {recrutador}.',
      close: '🔒 Este ticket será fechado em 5 segundos...',
    },
    questions: clone(DEFAULT_QUESTIONS),
  },
  points: { recruitment: 20, migration: 20, shiftFlat: 0, shiftPerHour: 0, reject: 0 },
  shift: {
    enabled: true,
    plannedMinutes: 60,
    minMinutes: 10,
    maxHours: 12,
    requireVoice: false,
    allowedChannelIds: [],
    rules: 'Fique disponível durante todo o plantão e atenda os tickets abertos.',
    panelChannelId: null,
    panelMessageId: null,
    // ---- Plantão em call (acontece no servidor PRINCIPAL; painel, logs e aprovação no INTERNO) ----
    categoryName: null, // só para exibição no /admin
    categoryId: null, // ID da categoria (do servidor principal) cujas calls valem para o plantão
    returnMinutes: 5, // tempo para voltar à call depois de sair; passou disso, o plantão é cancelado
    messages: {
      start: 'Olá {usuario}! Seu plantão foi **iniciado** na call **{call}**.\nPermaneça na call por **{minutos} minutos** para concluir. Previsão de término: {fim}.\nSe sair, você tem **{tolerancia} minutos** para voltar.',
      leave: '⚠️ {usuario}, você saiu da call do plantão!\nVolte para uma call do plantão em até **{tolerancia} minutos** ou ele será **cancelado**. Limite: {limite}.',
      cancel: '❌ {usuario}, seu plantão foi **cancelado**.\n**Motivo:** {motivo}',
      incomplete: '⚠️ {usuario}, você não voltou para a call a tempo.\nSeu plantão foi encerrado com **{tempo}** na call e enviado para a análise da liderança.',
      done: '✅ {usuario}, você completou **{minutos} minutos** de plantão!\nSeu plantão foi enviado para a análise da liderança. Você receberá o resultado por aqui.',
    },
  },
  ranking: {
    enabled: true, channelId: null, messageId: null, messageKind: null, auto: true, intervalMin: 10, topSize: 15,
    view: {
      style: 'embed', // 'embed' (clássico) | 'v3' (container de bordas finas)
      title: 'Ranking de Recrutamento',
      color: '#2B2D31',
      banner: '',
      thumbnail: '',
      footer: 'Top {top} • atualizado automaticamente',
      showTimestamp: true,
      v3Accent: false,
      sortBy: 'points', // points | recruitments | shifts | time
      unit: 'pontos',
      emptyText: 'Nenhum recrutador pontuou ainda.',
      lineTemplate: '{emoji} {usuario} — **{pontos}** {unidade}',
      description: '', // texto opcional acima da lista
      podiumCount: 0, // quantos primeiros usam o modelo de pódio (0 = desligado)
      podiumTemplate: '', // modelo das linhas do pódio (vazio = usa o modelo normal)
      totalsTemplate: '', // linha de totais abaixo da lista (vazio = não mostra)
      spacing: 'auto', // auto | compact | airy (espaço entre as posições)
    },
  },
  voice: { main: null, internal: null }, // call em que o bot fica conectado em cada servidor
  logs: {
    main: { geral: null, tickets: null, recrutamento: null },
    internal: { geral: null, tickets: null, recrutamento: null, plantao: null, admin: null },
  },
  perms: {
    main: { admin: [], leader: [], recruiter: [], migrator: [] }, // migrator = cargos habilitados para migração
    internal: { admin: [], leader: [], recruiter: [], shift: [] },
  },
  emojis: {}, // só as trocas feitas em /admin → Emojis e ícones (chave → emoji)
  presets: {}, // sistemas de tickets extras criados em /admin → Tickets → Presets (id → preset)
};


// ---------- presets de tickets ----------
// Cada preset é um sistema de tickets completo e independente (painel, canal, categoria/tópico,
// formulário, mensagens, cargos...). Internamente ele reaproveita a mesma estrutura do recrutamento.
const PRESET_DESCRIPTION = [
  'Clique no botão abaixo para abrir um ticket.',
  '',
  'Um membro da equipe irá atender você o mais rápido possível.',
  'Abra o ticket apenas se realmente precisar e aguarde o atendimento.',
].join('\n');

function presetDefaults(name = 'Novo preset') {
  return {
    name,
    recruitMode: false, // true = igual ao recrutamento: atendente seta cargos, reprova e pontua no ranking
    points: null, // pontos por ticket concluído no modo recrutamento (null = usa o valor de /admin → Pontuação)
    handlerRoleIds: [], // quem atende este preset (vazio = usa "Cargos com acesso aos tickets")
    logChannelId: null, // canal de logs só deste preset (vazio = logs padrão de tickets)
    tickets: {
      style: 'V1',
      categoryId: null,
      useThread: false,
      threadChannelId: null,
      panelChannelId: null,
      panelMessageId: null,
      panelKind: null,
      accessRoleIds: [],
      assignableRoleIds: [],
      hierarchyRoleIds: [],
      hierarchyMax: 1,
      inicianteRoleIds: [],
      nameTemplate: '{tipo}-{usuario}',
      requireShiftToClaim: false,
      panel: {
        title: name,
        desc1: PRESET_DESCRIPTION,
        desc2: '', desc3: '', desc4: '',
        color: '#D4AF37',
        banner: '',
        thumbnail: '',
        footer: '',
        labelStaff: 'Abrir ticket',
        labelMig: '',
        v3Accent: false,
        selectPlaceholder: 'Selecione uma opção...',
        optLabelStaff: name,
        optLabelMig: '',
        optDescStaff: 'Clique para abrir um ticket.',
        optDescMig: '',
      },
      messages: {
        open: 'Olá {usuario}! Seu ticket de **{tipo}** foi aberto. Aguarde um atendente assumir.',
        claim: '✅ {recrutador} assumiu o atendimento de {usuario}.',
        finish: '🎉 Atendimento de {usuario} concluído por {recrutador}!\n**Cargos:** {cargos}',
        reject: '❌ O pedido de {usuario} foi reprovado por {recrutador}.',
        close: '🔒 Este ticket será fechado em 5 segundos...',
      },
      questions: {
        staff: [{ label: 'Qual o motivo do ticket?', placeholder: 'Explique com detalhes...', long: true, required: true }],
        migracao: [],
      },
    },
  };
}

// Devolve uma cópia da configuração em que "tickets", pontos, permissões e logs são os do preset.
// Assim todo o código dos tickets (que lê cfg.tickets...) funciona igual para o recrutamento e para cada preset.
// presetId vazio = recrutamento original (cfg sem alteração).
function viewCfg(cfg, presetId) {
  if (!presetId) return cfg;
  const saved = cfg.presets?.[presetId];
  const p = merge(presetDefaults(saved?.name || 'Ticket'), clone(saved || {}));
  const handlers = p.handlerRoleIds?.length ? p.handlerRoleIds : p.tickets.accessRoleIds;
  const logId = p.logChannelId;
  const pts = p.points ?? cfg.points.recruitment;
  return {
    ...cfg,
    tickets: p.tickets,
    points: { ...cfg.points, recruitment: pts, migration: pts },
    perms: { ...cfg.perms, main: { ...cfg.perms.main, recruiter: handlers, migrator: handlers } },
    logs: logId ? { ...cfg.logs, main: { ...cfg.logs.main, geral: logId, tickets: logId, recrutamento: logId } } : cfg.logs,
    _preset: { id: presetId, name: p.name, recruitMode: !!p.recruitMode, deleted: !saved },
  };
}

// ---------- modelos ----------
const Config = model(
  'RecruitmentConfig',
  new Schema({ key: { type: String, unique: true }, data: Schema.Types.Mixed }, { minimize: false })
);

const UserStat = model(
  'UserStat',
  new Schema({
    userId: { type: String, unique: true },
    name: String,
    points: { type: Number, default: 0 },
    recruitments: { type: Number, default: 0 }, // total (staff + migração)
    migrations: { type: Number, default: 0 }, // só migrações
    shifts: { type: Number, default: 0 },
    shiftSeconds: { type: Number, default: 0 },
    // ajustes manuais (/ajustar): diferença entre o valor definido e o histórico; a reconciliação respeita isso
    adjStaff: { type: Number, default: 0 },
    adjMig: { type: Number, default: 0 },
    adjShifts: { type: Number, default: 0 },
    updatedAt: Date,
  })
);

const TicketSchema = new Schema({
  number: Number,
  guildId: String,
  channelId: { type: String, index: true },
  channelName: String,
  messageId: String,
  userId: String,
  userTag: String,
  type: String, // staff | migracao
  presetId: { type: String, default: null }, // null = recrutamento original • id = preset de tickets
  presetName: String,
  answers: [{ _id: false, q: String, a: String }],
  openedAt: { type: Date, default: Date.now },
  claimedBy: { type: String, default: null },
  claimedAt: Date,
  status: { type: String, default: 'open' }, // open | closed
  result: { type: String, default: null }, // aprovado | reprovado | cancelado
  rolesGiven: [String],
  finalizedAt: Date,
  closedAt: Date,
  closedBy: String,
  history: [{ _id: false, at: { type: Date, default: Date.now }, by: String, action: String, detail: String }],
});
// Impede dois tickets abertos para a mesma pessoa (anti-duplicidade)
// (uma pessoa pode ter 1 ticket aberto em cada preset, mas não 2 no mesmo)
TicketSchema.index({ userId: 1, presetId: 1 }, { unique: true, partialFilterExpression: { status: 'open' } });
const Ticket = model('Ticket', TicketSchema);

const Recruitment = model(
  'Recruitment',
  new Schema({
    ticketId: { type: Schema.Types.ObjectId, unique: true }, // 1 recrutamento por ticket (anti-duplicidade)
    guildId: String,
    recruiterId: String,
    recruitedId: String,
    type: String,
    roles: [String],
    points: Number,
    shiftId: Schema.Types.ObjectId,
    at: { type: Date, default: Date.now },
  })
);

const ShiftSchema = new Schema({
  guildId: String,
  userId: String,
  userTag: String,
  startedAt: { type: Date, default: Date.now },
  plannedEnd: Date,
  endedAt: Date,
  // active = em andamento • pending = concluído, aguardando a liderança • approved | rejected • cancelled
  // ('done' = plantões do modelo antigo, mantidos no histórico)
  status: { type: String, default: 'active' },
  voiceChannelId: String,
  voiceName: String,
  // ---- acompanhamento da call (servidor principal) ----
  presence: { type: String, default: 'in' }, // in = na call do plantão • away = fora, contando a tolerância
  inSince: Date, // início do trecho atual dentro da call
  awayAt: Date, // quando saiu da call
  inSec: { type: Number, default: 0 }, // segundos acumulados dentro da call
  muteSince: Date, // início do trecho atual mutado
  mutedSec: { type: Number, default: 0 }, // segundos acumulados mutado
  awayCount: { type: Number, default: 0 }, // quantas vezes saiu da call
  dmFailed: { type: Boolean, default: false },
  // ---- resultado ----
  durationSec: Number, // tempo total na call
  counted: Boolean,
  points: { type: Number, default: 0 },
  recruitments: { type: Number, default: 0 },
  attendances: { type: Number, default: 0 }, // tickets atendidos durante o plantão
  finalizedBy: String,
  cancelReason: String,
  reviewChannelId: String,
  reviewMessageId: String,
  reviewedBy: String,
  reviewedAt: Date,
  reviewNote: String,
  endReason: String, // preenchido quando foi enviado para análise sem completar o tempo
});
// Impede dois plantões simultâneos da mesma pessoa
ShiftSchema.index({ userId: 1 }, { unique: true, partialFilterExpression: { status: 'active' } });
const Shift = model('Shift', ShiftSchema);

const LogEntry = model(
  'LogEntry',
  new Schema({
    at: { type: Date, default: Date.now },
    category: String,
    action: String,
    userId: String,
    data: Schema.Types.Mixed,
  })
);

const Counter = model('Counter', new Schema({ _id: String, n: { type: Number, default: 0 } }));

// ---------- auditoria do painel /admin ----------
const AdminLog = model(
  'AdminLog',
  new Schema({
    at: { type: Date, default: Date.now, index: true },
    userId: String,
    userTag: String,
    guildId: String,
    action: String, // config | publicacao | manutencao | destrutiva
    label: String,
    path: String,
    value: String,
  })
);

// ---------- acesso à configuração ----------
// Cache em memória: cfgNow() é síncrono e sempre reflete o último getCfg()/setCfg()
let cfgCache = null;
const cfgNow = () => cfgCache ?? merge(clone(DEFAULTS), {});

async function getCfg() {
  const doc = await Config.findOne({ key: 'main' }).lean();
  const cfg = merge(clone(DEFAULTS), doc?.data ?? {});
  // compatibilidade: configuração antiga com "modo" único (channel/thread)
  const saved = doc?.data?.tickets;
  if (saved?.mode === 'thread' && saved.useThread === undefined) cfg.tickets.useThread = true;
  // compatibilidade: configuração antiga com um único cargo inicial
  if (!cfg.tickets.inicianteRoleIds?.length && cfg.tickets.inicianteRoleId) {
    cfg.tickets.inicianteRoleIds = [cfg.tickets.inicianteRoleId];
  }
  for (const [id, p] of Object.entries(cfg.presets || {})) cfg.presets[id] = merge(presetDefaults(p?.name), clone(p || {}));
  setOverrides(cfg.emojis); // mantém os emojis atualizados em todo o bot
  cfgCache = cfg;
  return cfg;
}
async function setCfg(path, value) {
  await Config.updateOne({ key: 'main' }, { $set: { [`data.${path}`]: value } }, { upsert: true });
  await getCfg(); // recarrega o cache
}

async function delCfg(path) {
  await Config.updateOne({ key: 'main' }, { $unset: { [`data.${path}`]: '' } });
  await getCfg(); // recarrega o cache
}

async function initDb() {
  // o índice antigo permitia só 1 ticket aberto por pessoa no total; o novo é por preset
  await Ticket.collection.dropIndex('userId_1').catch(() => {});
  await Promise.all(
    [Config, UserStat, Ticket, Recruitment, Shift].map((m) =>
      m.init().catch((e) => console.error(`[db] índice de ${m.modelName}:`, e.message))
    )
  );
  // índices extras: ranking, reconciliação e consultas de plantão ficam rápidos mesmo com histórico grande
  await Promise.all(
    [
      UserStat.collection.createIndex({ points: -1 }),
      Recruitment.collection.createIndex({ recruiterId: 1, at: -1 }),
      Recruitment.collection.createIndex({ at: -1 }),
      Shift.collection.createIndex({ status: 1, userId: 1 }),
    ].map((p) => p.catch((e) => console.error('[db] índice extra:', e.message)))
  );
  await getCfg(); // carrega os emojis personalizados já na inicialização
}

module.exports = {
  DEFAULTS, DEFAULT_QUESTIONS, clone, getPath,
  Config, UserStat, Ticket, Recruitment, Shift, LogEntry, Counter, AdminLog,
  getCfg, cfgNow, setCfg, delCfg, initDb, presetDefaults, viewCfg,
};
