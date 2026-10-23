'use strict';

const { SlashCommandBuilder } = require('discord.js');
const panel = require('../panel');

const data = new SlashCommandBuilder().setName('painel').setDescription('Abre o painel administrativo').setDMPermission(false);

async function execute(interaction) {
  return panel.open(interaction);
}

module.exports = { scope: 'internal', data, execute };
