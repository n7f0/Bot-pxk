const { Client, GatewayIntentBits } = require('discord.js');
const { initDb } = require('./db');
const { isKnownGuild } = require('./core');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

require('./events/ready')(client);
require('./events/voiceStateUpdate')(client);
require('./events/interactionCreate')(client);
require('./events/messageCreate')(client);

client.on('guildCreate', (guild) => {
  if (!isKnownGuild(guild.id)) {
    console.warn(`Saindo do servidor não autorizado: ${guild.name} (${guild.id})`);
    guild.leave().catch(() => {});
  }
});

client.on('error', (e) => console.error('[client]', e));
process.on('unhandledRejection', (err) => console.error('Rejeição não tratada:', err));

(async () => {
  try {
    await initDb();
    await client.login(process.env.DISCORD_TOKEN);
  } catch (e) {
    console.error('Falha ao iniciar bot:', e);
  }
})();