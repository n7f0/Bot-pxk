const { EmbedBuilder } = require('discord.js');
const {
  getCfg,
  getSeason,
  Season,
  VoiceSession,
  PointTx,
  MovEvent,
  MovOccurrence,
  MovParticipation,
  MonitorSession,
  MemberStat,
} = require('./db');
const {
  COLORS,
  ts,
  fmt,
  fmtDuration,
  perms,
  deny,
  startOfDay,
  guildKey,
  voiceGuildIds,
  sendLog,
  logEmbed,
  audit,
  DAY_MS,
  trunc,
} = require('./core');
const { awardPoints } = require('./points');
const { userEmbed, SORTS, scheduleRankingRefresh } = require('./ranking');
const { findVoiceState, isAuthorizedChannel, liveValid } = require('./movcall');
const { formatDays, nextStart } = require('./movs');
const { checkMember } = require('./metas');
const { E } = require('./emojis');

const internalOnly = (i) =>
  guildKey(i.guildId) === 'internal' ? null : deny(`${E('bad')} Este comando só funciona no servidor interno.`);

// /atividade
async function atividadeCommand(i) {
  const cfg = getCfg();
  const target = i.options.getUser('usuario') || i.user;
  if (target.id !== i.user.id && !perms(i.member, cfg).isLeader)
    return i.reply(deny(`${E('bad')} Só a liderança pode consultar a atividade de outro membro.`));
  await i.deferReply({ flags: 64 });
  const days = i.options.getInteger('dias') || 7;
  const since = new Date(Date.now() - days * DAY_MS);
  const [sessions, count, agg] = await Promise.all([
    VoiceSession.find({ userId: target.id, startedAt: { $gte: since }, status: { $in: ['done', 'active'] } })
      .sort({ startedAt: -1 })
      .limit(8),
    VoiceSession.countDocuments({ userId: target.id, startedAt: { $gte: since }, status: 'done' }),
    PointTx.aggregate([
      { $match: { userId: target.id, createdAt: { $gte: since } } },
      { $group: { _id: '$category', amount: { $sum: '$amount' }, seconds: { $sum: '$seconds' } } },
    ]),
  ]);
  const by = Object.fromEntries(agg.map((a) => [a._id, a]));
  const total = Object.values(by).reduce((a, b) => a + b.amount, 0);
  const now = new Date();
  const lines = sessions.map((s) => {
    const dur = s.status === 'active' ? liveValid(s, now, cfg) : s.validSec;
    return `${ts(s.startedAt, 'd')} ${ts(s.startedAt, 't')} • **${fmtDuration(dur)}** • <#${s.channelId}> • ${s.status === 'active' ? `${E('on')} em andamento` : `+${fmt(s.points)}`}`;
  });
  const embed = new EmbedBuilder()
    .setColor(COLORS.neutral)
    .setAuthor({ name: target.username, iconURL: target.displayAvatarURL() })
    .setTitle(`${E('time')} Atividade - últimos ${days} dia(s)`)
    .addFields(
      { name: 'Tempo válido', value: fmtDuration(by.time?.seconds || 0), inline: true },
      { name: 'Sessões', value: String(count), inline: true },
      {
        name: cfg.points.unit,
        value: `${fmt(total)} (tempo ${fmt(by.time?.amount || 0)} • MOV ${fmt(by.mov?.amount || 0)} • monit. ${fmt(by.monitor?.amount || 0)} • metas ${fmt(by.goal?.amount || 0)} • ajustes ${fmt(by.manual?.amount || 0)})`,
      },
      { name: 'Últimas sessões', value: lines.join('\n') || 'Nenhuma sessão no período.' },
    )
    .setTimestamp();
  return i.editReply({ embeds: [embed] });
}

// /movcall
async function movcallCommand(i) {
  await i.deferReply({ flags: 64 });
  const cfg = getCfg();
  const season = await getSeason();
  let inCall = 0;
  for (const gid of voiceGuildIds()) {
    const g = i.client.guilds.cache.get(gid);
    if (!g) continue;
    for (const vs of g.voiceStates.cache.values())
      if (vs.channelId && isAuthorizedChannel(cfg, vs.channel) && !vs.member?.user?.bot) inCall++;
  }
  const todayAgg = await PointTx.aggregate([
    { $match: { category: 'time', createdAt: { $gte: startOfDay() } } },
    { $group: { _id: null, sec: { $sum: '$seconds' }, pts: { $sum: '$amount' }, users: { $addToSet: '$userId' } } },
  ]);
  const t = todayAgg[0] || { sec: 0, pts: 0, users: [] };
  const events = await MovEvent.find({ enabled: true });
  const nexts = events
    .map((e) => ({ e, at: nextStart(e) }))
    .filter((x) => x.at)
    .sort((a, b) => a.at - b.at);
  const active = await MovOccurrence.find({ status: 'active', startsAt: { $lte: new Date() } });
  const me = findVoiceState(i.client, i.user.id);
  const embed = new EmbedBuilder()
    .setColor(COLORS.neutral)
    .setTitle(`${E('voice')} Mov Call - visão geral`)
    .addFields(
      { name: 'Em call agora', value: String(inCall), inline: true },
      {
        name: 'Hoje',
        value: `${fmtDuration(t.sec)} válidos • ${t.users.length} membro(s) • ${fmt(t.pts)} ${cfg.points.unit}`,
        inline: true,
      },
      { name: 'Temporada', value: season.name, inline: true },
      {
        name: 'Regra de tempo',
        value: `${fmt(cfg.points.perHour)} ${cfg.points.unit}/hora válida • mínimo ${cfg.voice.minSessionSec}s por sessão${cfg.points.dailyCap ? ` • limite diário ${fmt(cfg.points.dailyCap)}` : ''}`,
      },
      {
        name: `${E('mov')} MOV`,
        value: active.length
          ? `Em andamento: ${active.map((o) => `**${o.name}** (até ${ts(o.endsAt, 't')})`).join(', ')}`
          : nexts.length
            ? `Próximo: **${nexts[0].e.name}** ${ts(nexts[0].at, 'R')}`
            : 'Nenhum MOV cadastrado.',
      },
      {
        name: 'Você',
        value:
          me && isAuthorizedChannel(cfg, me.channel)
            ? `${E('ok')} Em call autorizada - tempo sendo contabilizado.`
            : 'Fora das calls autorizadas.',
      },
    )
    .setTimestamp();
  return i.editReply({ embeds: [embed] });
}

// /mov
async function movCommand(i) {
  await i.deferReply({ flags: 64 });
  const events = await MovEvent.find().sort({ time: 1 });
  const recent = await MovOccurrence.find({ status: 'done' }).sort({ startsAt: -1 }).limit(5);
  const active = await MovOccurrence.find({ status: 'active', startsAt: { $lte: new Date() } });
  const list = events.map((e) => {
    const n = nextStart(e);
    return `${e.enabled ? E('on') : E('off')} **${e.name}** - ${e.time} (${formatDays(e.days)}) • ${e.durationMin} min • mín. ${e.minMinutes} min • ${fmt(e.points)} ${getCfg().points.unit}${n && e.enabled ? ` • próximo ${ts(n, 'R')}` : ''}`;
  });
  const embed = new EmbedBuilder()
    .setColor(COLORS.neutral)
    .setTitle(`${E('mov')} MOVs oficiais`)
    .setDescription(trunc(list.join('\n') || 'Nenhum MOV cadastrado. A liderança cadastra em `/admin` → MOVs oficiais.', 4000));
  if (active.length)
    embed.addFields({ name: 'Em andamento', value: active.map((o) => `**${o.name}** até ${ts(o.endsAt, 't')}`).join('\n') });
  if (recent.length)
    embed.addFields({
      name: 'Últimos realizados',
      value: recent
        .map((o) => `${ts(o.startsAt, 'd')} **${o.name}** - ${o.participants} participante(s), ${o.rewarded} recompensado(s)`)
        .join('\n'),
    });
  return i.editReply({ embeds: [embed] });
}

// /pontos
async function pontosCommand(i) {
  const cfg = getCfg();
  const wrong = internalOnly(i);
  if (wrong) return i.reply(wrong);
  if (!perms(i.member, cfg).canPoints) return i.reply(deny(`${E('bad')} Você não tem permissão para gerenciar pontos.`));
  const sub = i.options.getSubcommand();
  const user = i.options.getUser('usuario');
  if (user.bot) return i.reply(deny(`${E('bad')} Escolha um membro, não um bot.`));
  const season = await getSeason();
  await i.deferReply({ flags: 64 });
  if (sub === 'consultar') return i.editReply({ embeds: [await userEmbed(cfg, user, season)] });

  const qty = i.options.getNumber('quantidade');
  const motivo = i.options.getString('motivo').trim();
  const cur = (await MemberStat.findOne({ userId: user.id, seasonId: season._id }).lean())?.crystals || 0;
  let delta = sub === 'adicionar' ? qty : sub === 'remover' ? -qty : qty - cur;
  delta = Math.round(delta * 100) / 100;
  if (!Number.isFinite(delta)) return i.editReply({ content: `${E('bad')} Quantidade inválida.` });
  if (sub !== 'definir' && qty <= 0) return i.editReply({ content: `${E('bad')} Use uma quantidade maior que zero.` });
  if (delta === 0) return i.editReply({ content: `${E('warn')} Nada a alterar - o total já é ${fmt(cur)}.` });
  const res = await awardPoints({
    key: `manual:${i.id}`,
    userId: user.id,
    tag: user.username,
    category: 'manual',
    amount: delta,
    reason: motivo,
    by: i.user.id,
  });
  if (res.duplicate) return i.editReply({ content: `${E('warn')} Esta alteração já havia sido aplicada.` });
  const novo = Math.round((cur + delta) * 100) / 100;
  await sendLog(
    i.client,
    'pontos',
    logEmbed(
      `${E('crystal')} Ajuste manual`,
      `**Por:** <@${i.user.id}>\n**Membro:** <@${user.id}>\n**Alteração:** ${delta > 0 ? '+' : ''}${fmt(delta)} (${sub})\n**Total na temporada:** ${fmt(cur)} → ${fmt(novo)}\n**Motivo:** ${motivo}`,
      delta > 0 ? COLORS.ok : COLORS.warn,
    ),
  );
  await audit(i.client, i.user, `Pontos: ${sub}`, `<@${user.id}>`, `${delta > 0 ? '+' : ''}${fmt(delta)} - ${motivo}`);
  checkMember(i.client, user.id, user.username).catch(() => {});
  scheduleRankingRefresh(i.client);
  return i.editReply({
    content: `${E('ok')} <@${user.id}>: ${fmt(cur)} → **${fmt(novo)}** ${cfg.points.unit} (${delta > 0 ? '+' : ''}${fmt(delta)}).`,
    allowedMentions: { parse: [] },
  });
}

// /relatorio
async function relatorioCommand(i) {
  const cfg = getCfg();
  const wrong = internalOnly(i);
  if (wrong) return i.reply(wrong);
  if (!perms(i.member, cfg).isLeader) return i.reply(deny(`${E('bad')} Apenas a liderança pode gerar relatórios.`));
  await i.deferReply({ flags: 64 });
  const periodo = i.options.getString('periodo') || '7d';
  const user = i.options.getUser('usuario');
  const season = await getSeason();
  const since =
    periodo === 'hoje'
      ? startOfDay()
      : periodo === '30d'
        ? new Date(Date.now() - 30 * DAY_MS)
        : periodo === 'temporada'
          ? season.startsAt
          : new Date(Date.now() - 7 * DAY_MS);
  const label = { hoje: 'Hoje', '7d': 'Últimos 7 dias', '30d': 'Últimos 30 dias', temporada: season.name }[periodo] || periodo;
  const match = { createdAt: { $gte: since } };
  if (user) match.userId = user.id;

  const [byCat, topRows, users, sessions, occs, mons] = await Promise.all([
    PointTx.aggregate([
      { $match: match },
      { $group: { _id: '$category', amount: { $sum: '$amount' }, seconds: { $sum: '$seconds' }, n: { $sum: 1 } } },
    ]),
    PointTx.aggregate([
      { $match: match },
      { $group: { _id: '$userId', amount: { $sum: '$amount' }, seconds: { $sum: '$seconds' } } },
      { $sort: { amount: -1 } },
      { $limit: 5 },
    ]),
    PointTx.distinct('userId', match),
    VoiceSession.countDocuments({ startedAt: { $gte: since }, status: 'done', ...(user ? { userId: user.id } : {}) }),
    user
      ? MovParticipation.countDocuments({ userId: user.id, rewarded: true, lastSeenAt: { $gte: since } })
      : MovOccurrence.countDocuments({ status: 'done', startsAt: { $gte: since } }),
    MonitorSession.aggregate([
      {
        $match: { startedAt: { $gte: since }, status: { $in: ['approved', 'rejected'] }, ...(user ? { targetId: user.id } : {}) },
      },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]),
  ]);
  const c = Object.fromEntries(byCat.map((r) => [r._id, r]));
  const total = byCat.reduce((a, r) => a + r.amount, 0);
  const mon = Object.fromEntries(mons.map((m) => [m._id, m.n]));
  const embed = new EmbedBuilder()
    .setColor(COLORS.neutral)
    .setTitle(`${E('report')} Relatório - ${label}${user ? ` • ${user.username}` : ''}`)
    .addFields(
      { name: 'Tempo válido', value: fmtDuration(c.time?.seconds || 0), inline: true },
      { name: 'Sessões', value: String(sessions), inline: true },
      { name: user ? 'MOVs recompensados' : 'MOVs realizados', value: String(occs), inline: true },
      {
        name: `${cfg.points.unit} concedidos`,
        value: `**${fmt(total)}** - tempo ${fmt(c.time?.amount || 0)} • MOV ${fmt(c.mov?.amount || 0)} • monitoria ${fmt(c.monitor?.amount || 0)} • metas ${fmt(c.goal?.amount || 0)} • ajustes ${fmt(c.manual?.amount || 0)}`,
      },
      { name: 'Monitorias', value: `${mon.approved || 0} aprovada(s) • ${mon.rejected || 0} reprovada(s)`, inline: true },
      { name: 'Membros com atividade', value: String(users.length), inline: true },
    )
    .setTimestamp();
  if (!user && topRows.length)
    embed.addFields({
      name: 'Top 5 do período',
      value: topRows.map((r, n) => `${n + 1}. <@${r._id}> - ${fmt(r.amount)} • ${fmtDuration(r.seconds)}`).join('\n'),
    });
  return i.editReply({ embeds: [embed] });
}

module.exports = { atividadeCommand, movcallCommand, movCommand, pontosCommand, relatorioCommand };
