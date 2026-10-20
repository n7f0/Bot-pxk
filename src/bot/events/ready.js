const { ActivityType, Events } = require('discord.js');
const { registerCommands } = require('../register');
const { reconcileOnReady } = require('../movcall');
const { startTickers } = require('../voiceTracker');
const { refreshRanking } = require('../ranking');
const { getCfg, setCfg } = require('../db');
const { commandGuildIds } = require('../core');
const { reconcileMovCall } = require('../iniciarmov');
const { reconcileLista } = require('../movlista');

module.exports = (client) => {
  client.once(Events.ClientReady, async () => {
    console.log(`🤖 Bot Online como ${client.user.tag}`);
    client.user.setActivity('a PXK 🔊', { type: ActivityType.Watching });

    await registerCommands({ token: process.env.DISCORD_TOKEN, clientId: process.env.CLIENT_ID, guildIds: commandGuildIds() });
    await reconcileOnReady(client).catch((e) => console.error('[reconcile]', e));
    await reconcileMovCall(client).catch((e) => console.error('[reconcile-movcall]', e));
    await reconcileLista(client).catch((e) => console.error('[reconcile-lista]', e));

    refreshRanking(client).catch(() => {});
    startTickers(client);
  });
};