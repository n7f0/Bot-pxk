const { Events } = require('discord.js');
const { onVoiceUpdate } = require('../voiceTracker');
const { sendLog, logEmbed, COLORS } = require('../core');
const { getCfg } = require('../../models');

module.exports = (client) => {
  client.on('voiceStateUpdate', async (oldState, newState) => {
    // 1. Lógica principal do bot (pontuação, movcall, etc)
    onVoiceUpdate(client, oldState, newState).catch((e) => console.error('[voice]', e));

    // 2. Log de entrada e saída de call
    const cfg = getCfg();
    if (cfg.logs.sessoes) {
      const member = newState.member || oldState.member;
      if (!member || member.user.bot) return;

      if (!oldState.channelId && newState.channelId) {
        // Entrou na call
        sendLog(client, 'sessoes', logEmbed('🔊 Entrou na Call', `👤 <@${member.id}>\n📍 Canal: <#${newState.channelId}>`, COLORS.ok));
      } else if (oldState.channelId && !newState.channelId) {
        // Saiu da call
        sendLog(client, 'sessoes', logEmbed('🔇 Saiu da Call', `👤 <@${member.id}>\n📍 Canal: <#${oldState.channelId}>`, COLORS.warn));
      } else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
        // Trocou de call
        sendLog(client, 'sessoes', logEmbed('🔄 Trocou de Call', `👤 <@${member.id}>\n📍 De: <#${oldState.channelId}>\n➡️ Para: <#${newState.channelId}>`, COLORS.neutral));
      }
    }
  });
};