'use strict';

const { requirePermission, requireInternalGuild } = require('../permissions');
const { EPHEMERAL } = require('../utils/interaction');
const main = require('./main');

const sections = {
  ranking: require('./ranking'),
  points: require('./points'),
  bateponto: require('./bateponto'),
  perms: require('./permissions'),
  logs: require('./logs'),
  roles: require('./roles'),
  system: require('./system'),
  appearance: require('./appearance'),
  visual: require('./visual'),
  stats: require('./stats'),
};

/** /painel */
async function open(interaction) {
  if (!(await requireInternalGuild(interaction))) return;
  if (!(await requirePermission(interaction, 'open_panel'))) return;
  return interaction.reply({ ...main.render(), flags: EPHEMERAL });
}

/** Todas as interações com customId "panel:<seção>:<ação>[:args]" (botões, menus e modais). */
async function handle(interaction) {
  if (!(await requireInternalGuild(interaction))) return;
  if (!(await requirePermission(interaction, 'open_panel'))) return;

  const [, section, action, ...args] = interaction.customId.split(':');
  if (section === 'menu') return interaction.update(main.render());
  const mod = sections[section];
  if (!mod) return;
  return mod.handle(interaction, action, args);
}

module.exports = { open, handle };
