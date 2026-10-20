const { Season, MemberStat, ensureSeason, getSeason, resetSeasonCache } = require('./db');
const { sendLog, logEmbed, COLORS } = require('./core');
const { E } = require('./emojis');
const { getCfg, setCfg } = require('./db');
const { refreshRanking } = require('./ranking');

async function startNewSeason(client, { name = null, endsAt = null, by = null } = {}) {
  const cur = await getSeason();
  const top = await MemberStat.find({ seasonId: cur._id, crystals: { $ne: 0 } })
    .sort({ crystals: -1 })
    .limit(100)
    .lean();
  await Season.updateOne(
    { _id: cur._id },
    {
      $set: {
        status: 'ended',
        endedAt: new Date(),
        snapshot: top.map((t) => ({
          userId: t.userId,
          tag: t.tag,
          crystals: t.crystals,
          voiceSec: t.voiceSec,
          movs: t.movs,
          mcDone: t.mcDone || 0,
          monitorPoints: t.monitorPoints || 0,
        })),
      },
    },
  );
  const number = (cur.number || 0) + 1;
  const next = await Season.create({ number, name: name || `Temporada ${number}`, endsAt });
  resetSeasonCache();
  await ensureSeason();
  const medal =
    top
      .slice(0, 10)
      .map((t, i) => `${i < 3 ? E(`rank${i + 1}`) : `**${i + 1}º**`} <@${t.userId}> - ${t.crystals}`)
      .join('\n') || 'Sem pontuações.';
  const embed = logEmbed(
    `${E('season')} Nova temporada: ${next.name}`,
    `**${cur.name}** foi encerrada.\n\n**Top 10 final:**\n${medal}\n\nO ranking completo (top 100) ficou salvo no banco de dados.${by ? `\n\nIniciada por <@${by}>.` : '\n\nReset automático.'}`,
    COLORS.ok,
  );
  await sendLog(client, 'geral', embed);
  await sendLog(client, 'pontos', embed);
  refreshRanking(client).catch(() => {}); // mensagem fixa já aparece zerada
  return next;
}

function weekKey(now, weekday, hour) {
  const brt = new Date(now.getTime() - 3 * 3600_000);
  let back = (brt.getUTCDay() - weekday + 7) % 7;
  if (back === 0 && brt.getUTCHours() < hour) back = 7;
  const d = new Date(Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth(), brt.getUTCDate() - back, hour));
  return d.toISOString().slice(0, 13);
}

async function tickSeasons(client) {
  const w = getCfg().seasons || {};
  if (w.weeklyReset) {
    const key = weekKey(new Date(), Number(w.weekday) || 0, Math.min(23, Math.max(0, Number(w.hour) || 0)));
    if (!w.lastKey)
      await setCfg('seasons.lastKey', key); // primeira vez: só marca a semana atual
    else if (w.lastKey !== key) {
      await setCfg('seasons.lastKey', key); // marca antes para nunca resetar duas vezes
      await startNewSeason(client, {});
      return;
    }
  }
  const cur = await getSeason();
  if (cur.endsAt && new Date() >= cur.endsAt) await startNewSeason(client, {});
}

module.exports = { startNewSeason, tickSeasons, weekKey };
