'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { buildStatsEmbed } = require('../stats/ui');

const data = new SlashCommandBuilder().setName('estatisticas').setDescription('Estatísticas gerais do sistema de pontos').setDMPermission(false);

async function execute(interaction) {
  return interaction.reply({ embeds: [buildStatsEmbed()] });
}

module.exports = { scope: 'both', data, execute };
