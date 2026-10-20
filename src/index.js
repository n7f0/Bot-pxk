require('dotenv').config();

const mongoose = require('mongoose');
const { Client, GatewayIntentBits } = require('discord.js');

const { DISCORD_TOKEN, CLIENT_ID, DATABASE_URL, SERVER_PRINCIPAL_ID, SERVER_INTERNO_ID } = process.env;
const missing = ['DISCORD_TOKEN', 'CLIENT_ID', 'DATABASE_URL', 'SERVER_PRINCIPAL_ID', 'SERVER_INTERNO_ID'].filter(
  (k) => !process.env[k],
);
if (missing.length) {
  console.error(`Faltam variáveis no .env: ${missing.join(', ')}`);
  process.exit(1);
}
if (SERVER_PRINCIPAL_ID === SERVER_INTERNO_ID) {
  console.error('SERVER_PRINCIPAL_ID e SERVER_INTERNO_ID precisam ser servidores diferentes.');
  process.exit(1);
}

const { initDb } = require('./src/db');
const { isKnownGuild } = require('./src/core');
const { shutdownSessions } = require('./src/movcall');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

require('./src/events/ready')(client);
require('./src/events/voiceStateUpdate')(client);
require('./src/events/interactionCreate')(client);
require('./src/events/messageCreate')(client);

client.on('guildCreate', (guild) => {
  if (!isKnownGuild(guild.id)) {
    console.warn(`Saindo do servidor não autorizado: ${guild.name} (${guild.id})`);
    guild.leave().catch(() => {});
  }
});

client.on('error', (e) => console.error('[client]', e));
process.on('unhandledRejection', (err) => console.error('Rejeição não tratada:', err));

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`${signal} recebido - fechando sessões e encerrando...`);
  const timer = setTimeout(() => process.exit(0), 8000);
  try {
    await shutdownSessions(client);
    await mongoose.disconnect();
  } catch (e) {
    console.error('[shutdown]', e.message);
  }
  clearTimeout(timer);
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

mongoose.connection.on('disconnected', () => console.warn('MongoDB desconectado - tentando reconectar...'));
mongoose.connection.on('reconnected', () => console.log('MongoDB reconectado.'));

(async () => {
  await mongoose.connect(DATABASE_URL, { serverSelectionTimeoutMS: 20000 });
  console.log('MongoDB conectado.');
  await initDb();
  await client.login(DISCORD_TOKEN);
})().catch((e) => {
  console.error('Falha ao iniciar:', e);
  process.exit(1);
});
