'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { buildProfile } = require('../ranking/profile');
const { errorEmbed } = require('../utils/embeds');
const { EPHEMERAL } = require('../utils/interaction');

const data = new SlashCommandBuilder()
  .setName('perfil')
  .setDescription('Perfil de pontuação')
  .setDMPermission(false)
  .addUserOption((o) => o.setName('user').setDescription('Usuário (padrão: você)').setRequired(false));

async function execute(interaction) {
  const target = interaction.options.getUser('user') || interaction.user;
  if (target.bot) return interaction.reply({ embeds: [errorEmbed('Bots não participam do sistema de pontos.')], flags: EPHEMERAL });
  await interaction.deferReply();
  const embed = await buildProfile(interaction.client, target.id);
  return interaction.editReply({ embeds: [embed] });
}

module.exports = { scope: 'both', data, execute };
