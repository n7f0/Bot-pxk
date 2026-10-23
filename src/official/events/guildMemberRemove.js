'use strict';

const { Events } = require('discord.js');
const config = require('../config');
const { memberLog, findExecutor, AuditLogEvent } = require('../logs/members');
const { COLORS } = require('../utils/embeds');

module.exports = {
  name: Events.GuildMemberRemove,
  async execute(member) {
    if (!config.isKnownGuild(member.guild.id) || member.user?.bot) return;

    // Expulsão tem log próprio; banimento é registrado em guildBanAdd (evita log duplicado de "saída").
    const ban = await findExecutor(member.guild, AuditLogEvent.MemberBanAdd, member.id);
    if (ban) return;
    const kick = await findExecutor(member.guild, AuditLogEvent.MemberKick, member.id);
    if (kick) {
      return memberLog({
        guild: member.guild,
        action: 'member_kick',
        title: 'Expulsão',
        color: COLORS.danger,
        userId: member.id,
        actorId: kick.executor?.id,
        summary: `Expulso por ${kick.executor?.tag ?? 'desconhecido'}`,
        lines: [`👮 **Responsável:** ${kick.executor ? `<@${kick.executor.id}>` : '—'}`, `📝 **Motivo:** ${kick.reason || 'Não informado'}`],
      });
    }
    await memberLog({
      guild: member.guild,
      action: 'member_leave',
      title: 'Saída de membro',
      color: COLORS.warning,
      userId: member.id,
      summary: `${member.user?.tag ?? member.id} saiu`,
      lines: member.roles?.cache?.size > 1 ? [`🎖️ **Cargos:** ${[...member.roles.cache.values()].filter((r) => r.id !== member.guild.id).map((r) => `<@&${r.id}>`).join(' ')}`] : [],
    });
  },
};
