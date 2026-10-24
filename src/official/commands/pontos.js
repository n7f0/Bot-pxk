'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { requirePermission, requireInternalGuild } = require('../permissions');
const actions = require('../points/actions');
const service = require('../points/service');
const ui = require('../points/ui');
const rankingService = require('../ranking/service');
const seasons = require('../seasons/service');
const settings = require('../database/settings');
const config = require('../config');
const { baseEmbed, errorEmbed, COLORS } = require('../utils/embeds');
const { EPHEMERAL } = require('../utils/interaction');
const { fmtDateTime } = require('../utils/time');
const { num, pad2 } = require('../utils/format');

const addUser = (o) => o.setName('user').setDescription('Usuário').setRequired(true);
const addMotivo = (o) => o.setName('motivo').setDescription('Motivo da alteração').setMaxLength(300).setRequired(false);
const addPontos = (min) => (o) =>
  o.setName('pontos').setDescription('Quantidade de pontos').setRequired(true).setMinValue(min).setMaxValue(config.limits.maxPoints);

const data = new SlashCommandBuilder()
  .setName('pontos')
  .setDescription('Gerenciamento de pontos')
  .setDMPermission(false)
  .addSubcommand((s) => s.setName('adicionar').setDescription('Adiciona pontos a um usuário').addUserOption(addUser).addIntegerOption(addPontos(1)).addStringOption(addMotivo))
  .addSubcommand((s) => s.setName('remover').setDescription('Remove pontos de um usuário').addUserOption(addUser).addIntegerOption(addPontos(1)).addStringOption(addMotivo))
  .addSubcommand((s) => s.setName('definir').setDescription('Define exatamente os pontos de um usuário').addUserOption(addUser).addIntegerOption(addPontos(0)).addStringOption(addMotivo))
  .addSubcommand((s) => s.setName('consultar').setDescription('Mostra pontos e posição no ranking').addUserOption(addUser))
  .addSubcommand((s) => s.setName('histórico').setDescription('Histórico de alterações de pontos').addUserOption(addUser));

const PERM = { adicionar: 'manage_points', remover: 'remove_points', definir: 'set_points' };
const MODE = { adicionar: 'add', remover: 'remove', definir: 'set' };

async function execute(interaction) {
  if (!(await requireInternalGuild(interaction))) return;
  const sub = interaction.options.getSubcommand();
  const target = interaction.options.getUser('user', true);

  if (target.bot) {
    return interaction.reply({ embeds: [errorEmbed('Bots não participam do sistema de pontos.')], flags: EPHEMERAL });
  }

  if (PERM[sub]) {
    if (!(await requirePermission(interaction, PERM[sub]))) return;
    const amount = interaction.options.getInteger('pontos', true);
    const reason = interaction.options.getString('motivo')?.trim() || null;
    // CORREÇÃO: respostas administrativas devem ser ephemeral
    // (deferReply sem flags deixava o "pensando..." público).
    await interaction.deferReply({ flags: EPHEMERAL });
    try {
      const entry = await actions.changePoints({
        userId: target.id,
        actorId: interaction.user.id,
        mode: MODE[sub],
        amount,
        reason,
        type: sub,
        guildId: interaction.guildId,
      });
      return interaction.editReply({ embeds: [ui.buildChangeEmbed(entry)] });
    } catch (err) {
      return interaction.editReply({ embeds: [errorEmbed(err.message)] });
    }
  }

  // consultar / histórico: o próprio usuário ou quem tem permissão
  if (target.id !== interaction.user.id && !(await requirePermission(interaction, 'manage_points'))) return;

  if (sub === 'consultar') {
    const season = seasons.requireCurrent();
    const score = service.getScore(target.id, season.id);
    const pos = rankingService.getPosition(season.id, target.id);
    const embed = baseEmbed({
      title: 'Consulta de pontos',
      color: COLORS.gold,
      footer: `Temporada #${pad2(season.number)}`,
      description: `<@${target.id}>\n-# Última alteração: ${fmtDateTime(score.last_change_at, settings.get('timezone'))}`,
    }).addFields(
      { name: 'Pontos atuais', value: `**${num(score.points)}**`, inline: true },
      { name: 'Posição', value: pos ? `**#${pad2(pos)}**` : '—', inline: true }
    );
    return interaction.reply({ embeds: [embed], flags: EPHEMERAL });
  }

  if (sub === 'histórico') {
    const payload = ui.buildHistoryPage(service, { userId: target.id, page: 1, ownerId: interaction.user.id });
    return interaction.reply({ ...payload, flags: EPHEMERAL });
  }
}

module.exports = { scope: 'internal', data, execute };