// src/bot/index.js
const { Client, GatewayIntentBits } = require('discord.js');
const { io } = require('socket.io-client');
const { isKnownGuild } = require('./core');
const { loadCfg } = require('../models'); // Importa a função que recarrega o cache

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

socket.on('config_updated', async (newCfg) => {
  console.log('⚡ [Bot] Configuração alterada no site! Atualizando cache e aplicando no Discord...');
  
  // 1. O SEGREDO: Recarrega o cache do banco de dados!
  // Assim, todas as variáveis (cfg.tickets, cfg.movCall, etc) são atualizadas na memória.
  await loadCfg();

  // 2. Atualiza o Status do Bot instantaneamente
  if (newCfg.bot_status && client.user) {
    const statusMap = { online: 'online', idle: 'idle', dnd: 'dnd', invisible: 'invisible' };
    client.user.setStatus(statusMap[newCfg.bot_status] || 'online');
  }
});

(async () => {
  try {
    await client.login(process.env.DISCORD_TOKEN);
  } catch (e) {
    console.error('Falha ao iniciar bot:', e);
  }
})();

module.exports = client;
