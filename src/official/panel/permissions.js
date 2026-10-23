'use strict';

const { StringSelectMenuBuilder, RoleSelectMenuBuilder } = require('discord.js');
const permService = require('../permissions/service');
const config = require('../config');
const { requirePermission } = require('../permissions');
const { baseEmbed, COLORS } = require('../utils/embeds');
const { SEP } = require('../utils/format');
const { row, button } = require('../utils/interaction');
const { menuButton, backButton, adminLog } = require('./util');

const { PERMISSIONS } = permService;
const fmtRoles = (list) => (list.length ? list.map((r) => `<@&${r.role_id}>`).join(' ') : '*nenhum cargo*');

function render() {
  const all = permService.listAll();
  const lines = Object.entries(PERMISSIONS).map(([key, p]) => `${p.emoji} **${p.label}**\n└ ${fmtRoles(all[key])}`);
  const embed = baseEmbed({
    title: 'Permissões',
    color: COLORS.brand,
    description: `${lines.join('\n\n')}\n${SEP}\n👑 Donos dos servidores e IDs em \`OWNER_IDS\` sempre têm acesso total.\nA verificação usa **somente** os cargos configurados aqui (não as permissões do Discord).`,
  });
  const select = new StringSelectMenuBuilder()
    .setCustomId('panel:perms:pick')
    .setPlaceholder('Escolha uma permissão para definir os cargos')
    .addOptions(Object.entries(PERMISSIONS).map(([key, p]) => ({ label: p.label, value: key, emoji: p.emoji })));
  return { embeds: [embed], components: [row(select), row(button('panel:perms:bulk', 'Gerenciar acessos em massa', { emoji: '👥' }), menuButton())] };
}

function renderPerm(permKey) {
  const p = PERMISSIONS[permKey];
  const current = permService.listRoles(permKey);
  const embed = baseEmbed({
    title: `Permissão · ${p.label}`,
    color: COLORS.brand,
    description: `**Cargos com esta permissão:**\n${fmtRoles(current)}\n\nSelecione abaixo os cargos do **servidor interno** que terão acesso (a seleção substitui a lista atual; deixe vazio para remover todos).`,
  });
  const menu = new RoleSelectMenuBuilder()
    .setCustomId(`panel:perms:set:${permKey}`)
    .setPlaceholder('Selecione os cargos autorizados')
    .setMinValues(0)
    .setMaxValues(25);
  const defaults = current.filter((r) => r.guild_id === config.internalGuildId).map((r) => r.role_id).slice(0, 25);
  if (defaults.length) menu.setDefaultRoles(...defaults);
  return { embeds: [embed], components: [row(menu), row(backButton('perms'))] };
}

function renderBulk() {
  const embed = baseEmbed({
    title: 'Acessos em massa',
    color: COLORS.warning,
    description: 'Conceda **todas** as permissões a um ou mais cargos, ou revogue **todas** as permissões deles de uma vez.',
  });
  return {
    embeds: [embed],
    components: [
      row(new RoleSelectMenuBuilder().setCustomId('panel:perms:grant').setPlaceholder('✅ Conceder TODAS as permissões a…').setMinValues(1).setMaxValues(10)),
      row(new RoleSelectMenuBuilder().setCustomId('panel:perms:revoke').setPlaceholder('🚫 Revogar TODAS as permissões de…').setMinValues(1).setMaxValues(10)),
      row(backButton('perms')),
    ],
  };
}

async function handle(interaction, action, args = []) {
  if (!(await requirePermission(interaction, 'change_settings'))) return;

  if (action === 'view') return interaction.update(render());

  if (action === 'pick') return interaction.update(renderPerm(interaction.values[0]));

  if (action === 'bulk') return interaction.update(renderBulk());

  if (action === 'set') {
    const permKey = args[0];
    if (!permService.isValid(permKey)) return;
    const ids = [...interaction.roles.keys()];
    const diff = permService.setRoles(permKey, config.internalGuildId, ids);
    await adminLog(
      interaction,
      'permissions_changed',
      'Permissões alteradas',
      `🔐 **${PERMISSIONS[permKey].label}**\n➕ Adicionados: ${diff.added.map((i) => `<@&${i}>`).join(' ') || '—'}\n➖ Removidos: ${diff.removed.map((i) => `<@&${i}>`).join(' ') || '—'}`
    );
    return interaction.update(renderPerm(permKey));
  }

  if (action === 'grant') {
    const ids = [...interaction.roles.keys()];
    permService.grantAll(config.internalGuildId, ids);
    await adminLog(interaction, 'permissions_changed', 'Permissões concedidas em massa', `✅ Todas as permissões concedidas a: ${ids.map((i) => `<@&${i}>`).join(' ')}`);
    return interaction.update(render());
  }

  if (action === 'revoke') {
    const ids = [...interaction.roles.keys()];
    permService.revokeAll(ids);
    await adminLog(interaction, 'permissions_changed', 'Permissões revogadas em massa', `🚫 Todas as permissões revogadas de: ${ids.map((i) => `<@&${i}>`).join(' ')}`);
    return interaction.update(render());
  }
}

module.exports = { render, handle };
