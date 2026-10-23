'use strict';

const { Events } = require('discord.js');
const config = require('../config');
const { memberLog } = require('../logs/members');
const { COLORS } = require('../utils/embeds');

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    if (!config.isKnownGuild(member.guild.id) || member.user.bot) return;
    await memberLog({
      guild: member.guild,
      action: 'member_join',
      title: 'Entrada de membro',
      color: COLORS.success,
      userId: member.id,
      summary: `${member.user.tag ?? member.user.username} entrou`,
      lines: [`🗓️ **Conta criada:** <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`],
    });
  },
};
