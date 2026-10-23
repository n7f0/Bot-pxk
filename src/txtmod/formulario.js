// ============================================================
// Formulário de Suporte (/formulario)
// ------------------------------------------------------------
// Preset de painel independente dos tickets:
//  1. O painel público tem o botão "Preencher Formulário".
//  2. Ao clicar, o bot cria um chat PRIVADO (só a pessoa e o bot enxergam).
//  3. O bot faz uma pergunta por vez; a pessoa tem X minutos (padrão 5) para cada uma.
//     Se o tempo acabar, o formulário é cancelado e o chat é apagado.
//  4. Ao terminar, as respostas vão para o canal de análise com os botões Aceitar e Recusar.
//  5. O resultado é registrado no canal de logs e a pessoa recebe aviso por DM.
// Tudo é configurável pelo comando /formulario. Dados em cfg.forms[id].
// ============================================================
const crypto = require('crypto');
const mongoose = require('mongoose');
const {
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { getCfg, setCfg, delCfg, clone } = require('./db');
const { guildKey, perms, row, trunc, render, parseColor, COLORS } = require('./core');

const MAX_FORMS = 25;
const MAX_QUESTIONS = 20;
const { Schema } = mongoose;

// ---------- modelo ----------
const FormSession =
  mongoose.models.FormSession ||
  mongoose.model(
    'FormSession',
    (() => {
      const s = new Schema({
        presetId: String,
        presetName: String,
        guildId: String,
        userId: String,
        userTag: String,
        channelId: String,
        questions: [String], // cópia das perguntas no momento em que a pessoa começou
        minutes: Number,
        answers: [String],
        askedIndex: { type: Number, default: -1 }, // última pergunta já enviada
        deadlineAt: Date, // prazo da pergunta atual
        // answering | pending (aguardando análise) | approved | refused | expired | cancelled
        status: { type: String, default: 'answering', index: true },
        startedAt: { type: Date, default: Date.now },
        finishedAt: Date,
        reviewChannelId: String,
        reviewMessageId: String,
        reviewedBy: String,
        reviewedAt: Date,
        reviewNote: String,
      });
      // uma pessoa só pode ter 1 formulário em andamento por painel
      s.index({ userId: 1, presetId: 1 }, { unique: true, partialFilterExpression: { status: 'answering' } });
      return s;
    })()
  );

// ---------- padrões ----------
const DEFAULT_DESC = [
  '👑 ***Formulário Para Suporte***',
  '',
  'Este formulário deve ser preenchido com as informações solicitadas para que sua solicitação seja analisada pela equipe responsável. Após a análise, caso necessário, o atendimento será encaminhado para o suporte adequado.',
].join('\n');

function formDefaults(name = 'Formulário de Suporte') {
  return {
    name,
    title: '',
    desc: DEFAULT_DESC,
    color: '#8B2BE2',
    banner: '',
    thumbnail: '',
    footer: '',
    buttonLabel: 'Preencher Formulário',
    categoryId: null, // categoria onde o chat privado é criado
    reviewChannelId: null, // canal onde chegam as fichas com Aceitar / Recusar
    logChannelId: null, // canal de logs do resultado
    reviewerRoleIds: [], // cargos que podem aceitar/recusar (vazio = liderança/admin)
    minutesPerQuestion: 5,
    questions: ['Qual o motivo da sua solicitação?', 'Explique com detalhes o que aconteceu.', 'Você tem provas ou mais informações? (links, prints, IDs)'],
    panelChannelId: null,
    panelMessageId: null,
    messages: {
      intro: 'Olá {usuario}! Este é o seu chat **privado** do formulário. Só você enxerga ele.\nVou fazer **{total} perguntas**, uma por vez. Você tem **{minutos} minutos** para responder cada uma, em **uma única mensagem**.',
      done: '✅ {usuario}, formulário enviado! A equipe vai analisar e você receberá o resultado por DM. Este chat será apagado em instantes.',
      accepted: '✅ {usuario}, sua ficha **{painel}** foi **aprovada** por {revisor}.',
      refused: '❌ {usuario}, sua ficha **{painel}** foi **recusada** por {revisor}.\n**Motivo:** {motivo}',
      timeout: '⏰ {usuario}, o tempo de **{minutos} minutos** para responder acabou e o formulário foi **cancelado**. Clique no painel de novo para recomeçar.',
    },
  };
}
const withDefaults = (f) => {
  const d = formDefaults(f?.name);
  const out = { ...d, ...clone(f || {}) };
  out.messages = { ...d.messages, ...(f?.messages || {}) };
  if (!Array.isArray(out.questions)) out.questions = d.questions;
  return out;
};
const getForm = (cfg, id) => (cfg.forms?.[id] ? withDefaults(cfg.forms[id]) : null);

// ---------- helpers ----------
const newId = () => 'f' + crypto.randomBytes(3).toString('hex');
const chan = (id) => (id ? `<#${id}>` : '*não definido*');
const rolesTxt = (ids) => (ids?.length ? ids.map((r) => `<@&${r}>`).join(' ') : '*liderança/admin*');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gbtn = (id, label, style = ButtonStyle.Secondary, emoji) => {
  const b = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
  return emoji ? b.setEmoji(emoji) : b;
};
const base = (title, desc) => new EmbedBuilder().setColor(COLORS.neutral).setTitle(title).setDescription(desc);
const isUrl = (s) => /^https?:\/\/\S+$/i.test(s);
const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || 'membro';
const fmtAnswer = (a, n) => trunc(a?.trim() ? a : '*sem resposta*', n);
const vars = (s, extra = {}) => ({ usuario: `<@${s.userId}>`, painel: s.presetName, minutos: s.minutes, total: s.questions?.length ?? 0, ...extra });

const commands = [
  new SlashCommandBuilder().setName('formulario').setDescription('Painéis de formulário (chat privado com tempo por pergunta)').setDMPermission(false).toJSON(),
];

// ============================================================
// Painel público
// ============================================================
function buildPanel(f, id, preview = false) {
  const e = new EmbedBuilder().setColor(parseColor(f.color)).setDescription(f.desc || '\u200b');
  if (f.title) e.setTitle(f.title);
  if (f.banner) e.setImage(f.banner);
  if (f.thumbnail) e.setThumbnail(f.thumbnail);
  if (f.footer) e.setFooter({ text: f.footer });
  const btn = gbtn(`fs:start:${id}`, f.buttonLabel || 'Preencher Formulário', ButtonStyle.Danger, '🎫').setDisabled(preview);
  return { embeds: [e], components: [row(btn)] };
}

async function publishPanel(f, id, channel) {
  const payload = buildPanel(f, id);
  let sent = null;
  if (f.panelMessageId && f.panelChannelId === channel.id) {
    const old = await channel.messages.fetch(f.panelMessageId).catch(() => null);
    if (old) sent = await old.edit({ content: '', ...payload }).catch(() => null);
  }
  if (!sent) sent = await channel.send(payload);
  return sent;
}

// ============================================================
// Telas de configuração (/formulario)
// ============================================================
function homeView(cfg) {
  const list = Object.entries(cfg.forms || {});
  const lines = ['Crie painéis de **formulário com chat privado**: a pessoa clica no botão, responde uma pergunta por vez em um chat só dela (com limite de tempo) e a equipe aceita ou recusa.', ''];
  if (list.length) {
    lines.push(`**Painéis criados (${list.length}/${MAX_FORMS}):**`);
    for (const [, raw] of list) {
      const f = withDefaults(raw);
      lines.push(`• **${trunc(f.name, 40)}** — ${f.questions.length} pergunta(s) • ${f.minutesPerQuestion} min cada • ${f.panelMessageId ? `publicado em ${chan(f.panelChannelId)}` : 'não publicado'}`);
    }
  } else lines.push('*Nenhum painel criado ainda. Clique em **Criar painel**.*');
  const components = [];
  if (list.length) {
    components.push(row(new StringSelectMenuBuilder().setCustomId('fs:pick').setPlaceholder('Escolha um painel salvo...')
      .addOptions(list.slice(0, MAX_FORMS).map(([id, raw]) => ({ label: trunc(withDefaults(raw).name, 100), value: id })))));
  }
  components.push(row(gbtn('fs:new', 'Criar painel', ButtonStyle.Secondary, '➕')));
  return { embeds: [base('📝 Formulários com chat privado', lines.join('\n'))], components };
}

function presetView(cfg, id) {
  const f = getForm(cfg, id);
  const ready = f.categoryId && f.reviewChannelId && f.questions.length;
  const lines = [
    `**Painel:** ${f.panelMessageId ? `publicado em ${chan(f.panelChannelId)}` : '*não publicado*'}`,
    `**Categoria dos chats privados:** ${chan(f.categoryId)}`,
    `**Canal de análise (Aceitar/Recusar):** ${chan(f.reviewChannelId)}`,
    `**Canal de logs:** ${chan(f.logChannelId)}`,
    `**Quem aceita/recusa:** ${rolesTxt(f.reviewerRoleIds)}`,
    `**Tempo por pergunta:** ${f.minutesPerQuestion} min`,
    `**Perguntas:** ${f.questions.length}`,
  ];
  if (!ready) lines.push('', '⚠️ Defina a **categoria**, o **canal de análise** e ao menos **1 pergunta** para o painel funcionar.');
  const menu = new StringSelectMenuBuilder().setCustomId(`fs:menu:${id}`).setPlaceholder('Editar este painel...').addOptions(
    { label: 'Aparência do painel', value: 'app', description: 'Título, texto, cor, banner e botão' },
    { label: 'Perguntas', value: 'qs', description: 'Adicionar ou remover perguntas' },
    { label: 'Mensagens', value: 'msgs', description: 'Variáveis: {usuario} {minutos} {painel} {total} {revisor} {motivo}' },
    { label: 'Tempo por pergunta', value: 'time', description: 'Minutos para responder cada pergunta' },
    { label: 'Canal de logs', value: 'logch', description: 'Onde o resultado é registrado' },
    { label: 'Ver prévia do painel', value: 'prev', description: 'Mostra como o painel vai ficar' },
    { label: 'Renomear', value: 'rename', description: 'Muda o nome interno do painel' }
  );
  return {
    embeds: [base(`📝 ${trunc(f.name, 60)} (${id})`, lines.join('\n'))],
    components: [
      row(menu),
      row(new ChannelSelectMenuBuilder().setCustomId(`fs:cat:${id}`).setPlaceholder('Categoria onde os chats privados serão criados...').setChannelTypes(ChannelType.GuildCategory)),
      row(new ChannelSelectMenuBuilder().setCustomId(`fs:rev:${id}`).setPlaceholder('Canal de análise (fichas com Aceitar/Recusar)...').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
      row(new RoleSelectMenuBuilder().setCustomId(`fs:roles:${id}`).setPlaceholder('Cargos que podem aceitar/recusar...').setMinValues(0).setMaxValues(10)),
      row(gbtn(`fs:pubsc:${id}`, 'Publicar painel', ButtonStyle.Secondary, '📤'), gbtn(`fs:del:${id}`, 'Excluir', ButtonStyle.Secondary, '🗑️'), gbtn('fs:home', 'Voltar', ButtonStyle.Secondary, '↩️')),
    ],
  };
}

function questionsView(cfg, id) {
  const f = getForm(cfg, id);
  const list = f.questions.length ? f.questions.map((q, n) => `**${n + 1}.** ${trunc(q, 200)}`).join('\n') : '*Nenhuma pergunta cadastrada.*';
  const components = [];
  if (f.questions.length) {
    components.push(row(new StringSelectMenuBuilder().setCustomId(`fs:qrem:${id}`).setPlaceholder('Remover uma pergunta...')
      .addOptions(f.questions.slice(0, 25).map((q, n) => ({ label: trunc(`${n + 1}. ${q}`, 100), value: String(n) })))));
  }
  components.push(row(gbtn(`fs:qadd:${id}`, 'Adicionar pergunta', ButtonStyle.Secondary, '➕').setDisabled(f.questions.length >= MAX_QUESTIONS), gbtn(`fs:open:${id}`, 'Voltar', ButtonStyle.Secondary, '↩️')));
  return { embeds: [base('❓ Perguntas', list).setFooter({ text: `${f.questions.length}/${MAX_QUESTIONS} perguntas • sem limite de 5 do modal: o bot pergunta no chat` })], components };
}

const channelPickView = (title, desc, customId, id, types, extraBtn) => ({
  embeds: [base(title, desc)],
  components: [
    row(new ChannelSelectMenuBuilder().setCustomId(customId).setPlaceholder('Escolha o canal...').setChannelTypes(...types)),
    row(...[extraBtn, gbtn(`fs:open:${id}`, 'Voltar', ButtonStyle.Secondary, '↩️')].filter(Boolean)),
  ],
});

function inp(id, label, value, { required = false, long = false, ph = '', max = 100 } = {}) {
  const t = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(long ? TextInputStyle.Paragraph : TextInputStyle.Short).setRequired(required).setMaxLength(max);
  if (ph) t.setPlaceholder(ph);
  if (value) t.setValue(String(value).slice(0, max));
  return row(t);
}

// ============================================================
// Interações do /formulario e do botão do painel
// ============================================================
async function adminCommand(i) {
  const cfg = await getCfg();
  if (!perms(i.member, cfg).isAdmin) return i.reply({ content: '❌ Só administradores podem usar este comando.', ephemeral: true });
  return i.reply({ ...homeView(cfg), ephemeral: true });
}

async function handleForm(i) {
  const [, action, id, arg] = i.customId.split(':');
  // ---- fluxo público (não precisa ser admin) ----
  if (action === 'start') return startForm(i, id);
  if (action === 'cancel') return cancelByUser(i, id);
  if (action === 'ok' || action === 'no') return reviewClick(i, id, action);
  if (action === 'nom') return reviewRefuse(i, id);

  // ---- configuração (só admin) ----
  let cfg = await getCfg();
  if (!perms(i.member, cfg).isAdmin) return i.reply({ content: '❌ Só administradores podem configurar.', ephemeral: true });
  const deny = (content) => i.reply({ content, ephemeral: true });
  const show = (view, extra = {}) => {
    const payload = { content: '', ...view, ...extra };
    return i.deferred || i.replied ? i.editReply(payload) : i.update(payload);
  };
  if (action === 'home') return show(homeView(cfg));
  if (action === 'new') {
    return i.showModal(new ModalBuilder().setCustomId('fs:newm').setTitle('Criar painel de formulário')
      .addComponents(inp('name', 'Nome do painel', '', { required: true, ph: 'Ex: Suporte, Acolhimento', max: 40 })));
  }
  if (action === 'newm') {
    const name = i.fields.getTextInputValue('name').trim();
    if (!name) return deny('❌ Informe o nome.');
    if (Object.keys(cfg.forms || {}).length >= MAX_FORMS) return deny(`❌ Limite de ${MAX_FORMS} painéis atingido.`);
    const nid = newId();
    await setCfg(`forms.${nid}`, formDefaults(name));
    cfg = await getCfg();
    return show(presetView(cfg, nid), { content: '✅ Painel criado. Defina a categoria, o canal de análise, ajuste as perguntas e publique.' });
  }
  if (action === 'pick') return show(presetView(cfg, i.values[0]));

  if (!cfg.forms?.[id]) return show(homeView(cfg), { content: '⚠️ Esse painel não existe mais.' });
  const f = () => getForm(cfg, id);
  const save = async (path, value) => { await setCfg(`forms.${id}.${path}`, value); cfg = await getCfg(); };

  switch (action) {
    case 'open': return show(presetView(cfg, id));
    case 'menu': {
      const v = i.values[0];
      if (v === 'app') {
        const p = f();
        return i.showModal(new ModalBuilder().setCustomId(`fs:mapp:${id}`).setTitle('Aparência do painel').addComponents(
          inp('title', 'Título (vazio = sem título)', p.title, { max: 256 }),
          inp('desc', 'Texto do painel', p.desc, { long: true, required: true, max: 3500 }),
          inp('color', 'Cor HEX (ex: #8B2BE2)', p.color, { required: true, max: 7 }),
          inp('banner', 'URL do banner (vazio remove)', p.banner, { max: 500 }),
          inp('button', 'Texto do botão', p.buttonLabel, { required: true, max: 80 })
        ));
      }
      if (v === 'msgs') {
        const m = f().messages;
        return i.showModal(new ModalBuilder().setCustomId(`fs:mmsg:${id}`).setTitle('Mensagens do formulário').addComponents(
          inp('intro', 'Ao abrir o chat privado', m.intro, { long: true, required: true, max: 1000 }),
          inp('done', 'Ao enviar o formulário', m.done, { long: true, required: true, max: 1000 }),
          inp('accepted', 'DM: ficha aprovada', m.accepted, { long: true, required: true, max: 1000 }),
          inp('refused', 'DM: ficha recusada', m.refused, { long: true, required: true, max: 1000 }),
          inp('timeout', 'Quando o tempo acaba', m.timeout, { long: true, required: true, max: 1000 })
        ));
      }
      if (v === 'time') {
        return i.showModal(new ModalBuilder().setCustomId(`fs:mtime:${id}`).setTitle('Tempo por pergunta')
          .addComponents(inp('min', 'Minutos por pergunta (1 a 60)', f().minutesPerQuestion, { required: true, max: 2 })));
      }
      if (v === 'rename') {
        return i.showModal(new ModalBuilder().setCustomId(`fs:mname:${id}`).setTitle('Renomear painel')
          .addComponents(inp('name', 'Nome do painel', f().name, { required: true, max: 40 })));
      }
      if (v === 'qs') return show(questionsView(cfg, id));
      if (v === 'logch') {
        return show(channelPickView('🧾 Canal de logs', `Atual: ${chan(f().logChannelId)}\nO resultado de cada ficha (aprovada/recusada/expirada) é registrado aqui.`, `fs:logch:${id}`, id,
          [ChannelType.GuildText, ChannelType.GuildAnnouncement], gbtn(`fs:logclear:${id}`, 'Remover canal de logs', ButtonStyle.Secondary, '🧹')));
      }
      if (v === 'prev') {
        return i.reply({ ...buildPanel(f(), id, true), flags: MessageFlags.Ephemeral });
      }
      return;
    }
    case 'mapp': {
      const color = i.fields.getTextInputValue('color').trim();
      const banner = i.fields.getTextInputValue('banner').trim();
      if (!/^#?[0-9a-f]{6}$/i.test(color)) return deny('❌ Cor inválida. Use o formato #RRGGBB.');
      if (banner && !isUrl(banner)) return deny('❌ O banner precisa ser um link http(s).');
      await save('title', i.fields.getTextInputValue('title').trim());
      await save('desc', i.fields.getTextInputValue('desc'));
      await save('color', color.startsWith('#') ? color : `#${color}`);
      await save('banner', banner);
      await save('buttonLabel', i.fields.getTextInputValue('button').trim());
      return show(presetView(cfg, id), { content: '✅ Aparência salva. Publique de novo para atualizar o painel.' });
    }
    case 'mmsg': {
      for (const k of ['intro', 'done', 'accepted', 'refused', 'timeout']) await save(`messages.${k}`, i.fields.getTextInputValue(k));
      return show(presetView(cfg, id), { content: '✅ Mensagens salvas.' });
    }
    case 'mtime': {
      const n = Number(i.fields.getTextInputValue('min').trim());
      if (!Number.isInteger(n) || n < 1 || n > 60) return deny('❌ Informe um número inteiro de 1 a 60.');
      await save('minutesPerQuestion', n);
      return show(presetView(cfg, id), { content: `✅ Agora são ${n} min por pergunta (vale para quem começar a partir de agora).` });
    }
    case 'mname': {
      await save('name', i.fields.getTextInputValue('name').trim());
      return show(presetView(cfg, id));
    }
    case 'cat': await save('categoryId', i.values[0]); return show(presetView(cfg, id));
    case 'rev': await save('reviewChannelId', i.values[0]); return show(presetView(cfg, id));
    case 'roles': await save('reviewerRoleIds', i.values); return show(presetView(cfg, id));
    case 'logch': await save('logChannelId', i.values[0]); return show(presetView(cfg, id));
    case 'logclear': await save('logChannelId', null); return show(presetView(cfg, id));
    case 'qadd':
      return i.showModal(new ModalBuilder().setCustomId(`fs:qm:${id}`).setTitle('Nova pergunta')
        .addComponents(inp('q', 'Pergunta', '', { required: true, long: true, max: 300, ph: 'Ex: Qual o ID do usuário envolvido?' })));
    case 'qm': {
      const qs = clone(f().questions);
      if (qs.length >= MAX_QUESTIONS) return deny(`❌ Limite de ${MAX_QUESTIONS} perguntas.`);
      qs.push(i.fields.getTextInputValue('q').trim());
      await save('questions', qs);
      return show(questionsView(cfg, id));
    }
    case 'qrem': {
      const qs = clone(f().questions);
      qs.splice(Number(i.values[0]), 1);
      await save('questions', qs);
      return show(questionsView(cfg, id));
    }
    case 'pubsc':
      return show(channelPickView('📤 Publicar painel', 'Escolha o canal onde o painel será publicado (se já existir um nele, é atualizado no lugar).', `fs:pubch:${id}`, id, [ChannelType.GuildText, ChannelType.GuildAnnouncement]));
    case 'pubch': {
      const channel = await i.guild.channels.fetch(i.values[0]).catch(() => null);
      try {
        const msg = await publishPanel(f(), id, channel);
        await save('panelChannelId', channel.id);
        await save('panelMessageId', msg.id);
      } catch (e) {
        console.error('[formulario:publish]', e.message);
        return deny('❌ Não consegui publicar nesse canal. Verifique as permissões do bot.');
      }
      return show(presetView(cfg, id), { content: `✅ Painel publicado em ${channel}.` });
    }
    case 'del':
      return show({
        embeds: [base('🗑️ Excluir painel', `Excluir **${trunc(f().name, 60)}**? O painel publicado será apagado. Formulários em andamento continuam até acabar.`).setColor(COLORS.bad)],
        components: [row(gbtn(`fs:delok:${id}`, 'Sim, excluir', ButtonStyle.Secondary, '🗑️'), gbtn(`fs:open:${id}`, 'Cancelar', ButtonStyle.Secondary, '↩️'))],
      });
    case 'delok': {
      const { panelChannelId, panelMessageId, name } = f();
      if (panelChannelId && panelMessageId) {
        const ch = await i.guild.channels.fetch(panelChannelId).catch(() => null);
        const msg = await ch?.messages?.fetch(panelMessageId).catch(() => null);
        await msg?.delete().catch(() => {});
      }
      await delCfg(`forms.${id}`);
      cfg = await getCfg();
      return show(homeView(cfg), { content: `✅ Painel **${trunc(name, 60)}** excluído.` });
    }
  }
}

// ============================================================
// Fluxo da pessoa: chat privado + perguntas com tempo
// ============================================================
const running = new Set(); // sessões com laço ativo
const collectors = new Map(); // sessionId → collector atual (para cancelar na hora)

async function startForm(i, id) {
  const cfg = await getCfg();
  const f = getForm(cfg, id);
  if (!f) return i.reply({ content: '❌ Este painel não está mais disponível.', ephemeral: true });
  if (!f.categoryId || !f.reviewChannelId || !f.questions.length) {
    return i.reply({ content: '⚠️ Este formulário ainda não foi configurado pela equipe. Avise a administração.', ephemeral: true });
  }
  await i.deferReply({ ephemeral: true });

  // já tem um em andamento?
  const open = await FormSession.findOne({ userId: i.user.id, presetId: id, status: 'answering' });
  if (open) {
    const ch = await i.guild.channels.fetch(open.channelId).catch(() => null);
    if (ch) return i.editReply(`⚠️ Você já tem um formulário em andamento: ${ch}`);
    open.status = 'cancelled';
    await open.save();
  }

  const category = await i.guild.channels.fetch(f.categoryId).catch(() => null);
  if (!category) return i.editReply('❌ A categoria dos formulários não existe mais. Avise a administração.');

  let channel;
  try {
    channel = await i.guild.channels.create({
      name: `formulario-${slug(i.user.username)}`,
      type: ChannelType.GuildText,
      parent: category.id,
      topic: `Formulário privado de ${i.user.tag} (${i.user.id})`,
      permissionOverwrites: [
        { id: i.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: i.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.AttachFiles] },
        {
          id: i.client.user.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AddReactions],
        },
      ],
    });
  } catch (e) {
    console.error('[formulario:criar-canal]', e.message);
    return i.editReply('❌ Não consegui criar o chat privado. Avise a administração (o bot precisa de **Gerenciar Canais** na categoria).');
  }

  let s;
  try {
    s = await FormSession.create({
      presetId: id, presetName: f.name, guildId: i.guildId, userId: i.user.id, userTag: i.user.tag,
      channelId: channel.id, questions: f.questions, minutes: f.minutesPerQuestion,
    });
  } catch (e) {
    await channel.delete().catch(() => {});
    return i.editReply('⚠️ Você já tem um formulário em andamento.');
  }

  await channel.send({
    content: `<@${i.user.id}>`,
    embeds: [new EmbedBuilder().setColor(parseColor(f.color)).setTitle(trunc(f.name, 200)).setDescription(render(f.messages.intro, vars(s)))],
    components: [row(gbtn(`fs:cancel:${s.id}`, 'Cancelar formulário', ButtonStyle.Secondary, '✖️'))],
    allowedMentions: { users: [i.user.id] },
  });
  await i.editReply(`✅ Seu formulário foi aberto em ${channel} — só você enxerga esse chat.`);
  runSession(i.client, s.id).catch((e) => console.error('[formulario:sessao]', e));
}

// Aguarda UMA mensagem da pessoa (ou o fim do prazo). Devolve a mensagem, null (tempo acabou) ou 'stop' (cancelado).
function waitAnswer(channel, userId, ms, sid) {
  return new Promise((resolve) => {
    const c = channel.createMessageCollector({ filter: (m) => m.author.id === userId && !m.system, max: 1, time: ms });
    collectors.set(sid, c);
    c.on('end', (col, reason) => {
      collectors.delete(sid);
      if (reason !== 'limit' && reason !== 'time') return resolve('stop'); // cancelado ou chat apagado
      resolve(col.first() ?? null);
    });
  });
}

async function runSession(client, sid) {
  if (running.has(sid)) return;
  running.add(sid);
  try {
    for (;;) {
      const s = await FormSession.findById(sid);
      if (!s || s.status !== 'answering') return;
      const cfg = await getCfg();
      const f = getForm(cfg, s.presetId) || withDefaults({ name: s.presetName });
      const channel = await client.channels.fetch(s.channelId).catch(() => null);
      if (!channel) { s.status = 'cancelled'; await s.save(); return; }

      const idx = s.answers.length;
      if (idx >= s.questions.length) return finishSession(client, s, channel, f);

      // envia a pergunta (se for retomada depois de reiniciar, não repete)
      if (s.askedIndex !== idx) {
        s.askedIndex = idx;
        s.deadlineAt = new Date(Date.now() + s.minutes * 60_000);
        await s.save();
        const end = Math.floor(s.deadlineAt.getTime() / 1000);
        await channel.send({
          embeds: [new EmbedBuilder().setColor(parseColor(f.color))
            .setTitle(`Pergunta ${idx + 1}/${s.questions.length}`)
            .setDescription(`${s.questions[idx]}\n\n⏳ Você tem até <t:${end}:t> (<t:${end}:R>) para responder, em uma única mensagem.`)],
        }).catch(() => {});
      }

      const left = s.deadlineAt.getTime() - Date.now();
      const m = left > 0 ? await waitAnswer(channel, s.userId, left, sid) : null;
      if (m === 'stop') return;
      if (!m) return expireSession(client, sid, channel, f);

      const text = [m.content, ...[...m.attachments.values()].map((a) => a.url)].filter(Boolean).join('\n').trim();
      await FormSession.updateOne({ _id: sid, status: 'answering' }, { $push: { answers: text || '[mensagem sem texto]' }, $set: { deadlineAt: null } });
      m.react('✅').catch(() => {});
    }
  } finally {
    running.delete(sid);
  }
}

const deleteLater = (channel, ms) => sleep(ms).then(() => channel?.delete().catch(() => {}));

async function expireSession(client, sid, channel, f) {
  const s = await FormSession.findOneAndUpdate({ _id: sid, status: 'answering' }, { status: 'expired', finishedAt: new Date() }, { new: true });
  if (!s) return;
  await channel.send({ content: render(f.messages.timeout, vars(s)), allowedMentions: { users: [s.userId] } }).catch(() => {});
  sendLog(client, f, s, COLORS.warn, `Formulário **expirou** (a pessoa não respondeu em ${s.minutes} min).`);
  await deleteLater(channel, 15_000);
}

async function cancelByUser(i, sid) {
  const s = await FormSession.findById(sid);
  if (!s || s.status !== 'answering') return i.reply({ content: 'Este formulário já foi encerrado.', ephemeral: true });
  if (i.user.id !== s.userId) return i.reply({ content: '❌ Só quem abriu pode cancelar.', ephemeral: true });
  s.status = 'cancelled';
  s.finishedAt = new Date();
  await s.save();
  collectors.get(sid)?.stop('cancel');
  await i.reply({ content: '✖️ Formulário cancelado. Este chat será apagado em instantes.' });
  const cfg = await getCfg();
  sendLog(i.client, getForm(cfg, s.presetId), s, COLORS.neutral, 'Formulário **cancelado** pela própria pessoa.');
  await deleteLater(i.channel, 8_000);
}

async function finishSession(client, s, channel, f) {
  s.status = 'pending';
  s.finishedAt = new Date();
  const reviewCh = f.reviewChannelId ? await client.channels.fetch(f.reviewChannelId).catch(() => null) : null;
  if (!reviewCh) {
    s.status = 'answering'; // não perde as respostas: avisa e deixa a equipe corrigir
    await s.save();
    await channel.send('⚠️ Não consegui enviar para a equipe (canal de análise inválido). Avise a administração; suas respostas estão salvas.').catch(() => {});
    return;
  }
  const msg = await reviewCh.send({
    embeds: [reviewEmbed(s, 'pending', f)],
    components: [reviewButtons(s.id)],
    allowedMentions: { parse: [] },
  });
  s.reviewChannelId = reviewCh.id;
  s.reviewMessageId = msg.id;
  await s.save();
  await channel.send({ content: render(f.messages.done, vars(s)), allowedMentions: { users: [s.userId] } }).catch(() => {});
  await deleteLater(channel, 15_000);
}

// ============================================================
// Análise: Aceitar / Recusar
// ============================================================
const reviewButtons = (sid, disabled = false) =>
  row(
    gbtn(`fs:ok:${sid}`, 'Aceitar', ButtonStyle.Success, '✅').setDisabled(disabled),
    gbtn(`fs:no:${sid}`, 'Recusar', ButtonStyle.Danger, '❌').setDisabled(disabled)
  );

function reviewEmbed(s, status, f, extra = {}) {
  const color = status === 'approved' ? COLORS.ok : status === 'refused' ? COLORS.bad : parseColor(f?.color);
  const per = Math.max(120, Math.min(900, Math.floor(4800 / Math.max(1, s.questions.length)) - 40));
  const e = new EmbedBuilder()
    .setColor(color)
    .setTitle(`📝 ${trunc(s.presetName, 200)}`)
    .setDescription(`**Enviado por:** <@${s.userId}> (\`${s.userId}\`)\n**Status:** ${status === 'approved' ? '✅ Aprovada' : status === 'refused' ? '❌ Recusada' : '🕐 Aguardando análise'}`)
    .addFields(s.questions.map((q, n) => ({ name: trunc(`${n + 1}. ${q}`, 256), value: fmtAnswer(s.answers[n], Math.min(per, 1024)) })))
    .setTimestamp(s.finishedAt || new Date());
  if (extra.by) e.addFields({ name: status === 'approved' ? 'Aprovada por' : 'Recusada por', value: `<@${extra.by}>`, inline: true });
  if (extra.note) e.addFields({ name: 'Motivo', value: trunc(extra.note, 1000), inline: true });
  return e;
}

async function canReview(i, s) {
  const cfg = await getCfg();
  const f = getForm(cfg, s.presetId);
  const ids = f?.reviewerRoleIds || [];
  const p = perms(i.member, cfg);
  return { f, ok: p.isAdmin || (ids.length ? ids.some((r) => i.member.roles.cache.has(r)) : p.isLeader) };
}

async function reviewClick(i, sid, action) {
  const s = await FormSession.findById(sid);
  if (!s) return i.reply({ content: '❌ Ficha não encontrada.', ephemeral: true });
  if (s.status !== 'pending') return i.reply({ content: 'Esta ficha já foi analisada.', ephemeral: true });
  const { ok } = await canReview(i, s);
  if (!ok) return i.reply({ content: '❌ Você não tem permissão para analisar esta ficha.', ephemeral: true });
  if (action === 'no') {
    return i.showModal(new ModalBuilder().setCustomId(`fs:nom:${sid}`).setTitle('Recusar ficha')
      .addComponents(inp('reason', 'Motivo (opcional, vai para a pessoa)', '', { long: true, max: 500 })));
  }
  await i.deferUpdate();
  return conclude(i, sid, 'approved', '');
}

async function reviewRefuse(i, sid) {
  const s = await FormSession.findById(sid);
  if (!s || s.status !== 'pending') return i.reply({ content: 'Esta ficha já foi analisada.', ephemeral: true });
  const { ok } = await canReview(i, s);
  if (!ok) return i.reply({ content: '❌ Você não tem permissão para analisar esta ficha.', ephemeral: true });
  await i.deferUpdate();
  return conclude(i, sid, 'refused', i.fields.getTextInputValue('reason').trim());
}

async function conclude(i, sid, status, note) {
  // só o primeiro clique vence (evita aceitar e recusar ao mesmo tempo)
  const s = await FormSession.findOneAndUpdate(
    { _id: sid, status: 'pending' },
    { status, reviewedBy: i.user.id, reviewedAt: new Date(), reviewNote: note || undefined },
    { new: true }
  );
  if (!s) return i.followUp({ content: 'Esta ficha já foi analisada por outra pessoa.', ephemeral: true });
  const cfg = await getCfg();
  const f = getForm(cfg, s.presetId) || withDefaults({ name: s.presetName });
  await i.editReply({ embeds: [reviewEmbed(s, status, f, { by: i.user.id, note })], components: [reviewButtons(s.id, true)] }).catch(() => {});

  const ok = status === 'approved';
  sendLog(i.client, f, s, ok ? COLORS.ok : COLORS.bad, `Ficha **${ok ? 'aprovada' : 'reprovada'}** por <@${i.user.id}>.\nAs informações foram registradas no canal de logs.`, true);

  // aviso por DM para a pessoa
  const user = await i.client.users.fetch(s.userId).catch(() => null);
  const text = render(ok ? f.messages.accepted : f.messages.refused, vars(s, { revisor: `<@${i.user.id}>`, motivo: note || 'Não informado.' }));
  const sent = await user?.send({ content: text }).then(() => true).catch(() => false);
  if (!sent) i.followUp({ content: '⚠️ Não consegui avisar a pessoa por DM (privado fechado).', ephemeral: true }).catch(() => {});
}

// Log no estilo "Ficha aprovada por @fulano" (canal de logs do painel)
async function sendLog(client, f, s, color, text, withUser = false) {
  if (!f?.logChannelId) return;
  try {
    const ch = await client.channels.fetch(f.logChannelId);
    const e = new EmbedBuilder().setColor(color).setDescription(`${withUser ? `**${trunc(s.userTag || s.userId, 80)}** (${s.userId})\n` : `<@${s.userId}> (\`${s.userId}\`)\n`}${text}`).setFooter({ text: f.name }).setTimestamp();
    await ch.send({ embeds: [e], allowedMentions: { parse: [] } });
  } catch (e) {
    console.error('[formulario:log]', e.message);
  }
}

// ============================================================
// Inicialização
// ============================================================
// Retoma formulários que estavam em andamento quando o bot reiniciou (o prazo continua valendo)
async function resumeAll(client) {
  await FormSession.init().catch((e) => console.error('[formulario:indice]', e.message));
  const list = await FormSession.find({ status: 'answering' });
  for (const s of list) runSession(client, s.id).catch((e) => console.error('[formulario:retomar]', e.message));
  if (list.length) console.log(`📝 ${list.length} formulário(s) em andamento retomado(s).`);
}

// Se alguém apagar o chat privado na mão, a sessão é encerrada
async function onChannelDelete(ch) {
  const s = await FormSession.findOneAndUpdate({ channelId: ch.id, status: 'answering' }, { status: 'cancelled', finishedAt: new Date() }, { new: true });
  if (s) collectors.get(s.id)?.stop('cancel');
}

module.exports = { commands, adminCommand, handleForm, resumeAll, onChannelDelete, FormSession };
