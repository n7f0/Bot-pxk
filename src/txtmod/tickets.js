const {
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ContainerBuilder,
  EmbedBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  ThumbnailBuilder,
  UserSelectMenuBuilder,
} = require('discord.js');
const { getCfg, Ticket, Recruitment, Shift, Counter, viewCfg } = require('./db');
const { COLORS, guildKey, perms, row, emit, ts, trunc, render, unique, parseColor, addStats, stripEmojis } = require('./core');
const { scheduleRankingRefresh } = require('./ranking');
const { E, Eb, lbl } = require('./emojis');

const TYPES = {
  staff: { name: 'Staff', emojiKey: 'typeStaff' },
  migracao: { name: 'Migração', emojiKey: 'typeMig' },
};
const resultLabel = (r) => ({ aprovado: lbl('ok', 'Aprovado'), reprovado: lbl('bad', 'Reprovado'), cancelado: '⚪ Cancelado', atendido: lbl('ok', 'Atendido') })[r];
const MAX_Q = 5;
// Título de modal só aceita texto simples: remove emoji personalizado (<:nome:id>), :atalhos: e markdown (**, __, ~~, `)
const plainText = (s) =>
  String(s ?? '')
    .replace(/<a?:\w+:\d+>/g, '')
    .replace(/:[a-zA-Z0-9_]{2,}:/g, '')
    .replace(/[*_~`|>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
const deny = (content) => ({ content, ephemeral: true });
// Nome do tipo do ticket: nome do preset (ou Staff/Migração no recrutamento original)
const tn = (t) => t.presetName || TYPES[t.type]?.name || t.type;
// Carrega a configuração certa para um ticket: a do preset em que ele foi aberto (ou a do recrutamento)
async function ctxByChannel(channelId) {
  const raw = await getCfg();
  const ticket = await Ticket.findOne({ channelId });
  return { raw, ticket, cfg: viewCfg(raw, ticket?.presetId) };
}

// Todos os botões dos tickets (V1 e V2) são cinza
// O emoji de cada botão vem de /admin → Emojis e ícones (chave = emojiKey)
const gbtn = (id, label, emojiKey, disabled = false) => {
  const b = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(ButtonStyle.Secondary).setDisabled(disabled);
  const em = Eb(emojiKey);
  return em ? b.setEmoji(em) : b;
};

const rowOpen = () => row(gbtn('tk:claim', 'Assumir atendimento', 'claim'), gbtn('tk:close', 'Fechar', 'close'));
const rowClaimed = (cfg) =>
  // preset sem "modo recrutamento": só transferir e fechar (sem setar cargos / reprovar)
  cfg?._preset && !cfg._preset.recruitMode
    ? row(gbtn('tk:transfer', 'Transferir', 'transfer'), gbtn('tk:close', 'Fechar', 'close'))
    : row(
        gbtn('tk:setroles', 'Setar cargos', 'setRoles'),
        gbtn('tk:reject', 'Reprovar', 'reject'),
        gbtn('tk:transfer', 'Transferir', 'transfer'),
        gbtn('tk:close', 'Fechar', 'close')
      );
const rowDone = (label) => row(gbtn('tk:done', label, 'done', true), gbtn('tk:close', 'Fechar', 'close'));

// ---------- painel público (V1 / V2 / V3) ----------
const panelKind = (cfg) => (cfg.tickets.style === 'V3' ? 'v3' : 'embed');

// Reparte o texto respeitando o limite de 4000 caracteres do Componentes V2
function fitBlocks(blocks, budget) {
  const out = [];
  let left = budget;
  for (const b of blocks) {
    if (left <= 0) break;
    const t = String(b).slice(0, left);
    out.push(t);
    left -= t.length;
  }
  return out;
}

// V3: container de bordas finas (Componentes V2), igual ao painel "Seja Eternally".
// preview=true desativa os controles (usado na prévia do /admin).
function buildPanelV3(cfg, preview = false) {
  const p = cfg.tickets.panel;
  const container = new ContainerBuilder();
  if (p.v3Accent) container.setAccentColor(parseColor(p.color));

  if (p.banner) {
    container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(p.banner)));
  }

  const head = `## ${p.title}`;
  const footer = p.footer ? `-# ${p.footer}` : '';
  const blocks = fitBlocks([p.desc1, p.desc2, p.desc3, p.desc4].filter(Boolean), 3700 - head.length - footer.length);
  const first = new TextDisplayBuilder().setContent([head, blocks[0]].filter(Boolean).join('\n'));
  if (p.thumbnail) {
    container.addSectionComponents(
      new SectionBuilder().addTextDisplayComponents(first).setThumbnailAccessory(new ThumbnailBuilder().setURL(p.thumbnail))
    );
  } else {
    container.addTextDisplayComponents(first);
  }
  for (const b of blocks.slice(1)) {
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(b));
  }
  if (footer) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(footer));

  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  const opt = (value, label, desc, key) => {
    const o = { label: String(label).slice(0, 100), value };
    if (desc) o.description = String(desc).slice(0, 100);
    const em = Eb(key);
    if (em) o.emoji = em;
    return o;
  };
  // preset: o menu tem uma única opção (o próprio preset); recrutamento: Recrutamento + Migração
  const pr = cfg._preset;
  const options = pr
    ? [opt('staff', p.optLabelStaff || pr.name, p.optDescStaff, 'menuStaff')]
    : [opt('staff', p.optLabelStaff || 'Recrutamento', p.optDescStaff, 'menuStaff'), opt('migracao', p.optLabelMig || 'Migração', p.optDescMig, 'menuMig')];
  container.addActionRowComponents(
    row(
      new StringSelectMenuBuilder()
        .setCustomId(pr ? `tk:openmenu:${pr.id}` : 'tk:openmenu')
        .setPlaceholder(trunc(p.selectPlaceholder || 'Selecione uma opção...', 150))
        .setDisabled(preview)
        .addOptions(...options)
    )
  );
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

function buildPanel(cfg, { preview = false } = {}) {
  if (cfg.tickets.style === 'V3') return buildPanelV3(cfg, preview);
  const p = cfg.tickets.panel;
  const color = parseColor(p.color);
  let embeds;

  if (cfg.tickets.style === 'V2') {
    // V2: blocos separados (descrição 1 a 4), banner e rodapé no último bloco
    const blocks = [p.desc1, p.desc2, p.desc3, p.desc4].filter(Boolean);
    embeds = blocks.map((d, idx) => {
      const e = new EmbedBuilder().setColor(color).setDescription(d);
      if (idx === 0) {
        e.setTitle(p.title);
        if (p.thumbnail) e.setThumbnail(p.thumbnail);
      }
      return e;
    });
    if (!embeds.length) embeds = [new EmbedBuilder().setColor(color).setTitle(p.title)];
    const last = embeds[embeds.length - 1];
    if (p.banner) last.setImage(p.banner);
    if (p.footer) last.setFooter({ text: p.footer });
  } else {
    // V1: uma embed única
    const e = new EmbedBuilder().setColor(color).setTitle(p.title).setDescription(p.desc1 || '\u200b');
    if (p.banner) e.setImage(p.banner);
    if (p.thumbnail) e.setThumbnail(p.thumbnail);
    if (p.footer) e.setFooter({ text: p.footer });
    embeds = [e];
  }

  return {
    embeds,
    components: [
      cfg._preset
        ? row(gbtn(`tk:open:staff:${cfg._preset.id}`, p.labelStaff || 'Abrir ticket', 'typeStaff', preview))
        : row(gbtn('tk:open:staff', p.labelStaff, 'typeStaff', preview), gbtn('tk:open:migracao', p.labelMig, 'typeMig', preview)),
    ],
  };
}

// Publica o painel. Se já existir um painel do mesmo tipo no mesmo canal, edita no lugar
// (assim trocar emoji/aparência não gera mensagens duplicadas). Se o tipo mudou
// (ex: V2 → V3), apaga a mensagem antiga do mesmo canal e envia uma nova.
async function publishPanel(client, cfg, channel) {
  const t = cfg.tickets;
  const kind = panelKind(cfg);
  const payload = buildPanel(cfg);

  let sent = null;
  if (t.panelMessageId && t.panelChannelId === channel.id) {
    const old = await channel.messages.fetch(t.panelMessageId).catch(() => null);
    if (old) {
      if ((t.panelKind ?? 'embed') === kind) {
        sent = await old.edit(kind === 'embed' ? { content: '', ...payload } : payload).catch(() => null);
      } else {
        await old.delete().catch(() => {});
      }
    }
  }
  if (!sent) sent = await channel.send(payload);
  return { message: sent, kind };
}

// ---------- roteador ----------
async function handleTicket(i) {
  if (guildKey(i.guildId) !== 'main') {
    return i.reply(deny(`${E('bad')} Os tickets funcionam apenas no servidor principal da União.`));
  }
  const [, action, arg, pid] = i.customId.split(':');
  switch (action) {
    case 'open': return openForm(i, arg, pid || null); // pid = id do preset (vazio = recrutamento)
    case 'openmenu': return openForm(i, i.values[0], arg || null); // menu do painel V3 (arg = id do preset)
    case 'modal': return createTicket(i, arg, pid || null);
    case 'claim': return claim(i);
    case 'setroles': return setRoles(i);
    case 'pickroles': return pickRoles(i);
    case 'migarea': case 'mighier': return migPick(i, action === 'migarea' ? 'area' : 'hier');
    case 'migok': return migConfirm(i);
    case 'reject': return rejectModal(i);
    case 'rejectm': return rejectSubmit(i);
    case 'transfer': return transferMenu(i);
    case 'transferto': return transferTo(i);
    case 'close': return closeTicket(i);
  }
}

// ---------- helpers ----------
// Quem enxerga cada tipo de ticket (definido em /admin → Permissões):
//  • ticket de STAFF (recrutamento)  → SOMENTE cargos de Recrutador
//  • ticket de MIGRAÇÃO              → SOMENTE cargos Habilitados para migração
// Se o cargo do tipo ainda não foi definido, usa "Cargos com acesso aos tickets" e, por fim, liderança/admin,
// para o ticket não ficar sem ninguém para atender.
const typeRoleIds = (cfg, type) => (type === 'migracao' ? cfg.perms.main.migrator : cfg.perms.main.recruiter) || [];
const visibleRoles = (cfg, guild, type) => {
  const own = typeRoleIds(cfg, type);
  const ids = own.length
    ? own
    : cfg.tickets.accessRoleIds.length
      ? cfg.tickets.accessRoleIds
      : [...cfg.perms.main.leader, ...cfg.perms.main.admin];
  return unique(ids).filter((id) => guild.roles.cache.has(id));
};
// Quem pode atender o tipo de ticket (assumir/transferir)
const canWorkType = (member, cfg, type) => {
  const p = perms(member, cfg);
  if (p.isLeader) return true;
  const own = typeRoleIds(cfg, type);
  return own.length ? own.some((id) => member.roles.cache.has(id)) : p.isRecruiter;
};

function upsertField(embed, label, emojiKey, value) {
  const name = lbl(emojiKey, label);
  const fields = [...(embed.data.fields ?? [])];
  // procura pelo texto (sem depender do emoji, que pode ter sido trocado)
  const idx = fields.findIndex((f) => f.name === label || f.name.endsWith(` ${label}`));
  if (idx >= 0) fields[idx] = { ...fields[idx], name, value };
  else fields.push({ name, value });
  return embed.setFields(fields);
}

const historyText = (t) =>
  trunc(
    (t.history || [])
      .map((h) => `${ts(h.at, 't')} <@${h.by}> — ${h.action}${h.detail ? `: ${h.detail}` : ''}`)
      .join('\n') || '—',
    1000
  );

const vars = (t, extra = {}) => ({
  usuario: `<@${t.userId}>`,
  tipo: tn(t),
  numero: String(t.number ?? 0).padStart(4, '0'),
  ...extra,
});

// Forma de criar o ticket (definida no painel): tópico privado ou canal em categoria. Sem perguntar ao candidato.
const ticketVia = (cfg) => (cfg.tickets.useThread ? 'thread' : 'channel');
const viaConfigured = (cfg) => (cfg.tickets.useThread ? !!cfg.tickets.threadChannelId : !!cfg.tickets.categoryId);

// ---------- 1) abrir formulário ----------
async function openForm(i, type, pid = null) {
  if (!TYPES[type]) return;
  const cfg = viewCfg(await getCfg(), pid);
  if (cfg._preset?.deleted) return i.reply(deny(`${E('warn')} Este painel de tickets foi removido. Avise um administrador.`));
  const questions = cfg.tickets.questions[type];

  if (!viaConfigured(cfg) || !questions.length) {
    return i.reply(deny(`${E('warn')} ${cfg._preset ? 'Este sistema de tickets' : 'O sistema de recrutamento'} ainda não foi configurado. Avise um administrador.`));
  }

  const existing = await Ticket.findOne({ userId: i.user.id, status: 'open', presetId: pid });
  if (existing) {
    const ch = await i.guild.channels.fetch(existing.channelId).catch(() => null);
    if (ch) return i.reply(deny(`${E('warn')} Você já tem um ticket aberto: ${ch}`));
    await Ticket.updateOne({ _id: existing._id }, { $set: { status: 'closed', result: existing.result ?? 'cancelado', closedAt: new Date(), closedBy: 'sistema' } });
  }

  const modal = new ModalBuilder()
    .setCustomId(`tk:modal:${type}:${pid || ''}`)
    .setTitle((cfg._preset ? plainText(cfg._preset.name) || 'Formulário' : `${plainText(cfg.tickets.panel.title) || 'Formulário'} — ${TYPES[type].name}`).slice(0, 45));
  questions.slice(0, MAX_Q).forEach((q, idx) => {
    const input = new TextInputBuilder()
      .setCustomId(`q${idx}`)
      .setLabel(q.label.slice(0, 45))
      .setStyle(q.long ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(q.required)
      .setMaxLength(q.long ? 1000 : 200);
    if (q.placeholder) input.setPlaceholder(q.placeholder.slice(0, 100));
    modal.addComponents(row(input));
  });
  return i.showModal(modal);
}

// ---------- 2) formulário enviado → cria o ticket ----------
const creating = new Set(); // evita clique duplo criando dois tópicos
async function createTicket(i, type, pid = null) {
  const key = `${i.user.id}:${pid ?? ''}`;
  if (creating.has(key)) return i.reply({ content: `${E('warn')} Seu ticket já está sendo criado, aguarde um instante.`, ephemeral: true }).catch(() => {});
  creating.add(key);
  try {
    return await createTicketNow(i, type, pid);
  } finally {
    creating.delete(key);
  }
}

async function createTicketNow(i, type, pid = null) {
  if (!TYPES[type]) return;
  await i.deferReply({ ephemeral: true });
  const cfg = viewCfg(await getCfg(), pid);
  if (cfg._preset?.deleted) return i.editReply(`${E('warn')} Este painel de tickets foi removido. Avise um administrador.`);
  const typeName = cfg._preset ? cfg._preset.name : TYPES[type].name;

  if (await Ticket.exists({ userId: i.user.id, status: 'open', presetId: pid })) {
    return i.editReply(`${E('warn')} Você já tem um ticket aberto.`);
  }

  const answers = cfg.tickets.questions[type].slice(0, MAX_Q).map((q, idx) => ({
    q: q.label,
    a: i.fields.fields.get(`q${idx}`)?.value?.trim() || '—',
  }));

  // numeração separada: o recrutamento usa o contador "ticket" e cada preset tem o seu
  const number = (await Counter.findOneAndUpdate({ _id: pid ? `ticket-${pid}` : 'ticket' }, { $inc: { n: 1 } }, { upsert: true, new: true })).n;
  const name =
    render(cfg.tickets.nameTemplate, { tipo: cfg._preset ? cfg._preset.name : type, usuario: i.user.username, numero: String(number).padStart(4, '0') })
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 90) || `ticket-${number}`;

  const base = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.AttachFiles,
  ];
  if (!viaConfigured(cfg)) return i.editReply(`${E('warn')} ${cfg._preset ? 'Este sistema de tickets' : 'O sistema de recrutamento'} ainda não foi configurado. Avise um administrador.`);
  const isThread = ticketVia(cfg) === 'thread';
  let channel;
  try {
    if (isThread) {
      // ---- modo TÓPICO: tópico privado dentro do canal configurado ----
      const parent = await i.guild.channels.fetch(cfg.tickets.threadChannelId).catch(() => null);
      if (!parent || !parent.threads) throw new Error('Canal dos tópicos não encontrado');
      channel = await parent.threads.create({
        name,
        type: ChannelType.PrivateThread,
        invitable: false,
        autoArchiveDuration: 10080,
        reason: `Ticket #${number} • ${typeName} • ${i.user.username} (${i.user.id})`,
      });
      await channel.members.add(i.user.id);
    } else channel = await i.guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: cfg.tickets.categoryId,
      topic: `Ticket #${number} • ${typeName} • ${i.user.username} (${i.user.id})`,
      permissionOverwrites: [
        { id: i.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: i.user.id, allow: base },
        { id: i.client.user.id, allow: [...base, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.EmbedLinks] },
        ...visibleRoles(cfg, i.guild, type).map((id) => ({ id, allow: base })),
      ],
    });
  } catch (err) {
    console.error('[ticket:create]', err.message);
    return i.editReply(`${E('bad')} Não consegui criar o ticket. Verifique ${isThread ? 'o canal dos tópicos (o bot precisa de **Criar Tópicos Privados**, **Enviar Mensagens em Tópicos** e **Gerenciar Tópicos**)' : 'a categoria e as permissões do bot'}.`);
  }

  const t = {
    number, guildId: i.guildId, channelId: channel.id, channelName: channel.name,
    userId: i.user.id, userTag: i.user.username, type, presetId: pid, presetName: cfg._preset ? cfg._preset.name : undefined, answers,
    history: [{ by: i.user.id, action: 'Ticket aberto' }],
  };

  const embed = new EmbedBuilder()
    .setColor(parseColor(cfg.tickets.panel.color))
    .setTitle(lbl(TYPES[type].emojiKey, cfg._preset ? `${typeName} #${String(number).padStart(4, '0')}` : `Candidatura #${String(number).padStart(4, '0')} — ${typeName}`))
    .setDescription(`**${cfg._preset ? 'Aberto por' : 'Candidato'}:** ${i.user} (\`${i.user.id}\`)`)
    .setThumbnail(i.user.displayAvatarURL({ size: 256 }))
    .addFields(answers.map((x) => ({ name: trunc(x.q, 256), value: trunc(x.a, 1024) })))
    .setFooter({ text: 'Aguardando atendimento' })
    .setTimestamp();

  // Marca dentro do ticket os cargos do tipo (Recrutador no staff • Habilitados à migração na migração);
  // no tópico, essa marcação também adiciona quem tem o cargo
  const pingRoles = visibleRoles(cfg, i.guild, type);
  const payload = (plain) => ({
    content: `${i.user} ${pingRoles.map((r) => `<@&${r}>`).join(' ')}\n${render(cfg.tickets.messages.open, vars(t))}`.slice(0, 2000),
    embeds: [embed],
    components: [plain ? row(new ButtonBuilder().setCustomId('tk:claim').setLabel('Assumir atendimento').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('tk:close').setLabel('Fechar').setStyle(ButtonStyle.Secondary)) : rowOpen()],
    allowedMentions: { roles: pingRoles, users: [i.user.id] },
  });
  let msg;
  try {
    try {
      msg = await channel.send(payload(false));
    } catch (e1) {
      console.error('[ticket:send]', e1.code, e1.message, e1.rawError ? JSON.stringify(e1.rawError.errors ?? e1.rawError) : '');
      if (e1.code !== 50035) throw e1; // dado inválido (ex.: emoji de botão) → tenta de novo sem emojis
      msg = await channel.send(payload(true));
    }
  } catch (err) {
    console.error('[ticket:send:falhou]', err.code, err.message);
    await channel.delete().catch(() => {}); // não deixa tópico órfão
    const hint = err.code === 50013 || err.code === 50001
      ? 'o bot precisa das permissões **Enviar Mensagens em Tópicos** e **Inserir Links** no canal dos tópicos'
      : `erro ${err.code ?? ''} ${err.message}`;
    return i.editReply(`${E('bad')} Não consegui enviar o painel dentro do ticket: ${hint}.`);
  }

  try {
    await Ticket.create({ ...t, messageId: msg.id });
  } catch (e) {
    await channel.delete().catch(() => {});
    if (e.code === 11000) return i.editReply(`${E('warn')} Você já tem um ticket aberto.`);
    throw e;
  }

  const log = new EmbedBuilder()
    .setColor(COLORS.ok)
    .setTitle(lbl('logOpened', 'Ticket aberto'))
    .addFields(
      { name: 'Aberto por', value: `${i.user} (\`${i.user.id}\`)`, inline: true },
      { name: 'Tipo', value: typeName, inline: true },
      { name: 'Horário', value: ts(new Date()), inline: true },
      { name: 'Ticket', value: `#${String(number).padStart(4, '0')} • ${channel} (\`#${channel.name}\`)` }
    )
    .setTimestamp();
  await emit(i.client, cfg, { category: 'tickets', action: 'Ticket aberto', embed: log, userId: i.user.id, data: { number, type } });

  // Painel V3 com menu: reseta a seleção para o próximo candidato poder escolher de novo
  if (cfg.tickets.style === 'V3' && i.isFromMessage?.()) {
    i.message.edit(buildPanel(cfg)).catch(() => {});
  }
  return i.editReply(`${E('ok')} Seu ticket foi aberto: [clique aqui para abrir](${channel.url})`);
}

// ---------- 3) assumir atendimento ----------
async function claim(i) {
  const { cfg, ticket: toClaim } = await ctxByChannel(i.channelId);
  if (toClaim && !canWorkType(i.member, cfg, toClaim.type)) {
    return i.reply(deny(`${E('bad')} ${toClaim.type === 'migracao' ? 'Apenas quem tem o cargo habilitado para migração' : 'Apenas recrutadores'} pode assumir este atendimento.`));
  }
  if (!toClaim && !perms(i.member, cfg).isRecruiter) return i.reply(deny(`${E('bad')} Apenas recrutadores podem assumir o atendimento.`));
  if (cfg.tickets.requireShiftToClaim && !(await Shift.exists({ userId: i.user.id, status: 'active' }))) {
    return i.reply(deny(`${E('warn')} Você precisa estar em plantão (servidor interno) para assumir atendimentos.`));
  }

  const ticket = await Ticket.findOneAndUpdate(
    { channelId: i.channelId, status: 'open', claimedBy: null },
    { $set: { claimedBy: i.user.id, claimedAt: new Date() }, $push: { history: { by: i.user.id, action: 'Atendimento assumido' } } },
    { new: true }
  );
  if (!ticket) {
    const t = await Ticket.findOne({ channelId: i.channelId });
    return i.reply(deny(t?.claimedBy ? `${E('warn')} Este ticket já foi assumido por <@${t.claimedBy}>.` : `${E('bad')} Ticket não encontrado ou já fechado.`));
  }

  const embed = upsertField(EmbedBuilder.from(i.message.embeds[0]), 'Atendido por', 'attended', `${i.user}`).setFooter({ text: 'Em atendimento' });
  await i.update({ embeds: [embed], components: [rowClaimed(cfg)] }).catch(async (e) => {
    console.error('[ticket:assumir:update]', e.code, e.message);
    if (e.code !== 50035) throw e;
    await i.update({ embeds: [embed], components: stripEmojis([rowClaimed(cfg)]) }); // emoji recusado → refaz sem emojis
  });
  await i.channel.send({
    content: render(cfg.tickets.messages.claim, vars(ticket, { recrutador: `${i.user}` })),
    allowedMentions: { users: [] },
  });

  const fields = [
    { name: 'Recrutador', value: `${i.user} (\`${i.user.id}\`)`, inline: true },
    { name: 'Candidato', value: `<@${ticket.userId}>`, inline: true },
    { name: 'Tipo', value: tn(ticket), inline: true },
    { name: 'Horário', value: ts(new Date()), inline: true },
    { name: 'Ticket', value: `#${String(ticket.number).padStart(4, '0')} • \`#${ticket.channelName}\`` },
  ];
  await emit(i.client, cfg, { category: 'tickets', action: 'Ticket assumido', userId: i.user.id,
    embed: new EmbedBuilder().setColor(COLORS.warn).setTitle(lbl('claim', 'Ticket assumido')).addFields(fields).setTimestamp() });
  await emit(i.client, cfg, { category: 'recruitment', action: 'Recrutamento iniciado', userId: i.user.id,
    embed: new EmbedBuilder().setColor(COLORS.warn).setTitle(lbl('logStarted', 'Recrutamento iniciado')).addFields(fields).setTimestamp() });
}

// ---------- 4) setar cargos (finaliza o recrutamento) ----------
const canHandle = (i, cfg, t) => i.user.id === t.claimedBy || perms(i.member, cfg).isLeader;

async function setRoles(i) {
  const { cfg, ticket } = await ctxByChannel(i.channelId);
  if (!ticket || ticket.status !== 'open') return i.reply(deny(`${E('bad')} Ticket não encontrado ou já fechado.`));
  if (ticket.result) return i.reply(deny(`${E('warn')} Este atendimento já foi finalizado.`));
  if (!canHandle(i, cfg, ticket)) return i.reply(deny(`${E('bad')} Apenas o recrutador que assumiu este atendimento pode setar cargos.`));

  // Ticket de MIGRAÇÃO com hierarquia configurada: painel com 2 menus (área + hierarquia) e botão de confirmar
  if (ticket.type === 'migracao' && migHierarchy(cfg, i.guild).length) {
    const draft = { area: [], hier: [], at: Date.now() };
    migDrafts.set(`${ticket._id}:${i.user.id}`, draft);
    return i.reply({ ...migPanel(cfg, i.guild, draft), ephemeral: true });
  }

  const options = cfg.tickets.assignableRoleIds
    .map((id) => i.guild.roles.cache.get(id))
    .filter(Boolean)
    .slice(0, 25)
    .map((r) => ({ label: r.name.slice(0, 100), value: r.id }));
  if (!options.length) return i.reply(deny(`${E('warn')} Nenhum cargo atribuível foi configurado (/admin → Tickets → Cargos do recrutamento).`));

  const select = new StringSelectMenuBuilder()
    .setCustomId('tk:pickroles')
    .setPlaceholder('Selecione o cargo do recrutado...')
    .setMinValues(1)
    .setMaxValues(options.length)
    .addOptions(options);
  return i.reply({
    content: `${E('setRoles')} Selecione o cargo que o recrutado vai receber.` + (cfg.tickets.inicianteRoleIds?.length ? ` Os cargos iniciais (${cfg.tickets.inicianteRoleIds.map((id) => `<@&${id}>`).join(' ')}) são adicionados automaticamente.` : ''),
    components: [row(select)],
    ephemeral: true,
  });
}

// ---------- migração: área + hierarquia ----------
const migDrafts = new Map(); // `${ticketId}:${userId}` → { area: [], hier: [], at }
const MIG_TTL = 15 * 60 * 1000;
const migHierarchy = (cfg, guild) => (cfg.tickets.hierarchyRoleIds || []).filter((id) => guild.roles.cache.has(id)).slice(0, 25);
const migMax = (cfg) => Math.max(1, Math.min(5, Number(cfg.tickets.hierarchyMax) || 1));

function migPanel(cfg, guild, draft) {
  const roleOpts = (ids, selected) =>
    ids.map((id) => guild.roles.cache.get(id)).filter(Boolean).slice(0, 25)
      .map((r) => ({ label: r.name.slice(0, 100), value: r.id, default: selected.includes(r.id) }));
  const areaOpts = roleOpts(cfg.tickets.assignableRoleIds, draft.area);
  const hierIds = migHierarchy(cfg, guild);
  const hierOpts = roleOpts(hierIds, draft.hier);
  const max = Math.min(migMax(cfg), hierOpts.length);
  const mention = (ids) => (ids.length ? ids.map((id) => `<@&${id}>`).join(' ') : '_não selecionado_');
  const components = [];
  if (areaOpts.length) {
    components.push(row(new StringSelectMenuBuilder().setCustomId('tk:migarea').setPlaceholder('1) Cargo de área do migrado...')
      .setMinValues(1).setMaxValues(areaOpts.length).addOptions(areaOpts)));
  }
  components.push(row(new StringSelectMenuBuilder().setCustomId('tk:mighier').setPlaceholder('2) Cargo de hierarquia do servidor...')
    .setMinValues(1).setMaxValues(max).addOptions(hierOpts)));
  const ready = (!areaOpts.length || draft.area.length) && draft.hier.length;
  components.push(row(gbtn('tk:migok', 'Confirmar e setar cargos', 'setRoles', !ready)));
  return {
    content:
      `${E('setRoles')} **Migração:** o migrado recebe o **cargo de área** e o **cargo de hierarquia** do servidor.\n` +
      `**Área:** ${mention(draft.area)}\n**Hierarquia:** ${mention(draft.hier)}${max > 1 ? ` _(até ${max})_` : ''}` +
      (cfg.tickets.inicianteRoleIds?.length ? `\nOs cargos iniciais (${cfg.tickets.inicianteRoleIds.map((id) => `<@&${id}>`).join(' ')}) são adicionados automaticamente.` : ''),
    components,
    allowedMentions: { parse: [] },
  };
}

async function migPick(i, which) {
  const { cfg, ticket } = await ctxByChannel(i.channelId);
  if (!ticket || ticket.status !== 'open' || ticket.result) return i.update({ content: `${E('warn')} Este atendimento já foi finalizado.`, components: [] });
  if (!canHandle(i, cfg, ticket)) return i.update({ content: `${E('bad')} Sem permissão.`, components: [] });
  for (const [k, d] of migDrafts) if (Date.now() - d.at > MIG_TTL) migDrafts.delete(k);
  const key = `${ticket._id}:${i.user.id}`;
  const draft = migDrafts.get(key) || { area: [], hier: [], at: Date.now() };
  const valid = which === 'area' ? cfg.tickets.assignableRoleIds : migHierarchy(cfg, i.guild);
  draft[which] = i.values.filter((v) => valid.includes(v)).slice(0, which === 'hier' ? migMax(cfg) : 25);
  draft.at = Date.now();
  migDrafts.set(key, draft);
  return i.update(migPanel(cfg, i.guild, draft));
}

async function migConfirm(i) {
  await i.deferUpdate();
  const { cfg, ticket } = await ctxByChannel(i.channelId);
  if (!ticket || ticket.status !== 'open' || ticket.result) return i.editReply({ content: `${E('warn')} Este atendimento já foi finalizado.`, components: [] });
  const key = `${ticket._id}:${i.user.id}`;
  const draft = migDrafts.get(key);
  const hasArea = cfg.tickets.assignableRoleIds.some((id) => i.guild.roles.cache.has(id));
  if (!draft || !draft.hier.length || (hasArea && !draft.area.length)) {
    return i.editReply({ content: `${E('warn')} Selecione o cargo de área e o de hierarquia antes de confirmar.`, components: [] });
  }
  migDrafts.delete(key);
  return finalizeRoles(i, [...draft.area, ...draft.hier]);
}

async function pickRoles(i) {
  await i.deferUpdate();
  return finalizeRoles(i, i.values);
}

async function finalizeRoles(i, values) {
  const { cfg, ticket } = await ctxByChannel(i.channelId);
  if (!ticket || ticket.status !== 'open' || ticket.result) return i.editReply({ content: `${E('warn')} Este atendimento já foi finalizado.`, components: [] });
  if (!canHandle(i, cfg, ticket)) return i.editReply({ content: `${E('bad')} Sem permissão.`, components: [] });

  const member = await i.guild.members.fetch(ticket.userId).catch(() => null);
  if (!member) return i.editReply({ content: `${E('bad')} O candidato não está mais no servidor.`, components: [] });

  const hierAllowed = ticket.type === 'migracao' ? migHierarchy(cfg, i.guild) : [];
  const hierPicked = values.filter((v) => hierAllowed.includes(v));
  if (hierAllowed.length && (!hierPicked.length || hierPicked.length > migMax(cfg))) {
    return i.editReply({ content: `${E('warn')} Selecione de 1 a ${migMax(cfg)} cargo(s) de hierarquia.`, components: [] });
  }
  const toAdd = unique([...values.filter((v) => cfg.tickets.assignableRoleIds.includes(v) || hierAllowed.includes(v)), ...(cfg.tickets.inicianteRoleIds || [])]);
  const me = i.guild.members.me;
  const blocked = toAdd.filter((id) => {
    const r = i.guild.roles.cache.get(id);
    return !r || r.position >= me.roles.highest.position;
  });
  if (blocked.length || !me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return i.editReply({
      content: `${E('bad')} Não consigo setar: ` + (blocked.map((id) => `<@&${id}>`).join(' ') || 'sem permissão') +
        '\nDê ao bot **Gerenciar Cargos** e coloque o cargo dele **acima** desses cargos.',
      components: [],
      allowedMentions: { parse: [] },
    });
  }

  // Trava atômica: só um clique consegue finalizar (evita pontos duplicados)
  const locked = await Ticket.findOneAndUpdate(
    { _id: ticket._id, status: 'open', result: null },
    { $set: { result: 'aprovado', rolesGiven: toAdd, finalizedAt: new Date() }, $push: { history: { by: i.user.id, action: 'Cargos setados', detail: toAdd.map((r) => i.guild.roles.cache.get(r)?.name).join(', ') } } },
    { new: true }
  );
  if (!locked) return i.editReply({ content: `${E('warn')} Este atendimento já foi finalizado.`, components: [] });

  try {
    await member.roles.add(toAdd, `Recrutamento por ${i.user.username}`);
  } catch (err) {
    console.error('[ticket:roles]', err.message);
    await Ticket.updateOne({ _id: ticket._id }, { $set: { result: null, rolesGiven: [] }, $pop: { history: 1 } });
    return i.editReply({ content: `${E('bad')} Erro ao adicionar os cargos. Nada foi registrado, tente novamente.`, components: [] });
  }

  const recruiterId = locked.claimedBy || i.user.id;
  const points = locked.type === 'migracao' ? cfg.points.migration : cfg.points.recruitment;
  const activeShift = await Shift.findOne({ userId: recruiterId, status: 'active' }).select('_id').lean();
  let registered = true;
  try {
    await Recruitment.create({
      ticketId: locked._id, guildId: i.guildId, recruiterId, recruitedId: locked.userId,
      type: locked.type, roles: toAdd, points, shiftId: activeShift?._id,
    });
  } catch (e) {
    if (e.code === 11000) registered = false;
    else throw e;
  }
  if (registered) {
    const recruiter = await i.client.users.fetch(recruiterId).catch(() => null);
    await addStats(recruiterId, recruiter?.username, {
      points, recruitments: 1, migrations: locked.type === 'migracao' ? 1 : 0,
    });
    scheduleRankingRefresh(i.client);
  }

  const names = toAdd.map((id) => `<@&${id}>`).join(' ');
  const main = await i.channel.messages.fetch(locked.messageId).catch(() => null);
  if (main?.embeds[0]) {
    const embed = upsertField(EmbedBuilder.from(main.embeds[0]), 'Cargos setados', 'setRoles', names)
      .setColor(COLORS.ok).setFooter({ text: 'Recrutamento concluído' });
    await main.edit({ embeds: [embed], components: [rowDone('Recrutamento concluído')] }).catch(() => {});
  }
  await i.channel.send({
    content: render(cfg.tickets.messages.finish, vars(locked, { recrutador: `<@${recruiterId}>`, cargos: names })),
    allowedMentions: { users: [locked.userId] },
  });

  const log = new EmbedBuilder()
    .setColor(COLORS.ok)
    .setTitle(lbl('logFinished', 'Recrutamento finalizado'))
    .addFields(
      { name: 'Recrutador', value: `<@${recruiterId}> (\`${recruiterId}\`)`, inline: true },
      { name: 'Recrutado', value: `<@${locked.userId}> (\`${locked.userId}\`)`, inline: true },
      { name: 'Tipo', value: tn(locked), inline: true },
      { name: 'Cargos', value: names },
      { name: 'Pontos adicionados', value: registered ? `+${points}` : '0 (já registrado)', inline: true },
      { name: 'Ticket', value: `#${String(locked.number).padStart(4, '0')}`, inline: true },
      { name: 'Horário', value: ts(new Date()), inline: true }
    )
    .setTimestamp();
  await emit(i.client, cfg, { category: 'recruitment', action: 'Recrutamento finalizado', embed: log, userId: recruiterId, data: { ticket: locked.number, points } });

  return i.editReply({ content: `${E('ok')} Cargos setados com sucesso!`, components: [] });
}

// ---------- 5) reprovar ----------
async function rejectModal(i) {
  const { cfg, ticket } = await ctxByChannel(i.channelId);
  if (!ticket || ticket.status !== 'open' || ticket.result) return i.reply(deny(`${E('warn')} Este atendimento já foi finalizado.`));
  if (!canHandle(i, cfg, ticket)) return i.reply(deny(`${E('bad')} Apenas o recrutador que assumiu pode reprovar.`));
  const input = new TextInputBuilder().setCustomId('reason').setLabel('Motivo da reprovação (opcional)')
    .setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500);
  return i.showModal(new ModalBuilder().setCustomId('tk:rejectm').setTitle('Reprovar candidatura').addComponents(row(input)));
}

async function rejectSubmit(i) {
  await i.deferUpdate();
  const { cfg } = await ctxByChannel(i.channelId);
  const reason = i.fields.getTextInputValue('reason').trim();
  const locked = await Ticket.findOneAndUpdate(
    { channelId: i.channelId, status: 'open', result: null },
    { $set: { result: 'reprovado', finalizedAt: new Date() }, $push: { history: { by: i.user.id, action: 'Reprovado', detail: reason || undefined } } },
    { new: true }
  );
  if (!locked) return i.followUp(deny(`${E('warn')} Este atendimento já foi finalizado.`));

  if (cfg.points.reject > 0 && locked.claimedBy) {
    await addStats(locked.claimedBy, undefined, { points: cfg.points.reject });
    scheduleRankingRefresh(i.client);
  }
  const main = await i.channel.messages.fetch(locked.messageId).catch(() => null);
  if (main?.embeds[0]) {
    const embed = upsertField(EmbedBuilder.from(main.embeds[0]), 'Resultado', 'reject', reason ? `Reprovado — ${trunc(reason, 900)}` : 'Reprovado')
      .setColor(COLORS.bad).setFooter({ text: 'Candidatura reprovada' });
    await main.edit({ embeds: [embed], components: [rowDone('Reprovado')] }).catch(() => {});
  }
  await i.channel.send({ content: render(cfg.tickets.messages.reject, vars(locked, { recrutador: `${i.user}` })), allowedMentions: { users: [locked.userId] } });
  await emit(i.client, cfg, { category: 'recruitment', action: 'Reprovado', userId: i.user.id,
    embed: new EmbedBuilder().setColor(COLORS.bad).setTitle(lbl('reject', 'Candidatura reprovada'))
      .addFields(
        { name: 'Recrutador', value: `${i.user}`, inline: true },
        { name: 'Candidato', value: `<@${locked.userId}>`, inline: true },
        { name: 'Tipo', value: tn(locked), inline: true },
        { name: 'Motivo', value: reason || '—' }
      ).setTimestamp() });
}

// ---------- 6) transferir ----------
async function transferMenu(i) {
  const { cfg, ticket } = await ctxByChannel(i.channelId);
  if (!ticket || ticket.status !== 'open' || ticket.result) return i.reply(deny(`${E('warn')} Este atendimento já foi finalizado.`));
  if (!canHandle(i, cfg, ticket)) return i.reply(deny(`${E('bad')} Apenas o recrutador responsável pode transferir o atendimento.`));
  return i.reply({
    content: `${E('transfer')} Escolha o recrutador que vai assumir este atendimento:`,
    components: [row(new UserSelectMenuBuilder().setCustomId('tk:transferto').setPlaceholder('Novo recrutador...').setMaxValues(1))],
    ephemeral: true,
  });
}

async function transferTo(i) {
  await i.deferUpdate();
  const { cfg, ticket: current } = await ctxByChannel(i.channelId);
  const targetId = i.values[0];
  const target = await i.guild.members.fetch(targetId).catch(() => null);
  if (!target || target.user.bot || !canWorkType(target, cfg, current?.type)) {
    return i.editReply({ content: `${E('bad')} Essa pessoa não pode atender este tipo de ticket.`, components: [] });
  }
  if (!current || current.status !== 'open' || current.result || !canHandle(i, cfg, current)) {
    return i.editReply({ content: `${E('bad')} Não foi possível transferir.`, components: [] });
  }
  const ticket = await Ticket.findOneAndUpdate(
    { _id: current._id, status: 'open', result: null },
    { $set: { claimedBy: targetId, claimedAt: new Date() }, $push: { history: { by: i.user.id, action: 'Transferido', detail: `de <@${current.claimedBy}> para <@${targetId}>` } } },
    { new: true }
  );
  const main = await i.channel.messages.fetch(ticket.messageId).catch(() => null);
  if (main?.embeds[0]) {
    await main.edit({ embeds: [upsertField(EmbedBuilder.from(main.embeds[0]), 'Atendido por', 'attended', `<@${targetId}>`)] }).catch(() => {});
  }
  await i.channel.send({ content: `${E('transfer')} ${i.user} transferiu o atendimento para <@${targetId}>.`, allowedMentions: { users: [targetId] } });
  await emit(i.client, cfg, { category: 'tickets', action: 'Ticket transferido', userId: i.user.id,
    embed: new EmbedBuilder().setColor(COLORS.warn).setTitle(lbl('transfer', 'Ticket transferido'))
      .addFields(
        { name: 'De', value: current.claimedBy ? `<@${current.claimedBy}>` : '—', inline: true },
        { name: 'Para', value: `<@${targetId}>`, inline: true },
        { name: 'Por', value: `${i.user}`, inline: true },
        { name: 'Ticket', value: `#${String(ticket.number).padStart(4, '0')} • \`#${ticket.channelName}\`` }
      ).setTimestamp() });
  return i.editReply({ content: `${E('ok')} Atendimento transferido.`, components: [] });
}

// ---------- 7) fechar ----------
async function closeTicket(i) {
  const { cfg, ticket } = await ctxByChannel(i.channelId);
  if (!ticket || ticket.status !== 'open') return i.reply(deny(`${E('warn')} Ticket não encontrado ou já fechado.`));

  const p = perms(i.member, cfg);
  const allowed =
    p.isLeader ||
    i.user.id === ticket.claimedBy ||
    (!ticket.claimedBy && (i.user.id === ticket.userId || canWorkType(i.member, cfg, ticket.type)));
  if (!allowed) return i.reply(deny(`${E('bad')} Você não pode fechar este ticket.`));

  // preset sem modo recrutamento: ticket que foi atendido fecha como "atendido"
  const result = ticket.result ?? (cfg._preset && ticket.claimedBy ? 'atendido' : 'cancelado');
  const closed = await Ticket.findOneAndUpdate(
    { _id: ticket._id, status: 'open' },
    { $set: { status: 'closed', result, closedAt: new Date(), closedBy: i.user.id }, $push: { history: { by: i.user.id, action: 'Ticket fechado' } } },
    { new: true }
  );
  if (!closed) return i.reply(deny(`${E('warn')} Este ticket já foi fechado.`));

  await i.reply(render(cfg.tickets.messages.close, vars(closed)));
  await emit(i.client, cfg, { category: 'tickets', action: 'Ticket fechado', userId: i.user.id,
    embed: new EmbedBuilder().setColor(COLORS.bad).setTitle(lbl('close', 'Ticket fechado'))
      .addFields(
        { name: 'Aberto por', value: `<@${closed.userId}>`, inline: true },
        { name: 'Tipo', value: tn(closed), inline: true },
        { name: 'Resultado', value: resultLabel(result), inline: true },
        { name: 'Abertura', value: ts(closed.openedAt), inline: true },
        { name: 'Fechamento', value: ts(closed.closedAt), inline: true },
        { name: 'Fechado por', value: `${i.user}`, inline: true },
        { name: 'Assumido por', value: closed.claimedBy ? `<@${closed.claimedBy}>` : '—', inline: true },
        { name: 'Ticket', value: `#${String(closed.number).padStart(4, '0')} • \`#${closed.channelName}\``, inline: true },
        { name: 'Alterações realizadas', value: historyText(closed) }
      ).setTimestamp() });
  setTimeout(() => i.channel.delete().catch(() => {}), 5000);
}

// Canal apagado na mão → encerra o ticket no banco (libera o candidato)
async function onChannelDelete(channel) {
  const t = await Ticket.findOne({ channelId: channel.id, status: 'open' });
  if (!t) return;
  await Ticket.updateOne({ _id: t._id }, { $set: { status: 'closed', result: t.result ?? 'cancelado', closedAt: new Date(), closedBy: 'sistema' } });
  const cfg = viewCfg(await getCfg(), t.presetId);
  await emit(channel.client, cfg, { category: 'tickets', action: 'Ticket removido', userId: t.userId,
    embed: new EmbedBuilder().setColor(COLORS.bad).setTitle(lbl('logDeleted', 'Canal do ticket apagado manualmente'))
      .setDescription(`Ticket #${String(t.number).padStart(4, '0')} de <@${t.userId}> foi encerrado como **cancelado**.`).setTimestamp() });
}

module.exports = { buildPanel, publishPanel, handleTicket, onChannelDelete };
