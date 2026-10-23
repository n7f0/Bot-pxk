'use strict';

const ui = require('./ui');
const rankingService = require('./service');
const publisher = require('./publisher');
const { EPHEMERAL } = require('../utils/interaction');

/**
 * Interações do ranking (customId): 
 *  rk:go:<seasonId>:<page>:<ownerId>   rk:me:<seasonId>:<ownerId>
 *  rk:seasons:<ownerId>               rk:pick:<ownerId> (select)
 * Os botões editam a MESMA mensagem. Se outra pessoa clicar, ela recebe uma cópia ephemeral.
 */
async function handleComponent(interaction) {
  const parts = interaction.customId.split(':');
  const action = parts[1];
  const clicker = interaction.user.id;
  let ownerId;
  let payload;

  if (action === 'go') {
    const [, , seasonId, page, owner] = parts;
    ownerId = owner;
    payload = await ui.buildRanking(interaction.client, {
      seasonId: Number(seasonId),
      page: Number(page),
      viewerId: clicker,
      ownerId: clicker,
      guildId: interaction.guildId,
    });
  } else if (action === 'me') {
    const [, , seasonId, owner] = parts;
    ownerId = owner;
    const pos = rankingService.getPosition(Number(seasonId), clicker);
    if (pos && pos > rankingService.maxMembers()) {
      return interaction.reply({ content: `🏆 Você está na posição **#${pos}**, fora do Top ${rankingService.maxMembers()} exibido no ranking.`, flags: EPHEMERAL });
    }
    if (!pos) {
      return interaction.reply({ content: '🏆 Você ainda não possui pontos nesta temporada.', flags: EPHEMERAL });
    }
    payload = await ui.buildRanking(interaction.client, {
      seasonId: Number(seasonId),
      page: rankingService.pageOfPosition(pos, ui.getPerPage()),
      viewerId: clicker,
      ownerId: clicker,
      guildId: interaction.guildId,
    });
  } else if (action === 'seasons') {
    ownerId = parts[2];
    payload = ui.buildSeasonsList({ ownerId: clicker });
  } else if (action === 'pick') {
    ownerId = parts[2];
    payload = await ui.buildRanking(interaction.client, {
      seasonId: Number(interaction.values[0]),
      page: 1,
      viewerId: clicker,
      ownerId: clicker,
      guildId: interaction.guildId,
    });
  } else {
    return;
  }

  if (clicker === ownerId) {
    publisher.untrack(interaction.message.id);
    await interaction.update(payload);
  }
  else await interaction.reply({ ...payload, flags: EPHEMERAL | payload.flags });
}

module.exports = { handleComponent };
