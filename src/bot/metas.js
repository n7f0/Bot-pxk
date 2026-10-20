const { EmbedBuilder } = require('discord.js');
const { Goal, GoalCompletion, PointTx, getSeason } = require('./db');
const { COLORS, periodRange, fmt, ts, sendLog, logEmbed, deny, eph } = require('./core');
const { awardPoints } = require('./points');
const { E } = require('./emojis');

const TYPE_LABEL = {
  hours: 'Horas válidas em call',
  movs: 'MOVs oficiais',
  monitors: 'Monitorias válidas',
  points: 'Cristais ganhos',
};
const SCOPE_LABEL = { individual: 'Individual', collective: 'Coletiva' };
const PERIOD_LABEL = { daily: 'Diária', weekly: 'Semanal', monthly: 'Mensal', season: 'Da temporada' };

// soma por membro dentro da janela do período
async function aggregate(goal, range, userId = null) {
  const match = { createdAt: { $gte: range.start, $lt: range.end } };
  let val = { $sum: 1 };
  if (goal.type === 'hours') {
    match.category = 'time';
    val = { $sum: '$seconds' };
  } else if (goal.type === 'movs') match.category = 'mov';
  else if (goal.type === 'monitors') match.category = 'monitor';
  else {
    match.category = { $in: ['time', 'mov', 'monitor'] };
    match.amount = { $gt: 0 };
    val = { $sum: '$amount' };
  }
  if (userId) match.userId = userId;
  const rows = await PointTx.aggregate([{ $match: match }, { $group: { _id: '$userId', v: val, tag: { $last: '$tag' } } }]);
  const scale = goal.type === 'hours' ? 1 / 3600 : 1;
  return rows.map((r) => ({ userId: r._id, tag: r.tag, value: r.v * scale }));
}

async function completeFor(client, goal, range, userId, tag) {
  if (goal.maxCompletions > 0) {
    const done = await GoalCompletion.countDocuments({ goalId: goal._id, userId });
    if (done >= goal.maxCompletions) return false;
  }
  const key = `goal:${goal._id}:${range.key}:${userId}`;
  const res = await awardPoints({
    key,
    userId,
    tag,
    category: 'goal',
    amount: goal.reward,
    reason: `Meta: ${goal.name}`,
    refId: goal._id,
  });
  if (res.duplicate) return false;
  await GoalCompletion.updateOne(
    { key },
    { $setOnInsert: { goalId: goal._id, userId, periodKey: range.key, reward: goal.reward } },
    { upsert: true },
  ).catch(() => {});
  await sendLog(
    client,
    'geral',
    logEmbed(
      `${E('goal')} Meta concluída`,
      `<@${userId}> concluiu **${goal.name}** (${PERIOD_LABEL[goal.period]}).\n**Recompensa:** ${fmt(goal.reward)}`,
      COLORS.ok,
    ),
  );
  return true;
}

async function checkMember(client, userId, tag) {
  const goals = await Goal.find({ enabled: true, scope: 'individual' });
  if (!goals.length) return;
  const season = await getSeason();
  for (const g of goals) {
    const range = periodRange(g.period, new Date(), season);
    const [row] = await aggregate(g, range, userId);
    if ((row?.value || 0) >= g.target) await completeFor(client, g, range, userId, tag);
  }
}

async function checkCollective(client) {
  const goals = await Goal.find({ enabled: true, scope: 'collective' });
  if (!goals.length) return;
  const season = await getSeason();
  for (const g of goals) {
    const range = periodRange(g.period, new Date(), season);
    const markerKey = `goalc:${g._id}:${range.key}`;
    if (await GoalCompletion.exists({ key: markerKey })) continue;
    const rows = await aggregate(g, range, null);
    const total = rows.reduce((a, r) => a + r.value, 0);
    if (total < g.target) continue;
    for (const r of rows.filter((x) => x.value > 0)) await completeFor(client, g, range, r.userId, r.tag);
    await GoalCompletion.updateOne(
      { key: markerKey },
      { $setOnInsert: { goalId: g._id, userId: 'coletivo', periodKey: range.key, reward: g.reward } },
      { upsert: true },
    );
    await sendLog(
      client,
      'geral',
      logEmbed(`${E('goal')} Meta coletiva concluída`, `**${g.name}** foi atingida por ${rows.length} membro(s).`, COLORS.ok),
    );
  }
}

const bar = (p) => {
  const n = Math.round(Math.max(0, Math.min(1, p)) * 10);
  return '▰'.repeat(n) + '▱'.repeat(10 - n);
};
const fmtVal = (g, v) => (g.type === 'hours' ? `${fmt(v)}h` : fmt(v));

async function metasCommand(i) {
  await i.deferReply({ flags: 64 });
  const goals = await Goal.find({ enabled: true }).sort({ period: 1, name: 1 });
  if (!goals.length) return i.editReply({ content: 'Nenhuma meta está ativa no momento.' });
  const season = await getSeason();
  const embed = new EmbedBuilder()
    .setColor(COLORS.neutral)
    .setTitle(`${E('goal')} Metas e progresso`)
    .setTimestamp();
  for (const g of goals.slice(0, 20)) {
    const range = periodRange(g.period, new Date(), season);
    const rows = await aggregate(g, range, g.scope === 'collective' ? null : i.user.id);
    const value = g.scope === 'collective' ? rows.reduce((a, r) => a + r.value, 0) : rows[0]?.value || 0;
    const done = value >= g.target;
    const mine = g.scope === 'collective' ? rows.find((r) => r.userId === i.user.id)?.value || 0 : null;
    const lines = [
      `${bar(value / g.target)} **${fmtVal(g, Math.min(value, g.target))} / ${fmtVal(g, g.target)}** ${done ? E('ok') : ''}`,
      `${TYPE_LABEL[g.type]} • ${SCOPE_LABEL[g.scope]} • ${PERIOD_LABEL[g.period]} • Recompensa: **${fmt(g.reward)}**`,
    ];
    if (g.scope === 'collective') lines.push(`Sua contribuição: ${fmtVal(g, mine)}`);
    if (g.period !== 'season' && range.end.getTime() < 8e15) lines.push(`Renova ${ts(range.end, 'R')}`);
    if (g.description) lines.push(`*${g.description}*`);
    embed.addFields({ name: g.name.slice(0, 250), value: lines.join('\n').slice(0, 1020) });
  }
  return i.editReply({ embeds: [embed] });
}

module.exports = { TYPE_LABEL, SCOPE_LABEL, PERIOD_LABEL, aggregate, checkMember, checkCollective, metasCommand };
