'use strict';

const { ActivityType, Events } = require('discord.js');
const { registerCommands } = require('../register');
const { reconcileOnReady } = require('../movcall');
const { startTickers } = require('../voiceTracker');
const { refreshRanking } = require('../ranking');
const { commandGuildIds } = require('../core');
const { reconcileMovCall } = require('../iniciarmov');
const { reconcileLista } = require('../movlista');

module.exports = (client) => {
  client.once(Events.ClientReady, async () => {
    console.log('🤖 Bot Online como ' + client.user.tag);
    client.user.setActivity('a PXK 🔊', { type: ActivityType.Watching });

    const registration = await registerCommands({
      token: process.env.DISCORD_TOKEN,
      clientId: process.env.CLIENT_ID,
      guildIds: commandGuildIds(),
    });
    if (!registration.ok) console.error('[commands] houve falha ao registrar comandos.');

    await reconcileOnReady(client).catch((error) => console.error('[reconcile]', error));
    await reconcileMovCall(client).catch((error) => console.error('[reconcile-movcall]', error));
    await reconcileLista(client).catch((error) => console.error('[reconcile-lista]', error));

    refreshRanking(client).catch((error) => console.error('[ranking] atualização inicial:', error.message));
    startTickers(client);
  });
};
