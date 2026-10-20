const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { getCfg, getSeason, UserMov, MovMonitoria, MemberStat } = require('./db');
const { row, ts, fmt, fmtDuration, perms, withLock, dayKey, deny, trunc, guildKey, render } = require('./core');
const { awardPoints } = require('./points');
const { checkMember } = require('./metas');
const { findVoiceState, isMovChannel } = require('./movcall');
const { scheduleRankingRefresh } = require('./ranking');
const { E, Eb } = require('./emojis');

const GAP_MAX = 180;
const MON_GRACE_SEC = 30;
const AWAIT_EXPIRE_MIN = 30;
const OPEN = ['active', 'awaiting', 'review'];
const PANEL_EVERY_MS = 55_000;

// utilidades de interface
const FLAGS = MessageFlags.IsComponentsV2;
const v2 = (container, { ephemeral = false } = {}) => ({
  components: [container],
  flags: ephemeral ? FLAGS | MessageFlags.Ephemeral : FLAGS,
  allowedMentions: { parse: [] },
});
const v2Update = (container) => ({ components: [container], flags: FLAGS, allowedMentions: { parse: [] } });
const text = (c, s) => c.addTextDisplayComponents(new TextDisplayBuilder().setContent(String(s).slice(0, 3500)));
const sep = (c) => c.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
const plain = (content) => ({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
const btn = (id, label, style = ButtonStyle.Secondary, emoji) => {
  const b = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
  if (emoji) b.setEmoji(emoji);
  return b;
};
const jumpUrl = (guildId, channelId) => `https://discord.com/channels/${guildId}/${channelId}`;
const short = (id) => String(id).slice(-6).toUpperCase();

async function dm(client, userId, content) {
  try {
    const payload = typeof content === 'string' ? { content, allowedMentions: { parse: [] } } : content;
    await (await client.users.fetch(userId)).send(payload);
    return true;
  } catch (e) {
    console.warn(`[dm] não consegui enviar DM para ${userId}: ${e.code || ''} ${e.message}`); // 50007 = DMs fechadas
    return false;
  }
}

async function movLog(client, title, lines) {
  try {
    const cfg = getCfg();
    const id = cfg.logs.movcall || cfg.logs.movs || cfg.logs.geral;
    if (!id) return;
    const ch = await client.channels.fetch(id).catch(() => null);
    if (!ch?.isTextBased()) return;
    const c = new ContainerBuilder();
    text(c, `### ${title}`);
    sep(c);
    text(c, lines.filter(Boolean).join('\n'));
    text(c, `-# ${ts(new Date(), 'f')}`);
    await ch.send(v2(c));
  } catch (e) {
    console.error('[movcall-log]', e.message);
  }
}

async function incStat(userId, tag, inc) {
  const season = await getSeason();
  const filter = { userId, seasonId: season._id };
  const update = { $inc: inc, $set: { tag } };
  try {
    await MemberStat.updateOne(filter, update, { upsert: true });
  } catch (e) {
    if (e.code === 11000) await MemberStat.updateOne(filter, update, { upsert: true });
    else throw e;
  }
}

// painel público da MOV
const movDurSec = (m) => Math.max(1, (m.endsAt - m.startedAt) / 1000);
function elapsedOf(mov, now = new Date()) {
  const end = mov.status === 'active' ? Math.min(now.getTime(), mov.endsAt.getTime()) : (mov.finishedAt || mov.endsAt).getTime();
  return Math.max(0, (end - mov.startedAt.getTime()) / 1000);
}

function movStatusLine(mov) {
  switch (mov.status) {
    case 'active':
      return `${E('join')} MOV em andamento`;
    case 'finished':
      return `${E('ok')} MOV concluída`;
    case 'failed':
      return `${E('warn')} MOV não validada - ${mov.endReason || 'presença insuficiente'}`;
    case 'cancelled':
      return `${E('cancel')} MOV cancelada${mov.endReason ? ` - ${mov.endReason}` : ''}`;
    default:
      return mov.status;
  }
}

function monLines(mons, cfg) {
  const lines = [];
  for (const m of mons.filter((x) => OPEN.includes(x.status))) {
    if (m.status === 'active') lines.push(`${E('btnMovMonitor')} Em monitoria por <@${m.byId}> • termina ${ts(m.endsAt, 'R')}`);
    else if (m.status === 'awaiting') lines.push(`${E('wait')} Monitoria concluída - aguardando avaliação de <@${m.byId}>`);
    else lines.push(`${E('review')} Em análise pela liderança`);
  }
  for (const m of mons.filter((x) => ['approved', 'rejected'].includes(x.status)).slice(-2)) {
    if (m.status === 'approved')
      lines.push(`${E('ok')} Aprovada por <@${m.decidedBy || m.byId}> • +${fmt(m.points)} ${cfg.points.unit}`);
    else
      lines.push(
        `${E('bad')} Reprovada ${m.decidedBy && m.decidedBy !== 'system' ? `por <@${m.decidedBy}>` : 'automaticamente'}`,
      );
  }
  return lines.length ? lines : [`${E('wait')} Aguardando monitor`];
}

function panelPayload(mov, mons, cfg) {
  const c = new ContainerBuilder(); // sem setAccentColor: sem barra lateral colorida
  const live = mov.status === 'active';
  text(c, `## ${E('movcall')} ${cfg.movCall.title}\n-# Acompanhamento de MOV • #${short(mov._id)}`);
  sep(c);
  text(
    c,
    [
      `**Membro:** <@${mov.userId}>`,
      `**Início:** ${ts(mov.startedAt, 't')}`,
      `**Duração prevista:** ${mov.durationMin} min${live ? ` • termina ${ts(mov.endsAt, 'R')}` : ''}`,
      `**Tempo decorrido:** ${fmtDuration(elapsedOf(mov))}`,
      mov.channelId
        ? `**Call:** [${trunc(mov.channelName || 'abrir call', 40)}](${jumpUrl(mov.voiceGuildId, mov.channelId)})`
        : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );
  sep(c);
  const graceSec = cfg.movCall.leaveGraceSec;
  const outLine =
    live && graceSec > 0 && mov.outSince
      ? `${E('warn')} Fora da call - precisa voltar até ${ts(new Date(mov.outSince.getTime() + graceSec * 1000), 'R')} ou a MOV será cancelada`
      : '';
  text(
    c,
    [
      `**Status:** ${movStatusLine(mov)}`,
      outLine,
      `**Monitoria:** ${(mov.result === 'auto' ? [`${E('star')} Pontuada automaticamente (sem monitor) • +${fmt(mov.autoPoints)} ${cfg.points.unit}`] : monLines(mons, cfg)).join('\n')}`,
    ]
      .filter(Boolean)
      .join('\n'),
  );
  const canClick = live || mons.some((m) => OPEN.includes(m.status));
  if (canClick) {
    sep(c);
    c.addActionRowComponents(row(btn(`mc:mon:${mov._id}`, 'Monitorar', ButtonStyle.Secondary, Eb('btnMovMonitor'))));
  }
  return v2(c);
}

const lastPanel = new Map();
async function refreshPanel(client, movOrId) {
  try {
    const mov = movOrId?._id ? movOrId : await UserMov.findById(movOrId);
    if (!mov?.panel?.messageId) return;
    const ch = await client.channels.fetch(mov.panel.channelId).catch(() => null);
    const msg = ch?.isTextBased() ? await ch.messages.fetch(mov.panel.messageId).catch(() => null) : null;
    if (!msg) return;
    const mons = await MovMonitoria.find({ movId: mov._id }).sort({ startedAt: 1 });
    await msg.edit(panelPayload(mov, mons, getCfg()));
    lastPanel.set(String(mov._id), Date.now());
  } catch (e) {
    console.error('[movcall-painel]', e.message);
  }
}

// presença da MOV
function stepMov(mov, client, cfg, now) {
  const limit = new Date(Math.min(now.getTime(), mov.endsAt.getTime()));
  const st = findVoiceState(client, mov.userId);
  const inAuth = !!st && isMovChannel(cfg, st.channel);
  if (mov.lastSeenAt) {
    const gap = (limit - mov.lastSeenAt) / 1000;
    if (mov.inCall && gap > 0 && gap <= GAP_MAX) mov.presentSec += gap;
  }
  if (inAuth) {
    mov.outSince = null;
    if (st.channelId !== mov.channelId) {
      mov.channelId = st.channelId;
      mov.channelName = st.channel?.name;
      mov.voiceGuildId = st.guild.id;
    }
  } else if (mov.inCall || !mov.outSince) {
    mov.outSince = limit;
  }
  mov.inCall = inAuth;
  mov.lastSeenAt = limit;
  return { inAuth, st };
}
const leaveReason = (st) => (st ? 'foi para uma call fora das categorias autorizadas' : 'saiu da call');

const dmWarned = new Set();

const CARD_TITLES = {
  start: 'MOV CALL INICIADA!',
  leave: 'VOCÊ SAIU DA CALL!',
  back: 'VOCÊ VOLTOU PARA A CALL!',
  cancel: 'MOV CANCELADA',
  finish: 'MOV FINALIZADA!',
  fail: 'MOV NÃO VALIDADA',
  auto: 'PONTUAÇÃO RECEBIDA!',
};
function notifyCard(kind, emoji, content, mov, cfg, extra = {}) {
  const mc = cfg.movCall;
  const secs = Math.floor(mov.presentSec || 0);
  const B = E('bullet');
  const bullets = {
    start: [
      `Duração: **${mov.durationMin} min**`,
      `Termina: ${ts(mov.endsAt, 't')}`,
      mov.channelName ? `Call: **${mov.channelName}**` : '',
      `Presença mínima: **${mc.minPresencePct}%**`,
    ],
    leave: [`Tempo para voltar: **${fmtDuration(mc.leaveGraceSec)}**`, 'Se não voltar a tempo, a MOV será cancelada.'],
    back: ['A contagem continua normalmente.'],
    cancel: [mov.endReason ? `Motivo: **${mov.endReason}**` : ''],
    finish: [`Presença registrada: **${fmtDuration(secs)}**`],
    fail: [mov.endReason ? `Motivo: **${mov.endReason}**` : ''],
    auto: [],
  }[kind]
    .filter(Boolean)
    .map((x) => `${B} ${x}`);
  const closing = { start: 'Permaneça na call até o fim!', finish: 'Obrigado por participar!', auto: 'Parabéns pela MOV!' }[kind];
  const c = new ContainerBuilder();
  text(c, `## ${emoji} ${CARD_TITLES[kind]}`);
  text(c, `**${content}**`);
  if (bullets.length) text(c, bullets.join('\n'));
  if (closing) text(c, `**${closing}** ${E('heart')}`);
  text(c, `-# ${mc.title || 'MOV CALL'} • ${ts(new Date(), 'f')}`);
  return c;
}
const NOTIFY = {
  start: ['msgStart', 'join'],
  leave: ['msgLeave', 'warn'],
  back: ['msgReturn', 'ok'],
  cancel: ['msgCancel', 'cancel'],
  finish: ['msgFinish', 'ok'],
  fail: ['msgFail', 'warn'],
  auto: ['msgAuto', 'star'],
};
async function notifyMov(client, mov, kind, extra = {}) {
  try {
    const cfg = getCfg();
    const mc = cfg.movCall;
    if (!mc.notifyEnabled) return;
    const [key, emoji] = NOTIFY[kind];
    const tpl = mc[key];
    if (!tpl) return;
    const secs = Math.floor(mov.presentSec || 0);
    const content = trunc(
      render(tpl, {
        emoji: E(emoji),
        usuario: `<@${mov.userId}>`,
        duracao: mov.durationMin,
        fim: ts(mov.endsAt, 't'),
        tolerancia: fmtDuration(mc.leaveGraceSec),
        motivo: mov.endReason || '',
        presenca: Math.min(100, Math.round((secs / movDurSec(mov)) * 100)),
        pontuacao: '',
        pontos: '',
        moeda: cfg.points.unit,
        call: mov.channelName || '',
        ...extra,
      }).trim(),
      1900,
    );
    let dmFailed = false;
    if (mc.notifyDm) {
      dmFailed = !(await dm(client, mov.userId, v2(notifyCard(kind, E(emoji), content, mov, cfg)))); // por padrão só na DM do membro
      if (dmFailed && !dmWarned.has(String(mov._id))) {
        dmWarned.add(String(mov._id));
        await movLog(client, `${E('warn')} DM não entregue`, [
          `**Membro:** <@${mov.userId}>`,
          'O membro está com as DMs de membros do servidor desativadas (Privacidade do Discord). As mensagens da MOV não chegam para ele.',
          `**MOV:** #${short(mov._id)}`,
        ]);
      }
    }
    if (mc.notifyChannel || (dmFailed && mc.notifyFallback)) {
      const chId = mc.notifyChannelId || mov.panel?.channelId;
      const ch = chId ? await client.channels.fetch(chId).catch(() => null) : null;
      const mention = `<@${mov.userId}>`;
      if (ch?.isTextBased()) {
        const card = notifyCard(kind, E(emoji), content, mov, cfg);
        text(card, mention);
        await ch.send({ components: [card], flags: FLAGS, allowedMentions: { users: [mov.userId] } });
      }
    }
    return { dmFailed };
  } catch (e) {
    console.error('[movcall-notify]', e.message);
    return { dmFailed: false };
  }
}

async function maybeAutoAward(client, mov) {
  const cfg = getCfg();
  const mc = cfg.movCall;
  if (!mc.autoPointsEnabled || !(mc.autoPoints > 0)) return null;
  if (mov.status !== 'finished' || mov.result !== 'none') return null;
  const busy = await MovMonitoria.exists({
    movId: mov._id,
    status: { $in: ['active', 'awaiting', 'review', 'approved', 'rejected'] },
  });
  if (busy) return null;
  const r = await awardPoints({
    key: `movauto:${mov._id}`,
    userId: mov.userId,
    tag: mov.tag,
    category: 'mov',
    amount: mc.autoPoints,
    reason: 'MOV Call concluída sem monitoria (pontuação automática)',
    by: 'system',
    refId: mov._id,
  });
  if (r.duplicate) return null;
  mov.result = 'auto';
  mov.autoPoints = mc.autoPoints;
  await mov.save();
  await incStat(mov.userId, mov.tag, { mcApproved: 1 }).catch((e) => console.error('[movcall-stat]', e.message));
  checkMember(client, mov.userId, mov.tag).catch((e) => console.error('[metas]', e.message));
  scheduleRankingRefresh(client);
  await movLog(client, `${E('movcall')} Pontuação automática`, [
    `**Membro:** <@${mov.userId}>`,
    `**Pontuação:** ${fmt(mc.autoPoints)} ${cfg.points.unit} (MOV sem monitor)`,
    `**ID:** #${short(mov._id)}`,
  ]);
  return mc.autoPoints;
}

async function closeMov(client, mov, status, reason, now = new Date()) {
  mov.status = status;
  mov.endReason = reason || '';
  mov.finishedAt = now;
  mov.outSince = null;
  mov.presentSec = Math.min(mov.presentSec, movDurSec(mov));
  await mov.save();
  const secs = Math.floor(mov.presentSec);
  if (status === 'finished') {
    await incStat(mov.userId, mov.tag, { mcDone: 1, mcSec: secs }).catch((e) => console.error('[movcall-stat]', e.message));
    scheduleRankingRefresh(client);
  }
  // monitorias ainda abertas
  const open = await MovMonitoria.find({ movId: mov._id, status: { $in: ['active', 'awaiting'] } })
    .select('_id')
    .lean();
  for (const x of open) {
    await withLock(`mm:${x._id}`, async () => {
      const m = await MovMonitoria.findById(x._id);
      if (!m || !['active', 'awaiting'].includes(m.status)) return;
      if (status === 'cancelled') await closeMonSilently(client, m, 'cancelled', 'MOV cancelada');
      else if (status === 'failed' && m.status === 'active') await applyPolicy(client, m, mov.endReason || 'MOV não validada');
    });
  }
  const auto =
    status === 'finished'
      ? await maybeAutoAward(client, mov).catch((e) => {
          console.error('[movcall-auto]', e.message);
          return null;
        })
      : null;
  await movLog(
    client,
    `${E('movcall')} MOV ${status === 'finished' ? 'finalizada' : status === 'failed' ? 'não validada' : 'cancelada'}`,
    [
      `**Membro:** <@${mov.userId}>`,
      `**Duração prevista:** ${mov.durationMin} min • **Presença na call:** ${fmtDuration(secs)} (${Math.min(100, Math.round((secs / movDurSec(mov)) * 100))}%)`,
      reason ? `**Motivo:** ${reason}` : '',
      `**ID:** #${short(mov._id)}`,
    ],
  );
  await refreshPanel(client, mov);
  const cfgNow = getCfg();
  if (status === 'finished')
    await notifyMov(client, mov, 'finish', {
      pontuacao: auto ? `Pontuação: **+${fmt(auto)} ${cfgNow.points.unit}** (automática, sem monitor).` : '',
    });
  else if (status === 'failed') await notifyMov(client, mov, 'fail');
  else await notifyMov(client, mov, 'cancel');
}

function processMov(client, id) {
  return withLock(`mc:${id}`, async () => {
    const mov = await UserMov.findById(id);
    if (!mov || mov.status !== 'active') return;
    const cfg = getCfg();
    const now = new Date();
    const { st, inAuth } = stepMov(mov, client, cfg, now);
    if (now >= mov.endsAt) {
      const pct = Math.round((mov.presentSec / movDurSec(mov)) * 100);
      if (pct >= cfg.movCall.minPresencePct) return closeMov(client, mov, 'finished', '', now);
      return closeMov(client, mov, 'failed', `presença de ${pct}%, abaixo do mínimo de ${cfg.movCall.minPresencePct}%`, now);
    }
    const grace = cfg.movCall.leaveGraceSec;
    if (grace > 0 && mov.outSince && now - mov.outSince > grace * 1000) {
      return closeMov(client, mov, 'cancelled', `o membro ${leaveReason(st)} e não voltou em ${fmtDuration(grace)}`, now);
    }
    if (grace > 0 && !inAuth && mov.outSince && !mov.leaveNotified) {
      // acabou de sair: avisa e abre a tolerância
      mov.leaveNotified = true;
      await mov.save();
      await notifyMov(client, mov, 'leave');
      return refreshPanel(client, mov);
    }
    if (inAuth && mov.leaveNotified) {
      // voltou dentro da tolerância
      mov.leaveNotified = false;
      await mov.save();
      await notifyMov(client, mov, 'back');
      return refreshPanel(client, mov);
    }
    await mov.save();
    if (Date.now() - (lastPanel.get(String(mov._id)) || 0) >= PANEL_EVERY_MS) await refreshPanel(client, mov);
  });
}

// presença da monitoria
function stepMon(m, client, cfg, now) {
  const limit = new Date(Math.min(now.getTime(), m.endsAt.getTime()));
  const tst = findVoiceState(client, m.targetId);
  const tin = !!tst && isMovChannel(cfg, tst.channel);
  const mst = findVoiceState(client, m.byId);
  const min = !!tst && !!mst && mst.channelId === tst.channelId; // monitor na mesma call do membro
  if (m.lastSeenAt) {
    const gap = (limit - m.lastSeenAt) / 1000;
    if (gap > 0 && gap <= GAP_MAX) {
      if (m.targetIn) m.presentSec += gap;
      if (m.monitorIn) m.monitorSec += gap;
    }
  }
  if (tin) m.targetOutSince = null;
  else if (m.targetIn || !m.targetOutSince) m.targetOutSince = limit;
  if (tst?.channelId) {
    m.channelId = tst.channelId;
    m.channelName = tst.channel?.name;
    m.voiceGuildId = tst.guild.id;
  }
  m.targetIn = tin;
  m.monitorIn = min;
  m.lastSeenAt = limit;
  const left = !tin && !!m.targetOutSince && now - m.targetOutSince > MON_GRACE_SEC * 1000;
  return { left, tst };
}
const monDur = (m) => Math.max(1, (m.endsAt - m.startedAt) / 1000);
const tPct = (m) => Math.min(100, Math.round((m.presentSec / monDur(m)) * 100));
const mPct = (m) => Math.min(100, Math.round((m.monitorSec / monDur(m)) * 100));
const elapsedSec = (m, now = new Date()) => Math.max(1, (Math.min(now, m.endsAt) - m.startedAt) / 1000);
const tPctAt = (m, now) => Math.min(100, Math.round((m.presentSec / elapsedSec(m, now)) * 100));
const mPctAt = (m, now) => Math.min(100, Math.round((m.monitorSec / elapsedSec(m, now)) * 100));

async function closeMonSilently(client, m, status, why) {
  m.status = status;
  m.finishedAt = new Date();
  m.observation = m.observation || why;
  await m.save();
  const movDoc = await UserMov.findById(m.movId).catch(() => null);
  if (movDoc && movDoc.status === 'finished' && movDoc.result === 'none') {
    const pts = await maybeAutoAward(client, movDoc).catch((e) => {
      console.error('[movcall-auto]', e.message);
      return null;
    });
    if (pts) {
      await refreshPanel(client, movDoc);
      await notifyMov(client, movDoc, 'auto', { pontos: fmt(pts) });
    }
  }
  await movLog(client, `${E('btnMovMonitor')} Monitoria ${status === 'cancelled' ? 'cancelada' : 'expirada'}`, [
    `**Membro:** <@${m.targetId}> • **Monitor:** <@${m.byId}>`,
    why ? `**Motivo:** ${why}` : '',
  ]);
}

async function applyPolicy(client, m, reason) {
  const cfg = getCfg();
  m.leftCall = true;
  m.leftReason = reason;
  if (cfg.movCall.onLeave === 'reject') {
    m.status = 'rejected';
    m.decidedBy = 'system';
    m.observation = `Reprovada automaticamente: ${reason}`;
    m.finishedAt = new Date();
    await m.save();
    await afterReject(client, m);
    await movLog(client, `${E('btnMovMonitor')} Monitoria reprovada automaticamente`, [
      `**Membro:** <@${m.targetId}> • **Monitor:** <@${m.byId}>`,
      `**Motivo:** ${reason}`,
    ]);
  } else {
    m.status = 'review';
    await m.save();
    await movLog(client, `${E('btnMovMonitor')} Monitoria marcada para análise`, [
      `**Membro:** <@${m.targetId}> • **Monitor:** <@${m.byId}>`,
      `**Motivo:** ${reason}`,
      'A liderança decide pelo botão **Monitorar** do painel da MOV.',
    ]);
    dm(client, m.byId, `${E('review')} A monitoria de <@${m.targetId}> foi marcada para análise da liderança: ${reason}.`);
  }
  await refreshPanel(client, m.movId);
}

async function afterReject(client, m) {
  await UserMov.updateOne({ _id: m.movId }, { $set: { result: 'rejected' } });
  const tag = m.targetTag;
  await incStat(m.targetId, tag, { mcRejected: 1 }).catch((e) => console.error('[movcall-stat]', e.message));
  if (m.byId) await incStat(m.byId, m.byTag, { monitoredCount: 1 }).catch(() => {});
  scheduleRankingRefresh(client);
}

function processMon(client, id) {
  return withLock(`mm:${id}`, async () => {
    const m = await MovMonitoria.findById(id);
    if (!m || m.status !== 'active') return;
    const cfg = getCfg();
    const now = new Date();
    const { left, tst } = stepMon(m, client, cfg, now);
    if (left) return applyPolicy(client, m, `o membro ${leaveReason(tst)} durante a monitoria`);
    if (now >= m.endsAt) {
      if (tPct(m) < cfg.movCall.minPresencePct)
        return applyPolicy(client, m, `presença de ${tPct(m)}% na monitoria, abaixo do mínimo de ${cfg.movCall.minPresencePct}%`);
      m.status = 'awaiting';
      await m.save();
      const mov = await UserMov.findById(m.movId);
      dm(
        client,
        m.byId,
        `${E('wait')} A monitoria de <@${m.targetId}> terminou. Avalie e defina o resultado no painel da MOV${mov?.panel?.messageId ? `: ${jumpUrl(mov.panel.guildId, mov.panel.channelId)}/${mov.panel.messageId}` : '.'}`,
      );
      return refreshPanel(client, m.movId);
    }
    await m.save();
  });
}

// rotinas periódicas e eventos de voz
async function tickMovCall(client) {
  const movs = await UserMov.find({ status: 'active' }).select('_id').lean();
  for (const x of movs) await processMov(client, x._id).catch((e) => console.error('[movcall-tick]', e));
  const mons = await MovMonitoria.find({ status: 'active' }).select('_id').lean();
  for (const x of mons) await processMon(client, x._id).catch((e) => console.error('[movcall-tick-mon]', e));
  // monitorias concluídas e nunca avaliadas expiram
  const limit = new Date(Date.now() - AWAIT_EXPIRE_MIN * 60_000);
  const old = await MovMonitoria.find({ status: 'awaiting', endsAt: { $lt: limit } });
  for (const m of old) {
    await withLock(`mm:${m._id}`, async () => {
      const f = await MovMonitoria.findById(m._id);
      if (!f || f.status !== 'awaiting') return;
      await closeMonSilently(client, f, 'expired', 'Sem avaliação dentro do prazo');
      await refreshPanel(client, f.movId);
    });
  }
}

async function onVoiceMovCall(client, userId) {
  const [mov, mons] = await Promise.all([
    UserMov.findOne({ userId, status: 'active' }).select('_id').lean(),
    MovMonitoria.find({ status: 'active', $or: [{ targetId: userId }, { byId: userId }] })
      .select('_id')
      .lean(),
  ]);
  if (mov) await processMov(client, mov._id);
  for (const m of mons) await processMon(client, m._id);
}

async function reconcileMovCall(client) {
  const cfg = getCfg();
  const tol = cfg.movCall.restartToleranceSec;
  const now = new Date();
  const movs = await UserMov.find({ status: 'active' }).select('_id').lean();
  for (const x of movs) {
    await withLock(`mc:${x._id}`, async () => {
      const mov = await UserMov.findById(x._id);
      if (!mov || mov.status !== 'active') return;
      const st = findVoiceState(client, mov.userId);
      const inAuth = !!st && isMovChannel(cfg, st.channel);
      const limit = new Date(Math.min(now.getTime(), mov.endsAt.getTime()));
      const gap = mov.lastSeenAt ? (limit - mov.lastSeenAt) / 1000 : 0;
      if (inAuth && mov.inCall && gap > 0 && gap <= tol) mov.presentSec += gap;
      mov.inCall = inAuth;
      mov.lastSeenAt = limit;
      if (inAuth) mov.outSince = null;
      else if (!mov.outSince) mov.outSince = now;
      await mov.save();
    });
  }
  const mons = await MovMonitoria.find({ status: 'active' }).select('_id').lean();
  for (const x of mons) {
    await withLock(`mm:${x._id}`, async () => {
      const m = await MovMonitoria.findById(x._id);
      if (!m || m.status !== 'active') return;
      const tst = findVoiceState(client, m.targetId);
      const tin = !!tst && isMovChannel(cfg, tst.channel);
      const mst = findVoiceState(client, m.byId);
      const min = !!tst && !!mst && mst.channelId === tst.channelId;
      const limit = new Date(Math.min(now.getTime(), m.endsAt.getTime()));
      const gap = m.lastSeenAt ? (limit - m.lastSeenAt) / 1000 : 0;
      if (gap > 0 && gap <= tol) {
        if (tin && m.targetIn) m.presentSec += gap;
        if (min && m.monitorIn) m.monitorSec += gap;
      }
      m.targetIn = tin;
      m.monitorIn = min;
      m.lastSeenAt = limit;
      m.targetOutSince = tin ? null : now;
      await m.save();
    });
  }
  for (const x of movs) await processMov(client, x._id).catch((e) => console.error('[movcall-reconcile]', e));
  for (const x of mons) await processMon(client, x._id).catch((e) => console.error('[movcall-reconcile]', e));
  console.log(`MOV Call: ${movs.length} MOV(s) e ${mons.length} monitoria(s) em andamento recuperadas.`);
}

async function startMov({ client, user, member, guildId, channel, reply }) {
  const cfg = getCfg();
  if (!guildKey(guildId)) return reply(`${E('bad')} Este servidor não está autorizado.`);
  const cmdCh = cfg.movCall.commandChannelId;
  if (cmdCh && channel?.id !== cmdCh) return reply(`${E('warn')} Use o \`/iniciarmov\` somente em <#${cmdCh}>.`);
  const p = perms(member, cfg);
  if (!p.canStartMov) return reply(`${E('bad')} Você não possui um cargo autorizado a iniciar MOV.`);
  const st = findVoiceState(client, user.id);
  if (!st) return reply(`${E('warn')} Entre em uma call autorizada antes de iniciar a MOV.`);
  if (!isMovChannel(cfg, st.channel))
    return reply(`${E('warn')} A call em que você está não pertence às categorias autorizadas para MOV.`);
  if (await UserMov.exists({ userId: user.id, status: 'active' }))
    return reply(`${E('warn')} Você já possui uma MOV em andamento.`);

  const configured = cfg.movCall.panelChannelId;
  const panelCh = (configured ? await client.channels.fetch(configured).catch(() => null) : null) || channel;
  if (!panelCh?.isTextBased())
    return reply(
      `${E('bad')} Não consegui acessar o canal dos painéis de MOV. Peça a um administrador para configurar em /admin → MOV Call.`,
    );

  const season = await getSeason();
  const now = new Date();
  let mov;
  try {
    mov = await UserMov.create({
      userId: user.id,
      tag: user.username,
      seasonId: season._id,
      guildId,
      voiceGuildId: st.guild.id,
      channelId: st.channelId,
      channelName: st.channel?.name,
      startChannelId: st.channelId,
      startedAt: now,
      endsAt: new Date(now.getTime() + cfg.movCall.durationMin * 60_000),
      durationMin: cfg.movCall.durationMin,
      lastSeenAt: now,
      inCall: true,
    });
  } catch (e) {
    if (e.code === 11000) return reply(`${E('warn')} Você já possui uma MOV em andamento.`);
    throw e;
  }
  try {
    const sent = await panelCh.send(panelPayload(mov, [], cfg));
    mov.panel = { guildId: sent.guildId, channelId: sent.channelId, messageId: sent.id };
    await mov.save();
    lastPanel.set(String(mov._id), Date.now());
  } catch (e) {
    mov.status = 'cancelled';
    mov.endReason = 'painel não publicado';
    mov.finishedAt = new Date();
    await mov.save();
    console.error('[movcall-painel]', e.message);
    return reply(
      `${E('bad')} Não consegui publicar o painel no canal configurado (confira as permissões do bot). A MOV não foi iniciada.`,
    );
  }
  await movLog(client, `${E('movcall')} MOV iniciada`, [
    `**Membro:** <@${mov.userId}>`,
    `**Call:** ${st.channel?.name || st.channelId}`,
    `**Duração prevista:** ${mov.durationMin} min • termina ${ts(mov.endsAt, 't')}`,
    `**ID:** #${short(mov._id)}`,
  ]);
  const started = await notifyMov(client, mov, 'start');
  const dmWarn = started?.dmFailed
    ? `\n${E('warn')} **Não consegui te enviar DM.** Libere em Configurações do Discord → Privacidade → *Permitir mensagens diretas de membros do servidor* para receber os avisos da MOV (saída da call, tolerância, resultado).`
    : '';
  const where = `https://discord.com/channels/${mov.panel.guildId}/${mov.panel.channelId}/${mov.panel.messageId}`;
  return reply(
    `${E('ok')} MOV iniciada! Duração: **${mov.durationMin} min**. Fique na call - o painel está aqui: ${where}${configured ? '' : '\n-# Nenhum canal de painéis configurado: usei este canal. Configure em /admin → MOV Call.'}${dmWarn}`,
  );
}

async function iniciarMovCommand(i) {
  if (!guildKey(i.guildId)) return i.reply(plain(`${E('bad')} Este servidor não está autorizado.`));
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  return startMov({
    client: i.client,
    user: i.user,
    member: i.member,
    guildId: i.guildId,
    channel: i.channel,
    reply: (content) => i.editReply({ content, allowedMentions: { parse: [] } }),
  });
}

// monitoria: início e tela de controle
const dayCount = (filter) => MovMonitoria.countDocuments(filter);

function controlView(m, viewer, cfg) {
  const now = new Date();
  const crit = m.criteriaSnapshot || [];
  const p = viewer || {};
  const c = new ContainerBuilder();
  const left = Math.max(0, Math.ceil((m.endsAt - now) / 1000));
  const earlyView = m.status === 'active' && !!cfg.movCall.allowEarlyApproval && left > 0;
  const label = {
    active:
      left > 0
        ? `${E('progress')} Em andamento - faltam ${fmtDuration(left)}${cfg.movCall.allowEarlyApproval ? ' (já dá para aprovar)' : ''}`
        : `${E('progress')} Tempo concluído - atualizando`,
    awaiting: `${E('wait')} Concluída - aguardando a sua avaliação`,
    review: `${E('review')} Em análise pela liderança`,
    approved: `${E('mcOk')} Aprovada`,
    rejected: `${E('mcBad')} Reprovada`,
    cancelled: `${E('expired')} Cancelada`,
    expired: `${E('expired')} Expirada`,
  }[m.status];
  text(c, `## ${E('btnMovMonitor')} Monitoria - MOV Call\n-# #${short(m.movId)}`);
  sep(c);
  text(
    c,
    [
      `**Membro:** <@${m.targetId}> • **Monitor:** <@${m.byId}>`,
      `**Status:** ${label}`,
      `**Início:** ${ts(m.startedAt, 't')} • **Término:** ${ts(m.endsAt, 't')}`,
      `**Presença do membro na call:** ${earlyView ? tPctAt(m, now) : tPct(m)}%${earlyView ? ' até agora' : ''} (mínimo ${cfg.movCall.minPresencePct}%)`,
      cfg.movCall.requireMonitorInCall
        ? `**Sua presença na mesma call:** ${earlyView ? mPctAt(m, now) : mPct(m)}%${earlyView ? ' até agora' : ''} (mínimo ${cfg.movCall.minPresencePct}%)`
        : '',
      `**Pontuação permitida:** ${fmt(cfg.movCall.pointsMin)} a ${fmt(cfg.movCall.pointsMax)} ${cfg.points.unit}`,
      m.status === 'approved' ? `**Pontuação concedida:** ${fmt(m.points)}` : '',
      m.leftReason ? `**Ocorrência:** ${m.leftReason}` : '',
      m.observation ? `**Observação:** ${trunc(m.observation, 300)}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );
  text(c, '-# O bot só mede se o membro está **conectado**. Conectado não significa ativo: avalie a atividade real na call.');
  if (crit.length) {
    sep(c);
    text(
      c,
      `**Critérios**\n${crit.map((x, idx) => `${m.criteriaMet.includes(idx) ? E('checkOn') : E('checkOff')} ${x}`).join('\n')}`.slice(
        0,
        1500,
      ),
    );
  }
  const open = OPEN.includes(m.status);
  const canDecide = open && (m.status === 'review' ? p.isLeader : true);
  if (open) sep(c);
  if (canDecide && crit.length && m.status !== 'review') {
    c.addActionRowComponents(
      row(
        new StringSelectMenuBuilder()
          .setCustomId(`mc:crit:${m._id}`)
          .setPlaceholder('Marque os critérios cumpridos')
          .setMinValues(0)
          .setMaxValues(Math.min(crit.length, 25))
          .addOptions(
            crit
              .slice(0, 25)
              .map((x, idx) => ({ label: x.slice(0, 100), value: String(idx), default: m.criteriaMet.includes(idx) })),
          ),
      ),
    );
  }
  const buttons = [btn(`mc:ref:${m._id}`, 'Atualizar')];
  if (canDecide)
    buttons.push(
      btn(`mc:ok:${m._id}`, 'Aprovar e pontuar', ButtonStyle.Success),
      btn(`mc:no:${m._id}`, 'Reprovar', ButtonStyle.Danger),
    );
  if (open && m.status !== 'review') buttons.push(btn(`mc:cancel:${m._id}`, 'Cancelar'));
  if (open) c.addActionRowComponents(row(...buttons));
  if (open && m.voiceGuildId && m.channelId) {
    c.addActionRowComponents(
      row(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Entrar na call').setURL(jumpUrl(m.voiceGuildId, m.channelId))),
    );
  }
  return c;
}

async function tryMoveMonitor(client, monitorId, st) {
  try {
    const g = st.guild;
    const me = g.members.me || (await g.members.fetchMe());
    if (!me.permissions.has(PermissionFlagsBits.MoveMembers)) return;
    const mem = g.members.cache.get(monitorId) || (await g.members.fetch(monitorId).catch(() => null));
    if (mem?.voice?.channelId && mem.voice.channelId !== st.channelId)
      await mem.voice.setChannel(st.channel, 'Monitoria de MOV Call');
  } catch {}
}

async function onMonitorButton(i, movId) {
  const cfg = getCfg();
  const p = perms(i.member, cfg);
  const mov = await UserMov.findById(movId).catch(() => null);
  if (!mov) return i.reply(plain(`${E('bad')} MOV não encontrada.`));
  const mons = await MovMonitoria.find({ movId: mov._id, status: { $in: OPEN } }).sort({ startedAt: 1 });

  const mine = mons.find((m) => m.byId === i.user.id);
  if (mine) return i.reply(v2(controlView(mine, p, cfg), { ephemeral: true }));
  const review = p.isLeader ? mons.find((m) => m.status === 'review') : null;
  if (review) return i.reply(v2(controlView(review, p, cfg), { ephemeral: true }));

  // 2) nova monitoria
  if (!p.canMonitor) return i.reply(plain(`${E('bad')} Você não tem permissão para monitorar.`));
  if (mov.status !== 'active') return i.reply(plain(`${E('warn')} Esta MOV já foi encerrada.`));
  if (mov.userId === i.user.id && !p.canSelfMonitor)
    return i.reply(plain(`${E('bad')} Você não pode monitorar a sua própria MOV.`));
  const running = mons.filter((m) => ['active', 'awaiting'].includes(m.status));
  if (running.length && !cfg.movCall.allowDuplicateMonitoring) {
    return i.reply(plain(`${E('warn')} Esta MOV já está sendo monitorada por <@${running[0].byId}>.`));
  }
  if (await MovMonitoria.exists({ byId: i.user.id, status: { $in: ['active', 'awaiting'] } })) {
    return i.reply(plain(`${E('warn')} Você já tem uma monitoria em andamento. Finalize-a antes de começar outra.`));
  }
  const st = findVoiceState(i.client, mov.userId);
  if (!st || !isMovChannel(cfg, st.channel))
    return i.reply(plain(`${E('warn')} <@${mov.userId}> não está em uma call autorizada agora.`));

  const now = new Date();
  const mst = findVoiceState(i.client, i.user.id);
  let m;
  try {
    m = await MovMonitoria.create({
      movId: mov._id,
      targetId: mov.userId,
      targetTag: mov.tag,
      byId: i.user.id,
      byTag: i.user.username,
      seasonId: mov.seasonId,
      channelId: st.channelId,
      channelName: st.channel?.name,
      voiceGuildId: st.guild.id,
      startedAt: now,
      endsAt: new Date(now.getTime() + cfg.monitor.durationMin * 60_000),
      lastSeenAt: now,
      targetIn: true,
      monitorIn: !!mst && mst.channelId === st.channelId,
      criteriaSnapshot: cfg.monitor.criteria,
    });
  } catch (e) {
    console.error('[movcall-monitoria]', e);
    return i.reply(plain(`${E('bad')} Não consegui iniciar a monitoria. Tente novamente.`));
  }
  if (cfg.movCall.autoMoveMonitor) tryMoveMonitor(i.client, i.user.id, st);
  await movLog(i.client, `${E('btnMovMonitor')} Monitoria iniciada`, [
    `**Membro:** <@${m.targetId}> • **Monitor:** <@${m.byId}>`,
    `**Call:** ${st.channel?.name || st.channelId}`,
    `**Término:** ${ts(m.endsAt, 't')} (${cfg.monitor.durationMin} min)`,
    `**MOV:** #${short(mov._id)}`,
  ]);
  const reply = i.reply(v2(controlView(m, p, cfg), { ephemeral: true }));
  refreshPanel(i.client, mov);
  return reply;
}

async function loadControlled(i, id) {
  const m = await MovMonitoria.findById(id).catch(() => null);
  if (!m) {
    await i.reply(plain(`${E('bad')} Monitoria não encontrada.`));
    return null;
  }
  const p = perms(i.member, getCfg());
  if (i.user.id !== m.byId && !p.isLeader) {
    await i.reply(plain(`${E('bad')} Apenas o monitor responsável (ou a liderança) pode usar estes botões.`));
    return null;
  }
  if (m.status === 'review' && !p.isLeader) {
    await i.reply(plain(`${E('warn')} Esta monitoria está em análise: só a liderança decide.`));
    return null;
  }
  return m;
}

function approveModal(id, cfg) {
  const mc = cfg.movCall;
  return new ModalBuilder()
    .setCustomId(`mc:okm:${id}`)
    .setTitle('Aprovar e pontuar')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('pts')
          .setLabel(`Pontuação (${fmt(mc.pointsMin)} a ${fmt(mc.pointsMax)})`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(10)
          .setValue(String(mc.pointsDefault)),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('obs')
          .setLabel('Observações (opcional)')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(400),
      ),
    );
}
const rejectModal = (id) =>
  new ModalBuilder()
    .setCustomId(`mc:nom:${id}`)
    .setTitle('Reprovar monitoria')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('obs')
          .setLabel('Justificativa')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(400),
      ),
    );

function decide(i, id, approve, { observation = '', pointsRaw = null } = {}) {
  return withLock(`mm:${id}`, async () => {
    const cfg = getCfg();
    const m = await MovMonitoria.findById(id);
    if (!m || !OPEN.includes(m.status)) return i.reply(plain(`${E('warn')} Esta monitoria já foi finalizada.`));
    const p = perms(i.member, cfg);
    if (i.user.id !== m.byId && !p.isLeader) return i.reply(plain(`${E('bad')} Sem permissão para decidir esta monitoria.`));
    if (m.status === 'review' && !p.isLeader)
      return i.reply(plain(`${E('warn')} Esta monitoria está em análise: só a liderança decide.`));
    if (i.user.id === m.targetId && !p.canSelfMonitor)
      return i.reply(plain(`${E('bad')} Você não pode aprovar ou pontuar a sua própria MOV.`));
    const now = new Date();
    const wasActive = m.status === 'active';
    if (wasActive) stepMon(m, i.client, cfg, now);
    let points = 0;

    if (approve) {
      const override = p.isLeader && m.status === 'review'; // a liderança pode decidir casos em análise
      const early = now < m.endsAt;
      if (early && !cfg.movCall.allowEarlyApproval) {
        await m.save();
        return i.reply(
          plain(`${E('warn')} Aguarde o fim da monitoria (${fmtDuration((m.endsAt - now) / 1000)} restantes) para aprovar.`),
        );
      }
      const tp = early ? tPctAt(m, now) : tPct(m);
      const mp = early ? mPctAt(m, now) : mPct(m);
      if (!override && tp < cfg.movCall.minPresencePct) {
        await m.save();
        return i.reply(
          plain(
            `${E('bad')} A presença do membro foi de ${tp}%${early ? ' até agora' : ''}, abaixo do mínimo de ${cfg.movCall.minPresencePct}%. Reprove ou cancele a monitoria.`,
          ),
        );
      }
      if (!override && cfg.movCall.requireMonitorInCall && mp < cfg.movCall.minPresencePct) {
        await m.save();
        return i.reply(
          plain(
            `${E('bad')} A sua presença na call foi de ${mp}%${early ? ' até agora' : ''}, abaixo do mínimo de ${cfg.movCall.minPresencePct}%. Sem acompanhar a call não dá para aprovar.`,
          ),
        );
      }
      const total = (m.criteriaSnapshot || []).length;
      if (cfg.monitor.requireAllCriteria && total && m.criteriaMet.length < total) {
        await m.save();
        return i.reply(
          plain(`${E('warn')} Marque todos os critérios cumpridos antes de aprovar (${m.criteriaMet.length}/${total}).`),
        );
      }
      points = parseFloat(String(pointsRaw ?? '').replace(',', '.'));
      const { pointsMin: lo, pointsMax: hi } = cfg.movCall;
      if (!Number.isFinite(points) || points < lo || points > hi)
        return i.reply(plain(`${E('bad')} A pontuação precisa estar entre ${fmt(lo)} e ${fmt(hi)}.`));
      points = Math.round(points * 100) / 100;
      const today = dayKey(now);
      await awardPoints({
        key: `movmon:${m._id}`,
        userId: m.targetId,
        tag: m.targetTag,
        category: 'monitor',
        amount: points,
        reason: `Monitoria de MOV Call por ${m.byTag}`,
        by: i.user.id,
        refId: m._id,
      });
      m.dayKey = today;
    }

    m.status = approve ? 'approved' : 'rejected';
    m.decidedBy = i.user.id;
    m.observation = observation;
    m.points = approve ? points : 0;
    m.finishedAt = now;
    await m.save();

    if (approve) {
      await UserMov.updateOne({ _id: m.movId }, { $set: { result: 'approved' } });
      await incStat(m.targetId, m.targetTag, { mcApproved: 1 }).catch((e) => console.error('[movcall-stat]', e.message));
      await incStat(m.byId, m.byTag, { monitoredCount: 1 }).catch(() => {});
      checkMember(i.client, m.targetId, m.targetTag).catch((e) => console.error('[metas]', e.message));
      scheduleRankingRefresh(i.client);
    } else {
      await afterReject(i.client, m);
    }
    await movLog(i.client, `${E('btnMovMonitor')} Monitoria ${approve ? 'aprovada' : 'reprovada'}`, [
      `**Membro:** <@${m.targetId}> • **Monitor:** <@${m.byId}>${i.user.id !== m.byId ? ` • **Decidido por:** <@${i.user.id}>` : ''}`,
      `**Presença do membro:** ${tPct(m)}% • **Presença do monitor:** ${mPct(m)}%`,
      `**Critérios:** ${m.criteriaMet.length}/${(m.criteriaSnapshot || []).length}`,
      approve ? `**Pontuação concedida:** ${fmt(points)} ${cfg.points.unit}` : '',
      `**Observação:** ${observation || '-'}`,
      `**MOV:** #${short(m.movId)}`,
    ]);
    refreshPanel(i.client, m.movId);
    return i.update(v2Update(controlView(m, p, cfg)));
  });
}

async function cancelMonitoria(i, m) {
  return withLock(`mm:${m._id}`, async () => {
    const f = await MovMonitoria.findById(m._id);
    if (!f || !OPEN.includes(f.status)) return i.update(v2Update(controlView(f || m, perms(i.member), getCfg())));
    await closeMonSilently(i.client, f, 'cancelled', `Cancelada por ${i.user.username}`);
    refreshPanel(i.client, f.movId);
    return i.update(v2Update(controlView(f, perms(i.member), getCfg())));
  });
}

async function handleMovCall(i) {
  const [, act, arg] = i.customId.split(':');
  const cfg = getCfg();
  if (act === 'mon') return onMonitorButton(i, arg);
  const m = await loadControlled(i, arg);
  if (!m) return undefined;
  const p = perms(i.member, cfg);
  switch (act) {
    case 'ref': {
      if (m.status === 'active')
        await withLock(`mm:${m._id}`, async () => {
          const f = await MovMonitoria.findById(m._id);
          if (f?.status === 'active') {
            stepMon(f, i.client, cfg, new Date());
            await f.save();
          }
        });
      return i.update(v2Update(controlView(await MovMonitoria.findById(m._id), p, cfg)));
    }
    case 'crit': {
      if (!OPEN.includes(m.status)) return i.update(v2Update(controlView(m, p, cfg)));
      m.criteriaMet = i.values.map(Number);
      await m.save();
      return i.update(v2Update(controlView(m, p, cfg)));
    }
    case 'ok':
      return i.showModal(approveModal(arg, cfg));
    case 'no':
      return i.showModal(rejectModal(arg));
    case 'okm':
      return decide(i, arg, true, {
        observation: i.fields.getTextInputValue('obs').trim(),
        pointsRaw: i.fields.getTextInputValue('pts'),
      });
    case 'nom':
      return decide(i, arg, false, { observation: i.fields.getTextInputValue('obs').trim() });
    case 'cancel':
      return cancelMonitoria(i, m);
    default:
      return undefined;
  }
}

// histórico e administração
const RESULT = {
  get approved() {
    return `${E('mcOk')} aprovada`;
  },
  get rejected() {
    return `${E('mcBad')} reprovada`;
  },
  get review() {
    return `${E('review')} em análise`;
  },
  get auto() {
    return `${E('auto')} pontuada automaticamente`;
  },
  none: '-',
};
const STATUS_ICON = {
  get active() {
    return E('on');
  },
  get finished() {
    return E('ok');
  },
  get failed() {
    return E('warn');
  },
  get cancelled() {
    return E('off');
  },
};

async function movHistoricoCommand(i) {
  const cfg = getCfg();
  const target = i.options.getUser('usuario') || i.user;
  if (target.id !== i.user.id && !perms(i.member, cfg).isLeader)
    return i.reply(plain(`${E('bad')} Só a liderança pode consultar o histórico de outro membro.`));
  const [list, season] = await Promise.all([UserMov.find({ userId: target.id }).sort({ startedAt: -1 }).limit(10), getSeason()]);
  const st = await MemberStat.findOne({ userId: target.id, seasonId: season._id }).lean();
  const c = new ContainerBuilder();
  text(c, `## ${E('movcall')} Histórico de MOV - ${target.username}\n-# ${season.name}`);
  sep(c);
  text(
    c,
    [
      `**MOVs realizadas:** ${st?.mcDone || 0} • ${E('mcOk')} ${st?.mcApproved || 0} • ${E('mcBad')} ${st?.mcRejected || 0}`,
      `**Tempo de MOV registrado:** ${fmtDuration(st?.mcSec || 0)} • **Monitorias realizadas:** ${st?.monitoredCount || 0}`,
      `**Pontos de monitoria:** ${fmt(st?.monitorPoints || 0)} ${cfg.points.unit}`,
    ].join('\n'),
  );
  sep(c);
  text(
    c,
    list.length
      ? list
          .map(
            (m) =>
              `${STATUS_ICON[m.status] || '•'} ${ts(m.startedAt, 'd')} ${ts(m.startedAt, 't')} • **${fmtDuration(m.presentSec)}** de ${m.durationMin} min • ${RESULT[m.result] || '-'}${m.endReason ? ` • ${trunc(m.endReason, 50)}` : ''}`,
          )
          .join('\n')
      : 'Nenhuma MOV registrada.',
  );
  return i.reply(v2(c, { ephemeral: true }));
}

async function adminListMovs() {
  const [active, recent] = await Promise.all([
    UserMov.find({ status: 'active' }).sort({ startedAt: 1 }).limit(25),
    UserMov.find({ status: { $ne: 'active' } })
      .sort({ finishedAt: -1 })
      .limit(8),
  ]);
  const mons = await MovMonitoria.find({ movId: { $in: active.map((a) => a._id) }, status: { $in: OPEN } });
  return { active, recent, mons };
}

function adminCancelMov(client, id, by) {
  return withLock(`mc:${id}`, async () => {
    const mov = await UserMov.findById(id);
    if (!mov || mov.status !== 'active') return null;
    await closeMov(client, mov, 'cancelled', `cancelada por administrador (${by})`);
    return mov;
  });
}

module.exports = {
  iniciarMovCommand,
  startMov,
  movHistoricoCommand,
  handleMovCall,
  tickMovCall,
  onVoiceMovCall,
  reconcileMovCall,
  adminListMovs,
  adminCancelMov,
  movStatusLine,
  STATUS_ICON,
  RESULT,
  ui: { v2, v2Update, text, sep, plain, btn, dm, incStat, movLog, short },
  _test: { stepMov, stepMon, panelPayload, controlView, tPct, mPct, notifyMov, maybeAutoAward },
};
