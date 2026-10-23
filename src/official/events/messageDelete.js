'use strict';

const { Events } = require('discord.js');
const config = require('../config');
const logs = require('../logs');
const tracker = require('../bateponto/tracker');
const { baseEmbed, COLORS } = require('../utils/embeds');
const { fmtDateTime } = require('../utils/time');
const settings = require('../database/settings');
const { truncate } = require('../utils/format');

module.exports = {
  name: Events.MessageDelete,
  async execute(message) {
    // Mensagem apagada deixa de contar no bate-ponto (anti "enviar e apagar").
    tracker.onMessageDelete(message.id);

    if (!message.guildId || !config.isKnownGuild(message.guildId)) return;
    if (message.author?.bot) return;
    if (logs.isLogChannel(message.channelId)) return;

    const author = message.author ? `<@${message.author.id}> (${message.author.tag ?? message.author.username})` : '*desconhecido (mensagem não estava em cache)*';
    const content = message.content ? truncate(message.content, 1000) : '*conteúdo indisponível*';
    const attachments = message.attachments?.size ? `\n📎 Anexos: ${[...message.attachments.values()].map((a) => a.name).join(', ')}` : '';
    await logs.logEvent({
      category: 'messages',
      action: 'message_delete',
      guildId: message.guildId,
      actorId: message.author?.id,
      summary: `Mensagem apagada em #${message.channel?.name ?? message.channelId}`,
      details: { content: message.content, channelId: message.channelId },
      embed: baseEmbed({
        title: 'Mensagem apagada',
        color: COLORS.danger,
        footer: logs.LOG_FOOTER,
        description: [
          `👤 **Autor:** ${author}`,
          `📍 **Canal:** <#${message.channelId}> • ${config.isInternal(message.guildId) ? 'Servidor interno' : 'Servidor externo'}`,
          `🕐 **Data:** ${fmtDateTime(Date.now(), settings.get('timezone'))}`,
          '',
          `📝 **Conteúdo:**\n${content}${attachments}`,
        ].join('\n'),
      }),
    });
  },
};
