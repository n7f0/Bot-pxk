'use strict';

const { Events } = require('discord.js');
const config = require('../config');
const { memberLog, findExecutor, AuditLogEvent } = require('../logs/members');
const { COLORS } = require('../utils/embeds');

module.exports = {
  name: Events.GuildBanRemove,
  async execute(ban) {
    if (!config.isKnownGuild(ban.guild.id)) return;
    const found = await findExecutor(ban.guild, AuditLogEvent.MemberBanRemove, ban.user.id);
    await memberLog({
      guild: ban.guild,
      action: 'member_unban',
      title: 'Banimento removido',
      color: COLORS.success,
      userId: ban.user.id,
      actorId: found?.executor?.id,
      summary: `Desbanido por ${found?.executor?.tag ?? 'desconhecido'}`,
      lines: [`👮 **Responsável:** ${found?.executor ? `<@${found.executor.id}>` : '—'}`],
    });
  },
};
