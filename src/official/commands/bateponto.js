'use strict';

const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { requirePermission } = require('../permissions');
const actions = require('../bateponto/actions');
const ui = require('../bateponto/ui');
const service = require('../bateponto/service');
const config = require('../config');
const { successEmbed, errorEmbed } = require('../utils/embeds');
const { EPHEMERAL } = require('../utils/interaction');

const data = new SlashCommandBuilder()
  .setName('bateponto')
  .setDescription('Sistema de bate-ponto')
  .setDMPermission(false)
  .addSubcommand((s) =>
    s
      .setName('painel')
      .setDescription('Publica o painel de bate-ponto (servidor interno)')
      .addChannelOption((o) =>
        o.setName('canal').setDescription('Canal do painel (padrão: canal atual)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(false)
      )
  )
  .addSubcommand((s) => s.setName('status').setDescription('Mostra o seu bate-ponto atual'));

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'status') {
    const s = service.getActiveByUser(interaction.user.id);
    if (!s) return interaction.reply({ embeds: [errorEmbed('Você não possui bate-ponto ativo.', 'Bate-ponto')], flags: EPHEMERAL });
    return interaction.reply({ ...ui.buildActivePanel(s), flags: EPHEMERAL });
  }

  if (interaction.guildId !== config.internalGuildId) {
    return interaction.reply({ embeds: [errorEmbed('O painel de bate-ponto é publicado no **servidor interno**.')], flags: EPHEMERAL });
  }
  if (!(await requirePermission(interaction, 'manage_bateponto'))) return;

  const channel = interaction.options.getChannel('canal') || interaction.channel;
  try {
    await actions.publishPanel(channel);
    return interaction.reply({ embeds: [successEmbed(`Painel publicado em <#${channel.id}>.`)], flags: EPHEMERAL });
  } catch (err) {
    return interaction.reply({ embeds: [errorEmbed(`Não consegui publicar o painel: ${err.message}`)], flags: EPHEMERAL });
  }
}

module.exports = { scope: 'both', data, execute };
