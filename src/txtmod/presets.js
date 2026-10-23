// ============================================================
// Presets de tickets (/admin → Tickets → Presets de tickets)
// ------------------------------------------------------------
// Cada preset é um sistema de tickets completo e independente, igual ao do recrutamento:
// painel próprio (V1/V2/V3), canal do painel, categoria ou tópico, formulário, mensagens,
// cargos que atendem, logs, nome do ticket... tudo personalizável pelo /admin.
// Os dados ficam em cfg.presets[id] (ver db.js → presetDefaults / viewCfg).
// ============================================================
const crypto = require('crypto');
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
const { getCfg, setCfg, delCfg, presetDefaults, viewCfg, clone } = require('./db');
const { COLORS, SERVER_NAMES, guildKey, row, trunc, emit } = require('./core');
const { buildPanel, publishPanel } = require('./tickets');
const { E, Eb, lbl } = require('./emojis');

// admin.js também importa este arquivo, então ele só é carregado quando precisar (evita dependência circular)
const admin = () => require('./adminClassico').views;

const MAX_PRESETS = 25; // limite do menu de seleção do Discord
const MAX_Q = 5; // limite de perguntas de um modal do Discord

// ---------- helpers visuais ----------
const gbtn = (id, label, emojiKey) => {
  const b = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(ButtonStyle.Secondary);
  const em = emojiKey ? Eb(emojiKey) : undefined;
  return em ? b.setEmoji(em) : b;
};
const opt = (label, value, description, emojiKey) => {
  const o = { label, value, description };
  const em = emojiKey ? Eb(emojiKey) : undefined;
  if (em) o.emoji = em;
  return o;
};
const base = (title, desc) => new EmbedBuilder().setColor(COLORS.neutral).setTitle(title).setDescription(desc);
const roles = (ids) => (ids?.length ? ids.map((id) => `<@&${id}>`).join(' ') : '*não definido*');
const chan = (id) => (id ? `<#${id}>` : '*não definido*');
const onoff = (b) => (b ? `${E('ok')} Ativado` : `${E('off')} Desativado`);
const wrongServer = () => `${E('warn')} Os presets de tickets pertencem ao **${SERVER_NAMES.main}**. Rode \`/admin\` lá para criar e editar.`;
const newId = () => 'p' + crypto.randomBytes(3).toString('hex');

// ---------- campos editáveis por modal ----------
// path = caminho dentro do preset (ex: tickets.panel.title). screen = tela para voltar depois de salvar.
const T = (path, label, extra = {}) => ({ path, label, type: 'text', max: 100, ...extra });
const FIELD_LIST = [
  T('name', 'Nome do preset', { max: 40, screen: 'open' }),
  T('tickets.nameTemplate', 'Modelo do nome do ticket', { max: 80, ph: 'Variáveis: {tipo} {usuario} {numero}', screen: 'open' }),
  T('tickets.panel.title', 'Título do painel', { max: 256, screen: 'appearance' }),
  T('tickets.panel.desc1', 'Descrição 1', { long: true, max: 4000, screen: 'appearance' }),
  T('tickets.panel.desc2', 'Descrição 2 (V2 e V3)', { long: true, max: 4000, required: false, screen: 'appearance' }),
  T('tickets.panel.desc3', 'Descrição 3 (V2 e V3)', { long: true, max: 4000, required: false, screen: 'appearance' }),
  T('tickets.panel.desc4', 'Descrição 4 (V2 e V3)', { long: true, max: 4000, required: false, screen: 'appearance' }),
  T('tickets.panel.color', 'Cor HEX (ex: #D4AF37)', { type: 'color', max: 7, screen: 'appearance' }),
  T('tickets.panel.banner', 'URL do banner (vazio remove)', { type: 'url', max: 500, required: false, screen: 'appearance' }),
  T('tickets.panel.thumbnail', 'URL da thumbnail (vazio remove)', { type: 'url', max: 500, required: false, screen: 'appearance' }),
  T('tickets.panel.footer', 'Texto do rodapé (vazio remove)', { max: 200, required: false, screen: 'appearance' }),
  T('tickets.panel.labelStaff', 'Texto do botão (V1 e V2)', { max: 80, screen: 'appearance' }),
  T('tickets.panel.selectPlaceholder', 'Texto do menu (V3)', { max: 100, screen: 'appearance' }),
  T('tickets.panel.optLabelStaff', 'Nome da opção do menu (V3)', { max: 100, screen: 'appearance' }),
  T('tickets.panel.optDescStaff', 'Descrição da opção do menu (V3)', { max: 100, required: false, screen: 'appearance' }),
  ...['open', 'claim', 'finish', 'reject', 'close'].map((k) =>
    T(`tickets.messages.${k}`, `Mensagem: ${k}`, { long: true, max: 1000, ph: '{usuario} {recrutador} {tipo} {cargos} {numero}', screen: 'messages' })
  ),
  { path: 'points', label: 'Pontos por ticket concluído', type: 'int', lo: 0, hi: 1000000, max: 8, required: false, ph: 'Vazio = usa o valor de /admin → Pontuação', screen: 'open' },
];
const PFIELDS = Object.fromEntries(FIELD_LIST.map((d) => [d.path, d]));

const APP_OPTIONS = [
  ['title', 'Título'], ['desc1', 'Descrição 1'], ['desc2', 'Descrição 2 (V2 e V3)'], ['desc3', 'Descrição 3 (V2 e V3)'],
  ['desc4', 'Descrição 4 (V2 e V3)'], ['color', 'Cor'], ['banner', 'Banner'], ['thumbnail', 'Thumbnail'], ['footer', 'Texto do rodapé'],
  ['labelStaff', 'Texto do botão (V1 e V2)'], ['selectPlaceholder', 'Texto do menu (V3)'],
  ['optLabelStaff', 'Nome da opção do menu (V3)'], ['optDescStaff', 'Descrição da opção do menu (V3)'],
];
const MSG_LABELS = { open: 'Ao abrir', claim: 'Ao assumir', finish: 'Ao concluir (modo recrutamento)', reject: 'Ao reprovar (modo recrutamento)', close: 'Ao fechar' };

// ============================================================
// Telas
// ============================================================
function presetsHome(cfg, gk) {
  const list = Object.entries(cfg.presets || {});
  const lines = [
    'Crie e gerencie **sistemas de tickets personalizados**, iguais ao de recrutamento.',
    'Cada preset tem o seu próprio painel (V1/V2/V3), canal do painel, categoria ou tópico, formulário, mensagens, cargos que atendem e logs.',
    '',
  ];
  if (gk !== 'main') lines.unshift(wrongServer(), '');
  if (list.length) {
    lines.push(`**Presets criados (${list.length}/${MAX_PRESETS}):**`);
    for (const [, p] of list) {
      const t = p.tickets;
      lines.push(`• **${trunc(p.name, 40)}** — ${t.style} • ${t.panelMessageId ? `publicado em ${chan(t.panelChannelId)}` : 'não publicado'}`);
    }
  } else {
    lines.push('*Nenhum preset criado ainda. Clique em **Criar preset**.*');
  }
  const components = [];
  if (list.length) {
    components.push(row(
      new StringSelectMenuBuilder()
        .setCustomId('adc:pr:pick')
        .setPlaceholder('Escolha um preset salvo...')
        .addOptions(list.slice(0, MAX_PRESETS).map(([id, p]) => ({
          label: trunc(p.name, 100),
          value: id,
          description: `${p.tickets.style} • ${p.tickets.panelMessageId ? 'publicado' : 'não publicado'}`,
        })))
    ));
  }
  components.push(row(gbtn('adc:pr:new', 'Criar preset', 'admAdd'), gbtn('adc:tk:home', 'Voltar', 'admBack')));
  return { embeds: [base(lbl('admPresets', 'Central de Presets de Tickets'), lines.join('\n'))], components };
}

function newPresetModal() {
  const inp = (id, label, required, ph, max) =>
    row(new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short).setRequired(required).setPlaceholder(ph).setMaxLength(max));
  return new ModalBuilder().setCustomId('adc:pr:newm').setTitle('Criar preset de tickets').addComponents(
    inp('name', 'Nome do preset', true, 'Ex: Blacklist, Gestão, Suporte', 40),
    inp('copy', 'Copiar o visual do Recrutamento? (sim/não)', false, 'não', 5)
  );
}

function presetView(cfg, id) {
  const p = cfg.presets[id];
  const t = p.tickets;
  const ready = t.useThread ? !!t.threadChannelId : !!t.categoryId;
  const lines = [
    `**Preset:** ${trunc(p.name, 60)} (\`${id}\`)`,
    `**Painel:** ${t.panelMessageId ? `publicado em ${chan(t.panelChannelId)}` : '*não publicado*'}`,
    `**Modelo do painel:** ${t.style}`,
    `**Ticket em tópico:** ${onoff(t.useThread)} ${t.useThread ? '_(tickets criados em tópico privado)_' : '_(tickets criados em canal na categoria)_'}`,
    `**Categoria dos tickets (canal):** ${chan(t.categoryId)}`,
    `**Canal dos tópicos (tópico):** ${chan(t.threadChannelId)}`,
    `**Cargos com acesso aos tickets:** ${roles(t.accessRoleIds)}`,
    `**Cargos que atendem:** ${p.handlerRoleIds?.length ? roles(p.handlerRoleIds) : '*igual aos cargos com acesso*'}`,
    `**Modo recrutamento:** ${onoff(p.recruitMode)}${p.recruitMode ? ` _(seta cargos, reprova e pontua${p.points !== null && p.points !== undefined ? ` • ${p.points} pontos` : ''})_` : ''}`,
    `**Canal de logs do preset:** ${p.logChannelId ? chan(p.logChannelId) : '*logs padrão de tickets*'}`,
    `**Nome do ticket:** \`${t.nameTemplate}\``,
    `**Exigir plantão para assumir:** ${onoff(t.requireShiftToClaim)}`,
  ];
  if (!ready) lines.push('', `${E('warn')} Defina ${t.useThread ? 'o **canal dos tópicos**' : 'a **categoria dos tickets**'} para o painel funcionar.`);

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`adc:pr:menu:${id}`)
    .setPlaceholder('Mais opções do preset...')
    .addOptions(
      opt('Aparência do painel', 'appearance', 'Título, descrições, cor, banner, botão e V3', 'admAppearance'),
      opt('Mensagens', 'messages', 'Textos de abrir, assumir, concluir, reprovar e fechar', 'admMessages'),
      opt('Formulário', 'forms', 'Perguntas que o membro responde ao abrir o ticket', 'admForms'),
      opt('Cargos e logs do preset', 'roles', 'Quem atende, cargos atribuíveis e canal de logs', 'admRoles'),
      opt('Nome dos tickets', 'naming', 'Modelo do nome do canal/tópico', 'admNaming'),
      opt('Ticket em tópico: ativar/desativar', 'usethread', 'Ativado = tópico privado • Desativado = canal na categoria', 'admNaming'),
      opt('Modo recrutamento: ativar/desativar', 'recmode', 'Ativado = setar cargos, reprovar e pontuar no ranking', 'admRoles'),
      opt('Pontos do preset', 'points', 'Pontos por ticket concluído (modo recrutamento)', 'admPoints'),
      opt('Exigir plantão para assumir', 'reqshift', 'Alterna a regra', 'admReqShift'),
      opt('Ver prévia do painel', 'preview', 'Mostra como o painel vai ficar', 'admPreview'),
      opt('Publicar painel', 'publish', 'Envia (ou atualiza) o painel em um canal', 'admPublish'),
      opt('Renomear preset', 'rename', 'Muda o nome do preset', 'admEdit'),
      opt('Duplicar preset', 'duplicate', 'Cria uma cópia (sem publicar)', 'admAdd'),
      opt('Excluir preset', 'delete', 'Remove o preset e o painel publicado', 'admReset')
    );
  return {
    embeds: [base(lbl('admPresets', `Preset — ${trunc(p.name, 60)}`), lines.join('\n'))],
    components: [
      row(menu),
      row(new ChannelSelectMenuBuilder().setCustomId(`adc:pr:cat:${id}`).setPlaceholder('Categoria dos tickets (usada quando o modo tópico está desativado)...').setChannelTypes(ChannelType.GuildCategory)),
      row(new ChannelSelectMenuBuilder().setCustomId(`adc:pr:thr:${id}`).setPlaceholder('Canal dos tópicos (usado quando o modo tópico está ativado)...').setChannelTypes(ChannelType.GuildText)),
      row(new RoleSelectMenuBuilder().setCustomId(`adc:pr:acc:${id}`).setPlaceholder('Cargos com acesso aos tickets...').setMinValues(0).setMaxValues(10)),
      row(
        gbtn(`adc:pr:style:${id}:V1`, t.style === 'V1' ? '✔ Modelo V1' : 'Modelo V1'),
        gbtn(`adc:pr:style:${id}:V2`, t.style === 'V2' ? '✔ Modelo V2' : 'Modelo V2'),
        gbtn(`adc:pr:style:${id}:V3`, t.style === 'V3' ? '✔ Modelo V3' : 'Modelo V3'),
        gbtn('adc:pr:home', 'Voltar', 'admBack')
      ),
    ],
  };
}

function appearanceView(cfg, id) {
  const vcfg = viewCfg(cfg, id);
  const p = vcfg.tickets.panel;
  const v3 = vcfg.tickets.style === 'V3';
  const lines = [
    `**Modelo:** ${vcfg.tickets.style} • **Cor:** \`${p.color}\``,
    `**Banner:** ${p.banner || '*nenhum*'}`,
    `**Thumbnail:** ${p.thumbnail || '*nenhuma*'}`,
    `**Rodapé:** ${p.footer || '*nenhum*'}`,
  ];
  if (v3) {
    lines.push(
      '**Controle do V3:** menu de seleção',
      `**Barra de cor do V3:** ${onoff(p.v3Accent)} *(desligada = só a borda fina)*`,
      '',
      'Use **Ver prévia** para conferir o painel. Depois, publique de novo em **Publicar painel** — se já houver um painel do mesmo tipo no mesmo canal, ele é atualizado no lugar.'
    );
  } else {
    lines.push('', 'Prévia do painel abaixo ⬇️');
  }
  const select = new StringSelectMenuBuilder()
    .setCustomId(`adc:pr:appfield:${id}`)
    .setPlaceholder('Editar aparência do painel...')
    .addOptions(APP_OPTIONS.map(([value, label]) => ({ label, value, description: `Editar: ${label}`.slice(0, 100) })));
  const components = [row(select)];
  if (v3) {
    components.push(row(
      gbtn(`adc:pr:preview:${id}`, 'Ver prévia', 'admPreview'),
      gbtn(`adc:pr:v3accent:${id}`, `Barra de cor: ${p.v3Accent ? 'ligada' : 'desligada'}`, 'admToggle')
    ));
  }
  components.push(row(gbtn(`adc:pr:open:${id}`, 'Voltar', 'admBack')));
  const info = base(lbl('admAppearance', 'Aparência do painel'), lines.join('\n'));
  const embeds = v3 ? [info] : [info, ...buildPanel(vcfg).embeds].slice(0, 10);
  return { embeds, components };
}

function messagesView(cfg, id) {
  const m = cfg.presets[id].tickets.messages;
  const desc = Object.keys(MSG_LABELS).map((k) => `**${MSG_LABELS[k]}:**\n${trunc(m[k], 200)}`).join('\n\n') +
    '\n\nVariáveis: `{usuario}` `{recrutador}` `{tipo}` `{cargos}` `{numero}`';
  const select = new StringSelectMenuBuilder()
    .setCustomId(`adc:pr:msgfield:${id}`)
    .setPlaceholder('Editar mensagem...')
    .addOptions(Object.keys(MSG_LABELS).map((k) => ({ label: MSG_LABELS[k], value: k, description: 'Editar este texto' })));
  return { embeds: [base(lbl('admMessages', 'Mensagens dos tickets'), desc)], components: [row(select), row(gbtn(`adc:pr:open:${id}`, 'Voltar', 'admBack'))] };
}

function formsView(cfg, id) {
  const qs = cfg.presets[id].tickets.questions.staff;
  const list = qs.length
    ? qs.map((q, n) => `**${n + 1}.** ${q.label}\n└ *${q.long ? 'resposta longa' : 'resposta curta'} • ${q.required ? 'obrigatória' : 'opcional'}*`).join('\n')
    : '*Nenhuma pergunta cadastrada — o painel não abre ticket sem pelo menos 1 pergunta.*';
  const components = [];
  if (qs.length) {
    components.push(row(new StringSelectMenuBuilder().setCustomId(`adc:pr:qrem:${id}`).setPlaceholder('Remover uma pergunta...')
      .addOptions(qs.map((q, idx) => ({ label: `${idx + 1}. ${q.label}`.slice(0, 100), value: String(idx) })))));
  }
  components.push(row(
    gbtn(`adc:pr:qadd:${id}`, 'Adicionar pergunta', 'admAdd').setDisabled(qs.length >= MAX_Q),
    gbtn(`adc:pr:qreset:${id}`, 'Restaurar padrão', 'admRestore'),
    gbtn(`adc:pr:open:${id}`, 'Voltar', 'admBack')
  ));
  return { embeds: [base(lbl('admForms', 'Formulário do preset'), list).setFooter({ text: `${qs.length}/${MAX_Q} perguntas (limite do Discord)` })], components };
}

function questionModal(id) {
  const inp = (cid, label, required, ph, max) =>
    row(new TextInputBuilder().setCustomId(cid).setLabel(label).setStyle(TextInputStyle.Short).setRequired(required).setPlaceholder(ph).setMaxLength(max));
  return new ModalBuilder().setCustomId(`adc:pr:qm:${id}`).setTitle('Nova pergunta').addComponents(
    inp('label', 'Pergunta (máx. 45 caracteres)', true, 'Ex: Qual o motivo do ticket?', 45),
    inp('placeholder', 'Texto de exemplo (placeholder)', false, 'Ex: Explique com detalhes', 100),
    inp('style', 'Resposta: curta ou longa', false, 'curta', 10),
    inp('required', 'Obrigatória? (sim ou não)', false, 'sim', 5)
  );
}

function rolesView(cfg, id) {
  const p = cfg.presets[id];
  const embed = base(lbl('admRoles', 'Cargos e logs do preset'), [
    `**Cargos que atendem:** ${p.handlerRoleIds?.length ? roles(p.handlerRoleIds) : '*igual aos cargos com acesso aos tickets*'}`,
    `**Cargos atribuíveis (modo recrutamento):** ${roles(p.tickets.assignableRoleIds)}`,
    `**Cargos iniciais (modo recrutamento):** ${roles(p.tickets.inicianteRoleIds)}`,
    `**Canal de logs do preset:** ${p.logChannelId ? chan(p.logChannelId) : '*logs padrão de tickets*'}`,
    '',
    'Quem **atende** é marcado dentro do ticket, enxerga o ticket e pode assumir/transferir/fechar. Os cargos atribuíveis e iniciais só são usados se o **modo recrutamento** estiver ativado.',
  ].join('\n'));
  return {
    embeds: [embed],
    components: [
      row(new RoleSelectMenuBuilder().setCustomId(`adc:pr:handler:${id}`).setPlaceholder('Cargos que atendem este preset...').setMinValues(0).setMaxValues(10)),
      row(new RoleSelectMenuBuilder().setCustomId(`adc:pr:assign:${id}`).setPlaceholder('Cargos que o atendente pode setar (modo recrutamento)...').setMinValues(0).setMaxValues(25)),
      row(new RoleSelectMenuBuilder().setCustomId(`adc:pr:inic:${id}`).setPlaceholder('Cargos iniciais (modo recrutamento)...').setMinValues(0).setMaxValues(25)),
      row(new ChannelSelectMenuBuilder().setCustomId(`adc:pr:log:${id}`).setPlaceholder('Canal de logs deste preset...').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
      row(gbtn(`adc:pr:logclear:${id}`, 'Remover canal de logs', 'admClear'), gbtn(`adc:pr:open:${id}`, 'Voltar', 'admBack')),
    ],
  };
}

function publishView(id) {
  return {
    embeds: [base(lbl('admPublish', 'Publicar painel do preset'), 'Selecione o canal onde o painel será publicado.')],
    components: [
      row(new ChannelSelectMenuBuilder().setCustomId(`adc:pr:publish:${id}`).setPlaceholder('Canal do painel...').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
      row(gbtn(`adc:pr:open:${id}`, 'Voltar', 'admBack')),
    ],
  };
}

function deleteView(cfg, id) {
  const p = cfg.presets[id];
  return {
    embeds: [base(lbl('admReset', 'Excluir preset'), [
      `Tem certeza que deseja excluir o preset **${trunc(p.name, 60)}**?`,
      '',
      '• O painel publicado será apagado (se ainda existir).',
      '• Tickets que já estão abertos continuam funcionando até serem fechados.',
      '• Esta ação não pode ser desfeita.',
    ].join('\n')).setColor(COLORS.bad)],
    components: [row(gbtn(`adc:pr:delok:${id}`, 'Sim, excluir', 'admReset'), gbtn(`adc:pr:open:${id}`, 'Cancelar', 'admBack'))],
  };
}

function renderPreset(name, cfg, id) {
  switch (name) {
    case 'appearance': return appearanceView(cfg, id);
    case 'messages': return messagesView(cfg, id);
    case 'forms': return formsView(cfg, id);
    case 'roles': return rolesView(cfg, id);
    case 'publish': return publishView(id);
    case 'delete': return deleteView(cfg, id);
    default: return presetView(cfg, id);
  }
}

// ============================================================
// Interações (customId: adc:pr:<ação>:<id>[:<arg>])
// ============================================================
function logChange(i, cfg, text) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.warn)
    .setTitle(lbl('admPresets', 'Presets de tickets'))
    .setDescription(trunc(text, 3500))
    .addFields(
      { name: 'Responsável', value: `${i.user} (\`${i.user.id}\`)`, inline: true },
      { name: 'Servidor', value: SERVER_NAMES[guildKey(i.guildId)] ?? '—', inline: true }
    )
    .setTimestamp();
  void emit(i.client, cfg, { category: 'admin', action: 'Presets de tickets', embed, userId: i.user.id });
}

async function handlePreset(i, cfg, gk) {
  const [, , action, id, arg] = i.customId.split(':');
  const deny = (content) => i.reply({ content, ephemeral: true });
  const show = (view, extra = {}) => {
    const payload = { content: '', ...view, ...extra };
    return i.deferred || i.replied ? i.editReply(payload) : i.update(payload);
  };
  if (gk !== 'main') return deny(wrongServer());

  const home = (extra) => show(presetsHome(cfg, gk), extra);
  if (action === 'home') return home();
  if (action === 'new') return i.showModal(newPresetModal());

  // ---- criar preset ----
  if (action === 'newm') {
    const name = i.fields.getTextInputValue('name').trim();
    const copy = ['s', 'sim', 'y', 'yes'].includes(i.fields.getTextInputValue('copy').trim().toLowerCase());
    if (!name) return deny(`${E('bad')} Informe o nome do preset.`);
    if (Object.keys(cfg.presets || {}).length >= MAX_PRESETS) return deny(`${E('bad')} Limite de ${MAX_PRESETS} presets atingido. Exclua algum para criar outro.`);
    const nid = newId();
    const preset = presetDefaults(name);
    if (copy) {
      // copia do Recrutamento só a estrutura e o visual (textos, formulário e cargos ficam do preset)
      const src = cfg.tickets;
      for (const k of ['style', 'categoryId', 'useThread', 'threadChannelId', 'accessRoleIds', 'nameTemplate', 'requireShiftToClaim']) preset.tickets[k] = clone(src[k]);
      for (const k of ['color', 'banner', 'thumbnail', 'footer', 'v3Accent', 'selectPlaceholder']) preset.tickets.panel[k] = clone(src.panel[k]);
    }
    await setCfg(`presets.${nid}`, preset);
    cfg = await getCfg();
    logChange(i, cfg, `**Preset criado:** ${name} (\`${nid}\`)${copy ? ' — visual copiado do Recrutamento' : ''}`);
    return show(presetView(cfg, nid), { content: `${E('ok')} Preset criado. Agora escolha a categoria/canal, personalize e publique o painel.` });
  }

  if (action === 'pick') return show(presetView(cfg, i.values[0]));

  // daqui para baixo toda ação precisa de um preset existente
  if (!cfg.presets?.[id]) return home({ content: `${E('warn')} Esse preset não existe mais.` });
  const preset = () => cfg.presets[id];
  const screen = (name) => show(renderPreset(name, cfg, id));
  const apply = async (path, value, label) => {
    await setCfg(`presets.${id}.${path}`, value);
    cfg = await getCfg();
    logChange(i, cfg, `**${preset().name}** (\`${id}\`) • ${label}`);
  };

  switch (action) {
    case 'open': return screen('open');

    case 'menu': {
      const v = i.values[0];
      if (v === 'rename') return i.showModal(admin().buildModal(`adc:pr:f:${id}:name`, 'Renomear preset', [PFIELDS.name], preset()));
      if (v === 'naming') return i.showModal(admin().buildModal(`adc:pr:f:${id}:tickets.nameTemplate`, 'Nome dos tickets', [PFIELDS['tickets.nameTemplate']], preset()));
      if (v === 'points') return i.showModal(admin().buildModal(`adc:pr:f:${id}:points`, 'Pontos do preset', [PFIELDS.points], preset()));
      if (v === 'usethread') { await apply('tickets.useThread', !preset().tickets.useThread, 'Ticket em tópico'); return screen('open'); }
      if (v === 'recmode') { await apply('recruitMode', !preset().recruitMode, 'Modo recrutamento'); return screen('open'); }
      if (v === 'reqshift') { await apply('tickets.requireShiftToClaim', !preset().tickets.requireShiftToClaim, 'Exigir plantão para assumir'); return screen('open'); }
      if (v === 'preview') {
        const payload = buildPanel(viewCfg(cfg, id), { preview: true });
        return i.reply({ ...payload, flags: (payload.flags ?? 0) | MessageFlags.Ephemeral });
      }
      if (v === 'duplicate') {
        if (Object.keys(cfg.presets).length >= MAX_PRESETS) return deny(`${E('bad')} Limite de ${MAX_PRESETS} presets atingido.`);
        const nid = newId();
        const copy = clone(preset());
        const newName = `${preset().name} (cópia)`.slice(0, 40);
        if (copy.tickets.panel.title === preset().name) copy.tickets.panel.title = newName;
        if (copy.tickets.panel.optLabelStaff === preset().name) copy.tickets.panel.optLabelStaff = newName;
        copy.name = newName;
        Object.assign(copy.tickets, { panelChannelId: null, panelMessageId: null, panelKind: null });
        await setCfg(`presets.${nid}`, copy);
        cfg = await getCfg();
        logChange(i, cfg, `**Preset duplicado:** ${preset().name} → ${newName} (\`${nid}\`)`);
        return show(presetView(cfg, nid), { content: `${E('ok')} Preset duplicado. O painel da cópia ainda não está publicado.` });
      }
      return screen(v === 'delete' ? 'delete' : v);
    }

    case 'cat': await apply('tickets.categoryId', i.values[0], 'Categoria dos tickets'); return screen('open');
    case 'thr': await apply('tickets.threadChannelId', i.values[0], 'Canal dos tópicos dos tickets'); return screen('open');
    case 'acc': await apply('tickets.accessRoleIds', i.values, 'Cargos com acesso aos tickets'); return screen('open');
    case 'style': {
      if (!['V1', 'V2', 'V3'].includes(arg)) return;
      await apply('tickets.style', arg, 'Modelo do painel');
      return screen('open');
    }

    // ---- aparência / mensagens (modal de um campo) ----
    case 'appfield': {
      const d = PFIELDS[`tickets.panel.${i.values[0]}`];
      if (!d) return;
      return i.showModal(admin().buildModal(`adc:pr:f:${id}:${d.path}`, 'Editar painel', [d], preset()));
    }
    case 'msgfield': {
      const d = PFIELDS[`tickets.messages.${i.values[0]}`];
      if (!d) return;
      return i.showModal(admin().buildModal(`adc:pr:f:${id}:${d.path}`, 'Editar mensagem', [d], preset()));
    }
    case 'f': {
      const d = PFIELDS[arg];
      if (!d) return;
      let { value, error } = admin().parseValue(d, i.fields.getTextInputValue(d.path));
      if (error) return deny(`${E('bad')} ${error}`);
      if (d.path === 'points' && value === '') value = null; // vazio = usa a pontuação padrão
      await apply(d.path, value, d.label);
      return screen(d.screen);
    }
    case 'v3accent': await apply('tickets.panel.v3Accent', !preset().tickets.panel.v3Accent, 'Barra de cor do V3'); return screen('appearance');
    case 'preview': {
      const payload = buildPanel(viewCfg(cfg, id), { preview: true });
      return i.reply({ ...payload, flags: (payload.flags ?? 0) | MessageFlags.Ephemeral });
    }

    // ---- formulário ----
    case 'qadd': return i.showModal(questionModal(id));
    case 'qm': {
      const qs = clone(preset().tickets.questions.staff);
      if (qs.length >= MAX_Q) return deny(`${E('bad')} Limite de ${MAX_Q} perguntas atingido.`);
      const style = i.fields.getTextInputValue('style').trim().toLowerCase();
      const req = i.fields.getTextInputValue('required').trim().toLowerCase();
      qs.push({
        label: i.fields.getTextInputValue('label').trim(),
        placeholder: i.fields.getTextInputValue('placeholder').trim(),
        long: style.startsWith('l'),
        required: !['n', 'nao', 'não'].includes(req),
      });
      await apply('tickets.questions.staff', qs, `Pergunta adicionada: ${qs[qs.length - 1].label}`);
      return screen('forms');
    }
    case 'qrem': {
      const qs = clone(preset().tickets.questions.staff);
      qs.splice(Number(i.values[0]), 1);
      await apply('tickets.questions.staff', qs, 'Pergunta removida');
      return screen('forms');
    }
    case 'qreset': await apply('tickets.questions.staff', clone(presetDefaults().tickets.questions.staff), 'Formulário restaurado ao padrão'); return screen('forms');

    // ---- cargos e logs ----
    case 'handler': await apply('handlerRoleIds', i.values, 'Cargos que atendem'); return screen('roles');
    case 'assign': await apply('tickets.assignableRoleIds', i.values, 'Cargos atribuíveis'); return screen('roles');
    case 'inic': await apply('tickets.inicianteRoleIds', i.values, 'Cargos iniciais'); return screen('roles');
    case 'log': await apply('logChannelId', i.values[0], 'Canal de logs do preset'); return screen('roles');
    case 'logclear': await apply('logChannelId', null, 'Canal de logs do preset removido'); return screen('roles');

    // ---- publicar ----
    case 'publish': {
      const channel = await i.guild.channels.fetch(i.values[0]).catch(() => null);
      try {
        const { message, kind } = await publishPanel(i.client, viewCfg(cfg, id), channel);
        await setCfg(`presets.${id}.tickets.panelChannelId`, channel.id);
        await setCfg(`presets.${id}.tickets.panelMessageId`, message.id);
        await setCfg(`presets.${id}.tickets.panelKind`, kind);
      } catch (e) {
        console.error('[presets:publish]', e.message);
        return deny(`${E('bad')} Não consegui publicar em ${channel ?? 'esse canal'}. Verifique as permissões do bot.`);
      }
      cfg = await getCfg();
      logChange(i, cfg, `**Painel publicado:** ${preset().name} (\`${id}\`) em ${channel} • Modelo ${preset().tickets.style}`);
      return show(presetView(cfg, id), { content: `${E('ok')} Painel publicado em ${channel}.` });
    }

    // ---- excluir ----
    case 'delok': {
      const p = preset();
      const { panelChannelId, panelMessageId } = p.tickets;
      if (panelChannelId && panelMessageId) {
        const ch = await i.guild.channels.fetch(panelChannelId).catch(() => null);
        const msg = await ch?.messages?.fetch(panelMessageId).catch(() => null);
        await msg?.delete().catch(() => {});
      }
      await delCfg(`presets.${id}`);
      logChange(i, cfg, `**Preset excluído:** ${p.name} (\`${id}\`)`);
      cfg = await getCfg();
      return home({ content: `${E('ok')} Preset **${trunc(p.name, 60)}** excluído.` });
    }
  }
}

module.exports = { handlePreset, presetsHome };
