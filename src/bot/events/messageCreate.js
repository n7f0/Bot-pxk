const { Events } = require('discord.js');
const { onPrefixMessage } = require('../movlista');
const { io } = require('../../dashboard'); // Importa o WebSocket

module.exports = (client) => {
  client.on(Events.MessageCreate, (msg) => {
    // 1. Envia para os prefixos de MOV
    onPrefixMessage(client, msg).catch((e) => console.error('[prefixo]', e));

    // 2. Envia em tempo real para o Painel Web (se não for do bot)
    if (!msg.author.bot && io) {
      io.emit('discord_message', {
        author: msg.author.username,
        avatar: msg.author.displayAvatarURL(),
        content: msg.content,
        channel: msg.channel.name,
        time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      });
    }
  });
};