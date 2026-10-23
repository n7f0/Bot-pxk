'use strict';

const statsService = require('./service');
const rankingService = require('../ranking/service');
const settings = require('../database/settings');
const { baseEmbed, COLORS } = require('../utils/embeds');
const { SEP, num, pad2, posEmoji } = require('../utils/format');
const { muted } = require('../utils/layout');
const { fmtDate } = require('../utils/time');

/** Dashboard de estatísticas (comando /estatisticas e painel administrativo). */
function buildStatsEmbed({ withTop = false } = {}) {
  const { season, season_stats: s, bateponto_all: bp, total_users: users } = statsService.getGlobalStats();
  const tz = settings.get('timezone');
  const embed = baseEmbed({
    title: 'Estatísticas',
    color: COLORS.brand,
    footer: `Temporada #${pad2(season.number)}`,
    description: `${muted(`Temporada #${pad2(season.number)} desde ${fmtDate(season.started_at, tz)}`)}\n${SEP}`,
  }).addFields(
    { name: 'No ranking', value: `**${num(s.ranked)}** de ${num(users)}`, inline: true },
    { name: 'Maior pontuação', value: `**${num(s.max_points)}**`, inline: true },
    { name: 'Média de pontos', value: `**${num(s.avg_points)}**`, inline: true },
    { name: 'Distribuídos', value: `+${num(s.total_added)}`, inline: true },
    { name: 'Removidos', value: `−${num(s.total_removed)}`, inline: true },
    { name: 'Alterações', value: `${num(s.changes)}`, inline: true },
    { name: 'Bate-pontos realizados', value: `**${num(bp.approved + bp.rejected)}**`, inline: true },
    { name: 'Aprovados · Reprovados', value: `${num(bp.approved)} · ${num(bp.rejected)}`, inline: true },
    { name: 'Em andamento', value: `**${num(bp.active)}**`, inline: true }
  );

  if (withTop) {
    const top = rankingService.getPage(season.id, 1, 5);
    const totals = rankingService.getMessageTotals(top.map((r) => r.user_id), season);
    const lines = top.length
      ? top.map((r) => `${require('../ranking/emojis').mark(r.position)}  <@${r.user_id}> · **${num(r.points)} pts** · \`${num(totals.get(r.user_id)?.messages || 0)} msgs\``)
      : ['*Sem pontuações nesta temporada.*'];
    embed.addFields({ name: 'Top 5 da temporada', value: lines.join('\n') });
  }
  return embed;
}

module.exports = { buildStatsEmbed };
