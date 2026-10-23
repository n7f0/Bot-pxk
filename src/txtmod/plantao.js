// ============================================================
// Plantão em call
// ------------------------------------------------------------
//  • Painel, logs e aprovação ficam no servidor INTERNO.
//  • O plantão em si acontece numa call do servidor PRINCIPAL, dentro da
//    categoria definida em /admin → Plantão → Categoria das calls.
//  • Fluxo: Iniciar (botão) → DM → fica na call → se sair, DM + tolerância
//    (padrão 5 min) → se não voltar, cancela → ao completar o tempo (padrão
//    60 min) vai para o log com [Aceitar] / [Recusar] → a liderança decide e
//    só então os pontos entram no ranking.
//  • O estado do plantão é sempre reconciliado com a call real (evento de voz
//    + verificação a cada 15 s), então nada se perde se o bot reiniciar.
// ============================================================
const {
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { getCfg, Shift, Recruitment, Ticket, LogEntry } = require('./db');
const { COLORS, MAIN_ID, INTERNAL_ID, guildKey, perms, row, emit, ts, fmtDuration, addStats, render, trunc } = require('./core');
const { scheduleRankingRefresh } = require('./ranking');
const { E, Eb, lbl } = require('./emojis');

const deny = (content) => ({ content, ephemeral: true });
// O emoji vem de /admin → Emojis e ícones (chave = emojiKey)
const gbtn = (id, label, emojiKey) => {
  const b = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(ButtonStyle.Secondary);
  const em = Eb(emojiKey);
  return em ? b.setEmoji(em) : b;
};

const sec = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 1000));
const pointsFor = (cfg, durationSec) => Math.round(cfg.points.shiftFlat + cfg.points.shiftPerHour * (durationSec / 3600));

// Quem está em plantão ativo (evita consultar o banco a cada evento de voz do servidor)
let activeUsers = new Set();

// ---------- leitura da call (servidor principal) ----------
const liveState = (client, userId) => client.guilds.cache.get(MAIN_ID)?.voiceStates.cache.get(userId) ?? null;
const isMuted = (vs) => !!(vs && (vs.mute || vs.deaf));

// A call vale para o plantão se estiver dentro da categoria configurada
function validCall(vs, cfg) {
  const cat = cfg.shift.categoryId;
  return !!(cat && vs?.channelId && vs.channel?.parentId === cat);
}

// Tempo total na call / mutado, somando o trecho que ainda está aberto
function stats(shift, now = new Date()) {
  const open = shift.presence === 'in';
  return {
    inSec: (shift.inSec || 0) + (open && shift.inSince ? sec(shift.inSince, now) : 0),
    mutedSec: (shift.mutedSec || 0) + (open && shift.muteSince ? sec(shift.muteSince, now) : 0),
  };
}

// Toda DM do bot sai no modelo "embed v3" (container de Components V2, sem barra lateral):
// título, divisória, texto e rodapé com data. Se o Discord recusar o formato, cai no texto simples.
function dmPayload(content, title) {
  const c = new ContainerBuilder(); // sem setAccentColor = sem barra colorida
  if (title) {
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${trunc(title, 200)}`));
    c.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  }
  c.addTextDisplayComponents(new TextDisplayBuilder().setContent(trunc(String(content), 3500)));
  c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${ts(new Date(), 'f')}`));
  return { components: [c], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

async function dm(client, userId, content, title = null) {
  let user;
  try {
    user = await client.users.fetch(userId);
  } catch {
    return false;
  }
  try {
    await user.send(dmPayload(content, title));
    return true;
  } catch (e) {
    if (e.code === 50007) return false; // DMs fechadas
    try {
      await user.send({ content: trunc(`${title ? `**${title}**\n` : ''}${content}`, 2000), allowedMentions: { parse: [] } });
      return true;
    } catch {
      return false;
    }
  }
}

// Variáveis das mensagens de DM configuráveis
function vars(cfg, shift, extra = {}) {
  const s = cfg.shift;
  return {
    usuario: `<@${shift.userId}>`,
    nome: shift.userTag || shift.userId,
    minutos: s.plannedMinutes,
    tolerancia: s.returnMinutes,
    call: shift.voiceName || 'call do plantão',
    tempo: fmtDuration(stats(shift).inSec),
    fim: shift.plannedEnd ? `${ts(shift.plannedEnd, 't')} (${ts(shift.plannedEnd, 'R')})` : '—',
    ...extra,
  };
}

// ---------- painel público do plantão (servidor interno) ----------
function buildShiftPanel(cfg) {
  const s = cfg.shift;
  const lines = [
    'Registre o seu plantão de recrutamento e migração.',
    '',
    '**Como funciona:**',
    '1. Entre em uma **call de plantão** no servidor principal;',
    '2. Clique em **Iniciar Plantão** aqui;',
    `3. Permaneça **${s.plannedMinutes} min** na call. Se sair, você tem **${s.returnMinutes} min** para voltar — senão o plantão é encerrado e enviado para análise com o tempo cumprido;`,
    '4. Ao concluir, a liderança analisa o plantão e, se for aceito, os pontos são seus.',
    '',
    `${E('shiftPlanned')} **Duração:** ${s.plannedMinutes} min`,
    `${E('shiftMin')} **Tolerância ao sair da call:** ${s.returnMinutes} min`,
  ];
  if (s.rules) lines.push('', '**Regras:**', s.rules);
  const embed = new EmbedBuilder()
    .setColor(COLORS.neutral)
    .setTitle(lbl('shiftTitle', 'Plantão de Recrutamento'))
    .setDescription(lines.join('\n'));
  return {
    embeds: [embed],
    components: [row(gbtn('pl:start', 'Iniciar Plantão', 'shiftStart'), gbtn('pl:end', 'Cancelar Plantão', 'shiftEnd'))],
  };
}

async function handleShift(i) {
  const [, action, arg] = i.customId.split(':');
  if (action === 'start') return startShift(i);
  if (action === 'end') return selfCancel(i);
  if (action === 'ok') return approveShift(i, arg);
  if (action === 'no') return askReject(i, arg);
  if (action === 'rsn') return rejectShift(i, arg);
}

// ---------- iniciar ----------
async function startShift(i) {
  if (guildKey(i.guildId) !== 'internal') return i.reply(deny(`${E('bad')} O plantão deve ser iniciado pelo servidor interno de recrutamento.`));
  await i.deferReply({ ephemeral: true });
  const bad = (msg) => i.editReply({ content: msg });

  const cfg = await getCfg();
  const s = cfg.shift;
  if (!s.enabled) return bad(`${E('off')} O sistema de plantão está desativado.`);
  if (!perms(i.member, cfg).isShift) return bad(`${E('bad')} Você não tem permissão para iniciar plantão.`);
  if (s.allowedChannelIds.length && !s.allowedChannelIds.includes(i.channelId)) {
    return bad(`${E('bad')} O plantão só pode ser iniciado em: ${s.allowedChannelIds.map((c) => `<#${c}>`).join(', ')}`);
  }
  if (!s.categoryId) return bad(`${E('warn')} A categoria das calls de plantão ainda não foi configurada. Avise a liderança.`);

  const main = i.client.guilds.cache.get(MAIN_ID);
  if (!main) return bad(`${E('bad')} Não consegui acessar o servidor principal agora. Tente novamente em instantes.`);
  const vs = main.voiceStates.cache.get(i.user.id);
  if (!vs?.channel) return bad(`${E('voice')} Entre em uma call de plantão no **servidor principal** e clique de novo.`);
  if (!validCall(vs, cfg)) {
    const catName = main.channels.cache.get(s.categoryId)?.name;
    return bad(`${E('bad')} A call **${vs.channel.name}** não vale para plantão. Entre em uma call da categoria **${catName || s.categoryId}**.`);
  }

  if (await Shift.exists({ userId: i.user.id, status: 'active' })) return bad(`${E('warn')} Você já tem um plantão em andamento.`);

  const startedAt = new Date();
  let shift;
  try {
    shift = await Shift.create({
      guildId: i.guildId,
      userId: i.user.id,
      userTag: i.user.username,
      startedAt,
      plannedEnd: new Date(startedAt.getTime() + s.plannedMinutes * 60000),
      voiceChannelId: vs.channelId,
      voiceName: vs.channel.name,
      presence: 'in',
      inSince: startedAt,
      muteSince: isMuted(vs) ? startedAt : null,
    });
  } catch (e) {
    if (e.code === 11000) return bad(`${E('warn')} Você já tem um plantão em andamento.`);
    throw e;
  }
  activeUsers.add(i.user.id);

  const sent = await dm(i.client, i.user.id, render(s.messages.start, vars(cfg, shift)), 'Plantão iniciado');
  if (!sent) await Shift.updateOne({ _id: shift._id }, { $set: { dmFailed: true } });

  const embed = new EmbedBuilder()
    .setColor(COLORS.ok)
    .setTitle(lbl('shiftLog', 'Plantão Iniciado'))
    .setDescription(
      [
        `**Recrutador:** ${i.user} (\`${i.user.id}\`)`,
        `${E('voice')} **Call (principal):** ${vs.channel.name}`,
        `${E('shiftStart')} **Início:** ${ts(shift.startedAt)}`,
        `${E('shiftEta')} **Término previsto:** ${ts(shift.plannedEnd)} ${ts(shift.plannedEnd, 'R')}`,
        sent ? null : `${E('warn')} Não consegui enviar a DM (privado fechado).`,
        `ID da sessão: \`${shift._id}\``,
      ].filter(Boolean).join('\n')
    )
    .setTimestamp();
  await emit(i.client, cfg, { category: 'plantao', action: 'Plantão iniciado', embed, userId: i.user.id, data: { shiftId: shift._id } });

  return bad(
    `${E('ok')} Plantão iniciado na call **${vs.channel.name}**! Fique **${s.plannedMinutes} min** na call.` +
      (sent ? '' : `\n${E('warn')} Não consegui te chamar no privado — abra suas mensagens diretas do servidor para receber os avisos.`)
  );
}

// ---------- cancelar (pelo próprio recrutador, pelo líder ou automaticamente) ----------
async function selfCancel(i) {
  if (guildKey(i.guildId) !== 'internal') return i.reply(deny(`${E('bad')} Use este botão no servidor interno de recrutamento.`));
  const shift = await Shift.findOne({ userId: i.user.id, status: 'active' }).select('_id').lean();
  if (!shift) return i.reply(deny(`${E('warn')} Você não tem nenhum plantão em andamento.`));
  await i.deferReply({ ephemeral: true });
  const ok = await cancelShift(i.client, shift._id, { reason: 'Cancelado por você mesmo.', byId: i.user.id });
  return i.editReply(ok ? `${E('ok')} Plantão cancelado.` : `${E('warn')} Este plantão já foi encerrado.`);
}

// O "lock" é a troca atômica de status: impede cancelar/concluir duas vezes.
async function cancelShift(client, shiftId, { reason = 'Plantão cancelado.', byId = null } = {}) {
  const now = new Date();
  const shift = await Shift.findOneAndUpdate(
    { _id: shiftId, status: 'active' },
    { $set: { status: 'cancelled', endedAt: now, cancelReason: reason, finalizedBy: byId || 'auto' } },
    { new: true }
  );
  if (!shift) return null;
  activeUsers.delete(shift.userId);

  const cfg = await getCfg();
  const st = stats(shift, now);
  const [recruitments, attendances] = await Promise.all([
    Recruitment.countDocuments({ shiftId: shift._id }),
    Ticket.countDocuments({ claimedBy: shift.userId, claimedAt: { $gte: shift.startedAt, $lte: now } }),
  ]);
  await Shift.updateOne(
    { _id: shift._id },
    { $set: { durationSec: st.inSec, inSec: st.inSec, mutedSec: st.mutedSec, inSince: null, muteSince: null, recruitments, attendances, points: 0, counted: false } }
  );

  await dm(client, shift.userId, render(cfg.shift.messages.cancel, vars(cfg, shift, { motivo: reason })), 'Plantão cancelado');

  const embed = new EmbedBuilder()
    .setColor(COLORS.bad)
    .setTitle('PLANTÃO CANCELADO')
    .addFields(
      { name: 'Recrutador', value: `<@${shift.userId}>`, inline: true },
      { name: 'ID', value: `\`${shift.userId}\``, inline: true },
      { name: 'Call', value: shift.voiceName || '—', inline: true },
      { name: 'Tempo na call', value: fmtDuration(st.inSec), inline: true },
      { name: 'Tempo mutado', value: fmtDuration(st.mutedSec), inline: true },
      { name: 'Tickets atendidos', value: String(attendances), inline: true },
      { name: 'Motivo', value: trunc(reason, 1000), inline: false }
    )
    .setFooter({ text: `ID da sessão: ${shift._id}` })
    .setTimestamp();
  await emit(client, cfg, { category: 'plantao', action: 'Plantão cancelado', embed, userId: shift.userId, data: { shiftId: shift._id, reason } });
  return { reason };
}

// ---------- concluir (tempo cumprido) → vai para análise da liderança ----------
async function completeShift(client, cfg, shift, now, st, endReason = null) {
  const durationSec = st.inSec;
  const [recruitments, attendances] = await Promise.all([
    Recruitment.countDocuments({ shiftId: shift._id }),
    Ticket.countDocuments({ claimedBy: shift.userId, claimedAt: { $gte: shift.startedAt, $lte: now } }),
  ]);
  const done = await Shift.findOneAndUpdate(
    { _id: shift._id, status: 'active' },
    {
      $set: {
        status: 'pending', endedAt: now, presence: 'in', inSince: null, muteSince: null,
        inSec: st.inSec, mutedSec: st.mutedSec, durationSec, recruitments, attendances,
        points: pointsFor(cfg, durationSec), counted: false, endReason: endReason || undefined,
      },
    },
    { new: true }
  );
  if (!done) return;
  activeUsers.delete(done.userId);

  const tpl = endReason ? cfg.shift.messages.incomplete : cfg.shift.messages.done;
  await dm(client, done.userId, render(tpl, vars(cfg, done)), endReason ? 'Plantão incompleto' : 'Plantão concluído');
  await sendReview(client, cfg, done);
}

// ---------- log para análise (botões Aceitar / Recusar) ----------
function reviewEmbed(shift, plannedMin) {
  const state = shift.status; // pending | approved | rejected
  const color = state === 'approved' ? COLORS.ok : state === 'rejected' ? COLORS.bad : COLORS.warn;
  const title = state === 'approved' ? 'PLANTÃO ACEITO' : state === 'rejected' ? 'PLANTÃO RECUSADO' : 'PLANTÃO PARA ANÁLISE';
  const dur = shift.durationSec || 0;
  const plannedLabel = plannedMin ? `${plannedMin} min` : 'duração prevista';
  const mutedPct = dur ? ` (${Math.round(((shift.mutedSec || 0) / dur) * 100)}%)` : '';
  const pts = state === 'approved' ? `${shift.points} pts` : state === 'rejected' ? '0 pts (recusado)' : `${shift.points} pts (se aceito)`;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(lbl('shiftLog', title))
    .addFields(
      { name: 'Recrutador', value: `<@${shift.userId}>`, inline: true },
      { name: 'ID', value: `\`${shift.userId}\``, inline: true },
      { name: `${E('voice')} Call`, value: shift.voiceName || '—', inline: true },
      { name: `${E('shiftPlanned')} Tempo na call`, value: fmtDuration(dur), inline: true },
      { name: `${E('shiftMuted')} Tempo mutado`, value: `${fmtDuration(shift.mutedSec || 0)}${mutedPct}`, inline: true },
      { name: `${E('shiftTickets')} Tickets atendidos`, value: String(shift.attendances || 0), inline: true },
      { name: 'Recrutamentos concluídos', value: String(shift.recruitments || 0), inline: true },
      { name: 'Saídas da call', value: String(shift.awayCount || 0), inline: true },
      { name: `${E('trophy')} Pontos`, value: pts, inline: true },
      { name: 'Início', value: ts(shift.startedAt), inline: true },
      { name: 'Término', value: ts(shift.endedAt || new Date()), inline: true },
      { name: 'Data', value: ts(shift.endedAt || new Date(), 'D'), inline: true }
    )
    .setTimestamp();
  if (shift.endReason) embed.addFields({ name: `${E('warn')} Atenção`, value: `**Plantão incompleto** (${fmtDuration(dur)} de ${plannedLabel}): ${trunc(shift.endReason, 900)}`, inline: false });

  if (state === 'approved') embed.setFooter({ text: `Aceito por ${shift.reviewedBy} • ID da sessão: ${shift._id}` });
  else if (state === 'rejected') embed.setFooter({ text: `Recusado por ${shift.reviewedBy}${shift.reviewNote ? ` — ${trunc(shift.reviewNote, 120)}` : ''} • ID da sessão: ${shift._id}` });
  else embed.setFooter({ text: `Aguardando análise da liderança • ID da sessão: ${shift._id}` });
  if (state !== 'pending') {
    embed.addFields({ name: 'Analisado por', value: `<@${shift.reviewedBy}> ${ts(shift.reviewedAt, 'R')}`, inline: false });
    if (shift.reviewNote) embed.addFields({ name: 'Motivo', value: trunc(shift.reviewNote, 1000), inline: false });
  }
  return embed;
}

const reviewButtons = (id) => [row(gbtn(`pl:ok:${id}`, 'Aceitar', 'ok'), gbtn(`pl:no:${id}`, 'Recusar', 'bad'))];

async function sendReview(client, cfg, shift) {
  const targets = cfg.logs.internal || {};
  const channelId = targets.plantao || targets.geral;
  if (!channelId) {
    console.warn('[plantão] sem canal de logs de plantão configurado no servidor interno — o plantão ficará pendente até configurar.');
    return;
  }
  try {
    const ch = await client.channels.fetch(channelId);
    if (!ch || ch.guildId !== INTERNAL_ID) {
      console.warn(`[plantão] canal ${channelId} não pertence ao servidor interno.`);
      return;
    }
    const msg = await ch.send({ embeds: [reviewEmbed(shift, cfg.shift.plannedMinutes)], components: reviewButtons(shift._id), allowedMentions: { parse: [] } });
    await Shift.updateOne({ _id: shift._id }, { $set: { reviewChannelId: ch.id, reviewMessageId: msg.id } });
    LogEntry.create({ category: 'plantao', action: 'Plantão enviado para análise', userId: shift.userId, data: { shiftId: shift._id, durationSec: shift.durationSec } }).catch(() => {});
  } catch (e) {
    console.error('[plantão:review]', e.message);
  }
}

// ---------- análise da liderança ----------
async function reviewGuard(i) {
  if (guildKey(i.guildId) !== 'internal') {
    await i.reply(deny(`${E('bad')} A análise de plantão é feita no servidor interno.`));
    return null;
  }
  const cfg = await getCfg();
  if (!perms(i.member, cfg).isLeader) {
    await i.reply(deny(`${E('bad')} Apenas a liderança pode aceitar ou recusar plantões.`));
    return null;
  }
  return cfg;
}

async function approveShift(i, id) {
  const cfg = await reviewGuard(i);
  if (!cfg) return;
  await i.deferUpdate();
  const shift = await Shift.findOneAndUpdate(
    { _id: id, status: 'pending' },
    { $set: { status: 'approved', counted: true, reviewedBy: i.user.id, reviewedAt: new Date() } },
    { new: true }
  );
  if (!shift) return i.followUp(deny(`${E('warn')} Este plantão já foi analisado.`));

  await addStats(shift.userId, shift.userTag, { points: shift.points, shifts: 1, shiftSeconds: shift.durationSec });
  scheduleRankingRefresh(i.client);
  LogEntry.create({ category: 'plantao', action: 'Plantão aceito', userId: shift.userId, data: { shiftId: shift._id, by: i.user.id, points: shift.points } }).catch(() => {});

  await i.editReply({ embeds: [reviewEmbed(shift, cfg.shift.plannedMinutes)], components: [] });
  await dm(i.client, shift.userId, `${E('ok')} Seu plantão foi **aceito** por **${i.user.username}**! Você recebeu **${shift.points}** ponto(s).`, 'Plantão aceito');
}

async function askReject(i, id) {
  const cfg = await reviewGuard(i);
  if (!cfg) return;
  const modal = new ModalBuilder().setCustomId(`pl:rsn:${id}`).setTitle('Recusar plantão').addComponents(
    row(
      new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Motivo (opcional)')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(500)
        .setPlaceholder('Ex: ficou mutado a maior parte do tempo')
    )
  );
  return i.showModal(modal);
}

async function rejectShift(i, id) {
  const cfg = await reviewGuard(i);
  if (!cfg) return;
  await i.deferUpdate();
  const note = i.fields.getTextInputValue('reason').trim();
  const shift = await Shift.findOneAndUpdate(
    { _id: id, status: 'pending' },
    { $set: { status: 'rejected', counted: false, points: 0, reviewedBy: i.user.id, reviewedAt: new Date(), reviewNote: note || undefined } },
    { new: true }
  );
  if (!shift) return i.followUp(deny(`${E('warn')} Este plantão já foi analisado.`));

  LogEntry.create({ category: 'plantao', action: 'Plantão recusado', userId: shift.userId, data: { shiftId: shift._id, by: i.user.id, note } }).catch(() => {});
  await i.editReply({ embeds: [reviewEmbed(shift, cfg.shift.plannedMinutes)], components: [] });
  await dm(i.client, shift.userId, `${E('bad')} Seu plantão foi **recusado** por **${i.user.username}**.${note ? `\n**Motivo:** ${note}` : ''}`, 'Plantão recusado');
}

// ---------- acompanhamento da call ----------
// Compara o plantão com a situação REAL da pessoa na call e aplica a transição necessária.
async function syncShift(client, cfg, shift, now = new Date()) {
  if (shift.status !== 'active' || !cfg.shift.categoryId) return;
  const s = cfg.shift;
  const vs = liveState(client, shift.userId);
  const inValid = validCall(vs, cfg);
  const muted = inValid && isMuted(vs);

  // ----- está fora da call: conta a tolerância -----
  if (shift.presence === 'away') {
    if (sec(shift.awayAt, now) >= s.returnMinutes * 60) {
      return completeShift(client, cfg, shift, now, stats(shift, now), `Saiu da call e não voltou em ${s.returnMinutes} minutos.`);
    }
    if (!inValid) return;
    await Shift.findOneAndUpdate(
      { _id: shift._id, status: 'active', presence: 'away' },
      { $set: { presence: 'in', inSince: now, awayAt: null, muteSince: muted ? now : null, voiceChannelId: vs.channelId, voiceName: vs.channel.name } }
    );
    return;
  }

  // ----- estava na call -----
  const st = stats(shift, now);

  if (!inValid) {
    // saiu (ou foi para uma call fora da categoria)
    if (st.inSec >= s.plannedMinutes * 60) return completeShift(client, cfg, shift, now, st);
    const left = await Shift.findOneAndUpdate(
      { _id: shift._id, status: 'active', presence: 'in', inSince: shift.inSince },
      { $set: { presence: 'away', awayAt: now, inSec: st.inSec, mutedSec: st.mutedSec, inSince: null, muteSince: null }, $inc: { awayCount: 1 } },
      { new: true }
    );
    if (!left) return;
    const limit = new Date(now.getTime() + s.returnMinutes * 60000);
    await dm(client, left.userId, render(s.messages.leave, vars(cfg, left, { limite: `${ts(limit, 't')} (${ts(limit, 'R')})` })), 'Você saiu da call');
    return;
  }

  // continua na call: acompanha mute e troca de call
  if (muted && !shift.muteSince) {
    await Shift.updateOne({ _id: shift._id, status: 'active', presence: 'in', muteSince: null }, { $set: { muteSince: now } });
    shift.muteSince = now;
  } else if (!muted && shift.muteSince) {
    const upd = await Shift.updateOne(
      { _id: shift._id, status: 'active', presence: 'in', muteSince: shift.muteSince },
      { $inc: { mutedSec: sec(shift.muteSince, now) }, $set: { muteSince: null } }
    );
    if (upd.modifiedCount) {
      shift.mutedSec = (shift.mutedSec || 0) + sec(shift.muteSince, now);
      shift.muteSince = null;
    }
  }
  if (vs.channelId !== shift.voiceChannelId) {
    await Shift.updateOne({ _id: shift._id, status: 'active' }, { $set: { voiceChannelId: vs.channelId, voiceName: vs.channel.name } });
    shift.voiceName = vs.channel.name;
  }

  const fresh = stats(shift, now);
  if (fresh.inSec >= s.plannedMinutes * 60) return completeShift(client, cfg, shift, now, fresh);
}

// Evento de voz: reage na hora (a verificação de 15 s cobre o que o evento perder)
async function onVoiceStateUpdate(client, oldState, newState) {
  if (newState.guild.id !== MAIN_ID || !activeUsers.has(newState.id)) return;
  const shift = await Shift.findOne({ userId: newState.id, status: 'active' });
  if (!shift) {
    activeUsers.delete(newState.id);
    return;
  }
  await syncShift(client, await getCfg(), shift);
}

let running = false;
// Roda a cada 15 s: reconcilia todos os plantões ativos, cancela os esquecidos e reenvia logs que ficaram sem canal.
async function autoFinalizeExpired(client) {
  if (running) return;
  running = true;
  try {
    const cfg = await getCfg();
    const active = await Shift.find({ status: 'active' });
    activeUsers = new Set(active.map((s) => s.userId));
    const now = new Date();
    const limitMs = cfg.shift.maxHours * 3600 * 1000;
    for (const shift of active) {
      try {
        if (now - shift.startedAt > limitMs) {
          await completeShift(client, cfg, shift, now, stats(shift, now), `Passou do tempo máximo de ${cfg.shift.maxHours} h sem completar o tempo na call.`);
        } else {
          await syncShift(client, cfg, shift, now);
        }
      } catch (e) {
        console.error('[plantão:sync]', e.message);
      }
    }
    const orphans = await Shift.find({ status: 'pending', reviewMessageId: null }).limit(10);
    for (const shift of orphans) await sendReview(client, cfg, shift);
  } finally {
    running = false;
  }
}

module.exports = { buildShiftPanel, handleShift, cancelShift, autoFinalizeExpired, onVoiceStateUpdate, syncShift };
