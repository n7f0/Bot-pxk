const {
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { getCfg, setCfg, getPath, Shift, UserStat, Recruitment, LogEntry, DEFAULT_QUESTIONS, clone } = require('./db');
const voz = require('./voz');
const { COLORS, MAIN_ID, SERVER_NAMES, guildKey, perms, row, emit, ts, trunc, addStats } = require('./core');
const { buildPanel, publishPanel } = require('./tickets');
const presets = require('./presets');
const { buildShiftPanel, cancelShift } = require('./plantao');
const { refreshRanking, buildRankingPayload, SORTS, LINE_PRESETS, THEMES, SPACINGS, SPACING_LABEL } = require('./ranking');
const { GROUPS, LABELS, GROUP_OF, E, Eb, lbl, current: emojiNow, isChanged, parseInput: parseEmojiInput } = require('./emojis');

const MAX_Q = 5;
const deny = (content) => ({ content, ephemeral: true });

// ============================================================
// Helpers visuais (botões sempre cinza)
// ============================================================
// O emoji de cada botão vem de /admin → Emojis e ícones (chave = emojiKey)
const gbtn = (id, label, emojiKey) => {
  const b = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(ButtonStyle.Secondary);
  const em = emojiKey ? Eb(emojiKey) : undefined;
  return em ? b.setEmoji(em) : b;
};
// opção de menu com emoji editável
const opt = (label, value, description, emojiKey) => {
  const o = { label, value, description };
  const em = emojiKey ? Eb(emojiKey) : undefined;
  if (em) o.emoji = em;
  return o;
};
const back = (id = 'adc:home') => row(gbtn(id, 'Voltar', 'admBack'));
const roles = (ids) => (ids?.length ? ids.map((id) => `<@&${id}>`).join(' ') : '*não definido*');
const chan = (id) => (id ? `<#${id}>` : '*não definido*');
const chans = (ids) => (ids?.length ? ids.map((id) => `<#${id}>`).join(' ') : '*qualquer canal*');
const onoff = (b) => (b ? `${E('ok')} Ativado` : `${E('off')} Desativado`);
const base = (title, desc) => new EmbedBuilder().setColor(COLORS.neutral).setTitle(title).setDescription(desc);
const wrongServer = (needed) => `${E('warn')} Esta seção pertence ao **${SERVER_NAMES[needed]}**. Rode \`/admin-classico\` lá para alterar.`;
const fmt = (v) =>
  Array.isArray(v) ? (v.length ? v.map((x) => `\`${x}\``).join(' ') : '*vazio*')
  : v === null || v === undefined || v === '' ? '*vazio*'
  : typeof v === 'string' ? `\`${trunc(v, 150)}\``
  : typeof v === 'object' ? `\`${trunc(JSON.stringify(v), 150)}\``
  : `\`${v}\``;

function logAdmin(i, cfg, title, text) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.warn)
    .setTitle(lbl('admHome', title))
    .setDescription(trunc(text, 3500))
    .addFields(
      { name: 'Responsável', value: `${i.user} (\`${i.user.id}\`)`, inline: true },
      { name: 'Servidor', value: SERVER_NAMES[guildKey(i.guildId)] ?? '—', inline: true }
    )
    .setTimestamp();
  void emit(i.client, cfg, { category: 'admin', action: title, embed, userId: i.user.id });
}

// ============================================================
// Campos editáveis por modal (validação centralizada)
// ============================================================
const T = (path, label, extra = {}) => ({ path, label, type: 'text', max: 100, ...extra });
const N = (path, label, lo, hi, screen) => ({ path, label, type: 'int', lo, hi, max: 8, screen });

const FIELD_LIST = [
  T('tickets.nameTemplate', 'Modelo do nome do ticket', { max: 80, ph: 'Variáveis: {tipo} {usuario} {numero}', screen: 'tickets' }),
  T('tickets.panel.title', 'Título do painel', { max: 256, screen: 'appearance' }),
  T('tickets.panel.desc1', 'Descrição 1', { long: true, max: 4000, screen: 'appearance' }),
  T('tickets.panel.desc2', 'Descrição 2 (somente V2)', { long: true, max: 4000, required: false, screen: 'appearance' }),
  T('tickets.panel.desc3', 'Descrição 3 (somente V2)', { long: true, max: 4000, required: false, screen: 'appearance' }),
  T('tickets.panel.desc4', 'Descrição 4 (somente V2)', { long: true, max: 4000, required: false, screen: 'appearance' }),
  T('tickets.panel.color', 'Cor HEX (ex: #D4AF37)', { type: 'color', max: 7, screen: 'appearance' }),
  T('tickets.panel.banner', 'URL do banner (vazio remove)', { type: 'url', max: 500, required: false, screen: 'appearance' }),
  T('tickets.panel.thumbnail', 'URL da thumbnail (vazio remove)', { type: 'url', max: 500, required: false, screen: 'appearance' }),
  T('tickets.panel.footer', 'Texto do rodapé (vazio remove)', { max: 200, required: false, screen: 'appearance' }),
  T('tickets.panel.labelStaff', 'Texto do botão de staff', { max: 80, screen: 'appearance' }),
  T('tickets.panel.labelMig', 'Texto do botão de migração', { max: 80, screen: 'appearance' }),
  T('tickets.panel.selectPlaceholder', 'Texto do menu (V3)', { max: 100, screen: 'appearance' }),
  T('tickets.panel.optLabelStaff', 'Nome da opção Recrutamento (menu V3)', { max: 100, screen: 'appearance' }),
  T('tickets.panel.optLabelMig', 'Nome da opção Migração (menu V3)', { max: 100, screen: 'appearance' }),
  T('tickets.panel.optDescStaff', 'Descrição da opção Staff (menu V3)', { max: 100, required: false, screen: 'appearance' }),
  T('tickets.panel.optDescMig', 'Descrição da opção Migração (menu V3)', { max: 100, required: false, screen: 'appearance' }),
  ...['open', 'claim', 'finish', 'reject', 'close'].map((k) =>
    T(`tickets.messages.${k}`, `Mensagem: ${k}`, { long: true, max: 1000, ph: '{usuario} {recrutador} {tipo} {cargos} {numero}', screen: 'messages' })
  ),
  N('points.recruitment', 'Pontos por recrutamento', 0, 1000000, 'points'),
  N('points.migration', 'Pontos por migração', 0, 1000000, 'points'),
  N('points.shiftFlat', 'Pontos fixos por plantão', 0, 1000000, 'points'),
  N('points.shiftPerHour', 'Pontos de plantão por hora', 0, 1000000, 'points'),
  N('points.reject', 'Pontos por candidato reprovado', 0, 1000000, 'points'),
  N('shift.plannedMinutes', 'Duração prevista (minutos)', 1, 1440, 'shift'),
  N('shift.minMinutes', 'Tempo mínimo para contar (min)', 0, 1440, 'shift'),
  N('shift.maxHours', 'Enviar plantão esquecido para análise após (horas)', 1, 72, 'shift'),
  N('shift.returnMinutes', 'Minutos para voltar à call', 1, 60, 'shift'),
  ...['start', 'leave', 'cancel', 'incomplete', 'done'].map((k) =>
    T(`shift.messages.${k}`, `Mensagem (DM): ${k}`, { long: true, max: 1000, ph: '{usuario} {minutos} {tolerancia} {call} {fim} {limite} {motivo} {tempo}', screen: 'shift' })
  ),
  T('shift.rules', 'Regras do plantão', { long: true, max: 1000, required: false, screen: 'shift' }),
  T('ranking.view.title', 'Título do ranking', { max: 100, screen: 'rankview' }),
  T('ranking.view.color', 'Cor HEX (ex: #2B2D31)', { type: 'color', max: 7, screen: 'rankview' }),
  T('ranking.view.banner', 'URL do banner (vazio remove)', { type: 'url', max: 500, required: false, screen: 'rankview' }),
  T('ranking.view.thumbnail', 'URL da thumbnail (vazio remove)', { type: 'url', max: 500, required: false, screen: 'rankview' }),
  T('ranking.view.footer', 'Rodapé ({top} = tamanho do top)', { max: 200, required: false, screen: 'rankview' }),
  T('ranking.view.lineTemplate', 'Modelo de cada linha', { long: true, max: 500, ph: '{emoji} {usuario} — {pontos} {unidade}', screen: 'rankview' }),
  T('ranking.view.description', 'Texto acima da lista (vazio remove)', { long: true, max: 400, required: false, screen: 'rankview' }),
  T('ranking.view.podiumTemplate', 'Modelo do pódio (vazio = igual às demais)', { long: true, max: 500, required: false, ph: '{emoji} {usuario} — {pontos} {unidade}', screen: 'rankview' }),
  N('ranking.view.podiumCount', 'Quantos no pódio (0 desliga, máx. 10)', 0, 10, 'rankview'),
  T('ranking.view.totalsTemplate', 'Linha de totais (vazio remove)', { long: true, max: 400, required: false, ph: '{membros} recrutadores • {totalPontos} {unidade}', screen: 'rankview' }),
  T('ranking.view.emptyText', 'Texto quando ninguém pontuou', { max: 200, screen: 'rankview' }),
  T('ranking.view.unit', 'Nome da pontuação (ex: pontos)', { max: 20, screen: 'rankview' }),
  N('ranking.topSize', 'Quantidade no ranking (5 a 25)', 5, 25, 'ranking'),
  N('ranking.intervalMin', 'Atualizar a cada (minutos)', 1, 1440, 'ranking'),
];
const FIELDS = Object.fromEntries(FIELD_LIST.map((d) => [d.path, d]));

const MODALS = {
  points: { title: 'Pontuação', paths: ['points.recruitment', 'points.migration', 'points.shiftFlat', 'points.shiftPerHour', 'points.reject'], screen: 'points', guild: null },
  shift: { title: 'Tempos e regras do plantão', paths: ['shift.plannedMinutes', 'shift.returnMinutes', 'shift.maxHours', 'shift.rules'], screen: 'shift', guild: 'internal' },
  ranking: { title: 'Configuração do ranking', paths: ['ranking.topSize', 'ranking.intervalMin'], screen: 'ranking', guild: 'internal' },
};
const TOGGLES = {
  'shift.enabled': 'shift',
  'shift.requireVoice': 'shift',
  'ranking.enabled': 'ranking',
  'ranking.auto': 'ranking',
  'tickets.requireShiftToClaim': 'tickets',
  'tickets.panel.v3Accent': 'appearance',
  'ranking.view.v3Accent': 'rankview',
  'ranking.view.showTimestamp': 'rankview',
};
const guildForPath = (p) => (p.startsWith('tickets') ? 'main' : p.startsWith('shift') || p.startsWith('ranking') ? 'internal' : null);

function buildModal(customId, title, defs, cfg) {
  const modal = new ModalBuilder().setCustomId(customId).setTitle(title.slice(0, 45));
  for (const d of defs) {
    const cur = getPath(cfg, d.path);
    const input = new TextInputBuilder()
      .setCustomId(d.path)
      .setLabel(d.label.slice(0, 45))
      .setStyle(d.long ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(d.required !== false)
      .setMaxLength(d.max);
    if (d.ph) input.setPlaceholder(d.ph.slice(0, 100));
    if (cur !== undefined && cur !== null && cur !== '') input.setValue(String(cur).slice(0, d.max));
    modal.addComponents(row(input));
  }
  return modal;
}

function parseValue(d, raw) {
  const v = raw.trim();
  if (!v) return d.required === false ? { value: '' } : { error: `**${d.label}** é obrigatório.` };
  if (d.type === 'int') {
    if (!/^\d+$/.test(v)) return { error: `**${d.label}**: use apenas números inteiros.` };
    const n = Number(v);
    if (n < d.lo || n > d.hi) return { error: `**${d.label}**: use um valor entre ${d.lo} e ${d.hi}.` };
    return { value: n };
  }
  if (d.type === 'color') {
    if (!/^#?[0-9a-f]{6}$/i.test(v)) return { error: 'Cor inválida. Use o formato HEX, ex: #D4AF37' };
    return { value: '#' + v.replace('#', '').toUpperCase() };
  }
  if (d.type === 'url') {
    if (!/^https?:\/\/\S+$/i.test(v)) return { error: `**${d.label}**: a URL deve começar com http:// ou https://` };
  }
  return { value: v };
}

// ============================================================
// Telas
// ============================================================
function homeView(cfg, gk) {
  const chk = (ok, label) => `${ok ? E('ok') : E('warn')} ${label}`;
  const lines = [
    `Você está no **${SERVER_NAMES[gk]}**.`,
    '',
    '**Status da configuração:**',
    cfg.tickets.useThread
      ? chk(cfg.tickets.threadChannelId, 'Canal dos tópicos dos tickets (principal)')
      : chk(cfg.tickets.categoryId, 'Categoria dos tickets (principal)'),
    chk(cfg.tickets.panelMessageId, 'Painel de tickets publicado (principal)'),
    `${Object.keys(cfg.presets || {}).length ? E('ok') : E('info')} Presets de tickets criados: ${Object.keys(cfg.presets || {}).length}`,
    chk(cfg.perms.main.recruiter.length, 'Recrutadores definidos (principal)'),
    chk(cfg.perms.main.migrator.length, 'Cargo habilitado à migração definido (principal)'),
    chk(cfg.tickets.assignableRoleIds.length, 'Cargos atribuíveis no recrutamento'),
    chk(cfg.logs.main.geral || cfg.logs.main.tickets, 'Logs do servidor principal'),
    chk(cfg.voice?.[gk], 'Call do bot (este servidor)'),
    chk(cfg.ranking.channelId, 'Canal do ranking (interno)'),
    chk(cfg.logs.internal.plantao || cfg.logs.internal.geral, 'Logs de plantão (interno) — obrigatório'),
    chk(cfg.shift.categoryId, 'Categoria das calls de plantão (principal)'),
    chk(cfg.shift.panelMessageId, 'Painel de plantão publicado (interno)'),
    '',
    'Selecione uma categoria abaixo.',
  ];
  const select = new StringSelectMenuBuilder()
    .setCustomId('adc:menu')
    .setPlaceholder('Selecione uma categoria para configurar...')
    .addOptions(
      opt('Tickets', 'tickets', 'V1/V2/V3, categoria, painel, mensagens, formulários e cargos', 'admTickets'),
      opt('Presets de tickets', 'presets', 'Crie vários sistemas de tickets personalizados', 'admPresets'),
      opt('Pontuação', 'points', 'Pontos por recrutamento, migração e plantão', 'admPoints'),
      opt('Plantão', 'shift', 'Quem pode iniciar, tempos, canais e regras', 'admShift'),
      opt('Ranking', 'ranking', 'Canal, visual, atualização, ajuste manual e reset', 'admRanking'),
      opt('Call do bot', 'voice', 'Deixa o bot conectado em uma call do servidor', 'voice'),
      opt('Logs', 'logs', 'Canais de logs de cada servidor', 'admLogs'),
      opt('Permissões', 'perms', 'Administradores, liderança, recrutadores e plantão', 'admPerms'),
      opt('Emojis e ícones', 'emojis', 'Troque os emojis de botões, menus, títulos e ranking', 'admEmojis')
    );
  return { embeds: [base(lbl('admHome', 'Painel Administrativo — Recrutamento União'), lines.join('\n'))], components: [row(select)] };
}

function ticketsView(cfg, gk) {
  const t = cfg.tickets;
  const embed = base(lbl('admTickets', 'Sistema de Tickets'), [
    `**Modelo do painel:** ${t.style}`,
    `**Ticket em tópico:** ${onoff(t.useThread)} ${t.useThread ? '_(tickets criados em tópico privado)_' : '_(tickets criados em canal na categoria)_'}`,
    `**Categoria dos tickets (canal):** ${chan(t.categoryId)}`,
    `**Canal dos tópicos (tópico):** ${chan(t.threadChannelId)}`,
    `**Canal do painel:** ${chan(t.panelChannelId)}`,
    `**Cargos com acesso aos tickets:** ${roles(t.accessRoleIds)}`,
    `**Cargos iniciais:** ${roles(t.inicianteRoleIds)}`,
    `**Cargos atribuíveis:** ${roles(t.assignableRoleIds)}`,
    `**Nome do ticket:** \`${t.nameTemplate}\``,
    `**Exigir plantão para assumir:** ${onoff(t.requireShiftToClaim)}`,
  ].join('\n'));
  if (gk !== 'main') {
    embed.setDescription(`${wrongServer('main')}\n\n${embed.data.description}`);
    return { embeds: [embed], components: [back()] };
  }
  const menu = new StringSelectMenuBuilder()
    .setCustomId('adc:tk:menu')
    .setPlaceholder('Mais opções de tickets...')
    .addOptions(
      opt('Aparência do painel', 'appearance', 'Título, descrições, cor, banner, botões e V3', 'admAppearance'),
      opt('Mensagens', 'messages', 'Textos de abrir, assumir, finalizar, reprovar e fechar', 'admMessages'),
      opt('Nome dos tickets', 'naming', 'Modelo do nome do canal', 'admNaming'),
      opt('Formulários', 'forms', 'Perguntas de staff e migração', 'admForms'),
      opt('Cargos do recrutamento', 'roles', 'Cargos atribuíveis e cargos iniciais', 'admRoles'),
      opt('Ticket em tópico: ativar/desativar', 'usethread', 'Ativado = tópico privado • Desativado = canal na categoria', 'admNaming'),
      opt('Exigir plantão para assumir', 'reqshift', 'Alterna a regra', 'admReqShift'),
      opt('Publicar painel', 'publish', 'Envia (ou atualiza) o painel em um canal', 'admPublish'),
      opt('Presets de tickets', 'presets', 'Crie outros sistemas de tickets, totalmente personalizados', 'admPresets')
    );
  return {
    embeds: [embed],
    components: [
      row(menu),
      row(new ChannelSelectMenuBuilder().setCustomId('adc:tk:category').setPlaceholder('Categoria dos tickets (usada quando o modo tópico está desativado)...').setChannelTypes(ChannelType.GuildCategory)),
      row(new ChannelSelectMenuBuilder().setCustomId('adc:tk:threadch').setPlaceholder('Canal dos tópicos (usado quando o modo tópico está ativado)...').setChannelTypes(ChannelType.GuildText)),
      row(new RoleSelectMenuBuilder().setCustomId('adc:tk:access').setPlaceholder('Cargos com acesso aos tickets...').setMinValues(0).setMaxValues(10)),
      row(
        gbtn('adc:tk:style:V1', t.style === 'V1' ? '✔ Modelo V1' : 'Modelo V1'),
        gbtn('adc:tk:style:V2', t.style === 'V2' ? '✔ Modelo V2' : 'Modelo V2'),
        gbtn('adc:tk:style:V3', t.style === 'V3' ? '✔ Modelo V3' : 'Modelo V3'),
        gbtn('adc:home', 'Voltar', 'admBack')
      ),
    ],
  };
}

const APP_OPTIONS = [
  ['title', 'Título'], ['desc1', 'Descrição 1'], ['desc2', 'Descrição 2 (V2 e V3)'], ['desc3', 'Descrição 3 (V2 e V3)'],
  ['desc4', 'Descrição 4 (V2 e V3)'], ['color', 'Cor'], ['banner', 'Banner'], ['thumbnail', 'Thumbnail'],
  ['footer', 'Texto do rodapé'], ['labelStaff', 'Texto do botão de staff'], ['labelMig', 'Texto do botão de migração'],
  ['selectPlaceholder', 'Texto do menu (V3)'], ['optLabelStaff', 'Nome da opção Recrutamento (V3)'], ['optLabelMig', 'Nome da opção Migração (V3)'], ['optDescStaff', 'Descrição da opção Staff (V3 menu)'], ['optDescMig', 'Descrição da opção Migração (V3 menu)'],
];
function appearanceView(cfg) {
  const p = cfg.tickets.panel;
  const v3 = cfg.tickets.style === 'V3';
  const lines = [
    `**Modelo:** ${cfg.tickets.style} • **Cor:** \`${p.color}\``,
    `**Banner:** ${p.banner || '*nenhum*'}`,
    `**Thumbnail:** ${p.thumbnail || '*nenhuma*'}`,
    `**Rodapé:** ${p.footer || '*nenhum*'}`,
  ];
  if (v3) {
    lines.push(
      '**Controle do V3:** menu de seleção',
      `**Barra de cor do V3:** ${onoff(p.v3Accent)} *(desligada = só a borda fina)*`,
      '',
      `Use **Ver prévia** para conferir o painel. Os ícones dos botões/menu mudam em **Emojis e ícones**. Depois, publique de novo em **Publicar painel** — se já houver um painel V3 no mesmo canal, ele é atualizado no lugar.`
    );
  } else {
    lines.push('', 'Prévia do painel abaixo ⬇️');
  }
  const info = base(lbl('admAppearance', 'Aparência do painel'), lines.join('\n'));
  const select = new StringSelectMenuBuilder()
    .setCustomId('adc:tk:appfield')
    .setPlaceholder('Editar aparência do painel...')
    .addOptions(APP_OPTIONS.map(([value, label]) => ({ label, value, description: `Editar: ${label}`.slice(0, 100) })));
  const components = [row(select)];
  if (v3) {
    components.push(row(
      gbtn('adc:tk:preview', 'Ver prévia', 'admPreview'),
      gbtn('adc:t:tickets.panel.v3Accent', `Barra de cor: ${p.v3Accent ? 'ligada' : 'desligada'}`, 'admToggle')
    ));
  }
  components.push(back('adc:tk:home'));
  const embeds = v3 ? [info] : [info, ...buildPanel(cfg).embeds].slice(0, 10);
  return { embeds, components };
}

function messagesView(cfg) {
  const m = cfg.tickets.messages;
  const labels = { open: 'Ao abrir', claim: 'Ao assumir', finish: 'Ao finalizar (aprovado)', reject: 'Ao reprovar', close: 'Ao fechar' };
  const desc = Object.keys(labels).map((k) => `**${labels[k]}:**\n${trunc(m[k], 200)}`).join('\n\n') +
    '\n\nVariáveis: `{usuario}` `{recrutador}` `{tipo}` `{cargos}` `{numero}`';
  const select = new StringSelectMenuBuilder()
    .setCustomId('adc:tk:msgfield')
    .setPlaceholder('Editar mensagem...')
    .addOptions(Object.keys(labels).map((k) => ({ label: labels[k], value: k, description: 'Editar este texto' })));
  return { embeds: [base(lbl('admMessages', 'Mensagens dos tickets'), desc)], components: [row(select), back('adc:tk:home')] };
}

function formsView(cfg, type) {
  const names = { staff: 'Quero ser staff', migracao: 'Quero ser migrado' };
  if (!type) {
    const select = new StringSelectMenuBuilder()
      .setCustomId('adc:tk:formtype')
      .setPlaceholder('Escolha um formulário...')
      .addOptions(
        { label: names.staff, value: 'staff', description: `${cfg.tickets.questions.staff.length} pergunta(s)` },
        { label: names.migracao, value: 'migracao', description: `${cfg.tickets.questions.migracao.length} pergunta(s)` }
      );
    return { embeds: [base(lbl('admForms', 'Formulários'), 'Escolha qual formulário editar. Cada um aceita até **5 perguntas** (limite do Discord).')], components: [row(select), back('adc:tk:home')] };
  }
  const qs = cfg.tickets.questions[type];
  const list = qs.length
    ? qs.map((q, n) => `**${n + 1}.** ${q.label}\n└ *${q.long ? 'resposta longa' : 'resposta curta'} • ${q.required ? 'obrigatória' : 'opcional'}*`).join('\n')
    : '*Nenhuma pergunta cadastrada.*';
  const components = [];
  if (qs.length) {
    components.push(row(new StringSelectMenuBuilder().setCustomId(`adc:tk:qrem:${type}`).setPlaceholder('Remover uma pergunta...')
      .addOptions(qs.map((q, idx) => ({ label: `${idx + 1}. ${q.label}`.slice(0, 100), value: String(idx) })))));
  }
  components.push(row(
    gbtn(`adc:tk:qadd:${type}`, 'Adicionar pergunta', 'admAdd').setDisabled(qs.length >= MAX_Q),
    gbtn(`adc:tk:qreset:${type}`, 'Restaurar padrão', 'admRestore'),
    gbtn('adc:tk:forms', 'Voltar', 'admBack')
  ));
  return { embeds: [base(lbl('admForms', `Formulário — ${names[type]}`), list).setFooter({ text: `${qs.length}/${MAX_Q} perguntas` })], components };
}

function questionModal(type) {
  const inp = (id, label, required, ph, max) =>
    row(new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short).setRequired(required).setPlaceholder(ph).setMaxLength(max));
  return new ModalBuilder().setCustomId(`adc:tk:qm:${type}`).setTitle('Nova pergunta').addComponents(
    inp('label', 'Pergunta (máx. 45 caracteres)', true, 'Ex: Qual a sua idade?', 45),
    inp('placeholder', 'Texto de exemplo (placeholder)', false, 'Ex: 17', 100),
    inp('style', 'Resposta: curta ou longa', false, 'curta', 10),
    inp('required', 'Obrigatória? (sim ou não)', false, 'sim', 5)
  );
}

function tkRolesView(cfg) {
  const embed = base(lbl('admRoles', 'Cargos do recrutamento'), [
    `**Cargos atribuíveis:** ${roles(cfg.tickets.assignableRoleIds)}`,
    `**Cargos iniciais (Iniciante):** ${roles(cfg.tickets.inicianteRoleIds)}`,
    `**Hierarquia da migração:** ${roles(cfg.tickets.hierarchyRoleIds)} _(máx. ${cfg.tickets.hierarchyMax || 1} por migração)_`,
    '',
    'Os cargos atribuíveis aparecem no botão **Setar cargos** (ex: Mov Call, Mov Chat, Recrutamento, Eventos). Os cargos iniciais (ex: Promessa, Staff cargo inicial) são dados junto, automaticamente.',
    'No **ticket de migração**, o migrador escolhe também o **cargo de hierarquia** do servidor entre os cargos pré-definidos abaixo (além do cargo de área).',
  ].join('\n'));
  return {
    embeds: [embed],
    components: [
      row(new RoleSelectMenuBuilder().setCustomId('adc:tk:assignable').setPlaceholder('Cargos que o recrutador pode setar...').setMinValues(0).setMaxValues(25)),
      row(new RoleSelectMenuBuilder().setCustomId('adc:tk:inic').setPlaceholder('Cargos iniciais (Iniciante)...').setMinValues(0).setMaxValues(25)),
      row(new RoleSelectMenuBuilder().setCustomId('adc:tk:hier').setPlaceholder('Hierarquia da migração (cargos pré-definidos, até 25)...').setMinValues(0).setMaxValues(25)),
      row(new StringSelectMenuBuilder().setCustomId('adc:tk:hiermax').setPlaceholder(`Máximo de cargos de hierarquia por migração: ${cfg.tickets.hierarchyMax || 1}`)
        .addOptions([1, 2, 3, 4, 5].map((n) => ({ label: `${n} cargo${n > 1 ? 's' : ''} de hierarquia`, value: String(n), default: (cfg.tickets.hierarchyMax || 1) === n })))),
      back('adc:tk:home'),
    ],
  };
}

function tkPublishView() {
  return {
    embeds: [base(lbl('admPublish', 'Publicar painel de tickets'), 'Selecione o canal onde o painel será publicado.')],
    components: [
      row(new ChannelSelectMenuBuilder().setCustomId('adc:tk:publish').setPlaceholder('Canal do painel...').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
      back('adc:tk:home'),
    ],
  };
}

function pointsView(cfg) {
  const p = cfg.points;
  const embed = base(lbl('admPoints', 'Pontuação'), [
    `**Recrutamento concluído:** ${p.recruitment} pts`,
    `**Migração concluída:** ${p.migration} pts`,
    `**Plantão (fixo por plantão):** ${p.shiftFlat} pts`,
    `**Plantão (por hora):** ${p.shiftPerHour} pts`,
    `**Candidato reprovado:** ${p.reject} pts`,
    '',
    'Os pontos de plantão só entram no ranking quando a liderança **aceita** o plantão (logs do servidor interno).',
  ].join('\n'));
  return { embeds: [embed], components: [row(gbtn('adc:m:points', 'Editar pontuação', 'admEdit'), gbtn('adc:home', 'Voltar', 'admBack'))] };
}

function voiceView(cfg, gk) {
  const embed = base(lbl('voice', 'Call do bot'), [
    `**Servidor:** ${SERVER_NAMES[gk]}`,
    `**Call atual:** ${cfg.voice?.[gk] ? `<#${cfg.voice[gk]}>` : '_nenhuma — o bot não fica em call_'}`,
    '',
    'O bot entra na call escolhida, fica **mudo e ensurdecido** e volta sozinho se for desconectado ou o serviço reiniciar.',
    'Ele precisa das permissões **Ver canal** e **Conectar** nessa call.',
  ].join('\n'));
  return {
    embeds: [embed],
    components: [
      row(new ChannelSelectMenuBuilder().setCustomId('adc:vc:channel').setPlaceholder('Escolha a call onde o bot vai ficar...').setChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)),
      row(gbtn('adc:vc:leave', 'Tirar o bot da call', 'admClear'), gbtn('adc:home', 'Voltar', 'admBack')),
    ],
  };
}

function shiftView(cfg, gk) {
  const s = cfg.shift;
  const embed = base(lbl('admShift', 'Sistema de Plantão'), [
    `**Status:** ${onoff(s.enabled)}`,
    `**Quem pode iniciar:** ${roles(cfg.perms.internal.shift.length ? cfg.perms.internal.shift : cfg.perms.internal.recruiter)}`,
    `**Quem aceita/recusa (liderança):** ${roles(cfg.perms.internal.leader)}`,
    `**Categoria das calls (servidor principal):** ${s.categoryId ? `\`${s.categoryId}\`${s.categoryName ? ` — ${s.categoryName}` : ''}` : '*não definida — o plantão não inicia sem ela*'}`,
    `**Duração:** ${s.plannedMinutes} min • **Tolerância ao sair da call:** ${s.returnMinutes} min • **Envia esquecido para análise após:** ${s.maxHours} h`,
    `**Canais permitidos para iniciar:** ${chans(s.allowedChannelIds)}`,
    `**Pontos (ao ser aceito):** ${cfg.points.shiftFlat} fixos + ${cfg.points.shiftPerHour}/hora`,
    `**Painel:** ${chan(s.panelChannelId)}`,
    `**Logs de plantão:** ${chan(cfg.logs.internal.plantao || cfg.logs.internal.geral)}`,
    `**Regras:** ${trunc(s.rules || '—', 300)}`,
    '',
    'Variáveis das mensagens (DM): `{usuario}` `{minutos}` `{tolerancia}` `{call}` `{fim}` `{limite}` `{motivo}` `{tempo}`',
  ].join('\n'));
  if (gk !== 'internal') {
    embed.setDescription(`${wrongServer('internal')}\n\n${embed.data.description}`);
    return { embeds: [embed], components: [back()] };
  }
  return {
    embeds: [embed],
    components: [
      row(new RoleSelectMenuBuilder().setCustomId('adc:pl:roles').setPlaceholder('Quem pode iniciar plantão...').setMinValues(0).setMaxValues(10)),
      row(new ChannelSelectMenuBuilder().setCustomId('adc:pl:channels').setPlaceholder('Canais onde o plantão pode ser iniciado...').setChannelTypes(ChannelType.GuildText).setMinValues(0).setMaxValues(10)),
      row(
        new StringSelectMenuBuilder().setCustomId('adc:pl:msg').setPlaceholder('Editar mensagem enviada no privado...').addOptions(
          { label: 'Ao iniciar o plantão', value: 'start', description: 'DM enviada quando o plantão começa' },
          { label: 'Ao sair da call', value: 'leave', description: 'DM enviada quando a pessoa sai da call' },
          { label: 'Plantão cancelado', value: 'cancel', description: 'DM enviada quando o plantão é cancelado' },
          { label: 'Saiu e não voltou', value: 'incomplete', description: 'DM quando o tempo para voltar acaba (vai para análise)' },
          { label: 'Plantão concluído', value: 'done', description: 'DM enviada quando o tempo é cumprido' }
        )
      ),
      row(
        gbtn('adc:t:shift.enabled', `Plantão: ${s.enabled ? 'ligado' : 'desligado'}`, 'admToggle'),
        gbtn('adc:m:shift', 'Tempos e regras', 'admEdit'),
        gbtn('adc:pl:cat', 'Categoria das calls', 'voice'),
        gbtn('adc:pl:pubmenu', 'Publicar painel', 'admPublish')
      ),
      row(gbtn('adc:pl:active', 'Plantões ativos', 'admActive'), gbtn('adc:pl:clearch', 'Limpar canais', 'admClear'), gbtn('adc:home', 'Voltar', 'admBack')),
    ],
  };
}

function shiftPublishView() {
  return {
    embeds: [base(lbl('admPublish', 'Publicar painel de plantão'), 'Selecione o canal (do servidor interno) onde o painel **Iniciar / Finalizar Plantão** será publicado.')],
    components: [
      row(new ChannelSelectMenuBuilder().setCustomId('adc:pl:publish').setPlaceholder('Canal do painel de plantão...').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
      back('adc:pl:home'),
    ],
  };
}

async function shiftActiveView() {
  const list = await Shift.find({ status: 'active' }).sort({ startedAt: 1 }).limit(25).lean();
  const desc = list.length
    ? list.map((s) => `• <@${s.userId}> — ${s.presence === 'away' ? '⚠️ fora da call' : 'na call'} (${s.voiceName || '—'}) • início ${ts(s.startedAt)} • previsto ${ts(s.plannedEnd, 'R')}`).join('\n')
    : '*Nenhum plantão ativo no momento.*';
  const components = [];
  if (list.length) {
    components.push(row(new StringSelectMenuBuilder().setCustomId('adc:pl:force').setPlaceholder('Cancelar o plantão de alguém...')
      .addOptions(list.map((s) => ({ label: (s.userTag || s.userId).slice(0, 100), value: String(s._id), description: `ID ${s.userId}` })))));
  }
  components.push(back('adc:pl:home'));
  return { embeds: [base(lbl('admActive', 'Plantões ativos'), desc)], components };
}

function rankingView(cfg, gk) {
  const r = cfg.ranking;
  const embed = base(lbl('admRanking', 'Ranking de Recrutamento'), [
    `**Status:** ${onoff(r.enabled)}`,
    `**Canal do ranking:** ${chan(r.channelId)}`,
    `**Atualização automática:** ${onoff(r.auto)} (a cada ${r.intervalMin} min, além de atualizar a cada recrutamento/plantão)`,
    `**Tamanho:** Top ${r.topSize}`,
  ].join('\n'));
  if (gk !== 'internal') {
    embed.setDescription(`${wrongServer('internal')}\n\n${embed.data.description}`);
    return { embeds: [embed], components: [back()] };
  }
  return {
    embeds: [embed],
    components: [
      row(new ChannelSelectMenuBuilder().setCustomId('adc:rk:channel').setPlaceholder('Canal do ranking...').setChannelTypes(ChannelType.GuildText)),
      row(
        gbtn('adc:t:ranking.enabled', `Ranking: ${r.enabled ? 'ligado' : 'desligado'}`, 'admToggle'),
        gbtn('adc:t:ranking.auto', `Auto: ${r.auto ? 'ligado' : 'desligado'}`, 'admAuto'),
        gbtn('adc:rk:refresh', 'Atualizar agora', 'admRefresh'),
        gbtn('adc:m:ranking', 'Top e intervalo', 'admEdit')
      ),
      row(gbtn('adc:rk:view', 'Personalizar', 'admAppearance'), gbtn('adc:rk:adjust', 'Ajustar pontos', 'admAdd'), gbtn('adc:rk:reset', 'Resetar ranking', 'admReset'), gbtn('adc:home', 'Voltar', 'admBack')),
    ],
  };
}

const LOG_LABELS = {
  main: { geral: 'Geral (padrão)', tickets: 'Logs de tickets', recrutamento: 'Logs de recrutamento' },
  internal: { geral: 'Geral (padrão)', tickets: 'Logs de tickets', recrutamento: 'Logs de recrutamento', plantao: 'Logs de plantão', admin: 'Logs administrativas' },
};
function logsView(cfg, gk, key) {
  const labels = LOG_LABELS[gk];
  const lines = Object.entries(labels).map(([k, l]) => `**${l}:** ${chan(cfg.logs[gk][k])}`);
  const note = gk === 'internal'
    ? `${E('warn')} Os **logs de plantão** são registrados obrigatoriamente neste servidor.`
    : 'Tipos sem canal usam o canal **Geral**.';
  const embed = base(lbl('admLogs', `Logs — ${SERVER_NAMES[gk]}`), `${lines.join('\n')}\n\n${note}\nEscolha abaixo qual log configurar.`);
  const select = new StringSelectMenuBuilder().setCustomId('adc:lg:pick').setPlaceholder('Qual log configurar?')
    .addOptions(Object.entries(labels).map(([k, l]) => ({ label: l, value: k, default: k === key })));
  const components = [row(select)];
  if (key) {
    components.push(row(new ChannelSelectMenuBuilder().setCustomId(`adc:lg:set:${key}`).setPlaceholder(`Canal para: ${labels[key]}`).setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)));
    components.push(row(gbtn(`adc:lg:clear:${key}`, 'Remover canal', 'admClear'), gbtn('adc:home', 'Voltar', 'admBack')));
  } else {
    components.push(back());
  }
  return { embeds: [embed], components };
}

const PERM_LABELS = { admin: 'Administradores', leader: 'Liderança', recruiter: 'Recrutadores', migrator: 'Habilitados à migração', shift: 'Responsáveis pelo plantão' };
function permsView(cfg, gk) {
  const keys = gk === 'internal' ? ['admin', 'leader', 'recruiter', 'shift'] : ['admin', 'leader', 'recruiter', 'migrator'];
  const p = cfg.perms[gk];
  const embed = base(lbl('admPerms', `Permissões — ${SERVER_NAMES[gk]}`), [
    ...keys.map((k) => `**${PERM_LABELS[k]}:** ${roles(p[k])}`),
    ...(gk === 'main' ? ['', '**Recrutadores** veem só os tickets de **staff** • **Habilitados à migração** veem só os tickets de **migração**.'] : []),
    '',
    'Quem tem a permissão **Administrador** do Discord (ou um cargo de `FULL_ACCESS_ROLE_IDS` no .env) sempre tem acesso total.',
    'As permissões são por servidor: rode `/admin-classico` no outro servidor para configurar os cargos de lá.',
  ].join('\n'));
  return {
    embeds: [embed],
    components: [
      ...keys.map((k) => row(new RoleSelectMenuBuilder().setCustomId(`adc:pm:${k}`).setPlaceholder(`${PERM_LABELS[k]}...`).setMinValues(0).setMaxValues(10))),
      back(),
    ],
  };
}

// ---------- personalizar o ranking ----------
const RANK_FIELDS = [
  ['title', 'Título'], ['lineTemplate', 'Modelo de cada linha'], ['unit', 'Nome da pontuação'], ['footer', 'Rodapé'],
  ['color', 'Cor'], ['banner', 'Banner'], ['thumbnail', 'Thumbnail'], ['emptyText', 'Texto quando vazio'],
  ['description', 'Texto acima da lista'], ['podiumCount', 'Quantidade no pódio'], ['podiumTemplate', 'Modelo do pódio'], ['totalsTemplate', 'Linha de totais'],
];
function rankViewView(cfg, gk) {
  const v = cfg.ranking.view;
  const isV3 = v.style === 'v3';
  const embed = base(lbl('admRanking', 'Personalizar ranking'), [
    `**Estilo:** ${isV3 ? 'V3 (bordas finas)' : 'Embed clássico'}${isV3 ? ` • **Barra de cor:** ${onoff(v.v3Accent)}` : ''}`,
    `**Título:** ${lbl('rankTitle', v.title)}`,
    `**Ordenar por:** ${SORTS[v.sortBy]?.label ?? 'Pontos'} • **Nome da pontuação:** \`${v.unit}\``,
    `**Cor:** \`${v.color}\` • **Hora no rodapé:** ${onoff(v.showTimestamp)}`,
    `**Banner:** ${v.banner || '*nenhum*'} • **Thumbnail:** ${v.thumbnail || '*nenhuma*'}`,
    `**Pódio:** ${v.podiumCount > 0 ? `top ${v.podiumCount} com modelo próprio` : 'desligado'} • **Espaço entre posições:** ${SPACING_LABEL[v.spacing] ?? 'Automático'} • **Totais:** ${v.totalsTemplate ? 'sim' : 'não'}`,
    `**Rodapé:** ${v.footer ? `\`${trunc(v.footer, 100)}\`` : '*nenhum*'}`,
    '',
    '**Modelo de cada linha:**',
    '```',
    trunc(String(v.lineTemplate).replace(/```/g, "'''"), 400),
    '```',
    'Variáveis: `{emoji}` `{pos}` `{usuario}` `{nome}` `{id}` `{pontos}` `{unidade}` `{staff}` `{migracoes}` `{atendidos}` `{recrutamentos}` `{plantoes}` `{tempo}` `{iconePontos}` `{iconeRec}` `{iconeMig}` `{iconePlantoes}` `{iconeTempo}`',
    'Totais: `{membros}` `{totalPontos}` `{totalStaff}` `{totalMigracoes}` `{totalAtendidos}` `{totalPlantoes}` `{totalTempo}`',
    'Dica: `-# texto` deixa a linha pequena e discreta (ótimo para os detalhes de cada pessoa).',
    '',
    'Os emojis do 1º, 2º, 3º lugar… ficam em **Emojis e ícones → Ranking (posições)**.',
  ].join('\n'));
  if (gk !== 'internal') {
    embed.setDescription(`${wrongServer('internal')}\n\n${embed.data.description}`);
    return { embeds: [embed], components: [back()] };
  }
  const select = new StringSelectMenuBuilder()
    .setCustomId('adc:rk:viewfield')
    .setPlaceholder('Editar o visual do ranking...')
    .addOptions(RANK_FIELDS.map(([value, label]) => ({ label, value, description: `Editar: ${label}`.slice(0, 100) })));
  return {
    embeds: [embed],
    components: [
      row(select),
      row(
        gbtn('adc:rk:style', `Estilo: ${isV3 ? 'V3' : 'Embed'}`, 'admStyle'),
        gbtn('adc:rk:sort', `Ordem: ${SORTS[v.sortBy]?.label ?? 'Pontos'}`, 'admSort'),
        gbtn('adc:t:ranking.view.showTimestamp', `Hora: ${v.showTimestamp ? 'sim' : 'não'}`, 'admToggle'),
        gbtn('adc:t:ranking.view.v3Accent', `Barra V3: ${v.v3Accent ? 'sim' : 'não'}`, 'admToggle')
      ),
      row(
        gbtn('adc:rk:theme:elegant', 'Tema elegante', 'admStyle'),
        gbtn('adc:rk:preset:simple', 'Linha simples', 'admEdit'),
        gbtn('adc:rk:preset:compact', 'Linha compacta', 'admEdit'),
        gbtn('adc:rk:preset:detail', 'Linha detalhada', 'admEdit'),
        gbtn('adc:rk:preset:elegant', 'Linha elegante', 'admEdit')
      ),
      row(
        gbtn('adc:rk:space', `Espaço: ${SPACING_LABEL[v.spacing] ?? 'Automático'}`, 'admSort'),
        gbtn('adc:rk:preview', 'Ver prévia', 'admPreview'),
        gbtn('adc:em:go:ranking_pos', 'Emojis das posições', 'admEmojis'),
        gbtn('adc:rk:home', 'Voltar', 'admBack')
      ),
    ],
  };
}

// ---------- emojis e ícones ----------
function emojisView(cfg, groupId) {
  const g = GROUPS.find((x) => x.id === groupId);
  if (!g) {
    const changed = Object.values(cfg.emojis || {}).filter((v) => v !== null && v !== undefined).length;
    const embed = base(lbl('admEmojis', 'Emojis e ícones'), [
      'Troque o emoji de **botões, menus, títulos, status, ranking e logs**.',
      '',
      '• Emoji comum: `🏆`',
      '• Emoji do seu servidor: `<:nome:ID>` (animado: `<a:nome:ID>`) — escreva `\\:nome:` no Discord e copie o resultado',
      '• `nenhum` tira o emoji • campo vazio volta ao padrão',
      '',
      ...GROUPS.map((x) => `${x.emoji} **${x.label}** — ${x.items.length} emojis`),
      '',
      `**Emojis alterados:** ${changed}`,
      '*Emojis de outros servidores só aparecem se o bot estiver nesse servidor. Painéis já publicados são atualizados ao publicar de novo.*',
    ].join('\n'));
    const select = new StringSelectMenuBuilder()
      .setCustomId('adc:em:group')
      .setPlaceholder('Escolha um grupo de emojis...')
      .addOptions(GROUPS.map((x) => ({ label: x.label, value: x.id, emoji: { name: x.emoji }, description: `${x.items.length} emojis` })));
    return { embeds: [embed], components: [row(select), row(gbtn('adc:em:resetall', 'Restaurar todos', 'admRestore'), gbtn('adc:home', 'Voltar', 'admBack'))] };
  }
  const lines = g.items.map(([k, label]) => `${E(k) || '▫️'} **${label}**${isChanged(k) ? ' *(alterado)*' : ''}${E(k) ? '' : ' — *sem emoji*'}\n└ \`${k}\``);
  const embed = base(`${g.emoji} ${g.label}`, `Escolha abaixo qual emoji trocar.\n\n${lines.join('\n')}`);
  const select = new StringSelectMenuBuilder()
    .setCustomId('adc:em:pick')
    .setPlaceholder('Qual emoji trocar?')
    .addOptions(g.items.map(([k, label, def]) => opt(label.slice(0, 100), k, `Padrão: ${def || 'sem emoji'}`, k)));
  return {
    embeds: [embed],
    components: [
      row(select),
      row(gbtn(`adc:em:resetgrp:${g.id}`, 'Restaurar este grupo', 'admRestore'), gbtn('adc:em:home', 'Voltar', 'admBack')),
    ],
  };
}

function emojiModal(key) {
  const input = new TextInputBuilder()
    .setCustomId('emoji')
    .setLabel(LABELS[key].slice(0, 45))
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(60)
    .setPlaceholder('Emoji, <:nome:ID>, "nenhum" (sem emoji) ou vazio (padrão)');
  const now = emojiNow(key);
  if (isChanged(key) && now) input.setValue(now);
  return new ModalBuilder().setCustomId(`adc:em:set:${key}`).setTitle('Trocar emoji').addComponents(row(input));
}

async function renderScreen(name, cfg, gk, arg) {
  switch (name) {
    case 'home': return homeView(cfg, gk);
    case 'tickets': return ticketsView(cfg, gk);
    case 'presets': return presets.presetsHome(cfg, gk);
    case 'appearance': return appearanceView(cfg);
    case 'messages': return messagesView(cfg);
    case 'forms': return formsView(cfg, arg);
    case 'tkroles': return tkRolesView(cfg);
    case 'tkpublish': return tkPublishView();
    case 'points': return pointsView(cfg);
    case 'shift': return shiftView(cfg, gk);
    case 'shiftpublish': return shiftPublishView();
    case 'shiftactive': return shiftActiveView();
    case 'ranking': return rankingView(cfg, gk);
    case 'rankview': return rankViewView(cfg, gk);
    case 'emojis': return emojisView(cfg, arg);
    case 'logs': return logsView(cfg, gk, arg);
    case 'voice': return voiceView(cfg, gk);
    case 'perms': return permsView(cfg, gk);
  }
  return homeView(cfg, gk);
}

// ============================================================
// Entradas
// ============================================================
async function adminCommand(i) {
  const gk = guildKey(i.guildId);
  if (!gk) return i.reply(deny(`${E('bad')} Servidor não autorizado.`));
  const cfg = await getCfg();
  if (!perms(i.member, cfg).isAdmin) return i.reply(deny(`${E('bad')} Você não tem permissão para usar o painel administrativo.`));
  return i.reply({ ...homeView(cfg, gk), ephemeral: true });
}

// /ajustar → define manualmente recrutamentos, migrações, plantões e pontos de uma pessoa
async function adjustCommand(i) {
  const gk = guildKey(i.guildId);
  if (!gk) return i.reply(deny(`${E('bad')} Servidor não autorizado.`));
  const cfg = await getCfg();
  if (!perms(i.member, cfg).isAdmin) return i.reply(deny(`${E('bad')} Você não tem permissão para ajustar o ranking.`));
  if (gk !== 'internal') return i.reply(deny(wrongServer('internal')));
  const user = i.options.getUser('usuario', true);
  const want = {
    staff: i.options.getInteger('recrutamentos'),
    mig: i.options.getInteger('migracoes'),
    shifts: i.options.getInteger('plantoes'),
    points: i.options.getInteger('pontos'),
  };
  if (Object.values(want).every((v) => v === null)) {
    return i.reply(deny(`${E('bad')} Informe pelo menos um valor: recrutamentos, migrações, plantões ou pontos.`));
  }
  await i.deferReply({ ephemeral: true });

  // histórico real desde o último reset (a reconciliação soma o ajuste manual por cima dele)
  const last = await LogEntry.findOne({ category: 'admin', action: 'Reset do ranking' }).sort({ at: -1 }).lean();
  const since = last?.at ?? new Date(0);
  const [recH, migH, shH, cur] = await Promise.all([
    Recruitment.countDocuments({ recruiterId: user.id, at: { $gte: since } }),
    Recruitment.countDocuments({ recruiterId: user.id, type: 'migracao', at: { $gte: since } }),
    Shift.countDocuments({
      userId: user.id,
      status: { $in: ['approved', 'done'] },
      $expr: { $gte: [{ $ifNull: ['$reviewedAt', '$endedAt'] }, since] },
    }),
    UserStat.findOne({ userId: user.id }).lean(),
  ]);

  const curMig = cur?.migrations || 0;
  const curStaff = (cur?.recruitments || 0) - curMig;
  const curShifts = cur?.shifts || 0;
  const newStaff = want.staff ?? curStaff;
  const newMig = want.mig ?? curMig;
  const newShifts = want.shifts ?? curShifts;

  const set = { name: user.username, recruitments: newStaff + newMig, migrations: newMig, shifts: newShifts, updatedAt: new Date() };
  if (want.points !== null) set.points = want.points;
  if (want.staff !== null) set.adjStaff = want.staff - (recH - migH);
  if (want.mig !== null) set.adjMig = want.mig - migH;
  if (want.shifts !== null) set.adjShifts = want.shifts - shH;
  await UserStat.updateOne({ userId: user.id }, { $set: set }, { upsert: true });

  const parts = [];
  if (want.staff !== null) parts.push(`recrutamentos de staff: **${curStaff} → ${newStaff}**`);
  if (want.mig !== null) parts.push(`migrações: **${curMig} → ${newMig}**`);
  if (want.shifts !== null) parts.push(`plantões: **${curShifts} → ${newShifts}**`);
  if (want.points !== null) parts.push(`pontos: **${cur?.points || 0} → ${want.points}**`);
  logAdmin(i, cfg, 'Ajuste manual do ranking', `${user} (\`${user.id}\`)\n${parts.join('\n')}`);
  await refreshRanking(i.client, { manual: true }).catch(() => {});
  return i.editReply({ content: `${E('ok')} Ranking de ${user} atualizado:\n${parts.join('\n')}`, allowedMentions: { parse: [] } });
}

// /emojis → abre direto a tela de emojis (só administradores)
async function emojisCommand(i) {
  const gk = guildKey(i.guildId);
  if (!gk) return i.reply(deny(`${E('bad')} Servidor não autorizado.`));
  const cfg = await getCfg();
  if (!perms(i.member, cfg).isAdmin) return i.reply(deny(`${E('bad')} Você não tem permissão para trocar os emojis.`));
  return i.reply({ ...emojisView(cfg), ephemeral: true });
}

async function handleAdmin(i) {
  const gk = guildKey(i.guildId);
  if (!gk) return i.reply(deny(`${E('bad')} Servidor não autorizado.`));
  let cfg = await getCfg();
  if (!perms(i.member, cfg).isAdmin) return i.reply(deny(`${E('bad')} Você não tem permissão para usar o painel administrativo.`));

  // Presets de tickets: tem módulo próprio (src/presets.js)
  if (i.customId.startsWith('adc:pr:')) return presets.handlePreset(i, cfg, gk);

  const [, scope, action, ...rest] = i.customId.split(':');
  const arg = rest[0];
  const show = (view, extra = {}) => {
    const payload = { content: '', ...view, ...extra };
    return i.deferred || i.replied ? i.editReply(payload) : i.update(payload);
  };
  const screen = async (name, a) => show(await renderScreen(name, cfg, gk, a));
  const fail = (msg) => i.reply(deny(msg));
  const apply = async (path, value, label) => {
    await setCfg(path, value);
    cfg = await getCfg();
    logAdmin(i, cfg, 'Alteração de configurações', `**${label}**\n\`${path}\` → ${fmt(value)}`);
  };
  const needGuild = (k) => (gk === k ? null : fail(wrongServer(k)));

  // --- campos de modal (um campo) ---
  if (scope === 'f') {
    const d = FIELDS[action];
    if (!d) return;
    const g = guildForPath(action);
    if (g && gk !== g) return fail(wrongServer(g));
    const { value, error } = parseValue(d, i.fields.getTextInputValue(action));
    if (error) return fail(`${E('bad')} ${error}`);
    await apply(action, value, d.label);
    if (action.startsWith('ranking.view.')) {
      await i.deferUpdate();
      await refreshRanking(i.client, { manual: true }).catch(() => {});
    }
    return screen(d.screen);
  }

  // --- modais com vários campos ---
  if (scope === 'm') {
    const m = MODALS[action];
    if (!m) return;
    if (m.guild && gk !== m.guild) return fail(wrongServer(m.guild));
    if (i.isButton()) return i.showModal(buildModal(`adc:m:${action}`, m.title, m.paths.map((p) => FIELDS[p]), cfg));
    const updates = {};
    for (const p of m.paths) {
      const { value, error } = parseValue(FIELDS[p], i.fields.getTextInputValue(p));
      if (error) return fail(`${E('bad')} ${error}`);
      updates[p] = value;
    }
    for (const [p, v] of Object.entries(updates)) await apply(p, v, FIELDS[p].label);
    return screen(m.screen);
  }

  // --- liga/desliga ---
  if (scope === 't') {
    if (!(action in TOGGLES)) return;
    const g = guildForPath(action);
    if (g && gk !== g) return fail(wrongServer(g));
    await apply(action, !getPath(cfg, action), `Alternado: ${action}`);
    if (action.startsWith('ranking.view.')) {
      await i.deferUpdate();
      await refreshRanking(i.client, { manual: true }).catch(() => {});
    }
    return screen(TOGGLES[action]);
  }

  const key = action === undefined ? scope : `${scope}:${action}`;
  switch (key) {
    case 'home': return screen('home');
    case 'menu': return screen(i.values[0]);

    // ======== TICKETS (servidor principal) ========
    case 'tk:home': return screen('tickets');
    case 'tk:menu': {
      if (needGuild('main')) return;
      const v = i.values[0];
      if (v === 'naming') return i.showModal(buildModal('adc:f:tickets.nameTemplate', 'Nome dos tickets', [FIELDS['tickets.nameTemplate']], cfg));
      if (v === 'usethread') {
        await apply('tickets.useThread', !cfg.tickets.useThread, 'Ticket em tópico');
        return screen('tickets');
      }
      if (v === 'reqshift') { await apply('tickets.requireShiftToClaim', !cfg.tickets.requireShiftToClaim, 'Exigir plantão para assumir'); return screen('tickets'); }
      return screen({ appearance: 'appearance', messages: 'messages', forms: 'forms', roles: 'tkroles', publish: 'tkpublish', presets: 'presets' }[v]);
    }
    case 'tk:category': if (needGuild('main')) return; await apply('tickets.categoryId', i.values[0], 'Categoria dos tickets'); return screen('tickets');
    case 'tk:threadch': if (needGuild('main')) return; await apply('tickets.threadChannelId', i.values[0], 'Canal dos tópicos dos tickets'); return screen('tickets');
    case 'tk:access': if (needGuild('main')) return; await apply('tickets.accessRoleIds', i.values, 'Cargos com acesso aos tickets'); return screen('tickets');
    case 'tk:style': if (needGuild('main')) return; await apply('tickets.style', arg, 'Modelo do painel'); return screen('tickets');
    case 'tk:appfield': if (needGuild('main')) return; return i.showModal(buildModal(`adc:f:tickets.panel.${i.values[0]}`, 'Editar painel', [FIELDS[`tickets.panel.${i.values[0]}`]], cfg));
    case 'tk:msgfield': if (needGuild('main')) return; return i.showModal(buildModal(`adc:f:tickets.messages.${i.values[0]}`, 'Editar mensagem', [FIELDS[`tickets.messages.${i.values[0]}`]], cfg));
    case 'tk:preview': {
      if (needGuild('main')) return;
      const payload = buildPanel(cfg, { preview: true });
      return i.reply({ ...payload, flags: (payload.flags ?? 0) | MessageFlags.Ephemeral });
    }
    case 'tk:forms': return screen('forms');
    case 'tk:formtype': return screen('forms', i.values[0]);
    case 'tk:qadd': return i.showModal(questionModal(arg));
    case 'tk:qm': {
      if (!['staff', 'migracao'].includes(arg)) return;
      const qs = clone(cfg.tickets.questions[arg]);
      if (qs.length >= MAX_Q) return fail(`${E('bad')} Limite de 5 perguntas atingido.`);
      const style = i.fields.getTextInputValue('style').trim().toLowerCase();
      const req = i.fields.getTextInputValue('required').trim().toLowerCase();
      qs.push({
        label: i.fields.getTextInputValue('label').trim(),
        placeholder: i.fields.getTextInputValue('placeholder').trim(),
        long: style.startsWith('l'),
        required: !['n', 'nao', 'não'].includes(req),
      });
      await setCfg(`tickets.questions.${arg}`, qs);
      cfg = await getCfg();
      logAdmin(i, cfg, 'Alteração de configurações', `**Pergunta adicionada (${arg}):** ${qs[qs.length - 1].label}`);
      return screen('forms', arg);
    }
    case 'tk:qrem': {
      const qs = clone(cfg.tickets.questions[arg]);
      qs.splice(Number(i.values[0]), 1);
      await setCfg(`tickets.questions.${arg}`, qs);
      cfg = await getCfg();
      logAdmin(i, cfg, 'Alteração de configurações', `**Pergunta removida (${arg})**`);
      return screen('forms', arg);
    }
    case 'tk:qreset': {
      await setCfg(`tickets.questions.${arg}`, clone(DEFAULT_QUESTIONS[arg]));
      cfg = await getCfg();
      logAdmin(i, cfg, 'Alteração de configurações', `**Formulário restaurado ao padrão (${arg})**`);
      return screen('forms', arg);
    }
    case 'tk:assignable': if (needGuild('main')) return; await apply('tickets.assignableRoleIds', i.values, 'Cargos atribuíveis'); return screen('tkroles');
    case 'tk:hier': if (needGuild('main')) return; await apply('tickets.hierarchyRoleIds', i.values, 'Hierarquia da migração'); return screen('tkroles');
    case 'tk:hiermax': if (needGuild('main')) return; await apply('tickets.hierarchyMax', Number(i.values[0]), 'Máximo de cargos de hierarquia'); return screen('tkroles');
    case 'tk:inic': if (needGuild('main')) return; await apply('tickets.inicianteRoleIds', i.values, 'Cargos iniciais (Iniciante)'); await setCfg('tickets.inicianteRoleId', null); cfg = await getCfg(); return screen('tkroles');
    case 'tk:publish': {
      if (needGuild('main')) return;
      const channel = await i.guild.channels.fetch(i.values[0]).catch(() => null);
      try {
        const { message, kind } = await publishPanel(i.client, cfg, channel);
        await setCfg('tickets.panelChannelId', channel.id);
        await setCfg('tickets.panelMessageId', message.id);
        await setCfg('tickets.panelKind', kind);
      } catch (e) {
        console.error('[admin:publish]', e.message);
        return fail(`${E('bad')} Não consegui publicar em ${channel ?? 'esse canal'}. Verifique as permissões do bot.`);
      }
      cfg = await getCfg();
      logAdmin(i, cfg, 'Painel de tickets publicado', `Canal: ${channel} • Modelo ${cfg.tickets.style}`);
      return show(await renderScreen('tickets', cfg, gk), { content: `${E('ok')} Painel publicado em ${channel}.` });
    }

    // ======== PLANTÃO (servidor interno) ========
    case 'pl:home': return screen('shift');
    case 'vc:channel': {
      await apply(`voice.${gk}`, i.values[0], `Call do bot (${SERVER_NAMES[gk]})`);
      voz.ensure(i.client, i.guildId).catch(() => {});
      return screen('voice');
    }
    case 'vc:leave': {
      await apply(`voice.${gk}`, null, `Call do bot removida (${SERVER_NAMES[gk]})`);
      voz.ensure(i.client, i.guildId).catch(() => {});
      return screen('voice');
    }
    case 'pl:roles': if (needGuild('internal')) return; await apply('perms.internal.shift', i.values, 'Quem pode iniciar plantão'); return screen('shift');
    case 'pl:channels': if (needGuild('internal')) return; await apply('shift.allowedChannelIds', i.values, 'Canais permitidos do plantão'); return screen('shift');
    case 'pl:clearch': if (needGuild('internal')) return; await apply('shift.allowedChannelIds', [], 'Canais permitidos do plantão'); return screen('shift');
    case 'pl:pubmenu': if (needGuild('internal')) return; return screen('shiftpublish');
    case 'pl:publish': {
      if (needGuild('internal')) return;
      const channel = await i.guild.channels.fetch(i.values[0]).catch(() => null);
      try {
        const msg = await channel.send(buildShiftPanel(cfg));
        await setCfg('shift.panelChannelId', channel.id);
        await setCfg('shift.panelMessageId', msg.id);
      } catch (e) {
        console.error('[admin:publish-shift]', e.message);
        return fail(`${E('bad')} Não consegui publicar em ${channel ?? 'esse canal'}. Verifique as permissões do bot.`);
      }
      cfg = await getCfg();
      logAdmin(i, cfg, 'Painel de plantão publicado', `Canal: ${channel}`);
      return show(await renderScreen('shift', cfg, gk), { content: `${E('ok')} Painel de plantão publicado em ${channel}.` });
    }
    case 'pl:active': if (needGuild('internal')) return; return screen('shiftactive');
    case 'pl:force': {
      if (needGuild('internal')) return;
      await i.deferUpdate();
      const res = await cancelShift(i.client, i.values[0], { byId: i.user.id, reason: `Cancelado manualmente por ${i.user.username} (liderança).` });
      logAdmin(i, cfg, 'Plantão cancelado manualmente', res ? `Sessão \`${i.values[0]}\`` : 'Plantão já estava encerrado.');
      return screen('shiftactive');
    }
    case 'pl:msg': {
      if (needGuild('internal')) return;
      const k = i.values[0];
      if (!FIELDS[`shift.messages.${k}`]) return;
      return i.showModal(buildModal(`adc:f:shift.messages.${k}`, 'Mensagem enviada no privado', [FIELDS[`shift.messages.${k}`]], cfg));
    }
    case 'pl:cat': {
      if (needGuild('internal')) return;
      const input = new TextInputBuilder()
        .setCustomId('id')
        .setLabel('ID da categoria (servidor principal)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(25)
        .setPlaceholder('Cole o ID da categoria. Vazio = remover');
      if (cfg.shift.categoryId) input.setValue(cfg.shift.categoryId);
      return i.showModal(new ModalBuilder().setCustomId('adc:pl:catset').setTitle('Categoria das calls de plantão').addComponents(row(input)));
    }
    case 'pl:catset': {
      if (needGuild('internal')) return;
      const raw = i.fields.getTextInputValue('id').trim();
      if (!raw) {
        await apply('shift.categoryId', null, 'Categoria das calls de plantão removida');
        await setCfg('shift.categoryName', null);
        return screen('shift');
      }
      if (!/^\d{15,25}$/.test(raw)) return fail(`${E('bad')} ID inválido. Ative o Modo Desenvolvedor, clique com o botão direito na categoria e escolha **Copiar ID**.`);
      const main = i.client.guilds.cache.get(MAIN_ID);
      const category = main ? await main.channels.fetch(raw).catch(() => null) : null;
      if (!category) return fail(`${E('bad')} Não encontrei esse ID no **servidor principal**. Confira se copiou o ID da categoria certa e se o bot está no servidor principal.`);
      if (category.type !== ChannelType.GuildCategory) return fail(`${E('bad')} Esse ID é de **${category.name}**, que não é uma categoria. Copie o ID da **categoria** onde ficam as calls de plantão.`);
      await apply('shift.categoryId', raw, `Categoria das calls de plantão: ${category.name}`);
      await setCfg('shift.categoryName', category.name);
      return screen('shift');
    }

    // ======== RANKING (servidor interno) ========
    case 'rk:channel': {
      if (needGuild('internal')) return;
      await i.deferUpdate();
      await apply('ranking.channelId', i.values[0], 'Canal do ranking');
      await setCfg('ranking.messageId', null);
      await setCfg('ranking.messageKind', null);
      const r = await refreshRanking(i.client, { manual: true });
      return show(await renderScreen('ranking', await getCfg(), gk), { content: r.ok ? `${E('ok')} Ranking publicado no canal.` : `${E('warn')} ${r.reason}` });
    }
    case 'rk:home': return screen('ranking');
    case 'rk:view': if (needGuild('internal')) return; return screen('rankview');
    case 'rk:viewfield': {
      if (needGuild('internal')) return;
      const path = `ranking.view.${i.values[0]}`;
      if (!FIELDS[path]) return;
      return i.showModal(buildModal(`adc:f:${path}`, 'Personalizar ranking', [FIELDS[path]], cfg));
    }
    case 'rk:style': {
      if (needGuild('internal')) return;
      await i.deferUpdate();
      await apply('ranking.view.style', cfg.ranking.view.style === 'v3' ? 'embed' : 'v3', 'Estilo do ranking');
      await refreshRanking(i.client, { manual: true }).catch(() => {});
      return screen('rankview');
    }
    case 'rk:sort': {
      if (needGuild('internal')) return;
      await i.deferUpdate();
      const keys = Object.keys(SORTS);
      const next = keys[(keys.indexOf(cfg.ranking.view.sortBy) + 1) % keys.length];
      await apply('ranking.view.sortBy', next, 'Ordenação do ranking');
      await refreshRanking(i.client, { manual: true }).catch(() => {});
      return screen('rankview');
    }
    case 'rk:preset': {
      if (needGuild('internal')) return;
      if (!LINE_PRESETS[arg]) return;
      await i.deferUpdate();
      await apply('ranking.view.lineTemplate', LINE_PRESETS[arg], 'Modelo da linha do ranking');
      await refreshRanking(i.client, { manual: true }).catch(() => {});
      return screen('rankview');
    }
    case 'rk:theme': {
      if (needGuild('internal')) return;
      const theme = THEMES[arg];
      if (!theme) return;
      await i.deferUpdate();
      for (const [k, val] of Object.entries(theme)) await setCfg(`ranking.view.${k}`, val);
      logAdmin(i, cfg, 'Tema do ranking aplicado', `Tema **${arg}** aplicado (estilo, linhas, pódio e totais).`);
      await refreshRanking(i.client, { manual: true }).catch(() => {});
      return screen('rankview');
    }
    case 'rk:space': {
      if (needGuild('internal')) return;
      await i.deferUpdate();
      const next = SPACINGS[(SPACINGS.indexOf(cfg.ranking.view.spacing) + 1) % SPACINGS.length];
      await apply('ranking.view.spacing', next, 'Espaço entre as posições do ranking');
      await refreshRanking(i.client, { manual: true }).catch(() => {});
      return screen('rankview');
    }
    case 'rk:preview': {
      if (needGuild('internal')) return;
      const payload = await buildRankingPayload(cfg);
      return i.reply({ ...payload, flags: (payload.flags ?? 0) | MessageFlags.Ephemeral });
    }
    case 'rk:refresh': {
      if (needGuild('internal')) return;
      await i.deferUpdate();
      const r = await refreshRanking(i.client, { manual: true });
      return show(await renderScreen('ranking', cfg, gk), { content: r.ok ? `${E('ok')} Ranking atualizado.` : `${E('warn')} ${r.reason}` });
    }
    case 'rk:adjust': {
      if (needGuild('internal')) return;
      const inp = (id, label, required, ph, max, long) =>
        row(new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(long ? TextInputStyle.Paragraph : TextInputStyle.Short).setRequired(required).setPlaceholder(ph).setMaxLength(max));
      return i.showModal(new ModalBuilder().setCustomId('adc:rk:adjm').setTitle('Ajuste manual de pontos').addComponents(
        inp('uid', 'ID do usuário', true, '123456789012345678', 30),
        inp('delta', 'Pontos (+ adiciona, - remove)', true, 'Ex: 20 ou -10', 8),
        inp('reason', 'Motivo (opcional)', false, 'Ex: correção de plantão', 300, true)
      ));
    }
    case 'rk:adjm': {
      if (needGuild('internal')) return;
      const m = i.fields.getTextInputValue('uid').match(/\d{15,25}/);
      const delta = Number(i.fields.getTextInputValue('delta').trim());
      if (!m) return fail(`${E('bad')} ID de usuário inválido.`);
      if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 1000000) return fail(`${E('bad')} Informe um número inteiro diferente de zero (ex: 20 ou -10).`);
      const user = await i.client.users.fetch(m[0]).catch(() => null);
      if (!user) return fail(`${E('bad')} Usuário não encontrado.`);
      await i.deferUpdate();
      const s = await addStats(user.id, user.username, { points: delta });
      if (s.points < 0) await UserStat.updateOne({ userId: user.id }, { $set: { points: 0 } });
      const reason = i.fields.getTextInputValue('reason').trim();
      logAdmin(i, cfg, 'Ajuste manual de pontos', `${user} (\`${user.id}\`): **${delta > 0 ? '+' : ''}${delta}** pts${reason ? `\nMotivo: ${trunc(reason, 300)}` : ''}`);
      await refreshRanking(i.client, { manual: true }).catch(() => {});
      return show(await renderScreen('ranking', cfg, gk), { content: `${E('ok')} ${delta > 0 ? '+' : ''}${delta} pontos para ${user.username}.` });
    }
    case 'rk:reset': {
      if (needGuild('internal')) return;
      return i.showModal(new ModalBuilder().setCustomId('adc:rk:resetm').setTitle('Resetar ranking').addComponents(
        row(new TextInputBuilder().setCustomId('confirm').setLabel('Digite CONFIRMAR para zerar tudo').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(10))
      ));
    }
    case 'rk:resetm': {
      if (needGuild('internal')) return;
      if (i.fields.getTextInputValue('confirm').trim().toUpperCase() !== 'CONFIRMAR') return fail(`${E('bad')} Reset cancelado: confirmação incorreta.`);
      await i.deferUpdate();
      const r = await UserStat.updateMany({}, { $set: { points: 0, recruitments: 0, migrations: 0, shifts: 0, shiftSeconds: 0, adjStaff: 0, adjMig: 0, adjShifts: 0 } });
      logAdmin(i, cfg, 'Reset do ranking', `Pontos, recrutamentos e plantões de **${r.modifiedCount}** recrutadores foram zerados. O histórico de tickets e plantões foi mantido.`);
      await refreshRanking(i.client, { manual: true }).catch(() => {});
      return show(await renderScreen('ranking', cfg, gk), { content: `${E('ok')} Ranking resetado.` });
    }

    // ======== EMOJIS E ÍCONES ========
    case 'em:home': return screen('emojis');
    case 'em:group': return screen('emojis', i.values[0]);
    case 'em:go': return screen('emojis', arg);
    case 'em:pick': {
      const key = i.values[0];
      if (!LABELS[key]) return;
      return i.showModal(emojiModal(key));
    }
    case 'em:set': {
      if (!LABELS[arg]) return;
      const { value, error } = parseEmojiInput(i.fields.getTextInputValue('emoji'));
      if (error) return fail(`${E('bad')} ${error}`);
      await apply(`emojis.${arg}`, value, `Emoji: ${LABELS[arg]}`);
      return screen('emojis', GROUP_OF[arg]);
    }
    case 'em:resetgrp': {
      if (!GROUPS.some((g) => g.id === arg)) return;
      const keep = Object.fromEntries(Object.entries(cfg.emojis || {}).filter(([k, v]) => v !== null && GROUP_OF[k] !== arg));
      await apply('emojis', keep, `Emojis restaurados ao padrão: ${GROUPS.find((g) => g.id === arg).label}`);
      return screen('emojis', arg);
    }
    case 'em:resetall': {
      await apply('emojis', {}, 'Todos os emojis restaurados ao padrão');
      return screen('emojis');
    }

    // ======== LOGS ========
    case 'lg:pick': return screen('logs', i.values[0]);
    case 'lg:set': {
      if (!LOG_LABELS[gk][arg]) return;
      await apply(`logs.${gk}.${arg}`, i.values[0], `Canal de log: ${LOG_LABELS[gk][arg]}`);
      return screen('logs', arg);
    }
    case 'lg:clear': {
      if (!LOG_LABELS[gk][arg]) return;
      await apply(`logs.${gk}.${arg}`, null, `Canal de log removido: ${LOG_LABELS[gk][arg]}`);
      return screen('logs', arg);
    }

    // ======== PERMISSÕES ========
    case 'pm:admin': case 'pm:leader': case 'pm:recruiter': case 'pm:migrator': case 'pm:shift': {
      if (action === 'shift' && gk !== 'internal') return fail(wrongServer('internal'));
      if (action === 'migrator' && gk !== 'main') return fail(wrongServer('main'));
      await apply(`perms.${gk}.${action}`, i.values, `Permissões — ${PERM_LABELS[action]} (${SERVER_NAMES[gk]})`);
      return screen('perms');
    }
  }
}

module.exports = { adminCommand, emojisCommand, adjustCommand, handleAdmin, views: { renderScreen, buildModal, parseValue, questionModal }, FIELDS, MODALS, LOG_LABELS };
