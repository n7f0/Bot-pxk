// src/bot/index.js
const { Client, GatewayIntentBits } = require('discord.js');
const { io } = require('socket.io-client');
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

// ==========================================
// CONEXÃO COM O SITE EM TEMPO REAL
// ==========================================
const socket = io('http://localhost:8080');

socket.on('connect', () => {
  console.log('📡 [Bot] Conectado ao Painel Web para receber atualizações em tempo real.');
});

socket.on('config_updated', (newCfg) => {
  console.log('⚡ [Bot] Configuração alterada no site! Aplicando no Discord...');
  
  // 1. Atualiza o Status (Online, Ausente, etc)
  if (newCfg.bot_status && client.user) {
    const statusMap = { online: 'online', idle: 'idle', dnd: 'dnd', invisible: 'invisible' };
    client.user.setStatus(statusMap[newCfg.bot_status] || 'online');
  }

  // 2. Atualiza o "Jogando/Assistindo" se você tiver essa opção no site
  // if (newCfg.bot_activity) {
  //    client.user.setActivity(newCfg.bot_activity, { type: 3 }); // 3 = Assistindo
  // }
  
  // Aqui você pode adicionar outras atualizações em tempo real, 
  // como mudar o nome do bot, avatar, etc.
});

(async () => {
  try {
    // O Mongoose já foi conectado no src/index.js, então aqui apenas logamos o bot.
    await client.login(process.env.DISCORD_TOKEN);
  } catch (e) {
    console.error('Falha ao iniciar bot:', e);
  }
})();

// Exporta o client caso outros arquivos precisem (ex: para o Socket.IO saber quem é o bot)
module.exports = client;
