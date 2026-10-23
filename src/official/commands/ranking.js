'use strict';

const { SlashCommandBuilder } = require('discord.js');
const ui = require('../ranking/ui');
const rankingService = require('../ranking/service');
const seasons = require('../seasons/service');
const publisher = require('../ranking/publisher');
const { errorEmbed } = require('../utils/embeds');
const { EPHEMERAL } = require('../utils/interaction');

// O Discord não permite misturar opções soltas com subcomandos, por isso:
//   /ranking ver [user]   -> ranking paginado (opcionalmente na página do usuário)
//   /ranking temporadas   -> lista de temporadas
const data = new SlashCommandBuilder()
  .setName('ranking')
  .setDescription('Ranking de pontos')
  .setDMPermission(false)
  .addSubcommand((s) =>
    s
      .setName('ver')
      .setDescription('Mostra o ranking de pontos da temporada atual')
      .addUserOption((o) => o.setName('user').setDescription('Mostrar a página em que este usuário aparece').setRequired(false))
  )
  .addSubcommand((s) => s.setName('temporadas').setDescription('Histórico de temporadas e seus rankings'));

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  await interaction.deferReply();

  if (sub === 'temporadas') {
    return interaction.editReply(ui.buildSeasonsList({ ownerId: interaction.user.id }));
  }

  const target = interaction.options.getUser('user');
  const season = seasons.requireCurrent();
  if (target?.bot) return interaction.editReply({ embeds: [errorEmbed('Bots não participam do ranking.')] });

  let page = 1;
  if (target) {
    const pos = rankingService.getPosition(season.id, target.id);
    if (pos) page = rankingService.pageOfPosition(pos, ui.getPerPage());
  }
  const params = {
    seasonId: season.id,
    page,
    viewerId: target ? target.id : interaction.user.id,
    viewerIsTarget: Boolean(target && target.id !== interaction.user.id),
    ownerId: interaction.user.id,
    guildId: interaction.guildId,
  };
  const payload = await ui.buildRanking(interaction.client, params);
  const msg = await interaction.editReply(payload);
  // A mensagem do ranking passa a se atualizar sozinha enquanto estiver aberta.
  if (msg?.id) publisher.track(msg.id, interaction, params, payload);
  return msg;
}

module.exports = { scope: 'both', data, execute };
