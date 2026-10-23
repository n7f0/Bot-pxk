const { SlashCommandBuilder } = require('discord.js');
const formulario = require('./formulario');

module.exports = [
  new SlashCommandBuilder().setName('admin-recrutamento').setDescription('Painel administrativo do recrutamento PXK').setDMPermission(false).toJSON(),
  new SlashCommandBuilder().setName('ajustar').setDescription('Ajustar manualmente recrutamentos, migrações, plantões e pontos').setDMPermission(false)
    .addUserOption((o) => o.setName('usuario').setDescription('Recrutador').setRequired(true))
    .addIntegerOption((o) => o.setName('recrutamentos').setDescription('Total de recrutamentos (valor final)').setMinValue(0).setMaxValue(100000))
    .addIntegerOption((o) => o.setName('migracoes').setDescription('Total de migrações (valor final)').setMinValue(0).setMaxValue(100000))
    .addIntegerOption((o) => o.setName('plantoes').setDescription('Total de plantões (valor final)').setMinValue(0).setMaxValue(100000))
    .addIntegerOption((o) => o.setName('pontos').setDescription('Total de pontos (valor final)').setMinValue(0).setMaxValue(10000000))
    .toJSON(),
  new SlashCommandBuilder().setName('emojis').setDescription('Configurar emojis dos painéis de recrutamento e tickets').setDMPermission(false).toJSON(),
  new SlashCommandBuilder().setName('admin-classico').setDescription('Painel administrativo clássico do recrutamento e tickets').setDMPermission(false).toJSON(),
  new SlashCommandBuilder().setName('ranking-recrutamento').setDescription('Ranking de recrutamento e estatísticas de um recrutador').setDMPermission(false)
    .addUserOption((o) => o.setName('usuario').setDescription('Ver estatísticas de um recrutador')).toJSON(),
  ...formulario.commands,
];
