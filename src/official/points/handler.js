'use strict';

const service = require('./service');
const ui = require('./ui');
const { EPHEMERAL } = require('../utils/interaction');
const { requirePermission } = require('../permissions');

/** Botões do histórico: hist:<userId>:<page>:<ownerId> */
async function handleComponent(interaction) {
  const [, userId, pageStr, ownerId] = interaction.customId.split(':');
  const page = Number(pageStr) || 1;
  const isOwner = interaction.user.id === ownerId;

  // O histórico de terceiros só pode ser consultado por quem tem permissão.
  if (userId !== interaction.user.id && !(await requirePermission(interaction, 'manage_points'))) return;

  const payload = ui.buildHistoryPage(service, {
    userId,
    page,
    ownerId: interaction.user.id,
    withMenu: interaction.message?.components?.[0]?.components?.length === 3,
  });
  if (isOwner) await interaction.update(payload);
  else await interaction.reply({ ...payload, flags: EPHEMERAL });
}

module.exports = { handleComponent };
