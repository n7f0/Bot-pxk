'use strict';

const { Events } = require('discord.js');
const config = require('../config');
const panel = require('../panel');
const rankingHandler = require('../ranking/handler');
const bpHandler = require('../bateponto/handler');
const pointsHandler = require('../points/handler');
const { errorEmbed } = require('../utils/embeds');
const { EPHEMERAL } = require('../utils/interaction');

async function reportError(interaction, err) {
  console.error('[interaction] erro:', err);
  const payload = { embeds: [errorEmbed('Ocorreu um erro inesperado ao executar esta ação. Tente novamente.')], flags: EPHEMERAL };
  try {
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
    else await interaction.reply(payload);
  } catch {
    /* interação expirada */
  }
}

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    try {
      // O bot só atua nos dois servidores configurados.
      if (!interaction.guildId || !config.isKnownGuild(interaction.guildId)) {
        if (interaction.isRepliable()) {
          await interaction.reply({ content: '❌ Este bot não está autorizado neste servidor.', flags: EPHEMERAL });
        }
        return;
      }

      if (interaction.isChatInputCommand()) {
        const command = interaction.client.commands.get(interaction.commandName);
        if (!command) return;
        if (command.scope === 'internal' && !config.isInternal(interaction.guildId)) {
          return interaction.reply({ content: '❌ Este comando só existe no servidor interno.', flags: EPHEMERAL });
        }
        if (command.scope === 'external' && !config.isExternal(interaction.guildId)) {
          return interaction.reply({ content: '❌ Este comando só existe no servidor externo.', flags: EPHEMERAL });
        }
        return await command.execute(interaction);
      }

      if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
        const prefix = interaction.customId.split(':')[0];
        if (prefix === 'panel') return await panel.handle(interaction);
        if (prefix === 'rk') return await rankingHandler.handleComponent(interaction);
        if (prefix === 'bp') return await bpHandler.handleComponent(interaction);
        if (prefix === 'hist') return await pointsHandler.handleComponent(interaction);
      }
    } catch (err) {
      await reportError(interaction, err);
    }
  },
};
