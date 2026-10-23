'use strict';

const seasons = require('../seasons/service');
const points = require('../points/service');
const rankingService = require('./service');
const settings = require('../database/settings');
const { baseEmbed, COLORS } = require('../utils/embeds');
const { SEP, signed, num, pad2, progressBar } = require('../utils/format');
const { muted } = require('../utils/layout');
const { fmtDateTime } = require('../utils/time');

/** Perfil de pontuação (comando /perfil e /ranking ver user:). */
async function buildProfile(client, userId) {
  const tz = settings.get('timezone');
  const season = seasons.requireCurrent();
  const score = points.getScore(userId, season.id);
  const position = rankingService.getPosition(season.id, userId);
  const evo = points.getRecentDelta(userId, season.id);
  const weekly = points.getWeeklyEvolution(userId, season, 4);
  const user = await client.users.fetch(userId).catch(() => null);

  const embed = baseEmbed({
    title: 'Perfil de pontuação',
    color: COLORS.gold,
    footer: `Temporada #${pad2(season.number)}`,
    description: `<@${userId}>\n${muted(score.last_change_at ? `Última alteração: ${fmtDateTime(score.last_change_at, tz)}` : 'Sem alterações de pontos ainda')}\n${SEP}`,
  }).addFields(
    { name: 'Pontos', value: `**${num(score.points)}**`, inline: true },
    { name: 'Posição', value: position ? `**#${pad2(position)}**` : '—', inline: true },
    { name: 'Últimos 7 dias', value: `**${signed(evo)}**`, inline: true },
    { name: 'Recebidos', value: `${num(score.total_added)}`, inline: true },
    { name: 'Removidos', value: `${num(score.total_removed)}`, inline: true },
    { name: 'Alterações', value: `${num(score.changes)}`, inline: true }
  );

  if (weekly.length) {
    const max = Math.max(...weekly.map((w) => w.points), 1);
    embed.addFields({
      name: 'Evolução semanal',
      value: weekly.map((w) => `\`S${w.week}\` ${progressBar(w.points, max, 10)} **${num(w.points)}** pts`).join('\n'),
    });
  }
  if (user) embed.setThumbnail(user.displayAvatarURL({ size: 256 }));
  return embed;
}

module.exports = { buildProfile };
