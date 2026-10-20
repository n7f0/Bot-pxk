const { Events } = require('discord.js');
const { onPrefixMessage } = require('../movlista');

module.exports = (client) => {
  client.on(Events.MessageCreate, (msg) => {
    onPrefixMessage(client, msg).catch((e) => console.error('[prefixo]', e));
  });
};