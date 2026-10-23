'use strict';

const { Events } = require('discord.js');
const config = require('../config');
const { memberLog, findExecutor, AuditLogEvent } = require('../logs/members');
const { COLORS } = require('../utils/embeds');

module.exports = {
  name: Events.GuildMemberUpdate,
  async execute(oldMember, newMember) {
    if (!config.isKnownGuild(newMember.guild.id) || newMember.user.bot) return;
    if (oldMember.partial) return; // sem estado anterior não há como comparar

    // Cargos
    const added = [...newMember.roles.cache.keys()].filter((id) => !oldMember.roles.cache.has(id));
    const removed = [...oldMember.roles.cache.keys()].filter((id) => !newMember.roles.cache.has(id));
    if (added.length || removed.length) {
      const found = await findExecutor(newMember.guild, AuditLogEvent.MemberRoleUpdate, newMember.id);
      await memberLog({
        guild: newMember.guild,
        action: 'member_roles',
        title: 'Alteração de cargos',
        color: COLORS.brand,
        userId: newMember.id,
        actorId: found?.executor?.id,
        summary: `+${added.length} / -${removed.length} cargo(s)`,
        lines: [
          added.length ? `➕ **Adicionados:** ${added.map((i) => `<@&${i}>`).join(' ')}` : '',
          removed.length ? `➖ **Removidos:** ${removed.map((i) => `<@&${i}>`).join(' ')}` : '',
          `👮 **Responsável:** ${found?.executor ? `<@${found.executor.id}>` : '—'}`,
        ].filter(Boolean),
      });
    }

    // Apelido
    if (oldMember.nickname !== newMember.nickname) {
      const found = await findExecutor(newMember.guild, AuditLogEvent.MemberUpdate, newMember.id);
      await memberLog({
        guild: newMember.guild,
        action: 'member_nickname',
        title: 'Alteração de apelido',
        color: COLORS.brand,
        userId: newMember.id,
        actorId: found?.executor?.id,
        summary: `${oldMember.nickname ?? '—'} → ${newMember.nickname ?? '—'}`,
        lines: [`**Antes:** ${oldMember.nickname ?? '*nenhum*'}`, `**Depois:** ${newMember.nickname ?? '*nenhum*'}`, `👮 **Responsável:** ${found?.executor ? `<@${found.executor.id}>` : '—'}`],
      });
    }

    // Timeout
    const before = oldMember.communicationDisabledUntilTimestamp;
    const after = newMember.communicationDisabledUntilTimestamp;
    if (before !== after) {
      const found = await findExecutor(newMember.guild, AuditLogEvent.MemberUpdate, newMember.id);
      const active = after && after > Date.now();
      await memberLog({
        guild: newMember.guild,
        action: active ? 'member_timeout' : 'member_timeout_end',
        title: active ? 'Timeout aplicado' : 'Timeout removido',
        color: active ? COLORS.danger : COLORS.success,
        userId: newMember.id,
        actorId: found?.executor?.id,
        summary: active ? `Timeout até ${new Date(after).toISOString()}` : 'Timeout removido',
        lines: [active ? `⏳ **Até:** <t:${Math.floor(after / 1000)}:f>` : '', `👮 **Responsável:** ${found?.executor ? `<@${found.executor.id}>` : '—'}`, `📝 **Motivo:** ${found?.reason || 'Não informado'}`].filter(Boolean),
      });
    }
  },
};
