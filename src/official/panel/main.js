'use strict';

const seasons = require('../seasons/service');
const settings = require('../database/settings');
const { baseEmbed, COLORS } = require('../utils/embeds');
const { humanDuration, pad2, SEP } = require('../utils/format');
const { WEEKDAYS } = require('../utils/time');
const { row, button, ButtonStyle } = require('../utils/interaction');
const { onOff } = require('./util');
const { h, muted } = require('../utils/layout');

const LINE = SEP;

/** Menu principal do painel administrativo. */
function render() {
  const season = seasons.requireCurrent();
  const weekly = settings.get('reset_enabled')
    ? `${WEEKDAYS[settings.get('reset_day')]} às ${settings.get('reset_time')}`
    : 'desativado';
  const embed = baseEmbed({
    title: 'Painel administrativo',
    color: COLORS.brand,
    timestamp: false,
    footer: `Temporada #${pad2(season.number)} · Reset semanal: ${weekly}`,
    description: [
      muted('Selecione uma área para gerenciar.'),
      LINE,
      h('Operação'),
      '**Ranking** · reset, temporadas e histórico',
      '**Pontos** · adicionar, remover, definir e consultar',
      '**Bate-ponto** · regras, canais e painel de iniciar',
      h('Aparência e comunicação'),
      '**Aparência** · título, rodapé, cor e banner do ranking',
      '**Visual** · tema, painéis e mensagens no privado',
      h('Administração'),
      '**Sistema** · servidores, fuso, banco e backup',
      '**Permissões** · quem pode usar cada função',
      '**Estatísticas** · pontos e bate-pontos',
      '**Logs** · canais e registros',
      '**Cargos** · cargos automáticos por pontuação',
      LINE,
      `Bate-ponto **${onOff(settings.get('bp_enabled'))}** · ${humanDuration(settings.get('bp_duration_min') * 60000)} · meta ${settings.get('bp_goal')} msgs · +${settings.get('bp_reward')} pts`,
    ].join('\n'),
  });
  return {
    embeds: [embed],
    components: [
      row(
        button('panel:ranking:view', 'Ranking', { emoji: '🏆', style: ButtonStyle.Primary }),
        button('panel:points:view', 'Pontos', { emoji: '⭐', style: ButtonStyle.Primary }),
        button('panel:bateponto:view', 'Bate-ponto', { emoji: '⏱️', style: ButtonStyle.Primary }),
        button('panel:appearance:view', 'Aparência', { emoji: '🎨' }),
        button('panel:visual:view', 'Visual', { emoji: '🖌️' })
      ),
      row(
        button('panel:system:view', 'Sistema', { emoji: '⚙️' }),
        button('panel:perms:view', 'Permissões', { emoji: '🔐' }),
        button('panel:stats:view', 'Estatísticas', { emoji: '📊' }),
        button('panel:logs:view', 'Logs', { emoji: '📝' }),
        button('panel:roles:view', 'Cargos', { emoji: '🏅' })
      ),
      row(button('panel:ranking:reset', 'Resetar ranking', { emoji: '🔄', style: ButtonStyle.Danger })),
    ],
  };
}

module.exports = { render, LINE, SEP };
