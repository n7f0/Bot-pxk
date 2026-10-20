const { VoiceSession, getCfg } = require('./db');
const { withLock, sendLog, logEmbed, ts, fmtDuration, fmt, COLORS, voiceGuildIds } = require('./core');
const { awardPoints, timePointsToday } = require('./points');
const { checkMember } = require('./metas');
const { E } = require('./emojis');
const { scheduleRankingRefresh } = require('./ranking');

const CHECKPOINT_SEC = 60;

// regras de validade
function isAuthorizedChannel(cfg, ch) {
  if (!ch || !ch.isVoiceBased?.()) return false;
  return cfg.voice.channelIds.includes(ch.id) || (!!ch.parentId && cfg.voice.categoryIds.includes(ch.parentId));
}
function isMovChannel(cfg, ch) {
  if (!ch || !ch.isVoiceBased?.()) return false;
  const { movChannelIds: mc, movCategoryIds: mk } = cfg.voice;
  if (!(mc || []).length && !(mk || []).length) return isAuthorizedChannel(cfg, ch);
  return (mc || []).includes(ch.id) || (!!ch.parentId && (mk || []).includes(ch.parentId));
}
function stateCounts(cfg, st) {
  if (!cfg.voice.countMuted && st.mute) return false;
  if (!cfg.voice.countDeafened && st.deaf) return false;
  return true;
}
function findVoiceState(client, userId) {
  for (const gid of voiceGuildIds()) {
    const vs = client.guilds.cache.get(gid)?.voiceStates.cache.get(userId);
    if (vs?.channelId) return vs;
  }
  return null;
}
function roundPts(x, mode) {
  if (mode === 'ceil') return Math.ceil(x);
  if (mode === 'round') return Math.round(x);
  if (mode === 'exact') return Math.round(x * 100) / 100;
  return Math.floor(x);
}

// contagem
const maxSec = (cfg) => cfg.voice.maxSessionHours * 3600;
const liveValid = (s, now, cfg) =>
  Math.min(maxSec(cfg), s.validSec + (s.countingSince ? Math.max(0, (now - s.countingSince) / 1000) : 0));
function fold(s, now, cfg) {
  if (s.countingSince) {
    s.validSec = Math.min(maxSec(cfg), s.validSec + Math.max(0, (now - s.countingSince) / 1000));
    s.countingSince = now;
  }
}
function applyState(s, st, now, cfg) {
  const ch = st?.channel;
  if (ch && s.channelId !== ch.id) {
    s.channelId = ch.id;
    if (!s.channelsVisited.includes(ch.id)) s.channelsVisited.push(ch.id);
  }
  const counting = !!st && stateCounts(cfg, st);
  if (counting && !s.countingSince) s.countingSince = now;
  else if (!counting && s.countingSince) {
    fold(s, now, cfg);
    s.countingSince = null;
  }
  s.lastSeenAt = now;
}

async function payout(client, s, cfg) {
  const newSec = Math.floor(s.validSec);
  if (newSec <= s.paidSec || newSec < cfg.voice.minSessionSec) return 0;
  const earned = roundPts((newSec / 3600) * cfg.points.perHour, cfg.points.rounding);
  let amount = Math.max(0, earned - s.paidPoints);
  if (cfg.points.dailyCap > 0) {
    amount = Math.max(0, Math.min(amount, cfg.points.dailyCap - (await timePointsToday(s.userId))));
  }
  const res = await awardPoints({
    key: `time:${s._id}:${newSec}`,
    userId: s.userId,
    tag: s.tag,
    category: 'time',
    amount,
    seconds: newSec - s.paidSec,
    reason: 'Tempo em call',
    refId: s._id,
  });
  s.paidSec = newSec;
  s.paidPoints = earned;
  if (!res.duplicate) {
    s.points = (s.points || 0) + amount;
    if (amount > 0) scheduleRankingRefresh(client, 5_000); // ranking acompanha os pontos de tempo em call
  }
  return amount;
}

async function openSession(client, userId, tag, st, now, cfg) {
  try {
    const s = await VoiceSession.create({
      userId,
      tag,
      guildId: st.guild.id,
      channelId: st.channel.id,
      channelsVisited: [st.channel.id],
      startedAt: now,
      lastSeenAt: now,
      countingSince: stateCounts(cfg, st) ? now : null,
      status: 'active',
    });
    sendLog(
      client,
      'sessoes',
      logEmbed(`${E('join')} Entrada em call`, `<@${userId}> entrou em <#${st.channel.id}>.`, COLORS.ok),
    );
    return s;
  } catch (e) {
    if (e.code === 11000) return null; // já existe sessão ativa
    throw e;
  }
}

async function closeSession(client, s, { reason, at = new Date() }) {
  const cfg = getCfg();
  let end = new Date(Math.min(new Date(at).getTime(), Date.now()));
  if (end < s.startedAt) end = s.startedAt;
  if (s.countingSince) s.validSec = Math.min(maxSec(cfg), s.validSec + Math.max(0, (end - s.countingSince) / 1000));
  s.countingSince = null;
  s.validSec = Math.floor(s.validSec);
  s.endedAt = end;
  s.endReason = reason;
  s.totalSec = Math.floor((end - s.startedAt) / 1000);
  const ok = s.validSec >= cfg.voice.minSessionSec;
  if (ok) await payout(client, s, cfg);
  s.status = ok ? 'done' : 'invalid';
  await s.save();
  const motivo =
    {
      saiu: 'saiu da call',
      canal_nao_autorizado: 'foi para um canal não autorizado',
      limite: 'limite de duração da sessão',
      reinicio: 'reinício do bot (tempo desconhecido não é contado)',
      reconciliado: 'conexão não confirmada',
      desligamento: 'desligamento do bot',
    }[reason] || reason;
  sendLog(
    client,
    'sessoes',
    logEmbed(
      `${E('leave')} Sessão ${ok ? 'encerrada' : 'invalidada'}`,
      `<@${s.userId}> • ${motivo}\n**Válido:** ${fmtDuration(s.validSec)} de ${fmtDuration(s.totalSec)}\n**Cristais:** ${fmt(s.points)}${ok ? '' : `\nMenos de ${cfg.voice.minSessionSec}s válidos - nada contabilizado.`}`,
      ok ? COLORS.neutral : COLORS.warn,
    ),
  );
  if (ok && s.points > 0) checkMember(client, s.userId, s.tag).catch((e) => console.error('[metas]', e.message));
  return s;
}

async function enforceLimit(client, s, st, inAuth, now, cfg) {
  if (liveValid(s, now, cfg) < maxSec(cfg)) return false;
  await closeSession(client, s, { reason: 'limite', at: now });
  if (st && inAuth) await openSession(client, s.userId, s.tag, st, now, cfg);
  return true;
}

function syncMember(client, userId, tag) {
  return withLock(`v:${userId}`, async () => {
    const cfg = getCfg();
    const now = new Date();
    const st = findVoiceState(client, userId);
    const inAuth = !!st && isAuthorizedChannel(cfg, st.channel);
    const s = await VoiceSession.findOne({ userId, status: 'active' });
    if (!s) {
      if (inAuth) await openSession(client, userId, tag, st, now, cfg);
      return;
    }
    if (!inAuth) return closeSession(client, s, { reason: st ? 'canal_nao_autorizado' : 'saiu', at: now });
    applyState(s, st, now, cfg);
    if (await enforceLimit(client, s, st, inAuth, now, cfg)) return;
    await s.save();
  });
}

async function tickSessions(client) {
  const list = await VoiceSession.find({ status: 'active' }).select('_id userId').lean();
  for (const x of list) {
    await withLock(`v:${x.userId}`, async () => {
      const s = await VoiceSession.findOne({ _id: x._id, status: 'active' });
      if (!s) return;
      const cfg = getCfg();
      const now = new Date();
      const st = findVoiceState(client, s.userId);
      const inAuth = !!st && isAuthorizedChannel(cfg, st.channel);
      if (!inAuth) return closeSession(client, s, { reason: 'reconciliado', at: s.lastSeenAt || now });
      applyState(s, st, now, cfg);
      if (await enforceLimit(client, s, st, inAuth, now, cfg)) return;
      const live = Math.floor(liveValid(s, now, cfg));
      if (live >= cfg.voice.minSessionSec && live - s.paidSec >= CHECKPOINT_SEC) {
        fold(s, now, cfg);
        const got = await payout(client, s, cfg);
        await s.save();
        if (got > 0) checkMember(client, s.userId, s.tag).catch((e) => console.error('[metas]', e.message));
        return;
      }
      await s.save();
    });
  }
}

async function reconcileOnReady(client) {
  const olds = await VoiceSession.find({ status: 'active' });
  for (const s of olds) {
    await withLock(`v:${s.userId}`, () => closeSession(client, s, { reason: 'reinicio', at: s.lastSeenAt || s.startedAt }));
  }
  const cfg = getCfg();
  let opened = 0;
  for (const gid of voiceGuildIds()) {
    const guild = client.guilds.cache.get(gid);
    if (!guild) continue;
    for (const vs of guild.voiceStates.cache.values()) {
      if (!vs.channelId || !isAuthorizedChannel(cfg, vs.channel)) continue;
      const member = vs.member || (await guild.members.fetch(vs.id).catch(() => null));
      if (!member || member.user.bot) continue;
      await syncMember(client, member.id, member.user.username);
      opened++;
    }
  }
  console.log(`Sessões reconciliadas: ${olds.length} antigas fechadas, ${opened} membro(s) em call.`);
}

async function shutdownSessions(client) {
  const list = await VoiceSession.find({ status: 'active' });
  for (const s of list)
    await closeSession(client, s, { reason: 'desligamento', at: new Date() }).catch((e) =>
      console.error('[shutdown]', e.message),
    );
}

module.exports = {
  isAuthorizedChannel,
  isMovChannel,
  stateCounts,
  findVoiceState,
  syncMember,
  tickSessions,
  reconcileOnReady,
  shutdownSessions,
  liveValid,
};
