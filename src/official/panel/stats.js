'use strict';

const { buildStatsEmbed } = require('../stats/ui');
const { row, button } = require('../utils/interaction');
const { menuButton } = require('./util');

/** Dashboard de estatísticas dentro do painel. */
function render() {
  return { embeds: [buildStatsEmbed({ withTop: true })], components: [row(button('panel:stats:view', 'Atualizar', { emoji: '🔄' }), menuButton())] };
}

async function handle(interaction, action) {
  if (action === 'view') return interaction.update(render());
}

module.exports = { render, handle };
