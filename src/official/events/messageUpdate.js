'use strict';

const { Events } = require('discord.js');
const config = require('../config');
const logs = require('../logs');
const settings = require('../database/settings');
const { baseEmbed, COLORS } = require('../utils/embeds');
const { fmtDateTime } = require('../utils/time');
const { truncate } = require('../utils/format');

module.exports = {
  name: Events.MessageUpdate,
  async execute(oldMessage, newMessage) {
    if (!newMessage.guildId || !config.isKnownGuild(newMessage.guildId)) return;
    if (newMessage.author?.bot || oldMessage.author?.bot) return;
    if (logs.isLogChannel(newMessage.channelId)) return;
    if (oldMessage.content === newMessage.content) return; // embeds/anexos resolvidos, não é edição

    const author = newMessage.author ?? oldMessage.author;
    await logs.logEvent({
      category: 'messages',
      action: 'message_edit',
      guildId: newMessage.guildId,
      actorId: author?.id,
      summary: `Mensagem editada em #${newMessage.channel?.name ?? newMessage.channelId}`,
      details: { before: oldMessage.content, after: newMessage.content },
      embed: baseEmbed({
        title: 'Mensagem editada',
        color: COLORS.warning,
        footer: logs.LOG_FOOTER,
        description: [
          `👤 **Autor:** ${author ? `<@${author.id}>` : '*desconhecido*'}`,
          `📍 **Canal:** <#${newMessage.channelId}> • ${config.isInternal(newMessage.guildId) ? 'Servidor interno' : 'Servidor externo'} • [Ir para a mensagem](${newMessage.url})`,
          `🕐 **Data:** ${fmtDateTime(Date.now(), settings.get('timezone'))}`,
          '',
          `**Antes:**\n${oldMessage.content ? truncate(oldMessage.content, 900) : '*conteúdo anterior indisponível*'}`,
          '',
          `**Depois:**\n${newMessage.content ? truncate(newMessage.content, 900) : '*vazio*'}`,
        ].join('\n'),
      }),
    });
  },
};
