'use strict';

const { Events } = require('discord.js');
const config = require('../config');
const { memberLog, findExecutor, AuditLogEvent } = require('../logs/members');
const { COLORS } = require('../utils/embeds');

module.exports = {
  name: Events.GuildBanAdd,
  async execute(ban) {
    if (!config.isKnownGuild(ban.guild.id)) return;
    const found = await findExecutor(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);
    await memberLog({
      guild: ban.guild,
      action: 'member_ban',
      title: 'Banimento',
      color: COLORS.danger,
      userId: ban.user.id,
      actorId: found?.executor?.id,
      summary: `Banido por ${found?.executor?.tag ?? 'desconhecido'}`,
      lines: [`👮 **Responsável:** ${found?.executor ? `<@${found.executor.id}>` : '—'}`, `📝 **Motivo:** ${ban.reason || found?.reason || 'Não informado'}`],
    });
  },
};
