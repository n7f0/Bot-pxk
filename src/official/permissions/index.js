'use strict';

const config = require('../config');
const service = require('./service');
const { errorEmbed } = require('../utils/embeds');
const { EPHEMERAL } = require('../utils/interaction');

const NO_PERMISSION = '❌ Você não possui permissão para utilizar esta função.';

async function fetchMember(client, guildId, userId) {
  const guild = client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId).catch(() => null));
  if (!guild) return { guild: null, member: null };
  const member = guild.members.cache.get(userId) || (await guild.members.fetch(userId).catch(() => null));
  return { guild, member };
}

/**
 * Verifica a permissão SOMENTE pelos cargos configurados no banco (não usa as permissões do Discord).
 * Acesso total: IDs em OWNER_IDS e donos dos dois servidores (necessário para configurar o primeiro acesso).
 * Os cargos são verificados nos dois servidores, então a equipe pode ser definida no servidor interno.
 */
async function hasPermission(client, userId, permission) {
  if (!service.isValid(permission)) return false;
  if (config.ownerIds.includes(userId)) return true;
  for (const guildId of [config.internalGuildId, config.externalGuildId]) {
    const { guild, member } = await fetchMember(client, guildId, userId);
    if (!guild) continue;
    if (guild.ownerId === userId) return true;
    if (member && service.anyRoleHas([...member.roles.cache.keys()], permission)) return true;
  }
  return false;
}

/** Retorna true se autorizado; caso contrário já responde ao usuário com a mensagem padrão. */
async function requirePermission(interaction, permission) {
  const ok = await hasPermission(interaction.client, interaction.user.id, permission);
  if (ok) return true;
  const payload = { content: NO_PERMISSION, embeds: [], components: [], flags: EPHEMERAL };
  try {
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
    else await interaction.reply(payload);
  } catch (e) {
    console.error('[permissions] falha ao responder:', e.message);
  }
  return false;
}

/** Funções administrativas só podem rodar no servidor interno. */
async function requireInternalGuild(interaction) {
  if (interaction.guildId === config.internalGuildId) return true;
  const payload = {
    embeds: [errorEmbed('Esta função administrativa só está disponível no **servidor interno**.')],
    flags: EPHEMERAL,
  };
  try {
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
    else await interaction.reply(payload);
  } catch (e) {
    console.error('[permissions] falha ao responder:', e.message);
  }
  return false;
}

module.exports = { NO_PERMISSION, hasPermission, requirePermission, requireInternalGuild, PERMISSIONS: service.PERMISSIONS };
