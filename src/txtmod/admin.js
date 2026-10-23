// ============================================================
// /admin — painel administrativo em Components V2
// ------------------------------------------------------------
// • Telas declarativas: cada tela é { título, descrição, campos } e os campos
//   (T, N, B, EN, CH, CHS, RL, L) guardam o tipo e o caminho da configuração.
// • Telas especiais: Publicações, Manutenção, Reconciliação e Últimas ações.
// • Toda alteração é gravada na auditoria (AdminLog) e enviada ao canal de logs.
// • O painel clássico (embeds) continua disponível em /admin-classico.
// customIds: txadm:home | txadm:s:<tela> | txadm:pg:<tela>:<página> | txadm:t:<tela>:<campo>
//            txadm:e:<tela>:<campo> | txadm:m:<tela>:<campo> | txadm:o:<tela>:<campo>:<opção>
//            txadm:c:<tela>:<campo> (menu) | txadm:x:<tela>:<campo> (limpar)
//            txadm:p:<pub> | txadm:pc:<pub> | txadm:ps:<pub> | txadm:mt:<ação> | txadm:d:<ação> | txadm:dc:<ação>
// ============================================================
const {
  ActionRowBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  RoleSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { cfgNow, setCfg, getPath, AdminLog, UserStat, Recruitment, Shift, Ticket, LogEntry } = require('./db');
const { COLORS, SERVER_NAMES, guildKey, guildIdOf, perms, emit, trunc } = require('./core');
const { Panel, btn } = require('./adminUi');
const { help } = require('./adminHelp');
const { buildShiftPanel } = require('./plantao');
const { publishPanel } = require('./tickets');
const { refreshRanking, SORTS, SPACING_LABEL } = require('./ranking');
const voz = require('./voz');

const PER_PAGE = 6;
const EPHEMERAL = MessageFlags.Ephemeral;
const TEXT_CH = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
const VOICE_CH = [ChannelType.GuildVoice, ChannelType.GuildStageVoice];

// ============================================================
// Campos (funções auxiliares): guardam o tipo e o caminho da configuração
// "{g}" no caminho vira o servidor atual (main | internal)
// opções: guild (só aparece nesse servidor), optional, long, kind (color|url|snowflake),
//         check(valor, ctx) → texto de erro, after(ctx, valor), ph (exemplo no modal)
// ============================================================
const mk = (type, path, label, o = {}) => ({
  type, path, label, id: path.replace(/[{}]/g, '').replace(/\./g, '_'), ...o,
});
const T = (path, label, o = {}) => mk('text', path, label, { max: 100, ...o });
const N = (path, label, min, max, o = {}) => mk('num', path, label, { min, max, ...o });
const B = (path, label, o = {}) => mk('bool', path, label, o);
const EN = (path, label, options, o = {}) => mk('enum', path, label, { options, ...o });
const CH = (path, label, types, o = {}) => mk('chan', path, label, { types, ...o });
const CHS = (path, label, types, o = {}) => mk('chans', path, label, { types, ...o });
const RL = (path, label, o = {}) => mk('roles', path, label, o);
const L = (path, label, o = {}) => mk('lines', path, label, { min: 1, ...o });

// ---------- perguntas dos formulários: "Pergunta | exemplo | longa? | obrigatória?" ----------
const yes = (s, def) => (s === undefined || s === '' ? def : /^(s|sim|true|1|longa|obrigat)/i.test(s));
const questionsToStr = (arr) =>
  (arr || []).map((q) => `${q.label} | ${q.placeholder || ''} | ${q.long ? 'sim' : 'não'} | ${q.required === false ? 'não' : 'sim'}`).join('\n');
function questionsFromStr(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) throw new Error('Informe pelo menos 1 pergunta.');
  if (lines.length > 5) throw new Error('O formulário aceita no máximo 5 perguntas (limite do Discord).');
  return lines.map((l, n) => {
    const [label = '', placeholder = '', long, required] = l.split('|').map((s) => s.trim());
    if (!label) throw new Error(`Linha ${n + 1}: a pergunta não pode ficar vazia.`);
    if (label.length > 45) throw new Error(`Linha ${n + 1}: a pergunta tem ${label.length} caracteres (máximo 45).`);
    if (placeholder.length > 100) throw new Error(`Linha ${n + 1}: o exemplo passa de 100 caracteres.`);
    return { label, placeholder, long: yes(long, false), required: yes(required, true) };
  });
}
const questionField = (key, label) =>
  L(`tickets.questions.${key}`, label, {
    guild: 'main',
    toStr: questionsToStr,
    fromStr: questionsFromStr,
    ph: 'Qual a sua idade? | Ex: 17 | não | sim',
  });

// ---------- validações entre campos ----------
const cfgNum = (path) => Number(getPath(cfgNow(), path));
const checkPlanned = (v) => {
  if (v < cfgNum('shift.minMinutes')) return `A duração prevista (${v} min) não pode ser menor que o tempo mínimo (${cfgNum('shift.minMinutes')} min).`;
  if (v > cfgNum('shift.maxHours') * 60) return `A duração prevista (${v} min) não pode passar do limite de ${cfgNum('shift.maxHours')} h do plantão.`;
  return null;
};
const checkMin = (v) => (v > cfgNum('shift.plannedMinutes') ? `O tempo mínimo (${v} min) não pode ser maior que a duração prevista (${cfgNum('shift.plannedMinutes')} min).` : null);
const checkMaxH = (v) => (v * 60 < cfgNum('shift.plannedMinutes') ? `O limite (${v} h) não pode ser menor que a duração prevista (${cfgNum('shift.plannedMinutes')} min).` : null);

// categoria das calls de plantão: ID de uma categoria do servidor PRINCIPAL
async function checkShiftCategory(v, ctx) {
  if (!v) return null;
  const main = ctx.client.guilds.cache.get(guildIdOf('main'));
  const cat = main ? await main.channels.fetch(v).catch(() => null) : null;
  if (!cat) return 'Não encontrei esse ID no servidor principal. Confira o ID e se o bot está lá.';
  if (cat.type !== ChannelType.GuildCategory) return `Esse ID é de **${cat.name}**, que não é uma categoria.`;
  return null;
}
async function afterShiftCategory(ctx, v) {
  const main = ctx.client.guilds.cache.get(guildIdOf('main'));
  const cat = v && main ? await main.channels.fetch(v).catch(() => null) : null;
  await setCfg('shift.categoryName', cat?.name ?? null);
}

const refreshRank = (ctx) => refreshRanking(ctx.client, { manual: true }).catch((e) => console.error('[admin:ranking]', e.message));
const rv = { guild: 'internal', after: refreshRank }; // campos do visual do ranking: atualizam a mensagem fixa

// ============================================================
// Telas declarativas
// ============================================================
const SCREENS = {
  canais: {
    emoji: '📡', name: 'Canais', short: 'logs, call do bot, categoria dos tickets e plantão',
    desc: (ctx) => `Configurando o **${SERVER_NAMES[ctx.gk]}**. Escolha onde o bot envia logs, cria tickets e fica na call.`,
    fields: [
      CH('logs.{g}.geral', 'Logs gerais', TEXT_CH),
      CH('logs.{g}.tickets', 'Logs de tickets', TEXT_CH),
      CH('logs.{g}.recrutamento', 'Logs de recrutamento', TEXT_CH),
      CH('logs.internal.plantao', 'Logs de plantão', TEXT_CH, { guild: 'internal' }),
      CH('logs.internal.admin', 'Logs do painel admin', TEXT_CH, { guild: 'internal' }),
      CH('voice.{g}', 'Call do bot', VOICE_CH, { after: (ctx) => voz.ensure(ctx.client, ctx.i.guildId) }),
      CH('tickets.categoryId', 'Categoria dos tickets', [ChannelType.GuildCategory], { guild: 'main' }),
      CH('tickets.threadChannelId', 'Canal dos tópicos', TEXT_CH, { guild: 'main' }),
      T('shift.categoryId', 'Categoria das calls de plantão', {
        guild: 'internal', max: 25, optional: true, nullable: true, kind: 'snowflake',
        ph: 'ID da categoria do servidor principal. Vazio = remover', check: checkShiftCategory, after: afterShiftCategory,
      }),
      CHS('shift.allowedChannelIds', 'Canais do botão de plantão', TEXT_CH, { guild: 'internal' }),
    ],
  },
  perms: {
    emoji: '🔐', name: 'Permissões', short: 'cargos de admin, liderança, recrutadores e migradores',
    desc: (ctx) => `Cargos do **${SERVER_NAMES[ctx.gk]}**. As permissões são por servidor: rode \`/admin\` no outro para configurar lá.`,
    fields: [
      RL('perms.{g}.admin', 'Cargos de administrador'),
      RL('perms.{g}.leader', 'Cargos de liderança'),
      RL('perms.{g}.recruiter', 'Cargos de recrutador'),
      RL('perms.main.migrator', 'Cargos de migração', { guild: 'main' }),
      RL('perms.internal.shift', 'Quem inicia plantão', { guild: 'internal' }),
    ],
  },
  tickets: {
    emoji: '🎫', name: 'Tickets', short: 'modelo, tópicos, nome, cargos e hierarquia',
    desc: 'Funcionamento dos tickets de recrutamento e migração (servidor principal). Depois de mudar o modelo, republique o painel em **Publicações**.',
    fields: [
      EN('tickets.style', 'Modelo do painel', [
        { value: 'V1', label: 'V1 — embed única' }, { value: 'V2', label: 'V2 — embeds em blocos' }, { value: 'V3', label: 'V3 — container de bordas finas' },
      ], { guild: 'main' }),
      B('tickets.useThread', 'Ticket em tópico', { guild: 'main' }),
      B('tickets.requireShiftToClaim', 'Exigir plantão para assumir', { guild: 'main' }),
      T('tickets.nameTemplate', 'Nome dos tickets', { guild: 'main', max: 80, ph: '{tipo}-{usuario}' }),
      RL('tickets.accessRoleIds', 'Cargos com acesso', { guild: 'main' }),
      RL('tickets.assignableRoleIds', 'Cargos atribuíveis', { guild: 'main' }),
      RL('tickets.hierarchyRoleIds', 'Cargos de hierarquia', { guild: 'main' }),
      N('tickets.hierarchyMax', 'Máx. de hierarquias', 1, 10, { guild: 'main' }),
      RL('tickets.inicianteRoleIds', 'Cargos iniciais', { guild: 'main' }),
    ],
  },
  forms: {
    emoji: '📝', name: 'Formulários', short: 'perguntas de staff e de migração',
    desc: 'Perguntas que o candidato responde ao abrir o ticket. Uma por linha, de 1 a 5: `Pergunta | exemplo | longa? | obrigatória?`',
    fields: [questionField('staff', 'Perguntas de staff'), questionField('migracao', 'Perguntas de migração')],
  },
  msgs: {
    emoji: '💬', name: 'Mensagens', short: 'textos dos tickets e DMs do plantão',
    desc: (ctx) => (ctx.gk === 'main' ? 'Mensagens enviadas dentro dos tickets.' : 'Mensagens enviadas no privado durante o plantão.'),
    fields: [
      ...['open', 'claim', 'finish', 'reject', 'close'].map((k) =>
        T(`tickets.messages.${k}`, `Ticket: ${{ open: 'abertura', claim: 'assumir', finish: 'finalizar', reject: 'reprovar', close: 'fechar' }[k]}`, { guild: 'main', long: true, max: 1000 })),
      ...['start', 'leave', 'cancel', 'incomplete', 'done'].map((k) =>
        T(`shift.messages.${k}`, `DM: ${{ start: 'início', leave: 'saiu da call', cancel: 'cancelado', incomplete: 'incompleto', done: 'concluído' }[k]}`, { guild: 'internal', long: true, max: 1000 })),
    ],
  },
  pontos: {
    emoji: '💎', name: 'Pontuação', short: 'pontos por recrutamento, migração e plantão',
    desc: 'Quantos pontos cada ação vale. Vale para novos registros; o histórico não muda.',
    fields: [
      N('points.recruitment', 'Pontos por recrutamento', 0, 1000000),
      N('points.migration', 'Pontos por migração', 0, 1000000),
      N('points.shiftFlat', 'Pontos fixos por plantão', 0, 1000000),
      N('points.shiftPerHour', 'Pontos por hora de plantão', 0, 1000000),
      N('points.reject', 'Pontos por reprovação', 0, 1000000),
    ],
  },
  plantao: {
    emoji: '🕐', name: 'Plantão', short: 'duração, tolerância e regras do plantão em call',
    desc: 'Regras do plantão (servidor interno). As calls válidas e os canais ficam em **Canais**.',
    fields: [
      B('shift.enabled', 'Plantão ativo', { guild: 'internal' }),
      B('shift.requireVoice', 'Exigir call para iniciar', { guild: 'internal' }),
      N('shift.plannedMinutes', 'Duração prevista (min)', 1, 1440, { guild: 'internal', check: checkPlanned }),
      N('shift.minMinutes', 'Tempo mínimo (min)', 0, 1440, { guild: 'internal', check: checkMin }),
      N('shift.returnMinutes', 'Tolerância ao sair (min)', 1, 60, { guild: 'internal' }),
      N('shift.maxHours', 'Limite do plantão (h)', 1, 72, { guild: 'internal', check: checkMaxH }),
      T('shift.rules', 'Regras do plantão', { guild: 'internal', long: true, max: 1000, optional: true }),
    ],
  },
  ranking: {
    emoji: '🏆', name: 'Ranking', short: 'canal, atualização automática e tamanho do top',
    desc: 'Comportamento do ranking de recrutamento (servidor interno).',
    fields: [
      B('ranking.enabled', 'Ranking ativo', { guild: 'internal', after: refreshRank }),
      B('ranking.auto', 'Atualização automática', { guild: 'internal' }),
      N('ranking.topSize', 'Tamanho do top', 5, 25, { guild: 'internal', after: refreshRank }),
      N('ranking.intervalMin', 'Atualizar a cada (min)', 1, 1440, { guild: 'internal' }),
      CH('ranking.channelId', 'Canal do ranking', TEXT_CH, {
        guild: 'internal',
        after: async (ctx, v) => {
          await setCfg('ranking.messageId', null);
          await setCfg('ranking.messageKind', null);
          if (v) await refreshRanking(ctx.client, { manual: true });
        },
      }),
      EN('ranking.view.sortBy', 'Ordenar por', Object.entries(SORTS).map(([value, s]) => ({ value, label: s.label })), rv),
    ],
  },
  rankvis: {
    emoji: '🖼️', name: 'Ranking visual', short: 'título, cores, imagens e modelo das linhas',
    desc: 'Aparência do ranking. A mensagem publicada é atualizada ao salvar.',
    fields: [
      EN('ranking.view.style', 'Estilo', [{ value: 'embed', label: 'Embed clássica' }, { value: 'v3', label: 'V3 — container de bordas finas' }], rv),
      T('ranking.view.title', 'Título', { ...rv, max: 100 }),
      T('ranking.view.color', 'Cor (HEX)', { ...rv, max: 7, kind: 'color', ph: '#2B2D31' }),
      T('ranking.view.unit', 'Nome da pontuação', { ...rv, max: 20 }),
      T('ranking.view.banner', 'Banner (URL)', { ...rv, max: 500, optional: true, kind: 'url' }),
      T('ranking.view.thumbnail', 'Miniatura (URL)', { ...rv, max: 500, optional: true, kind: 'url' }),
      T('ranking.view.footer', 'Rodapé', { ...rv, max: 200, optional: true }),
      T('ranking.view.lineTemplate', 'Modelo da linha', { ...rv, max: 500, long: true, ph: '{emoji} {usuario} — {pontos} {unidade}' }),
      T('ranking.view.emptyText', 'Texto sem pontuação', { ...rv, max: 200 }),
      T('ranking.view.description', 'Texto acima da lista', { ...rv, max: 400, long: true, optional: true }),
      N('ranking.view.podiumCount', 'Quantos no pódio', 0, 10, rv),
      T('ranking.view.podiumTemplate', 'Modelo do pódio', { ...rv, max: 500, long: true, optional: true, ph: '{emoji} {usuario} — {pontos} {unidade}' }),
      T('ranking.view.totalsTemplate', 'Linha de totais', { ...rv, max: 400, long: true, optional: true, ph: '{membros} recrutadores • {totalPontos} {unidade}' }),
      EN('ranking.view.spacing', 'Espaço entre posições', Object.entries(SPACING_LABEL).map(([value, label]) => ({ value, label })), rv),
      B('ranking.view.showTimestamp', 'Mostrar data', rv),
      B('ranking.view.v3Accent', 'Barra colorida (V3)', rv),
    ],
  },
  aparencia: {
    emoji: '🎨', name: 'Aparência', short: 'textos, cores e botões do painel de tickets',
    desc: 'Visual do painel "Seja Staff" (servidor principal). Depois de editar, republique em **Publicações**.',
    fields: [
      T('tickets.panel.title', 'Título', { guild: 'main', max: 256 }),
      T('tickets.panel.desc1', 'Descrição 1', { guild: 'main', long: true, max: 4000 }),
      T('tickets.panel.desc2', 'Descrição 2 (V2)', { guild: 'main', long: true, max: 4000, optional: true }),
      T('tickets.panel.desc3', 'Descrição 3 (V2)', { guild: 'main', long: true, max: 4000, optional: true }),
      T('tickets.panel.desc4', 'Descrição 4 (V2)', { guild: 'main', long: true, max: 4000, optional: true }),
      T('tickets.panel.color', 'Cor (HEX)', { guild: 'main', max: 7, kind: 'color', ph: '#D4AF37' }),
      T('tickets.panel.banner', 'Banner (URL)', { guild: 'main', max: 500, optional: true, kind: 'url' }),
      T('tickets.panel.thumbnail', 'Miniatura (URL)', { guild: 'main', max: 500, optional: true, kind: 'url' }),
      T('tickets.panel.footer', 'Rodapé', { guild: 'main', max: 200, optional: true }),
      T('tickets.panel.labelStaff', 'Botão de staff', { guild: 'main', max: 80 }),
      T('tickets.panel.labelMig', 'Botão de migração', { guild: 'main', max: 80 }),
      T('tickets.panel.selectPlaceholder', 'Texto do menu (V3)', { guild: 'main', max: 100 }),
      T('tickets.panel.optLabelStaff', 'Opção Recrutamento (V3)', { guild: 'main', max: 100 }),
      T('tickets.panel.optLabelMig', 'Opção Migração (V3)', { guild: 'main', max: 100 }),
      T('tickets.panel.optDescStaff', 'Descrição Recrut. (V3)', { guild: 'main', max: 100, optional: true }),
      T('tickets.panel.optDescMig', 'Descrição Migração (V3)', { guild: 'main', max: 100, optional: true }),
      B('tickets.panel.v3Accent', 'Barra colorida (V3)', { guild: 'main' }),
    ],
  },
  // telas especiais (renderizadas à mão)
  pub: { emoji: '📢', name: 'Publicações', short: 'publicar ou atualizar os painéis fixos' },
  mt: { emoji: '🧰', name: 'Manutenção', short: 'atualizar mensagens, reconciliar totais e ações recentes' },
  log: { emoji: '📜', name: 'Últimas ações', short: '' },
  recon: { emoji: '🧮', name: 'Reconciliar totais', short: '' },
};

// Grupos da tela inicial
const GROUPS = [
  { title: '🚀 Comece por aqui', items: ['canais', 'perms'] },
  { title: '🎫 Tickets', items: ['tickets', 'forms', 'msgs'] },
  { title: '💎 Pontos e plantão', items: ['pontos', 'plantao', 'ranking'] },
  { title: '🎨 Visual', items: ['aparencia', 'rankvis'] },
  { title: '🧰 Publicação e manutenção', items: ['pub', 'mt'] },
];

const titleOf = (key) => `${SCREENS[key].emoji} ${SCREENS[key].name}`;
const visible = (sc, gk) => sc.fields.filter((f) => !f.guild || f.guild === gk);
const pathOf = (f, gk) => f.path.replace('{g}', gk);
const fieldPage = (sc, gk, f) => Math.floor(Math.max(0, visible(sc, gk).indexOf(f)) / PER_PAGE);
function findField(key, id) {
  const sc = SCREENS[key];
  const f = sc?.fields?.find((x) => x.id === id);
  return f ? { sc, f } : null;
}

// ============================================================
// Exibição de valores
// ============================================================
const esc = (s) => String(s).replace(/([\\*_~`|>])/g, '\\$1');
const oneLine = (s) => String(s).replace(/\s+/g, ' ').trim();
const EMPTY = '— (não definido)';

function chanName(ctx, id) {
  const ch = ctx.client.channels.cache.get(id);
  if (!ch) return `\`${id}\` (bot não enxerga)`;
  return `${esc(`#${ch.name}`)}${ch.guild?.name ? ` (${esc(ch.guild.name)})` : ''}`;
}
function roleName(ctx, id) {
  const r = ctx.guild?.roles.cache.get(id);
  return r ? esc(`@${r.name}`) : `\`${id}\` (cargo não encontrado)`;
}
function fmtValue(ctx, f, v) {
  switch (f.type) {
    case 'bool': return v ? '✅ Ligado' : '❌ Desligado';
    case 'enum': return f.options.find((o) => o.value === v)?.label ?? (v ? `\`${v}\`` : EMPTY);
    case 'num': return v === undefined || v === null ? EMPTY : `**${v}**`;
    case 'chan': return v ? chanName(ctx, v) : EMPTY;
    case 'chans': return v?.length ? trunc(v.map((id) => chanName(ctx, id)).join(', '), 180) : EMPTY;
    case 'roles': return v?.length ? trunc(v.map((id) => roleName(ctx, id)).join(', '), 180) : EMPTY;
    case 'lines': return v?.length ? `${v.length} item(ns): ${trunc(oneLine(v.map((q) => q.label ?? q).join(' ⏐ ')), 130)}` : EMPTY;
    default: return v ? `\`${trunc(oneLine(v).replace(/`/g, 'ˋ'), 110)}\`` : EMPTY;
  }
}
function rawText(v) {
  if (Array.isArray(v)) return v.length ? v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : x)).join(', ') : '(vazio)';
  if (v === null || v === undefined || v === '') return '(vazio)';
  if (typeof v === 'boolean') return v ? 'ligado' : 'desligado';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// ============================================================
// Auditoria: grava no banco e envia ao canal de logs (se houver)
// ============================================================
const AUDIT = {
  config: { color: COLORS.warn, title: '⚙️ Configuração alterada' },
  publicacao: { color: COLORS.ok, title: '📢 Publicação' },
  manutencao: { color: COLORS.neutral, title: '🧰 Manutenção' },
  destrutiva: { color: COLORS.bad, title: '🗑️ Ação destrutiva' },
};
async function audit(ctx, { kind = 'config', label, path = '', value }) {
  const val = trunc(rawText(value), 500);
  AdminLog.create({ userId: ctx.user.id, userTag: ctx.user.username, guildId: ctx.i.guildId, action: kind, label, path, value: val })
    .catch((e) => console.error('[admin:auditoria]', e.message));
  const a = AUDIT[kind];
  const embed = new EmbedBuilder()
    .setColor(a.color)
    .setTitle(a.title)
    .addFields(
      { name: 'Quem', value: `<@${ctx.user.id}> (\`${ctx.user.id}\`)`, inline: true },
      { name: 'Servidor', value: SERVER_NAMES[ctx.gk] ?? '—', inline: true },
      { name: 'Campo', value: trunc(path ? `${label}\n\`${path}\`` : label, 1000) },
      { name: 'Novo valor', value: trunc(val || '—', 1000) }
    )
    .setTimestamp();
  // sem canal de logs configurado, o emit só avisa no console: a ação segue normalmente
  void emit(ctx.client, cfgNow(), { category: 'admin', action: label, embed, userId: ctx.user.id, data: { path, value: val } });
}

// grava um campo da configuração + auditoria + gancho "after" (sem travar a resposta)
async function commit(ctx, f, value) {
  const path = pathOf(f, ctx.gk);
  await setCfg(path, value);
  await audit(ctx, { kind: 'config', label: f.label, path, value });
  if (f.after) Promise.resolve().then(() => f.after(ctx, value)).catch((e) => console.error('[admin:after]', f.path, e.message));
}

// ============================================================
// Validação ao salvar (nada é gravado se houver erro)
// ============================================================
async function parseField(ctx, f, raw) {
  const s = String(raw ?? '').trim();
  let value;
  if (f.type === 'num') {
    if (!/^\d+$/.test(s)) return { error: `**${f.label}**: use apenas números inteiros (sem sinal).` };
    value = Number(s);
    if (value < f.min || value > f.max) return { error: `**${f.label}**: use um valor entre ${f.min} e ${f.max}.` };
  } else if (f.type === 'lines') {
    try { value = f.fromStr(s); } catch (e) { return { error: e.message }; }
  } else {
    if (!s) {
      if (!f.optional) return { error: `**${f.label}** não pode ficar vazio.` };
      value = f.nullable ? null : '';
    } else {
      if (s.length > f.max) return { error: `**${f.label}**: máximo de ${f.max} caracteres (você enviou ${s.length}).` };
      value = s;
      if (f.kind === 'color') {
        if (!/^#?[0-9a-f]{6}$/i.test(s)) return { error: `**${f.label}**: cor inválida. Use hexadecimal, ex.: #D4AF37` };
        value = `#${s.replace('#', '').toUpperCase()}`;
      }
      if (f.kind === 'url' && !/^https?:\/\/\S+$/i.test(s)) return { error: `**${f.label}**: a URL deve começar com http:// ou https://` };
      if (f.kind === 'snowflake' && !/^\d{15,25}$/.test(s)) return { error: `**${f.label}**: informe só o ID (apenas números).` };
    }
  }
  if (f.check) {
    const err = await f.check(value, ctx);
    if (err) return { error: err };
  }
  return { value };
}

function buildModal(ctx, key, f) {
  const cur = getPath(cfgNow(), pathOf(f, ctx.gk));
  const max = f.type === 'num' ? 12 : f.type === 'lines' ? 4000 : f.max;
  const raw = f.type === 'lines' ? f.toStr(cur) : cur ?? '';
  const input = new TextInputBuilder()
    .setCustomId('v')
    .setLabel(trunc(f.label, 45))
    .setStyle(f.long || f.type === 'lines' ? TextInputStyle.Paragraph : TextInputStyle.Short)
    .setRequired(!f.optional)
    .setMaxLength(max);
  const ph = f.ph ?? (f.type === 'num' ? `Entre ${f.min} e ${f.max}` : null);
  if (ph) input.setPlaceholder(trunc(ph, 100));
  if (raw !== '' && raw !== null) input.setValue(String(raw).slice(0, max));
  return new ModalBuilder().setCustomId(`txadm:m:${key}:${f.id}`).setTitle(trunc(f.label, 45)).addComponents(new ActionRowBuilder().addComponents(input));
}

// ============================================================
// Telas
// ============================================================
function navRow(p, key, page, pages) {
  const btns = [];
  if (pages > 1) {
    btns.push(btn(`txadm:pg:${key}:${page - 1}`, '◀️ Anterior', 'gray', page <= 0));
    btns.push(btn(`txadm:pg:${key}:${page + 1}`, '▶️ Próxima', 'gray', page >= pages - 1));
  }
  btns.push(btn('txadm:home', '🏠 Início', 'gray'));
  p.row(btns);
}

function fieldButton(key, f, v) {
  const id = (a) => `txadm:${a}:${key}:${f.id}`;
  if (f.type === 'bool') return v ? btn(id('t'), 'Ligado', 'green') : btn(id('t'), 'Desligado', 'gray');
  if (f.type === 'enum') return btn(id('e'), '🔘 Escolher');
  if (f.type === 'chan' || f.type === 'chans' || f.type === 'roles') return btn(id('e'), '📌 Alterar');
  return btn(id('e'), '✏️ Editar');
}

function homeScreen(ctx) {
  const cfg = cfgNow();
  const p = new Panel();
  const items = [
    [cfg.logs.internal.admin || cfg.logs.internal.geral, 'Canal de logs definido', 'canais'],
    [cfg.perms.main.admin.length || cfg.perms.internal.admin.length, 'Cargo de administrador definido', 'perms'],
    [cfg.tickets.useThread ? cfg.tickets.threadChannelId : cfg.tickets.categoryId, 'Categoria ou canal dos tickets', 'canais'],
    [cfg.perms.main.recruiter.length, 'Recrutadores definidos', 'perms'],
    [cfg.perms.main.migrator.length, 'Cargo de migração definido', 'perms'],
    [cfg.tickets.assignableRoleIds.length, 'Cargos atribuíveis no recrutamento', 'tickets'],
    [cfg.tickets.panelMessageId, 'Painel de tickets publicado', 'pub'],
    [cfg.logs.internal.plantao || cfg.logs.internal.geral, 'Logs de plantão (interno)', 'canais'],
    [cfg.shift.categoryId, 'Categoria das calls de plantão', 'canais'],
    [cfg.shift.panelMessageId, 'Painel de plantão publicado', 'pub'],
    [cfg.ranking.channelId, 'Canal do ranking', 'ranking'],
  ];
  const ok = items.filter(([v]) => v).length;
  const lines = items.map(([v, label, to]) => (v ? `✅ ${label}` : `⬜ ${label} → **${titleOf(to)}**`));
  p.text(
    `## ⚙️ Painel administrativo — ${ctx.client.user?.username ?? 'Bot'}\n` +
    `Tudo aqui é feito por botões e só você vê esta mensagem. Você está no **${SERVER_NAMES[ctx.gk]}**.\n\n` +
    `**Primeiros passos — ${ok}/${items.length} concluídos**\n${lines.join('\n')}`
  );
  for (const g of GROUPS) {
    p.sep();
    p.text(`**${g.title}**\n${g.items.map((k) => `${SCREENS[k].emoji} **${SCREENS[k].name}** — ${SCREENS[k].short}`).join('\n')}`);
    p.row(g.items.map((k) => btn(`txadm:s:${k}`, titleOf(k), 'primary')));
  }
  p.sep();
  p.text('-# Painel V2 • Para trocar os emojis use `/emojis`. Presets de tickets e plantões ativos continuam no painel clássico: `/admin-classico`.');
  return p;
}

function declarativeScreen(ctx, key, page, notice) {
  const sc = SCREENS[key];
  const fields = visible(sc, ctx.gk);
  const hidden = sc.fields.length - fields.length;
  const pages = Math.max(1, Math.ceil(fields.length / PER_PAGE));
  page = Math.min(Math.max(0, page), pages - 1);
  const p = new Panel();
  const desc = typeof sc.desc === 'function' ? sc.desc(ctx) : sc.desc;
  p.text(`## ${titleOf(key)}\n${notice ? `${notice}\n` : ''}${desc}${pages > 1 ? `\n-# Página ${page + 1} de ${pages}` : ''}`);
  p.sep();
  if (!fields.length) {
    const other = ctx.gk === 'main' ? 'internal' : 'main';
    p.text(`Esta tela é do **${SERVER_NAMES[other]}**. Rode \`/admin\` lá para configurar.`);
  }
  const cfg = cfgNow();
  for (const f of fields.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE)) {
    const v = getPath(cfg, pathOf(f, ctx.gk));
    const h = help(f.path);
    p.section(`**${f.label}**\n${fmtValue(ctx, f, v)}${h ? `\n-# ${h}` : ''}`, fieldButton(key, f, v));
  }
  if (hidden > 0) p.text(`-# ${hidden} campo(s) exclusivo(s) do ${SERVER_NAMES[ctx.gk === 'main' ? 'internal' : 'main']} não aparecem aqui.`);
  p.sep();
  navRow(p, key, page, pages);
  return p;
}

// escolha de uma opção (enum): um botão por opção, a atual fica verde
function enumScreen(ctx, key, f) {
  const sc = SCREENS[key];
  const cur = getPath(cfgNow(), pathOf(f, ctx.gk));
  const p = new Panel();
  p.text(`## ${titleOf(key)} › ${f.label}\n${help(f.path) || 'Escolha uma opção.'}\n\n**Atual:** ${fmtValue(ctx, f, cur)}`);
  p.sep();
  const btns = f.options.map((o) => btn(`txadm:o:${key}:${f.id}:${o.value}`, o.label, o.value === cur ? 'green' : 'gray'));
  for (let n = 0; n < btns.length; n += 5) p.row(btns.slice(n, n + 5));
  p.row(btn(`txadm:pg:${key}:${fieldPage(sc, ctx.gk, f)}`, '↩️ Voltar', 'gray'));
  return p;
}

// escolha de canal(is) ou cargo(s) por menu
function pickerScreen(ctx, key, f) {
  const sc = SCREENS[key];
  const cur = getPath(cfgNow(), pathOf(f, ctx.gk));
  const single = f.type === 'chan';
  const ids = (single ? [cur] : cur || []).filter(Boolean);
  const p = new Panel();
  p.text(`## ${titleOf(key)} › ${f.label}\n${help(f.path)}\n\n**Atual:** ${fmtValue(ctx, f, cur)}`);
  p.sep();
  const id = `txadm:c:${key}:${f.id}`;
  let menu;
  if (f.type === 'roles') {
    menu = new RoleSelectMenuBuilder().setCustomId(id).setPlaceholder('Selecione os cargos...').setMinValues(1).setMaxValues(25);
    const ok = ids.filter((r) => ctx.guild?.roles.cache.has(r)).slice(0, 25);
    if (ok.length) menu.setDefaultRoles(ok);
  } else {
    menu = new ChannelSelectMenuBuilder().setCustomId(id).setPlaceholder(single ? 'Selecione um canal...' : 'Selecione os canais...')
      .setChannelTypes(f.types).setMinValues(1).setMaxValues(single ? 1 : 25);
    const ok = ids.filter((c) => ctx.guild?.channels.cache.has(c)).slice(0, single ? 1 : 25);
    if (ok.length) menu.setDefaultChannels(ok);
  }
  p.row(menu);
  p.row(btn(`txadm:x:${key}:${f.id}`, '🧹 Limpar', 'gray'), btn(`txadm:pg:${key}:${fieldPage(sc, ctx.gk, f)}`, '↩️ Voltar', 'gray'));
  return p;
}

// ============================================================
// Publicações (mensagens fixas): publicar de novo EDITA a mensagem existente
// ============================================================
const PUBS = {
  tickets: { label: 'Painel de tickets', guild: 'main', chan: 'tickets.panelChannelId', msg: 'tickets.panelMessageId' },
  plantao: { label: 'Painel de plantão', guild: 'internal', chan: 'shift.panelChannelId', msg: 'shift.panelMessageId' },
  ranking: { label: 'Ranking', guild: 'internal', chan: 'ranking.channelId', msg: 'ranking.messageId' },
};
const pubErrors = {}; // último erro de cada publicação (fica na memória)

async function doPublish(ctx, key, channel) {
  const P = PUBS[key];
  const cfg = cfgNow();
  if (!channel) {
    const id = getPath(cfg, P.chan);
    if (!id) throw new Error('nenhum canal definido. Use "Trocar canal".');
    channel = await ctx.client.channels.fetch(id).catch(() => null);
    if (!channel) throw new Error('não encontrei o canal (ele existe e o bot enxerga?).');
  }
  if (channel.guildId !== guildIdOf(P.guild)) throw new Error(`o canal precisa ser do ${SERVER_NAMES[P.guild]}.`);
  if (!channel.isTextBased()) throw new Error('o canal precisa ser de texto.');

  if (key === 'tickets') {
    const { message, kind } = await publishPanel(ctx.client, cfg, channel); // edita se já existir no mesmo canal
    await setCfg('tickets.panelChannelId', channel.id);
    await setCfg('tickets.panelMessageId', message.id);
    await setCfg('tickets.panelKind', kind);
  } else if (key === 'plantao') {
    const payload = buildShiftPanel(cfg);
    let sent = null;
    if (cfg.shift.panelMessageId && cfg.shift.panelChannelId === channel.id) {
      const old = await channel.messages.fetch(cfg.shift.panelMessageId).catch(() => null);
      if (old) sent = await old.edit({ content: '', ...payload }).catch(() => null);
    }
    if (!sent) sent = await channel.send(payload);
    await setCfg('shift.panelChannelId', channel.id);
    await setCfg('shift.panelMessageId', sent.id);
  } else {
    if (cfg.ranking.channelId !== channel.id) {
      await setCfg('ranking.channelId', channel.id);
      await setCfg('ranking.messageId', null);
      await setCfg('ranking.messageKind', null);
    }
    const r = await refreshRanking(ctx.client, { manual: true }); // edita a mensagem existente
    if (!r.ok) throw new Error(r.reason);
  }
}

// publica e registra sucesso/erro; nunca lança
async function runPublish(ctx, key, channel, kind = 'publicacao') {
  try {
    await doPublish(ctx, key, channel);
    delete pubErrors[key];
    const cfg = cfgNow();
    const ch = getPath(cfg, PUBS[key].chan);
    await audit(ctx, { kind, label: `${PUBS[key].label} publicado/atualizado`, path: PUBS[key].chan, value: ch ? `<#${ch}>` : '' });
    return null;
  } catch (e) {
    console.error('[admin:publicar]', key, e.message);
    pubErrors[key] = e.message;
    return e.message;
  }
}

function pubScreen(ctx, notice) {
  const cfg = cfgNow();
  const p = new Panel();
  p.text(`## ${titleOf('pub')}\n${notice ? `${notice}\n` : ''}Publicar de novo **edita** a mensagem existente, nunca duplica. Cada painel é publicado no servidor indicado.`);
  p.sep();
  for (const [key, P] of Object.entries(PUBS)) {
    const chId = getPath(cfg, P.chan);
    const msgId = getPath(cfg, P.msg);
    const ch = chId ? ctx.client.channels.cache.get(chId) : null;
    const where = !chId ? EMPTY : ch ? chanName(ctx, chId) : `\`${chId}\` (bot não enxerga)`;
    const link = msgId && ch ? `[abrir mensagem](https://discord.com/channels/${ch.guildId}/${chId}/${msgId})` : null;
    const state = msgId ? `✅ Publicado${link ? ` — ${link}` : ''}` : '⬜ Ainda não publicado';
    const wrong = ctx.gk !== P.guild;
    p.section(
      `**${P.label}** — ${SERVER_NAMES[P.guild]}\nCanal: ${where}\n${state}${pubErrors[key] ? `\n-# ⚠️ Último erro: ${trunc(pubErrors[key], 200)}` : ''}${wrong ? `\n-# Disponível no ${SERVER_NAMES[P.guild]}.` : ''}`,
      btn(`txadm:p:${key}`, '📤 Publicar / atualizar', 'primary', wrong)
    );
  }
  p.sep();
  p.row(Object.entries(PUBS).map(([key, P]) => btn(`txadm:pc:${key}`, `📌 Canal: ${P.label.replace('Painel de ', '')}`, 'gray', ctx.gk !== P.guild)));
  p.row(btn('txadm:home', '🏠 Início', 'gray'));
  return p;
}

function pubPicker(ctx, key) {
  const P = PUBS[key];
  const p = new Panel();
  p.text(`## ${titleOf('pub')} › ${P.label}\nEscolha o canal. O painel será publicado nele agora.`);
  p.sep();
  p.row(new ChannelSelectMenuBuilder().setCustomId(`txadm:ps:${key}`).setPlaceholder('Selecione um canal de texto...').setChannelTypes(TEXT_CH).setMinValues(1).setMaxValues(1));
  p.row(btn('txadm:s:pub', '↩️ Voltar', 'gray'));
  return p;
}

// ============================================================
// Manutenção, reconciliação e últimas ações
// ============================================================
async function mtScreen(ctx, notice) {
  const [tickets, shifts, recruiters] = await Promise.all([
    Ticket.countDocuments({ status: 'open' }),
    Shift.countDocuments({ status: 'active' }),
    UserStat.countDocuments({ $or: [{ points: { $gt: 0 } }, { recruitments: { $gt: 0 } }, { shifts: { $gt: 0 } }] }),
  ]);
  const cfg = cfgNow();
  const p = new Panel();
  p.text(
    `## ${titleOf('mt')}\n${notice ? `${notice}\n` : ''}` +
    `🎫 Tickets abertos: **${tickets}** • 🕐 Plantões ativos: **${shifts}** • 🏆 Pessoas no ranking: **${recruiters}**`
  );
  p.sep();
  p.text('**Atualizar mensagens fixas**\n-# Reenvia o conteúdo atual para a mensagem já publicada (nada é duplicado).');
  p.row(Object.entries(PUBS).map(([key, P]) =>
    btn(`txadm:mt:rf:${key}`, `🔄 ${P.label.replace('Painel de ', '')}`, 'gray', ctx.gk !== P.guild || !getPath(cfg, P.msg))));
  p.sep();
  p.row(btn('txadm:s:recon', '🧮 Reconciliar totais', 'gray'), btn('txadm:s:log', '📜 Últimas ações', 'gray'));
  p.sep();
  p.text('**Zona de perigo**\n-# Pede confirmação em duas etapas.');
  p.row(btn('txadm:d:rank', '🗑️ Zerar ranking', 'red', ctx.gk !== 'internal'));
  p.row(btn('txadm:home', '🏠 Início', 'gray'));
  return p;
}

async function logScreen(ctx) {
  const rows = await AdminLog.find().sort({ at: -1 }).limit(15).lean();
  const p = new Panel();
  const lines = rows.map((r, n) => `**${n + 1}.** <t:${Math.floor(new Date(r.at).getTime() / 1000)}:R> • <@${r.userId}> • ${trunc(r.label, 70)}${r.value ? ` → \`${trunc(oneLine(r.value).replace(/`/g, 'ˋ'), 60)}\`` : ''}`);
  p.text(`## ${titleOf('log')}\nAs últimas 15 alterações feitas por este painel.\n\n${lines.length ? lines.join('\n') : '*Nenhuma alteração registrada ainda.*'}`);
  p.sep();
  p.row(btn('txadm:s:mt', '↩️ Manutenção', 'gray'), btn('txadm:home', '🏠 Início', 'gray'));
  return p;
}

// Compara os contadores do ranking com o histórico (a partir do último reset). Pontos não são recalculados
// porque também incluem ajustes manuais.
async function computeRecon() {
  const last = await LogEntry.findOne({ category: 'admin', action: 'Reset do ranking' }).sort({ at: -1 }).lean();
  const since = last?.at ?? new Date(0);
  const [rec, sh, stats] = await Promise.all([
    Recruitment.aggregate([
      { $match: { at: { $gte: since } } },
      { $group: { _id: '$recruiterId', recruitments: { $sum: 1 }, migrations: { $sum: { $cond: [{ $eq: ['$type', 'migracao'] }, 1, 0] } } } },
    ]),
    Shift.aggregate([
      { $match: { status: { $in: ['approved', 'done'] } } },
      { $addFields: { d: { $ifNull: ['$reviewedAt', '$endedAt'] } } },
      { $match: { d: { $gte: since } } },
      { $group: { _id: '$userId', shifts: { $sum: 1 }, shiftSeconds: { $sum: { $ifNull: ['$durationSec', 0] } } } },
    ]),
    UserStat.find().lean(),
  ]);
  const calc = new Map();
  const zero = () => ({ recruitments: 0, migrations: 0, shifts: 0, shiftSeconds: 0 });
  for (const r of rec) calc.set(r._id, { ...zero(), recruitments: r.recruitments, migrations: r.migrations });
  for (const s of sh) calc.set(s._id, { ...(calc.get(s._id) ?? zero()), shifts: s.shifts, shiftSeconds: s.shiftSeconds });
  const cur = new Map(stats.map((s) => [s.userId, s]));
  const diffs = [];
  for (const id of new Set([...calc.keys(), ...cur.keys()])) {
    const c = cur.get(id) ?? zero();
    const n0 = calc.get(id) ?? zero();
    const cs = cur.get(id);
    const n = {
      recruitments: n0.recruitments + (cs?.adjStaff || 0) + (cs?.adjMig || 0),
      migrations: n0.migrations + (cs?.adjMig || 0),
      shifts: n0.shifts + (cs?.adjShifts || 0),
      shiftSeconds: n0.shiftSeconds,
    };
    const before = { recruitments: c.recruitments || 0, migrations: c.migrations || 0, shifts: c.shifts || 0, shiftSeconds: Math.round(c.shiftSeconds || 0) };
    const after = { ...n, shiftSeconds: Math.round(n.shiftSeconds) };
    if (Object.keys(before).some((k) => before[k] !== after[k])) diffs.push({ id, before, after });
  }
  return { since: last?.at ?? null, diffs };
}

async function reconScreen(ctx, notice) {
  const { since, diffs } = await computeRecon();
  const p = new Panel();
  const sample = diffs.slice(0, 8).map((d) =>
    `<@${d.id}>: recrut. ${d.before.recruitments}→${d.after.recruitments} • migr. ${d.before.migrations}→${d.after.migrations} • plant. ${d.before.shifts}→${d.after.shifts}`);
  p.text(
    `## ${titleOf('recon')}\n${notice ? `${notice}\n` : ''}` +
    `Compara os contadores do ranking (recrutamentos, migrações e plantões) com o histórico${since ? ` desde o último reset (<t:${Math.floor(new Date(since).getTime() / 1000)}:d>)` : ''}.\n` +
    `-# Os pontos não são alterados, porque incluem ajustes manuais.\n\n` +
    (diffs.length ? `**${diffs.length} pessoa(s) com divergência**\n${sample.join('\n')}${diffs.length > 8 ? `\n…e mais ${diffs.length - 8}.` : ''}` : '✅ Tudo certo: os totais batem com o histórico.')
  );
  p.sep();
  p.row(btn('txadm:d:recon', '🛠️ Aplicar correção', 'red', !diffs.length || ctx.gk !== 'internal'), btn('txadm:s:mt', '↩️ Manutenção', 'gray'));
  return p;
}

// ---------- ações destrutivas: botão vermelho e depois "Confirmar" ----------
const DESTRUCTIVE = {
  rank: { title: 'Zerar o ranking', text: 'Pontos, recrutamentos, migrações e plantões de **todos** os recrutadores serão zerados. O histórico de tickets e plantões é mantido.', back: 'mt' },
  recon: { title: 'Aplicar a correção dos totais', text: 'Os contadores de recrutamentos, migrações e plantões serão sobrescritos pelo valor calculado no histórico.', back: 'recon' },
};
function confirmScreen(action) {
  const d = DESTRUCTIVE[action];
  const p = new Panel();
  p.text(`## ⚠️ ${d.title}\n${d.text}\n\n**Esta ação não pode ser desfeita.** Deseja continuar?`);
  p.sep();
  p.row(btn(`txadm:dc:${action}`, 'Confirmar', 'red'), btn(`txadm:s:${d.back}`, 'Cancelar', 'gray'));
  return p;
}
async function runDestructive(ctx, action) {
  if (ctx.gk !== 'internal') throw new Error(`Esta ação só funciona no ${SERVER_NAMES.internal}.`);
  if (action === 'rank') {
    const r = await UserStat.updateMany({}, { $set: { points: 0, recruitments: 0, migrations: 0, shifts: 0, shiftSeconds: 0, adjStaff: 0, adjMig: 0, adjShifts: 0 } });
    await audit(ctx, { kind: 'destrutiva', label: 'Reset do ranking', value: `${r.modifiedCount} recrutadores zerados` });
    refreshRank(ctx);
    return { screen: 'mt', notice: '✅ Ranking zerado.' };
  }
  const { diffs } = await computeRecon();
  if (diffs.length) {
    await UserStat.bulkWrite(diffs.map((d) => ({
      updateOne: { filter: { userId: d.id }, update: { $set: { ...d.after, updatedAt: new Date() } }, upsert: true },
    })));
  }
  await audit(ctx, { kind: 'destrutiva', label: 'Totais reconciliados', value: `${diffs.length} pessoa(s) corrigida(s)` });
  refreshRank(ctx);
  return { screen: 'recon', notice: `✅ ${diffs.length} pessoa(s) corrigida(s).` };
}

// ============================================================
// Roteamento
// ============================================================
async function renderScreen(ctx, key, { page = 0, notice } = {}) {
  if (key === 'home') return homeScreen(ctx);
  if (key === 'pub') return pubScreen(ctx, notice);
  if (key === 'mt') return mtScreen(ctx, notice);
  if (key === 'log') return logScreen(ctx);
  if (key === 'recon') return reconScreen(ctx, notice);
  if (SCREENS[key]?.fields) return declarativeScreen(ctx, key, page, notice);
  return homeScreen(ctx);
}

const strip = (payload) => ({ components: payload.components, flags: MessageFlags.IsComponentsV2, allowedMentions: payload.allowedMentions });
async function show(i, panel) {
  const payload = panel.done();
  if (i.deferred || i.replied) return i.editReply(strip(payload));
  if (i.isModalSubmit() && !i.isFromMessage()) return i.reply(payload);
  return i.update(strip(payload));
}
const fail = (i, msg) => {
  const o = { content: `❌ ${msg}`, flags: EPHEMERAL };
  return i.deferred || i.replied ? i.followUp(o) : i.reply(o);
};
const noPerm = (i) => i.reply({ content: '❌ Sem permissão', flags: EPHEMERAL });
const makeCtx = (i, gk) => ({ i, gk, client: i.client, guild: i.guild, user: i.user });

async function adminCommand(i) {
  const gk = guildKey(i.guildId);
  if (!gk) return i.reply({ content: '❌ Este servidor não está autorizado.', flags: EPHEMERAL });
  if (!perms(i.member, cfgNow()).isAdmin) return noPerm(i);
  return i.reply(homeScreen(makeCtx(i, gk)).done());
}

async function handleAdmin(i) {
  try {
    await route(i);
  } catch (e) {
    console.error('[admin]', e);
    const o = { content: '❌ Ocorreu um erro. Tente novamente.', flags: EPHEMERAL };
    if (i.deferred || i.replied) await i.followUp(o).catch(() => {});
    else await i.reply(o).catch(() => {});
  }
}

async function route(i) {
  const gk = guildKey(i.guildId);
  if (!gk) return i.reply({ content: '❌ Este servidor não está autorizado.', flags: EPHEMERAL });
  if (!perms(i.member, cfgNow()).isAdmin) return noPerm(i);
  const ctx = makeCtx(i, gk);
  const [, act, a, b, c] = i.customId.split(':');
  const go = async (key, opts) => show(i, await renderScreen(ctx, key, opts));
  // telas com escrita no banco: confirma a interação antes (limite de 3 s)
  const ack = () => (i.deferred || i.replied ? null : i.deferUpdate());

  // campo (tela a, campo b) válido para este servidor?
  const field = () => {
    const r = findField(a, b);
    if (!r) { fail(i, 'Campo não encontrado. Abra o painel de novo com `/admin`.'); return null; }
    if (r.f.guild && r.f.guild !== gk) { fail(i, `Este campo é do **${SERVER_NAMES[r.f.guild]}**. Rode \`/admin\` lá.`); return null; }
    return r;
  };
  const back = (r) => ({ page: fieldPage(r.sc, gk, r.f) });

  switch (act) {
    case 'home': return go('home');
    case 's': return go(SCREENS[a] ? a : 'home');
    case 'pg': return go(a, { page: Number(b) || 0 });

    case 't': { // alternar ligado/desligado
      const r = field(); if (!r || r.f.type !== 'bool') return;
      await ack();
      await commit(ctx, r.f, !getPath(cfgNow(), pathOf(r.f, gk)));
      return go(a, back(r));
    }

    case 'e': { // editar: modal (texto/número/linhas) ou tela de escolha (enum/canais/cargos)
      const r = field(); if (!r) return;
      if (r.f.type === 'enum') return show(i, enumScreen(ctx, a, r.f));
      if (['chan', 'chans', 'roles'].includes(r.f.type)) return show(i, pickerScreen(ctx, a, r.f));
      return i.showModal(buildModal(ctx, a, r.f));
    }

    case 'm': { // envio do modal
      const r = field(); if (!r) return;
      const { value, error } = await parseField(ctx, r.f, i.fields.getTextInputValue('v'));
      if (error) return fail(i, error);
      await ack();
      await commit(ctx, r.f, value);
      return go(a, back(r));
    }

    case 'o': { // opção de enum
      const r = field(); if (!r || r.f.type !== 'enum') return;
      if (!r.f.options.some((o) => o.value === c)) return fail(i, 'Opção inválida.');
      await ack();
      await commit(ctx, r.f, c);
      return go(a, back(r));
    }

    case 'c': { // menu de canais/cargos
      const r = field(); if (!r) return;
      await ack();
      await commit(ctx, r.f, r.f.type === 'chan' ? i.values[0] : [...i.values]);
      return go(a, back(r));
    }

    case 'x': { // limpar
      const r = field(); if (!r) return;
      await ack();
      await commit(ctx, r.f, r.f.type === 'chan' ? null : []);
      return go(a, back(r));
    }

    // ---- Publicações ----
    case 'p': case 'pc': case 'ps': {
      const P = PUBS[a];
      if (!P) return;
      if (gk !== P.guild) return fail(i, `Este painel é do **${SERVER_NAMES[P.guild]}**. Rode \`/admin\` lá.`);
      if (act === 'pc' || (act === 'p' && !getPath(cfgNow(), P.chan))) return show(i, pubPicker(ctx, a));
      await ack();
      const channel = act === 'ps' ? await i.guild.channels.fetch(i.values[0]).catch(() => null) : null;
      if (act === 'ps' && !channel) return fail(i, 'Não consegui acessar esse canal.');
      const err = await runPublish(ctx, a, channel);
      return go('pub', { notice: err ? `❌ Não consegui publicar: ${trunc(err, 200)}` : `✅ ${P.label} publicado.` });
    }

    // ---- Manutenção ----
    case 'mt': {
      if (a === 'rf') {
        const P = PUBS[b];
        if (!P) return;
        if (gk !== P.guild) return fail(i, `Este painel é do **${SERVER_NAMES[P.guild]}**.`);
        await ack();
        const err = await runPublish(ctx, b, null, 'manutencao');
        return go('mt', { notice: err ? `❌ ${P.label}: ${trunc(err, 200)}` : `✅ ${P.label} atualizado.` });
      }
      return go('mt');
    }

    // ---- Ações destrutivas (duas etapas) ----
    case 'd': {
      if (!DESTRUCTIVE[a]) return;
      if (gk !== 'internal') return fail(i, `Esta ação só funciona no **${SERVER_NAMES.internal}**.`);
      return show(i, confirmScreen(a));
    }
    case 'dc': {
      if (!DESTRUCTIVE[a]) return;
      await ack();
      try {
        const r = await runDestructive(ctx, a);
        return go(r.screen, { notice: r.notice });
      } catch (e) {
        return fail(i, e.message);
      }
    }
    default: return;
  }
}

module.exports = { adminCommand, handleAdmin, SCREENS };
