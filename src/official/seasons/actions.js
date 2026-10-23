'use strict';

const seasons = require('./service');
const settings = require('../database/settings');
const logs = require('../logs');
const roles = require('../roles/service');
const publisher = require('../ranking/publisher');
const { baseEmbed, COLORS } = require('../utils/embeds');
const { fmtDateTime } = require('../utils/time');
const { seasonLabel, num } = require('../utils/format');

let resetting = false;

/**
 * Encerra a temporada atual e inicia a próxima. Usado pelo reset manual e pelo semanal.
 * Protegido contra execução simultânea.
 */
async function resetSeason({ actorId = null, reason = 'Reset manual', auto = false } = {}) {
  if (resetting) throw new Error('Já existe um reset em andamento.');
  resetting = true;
  try {
    const result = seasons.closeAndStartNew({ actorId, reason });
    const tz = settings.get('timezone');
    const { closed, created, stats } = result;

    const winner = stats.winner ? `<@${stats.winner.user_id}> — **${num(stats.winner.points)}** pts` : '—';
    const embed = baseEmbed({
      title: auto ? 'Reset semanal automático' : 'Ranking resetado',
      color: COLORS.warning,
      footer: logs.LOG_FOOTER,
      description: [
        `🏁 **Temporada encerrada:** ${seasonLabel(closed.number)}`,
        `🆕 **Nova temporada:** ${seasonLabel(created.number)}`,
        `👮 **Responsável:** ${actorId ? `<@${actorId}>` : 'Sistema (automático)'}`,
        `📝 **Motivo:** ${reason}`,
        `🕐 **Data:** ${fmtDateTime(created.started_at, tz)}`,
        '',
        `👥 Participantes no ranking: **${stats.ranked}**`,
        `⭐ Pontos distribuídos: **${num(stats.total_added)}**`,
        `🏆 Campeão: ${winner}`,
      ].join('\n'),
    });

    await logs.logEvent({
      category: 'ranking',
      action: auto ? 'reset_auto' : 'reset_manual',
      actorId,
      summary: `Temporada ${seasonLabel(closed.number)} encerrada; ${seasonLabel(created.number)} iniciada`,
      details: { closed: closed.number, created: created.number, stats },
      embed,
      mirror: ['admin'],
    });
    await logs.logEvent({
      category: 'admin',
      action: 'season_created',
      actorId,
      summary: `Temporada ${seasonLabel(created.number)} criada`,
      embed: baseEmbed({
        title: 'Temporada criada',
        description: `Temporada **${seasonLabel(created.number)}** iniciada em ${fmtDateTime(created.started_at, tz)}.`,
        color: COLORS.success,
        footer: logs.LOG_FOOTER,
      }),
      mirror: [],
    });

    publisher.scheduleRefresh(1000);

    // Na nova temporada todos começam do zero: remove os cargos por pontuação (em segundo plano).
    if (settings.get('roles_enabled') && settings.get('roles_clear_on_reset')) {
      roles.clearMembers(result.userIds).catch((e) => console.error('[roles] limpeza pós-reset:', e.message));
    }
    return result;
  } finally {
    resetting = false;
  }
}

module.exports = { resetSeason };
