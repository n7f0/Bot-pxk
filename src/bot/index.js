// src/bot/index.js
const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
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
// SISTEMA DE PRESENÇA (STATUS) E ROTAÇÃO
// ==========================================
let presenceInterval = null;

function updateBotPresence(cfg) {
  if (!client.user) return;

  // 1. Limpa a rotação anterior para não criar loops duplicados
  if (presenceInterval) {
    clearInterval(presenceInterval);
    presenceInterval = null;
  }

  // 2. Atualiza o status online (Online, Ausente, Não Perturbe, Invisível)
  if (cfg.bot_status) {
    const statusMap = { online: 'online', idle: 'idle', dnd: 'dnd', invisible: 'invisible' };
    client.user.setStatus(statusMap[cfg.bot_status] || 'online');
  }

  // 3. Configura as atividades (presets)
  const presets = cfg.presences || [];
  if (presets.length === 0) return;

  let currentIndex = 0;

  // Função que aplica o preset atual
  const applyPreset = () => {
    const preset = presets[currentIndex];
    if (!preset || !preset.text) return;

    let activityType = ActivityType.Playing; // Padrão
    
    // Mapeia os tipos configurados no site para os tipos do Discord
    switch (preset.type?.toUpperCase()) {
      case 'PLAYING': activityType = ActivityType.Playing; break;
      case 'STREAMING': activityType = ActivityType.Streaming; break;
      case 'LISTENING': activityType = ActivityType.Listening; break;
      case 'WATCHING': activityType = ActivityType.Watching; break;
      case 'COMPETING': activityType = ActivityType.Competing; break;
      case 'CUSTOM': activityType = ActivityType.Custom; break;
    }

    const activityOptions = {
      type: activityType,
      name: preset.text // Aqui o emoji padrão ou do servidor (<:nome:id>) já é reconhecido automaticamente
    };

    // O Discord exige uma URL se o tipo for "Transmitindo" (Streaming)
    if (activityType === ActivityType.Streaming) {
      activityOptions.url = preset.url || 'https://www.twitch.tv/discord';
    }

    client.user.setActivity(activityOptions);
  };

  // Aplica o primeiro preset imediatamente
  applyPreset();

  // 4. Lógica de Rotação
  if (cfg.presence_rotation && presets.length > 1) {
    const intervalMs = (cfg.presence_interval || 30) * 1000; // Converte segundos para milissegundos
    presenceInterval = setInterval(() => {
      currentIndex = (currentIndex + 1) % presets.length;
      applyPreset();
    }, intervalMs);
  }
}

// Aplica o status assim que o bot ligar (usando o cache do banco)
client.once('ready', async () => {
  try {
    const initialCfg = await loadCfg(); // Puxa o cache do banco
    updateBotPresence(initialCfg || {}); // Passe o objeto de config inteiro
  } catch (e) {
    console.error('Erro ao carregar status inicial:', e);
  }
});

// ==========================================
// CONEXÃO COM O SITE EM TEMPO REAL
// ==========================================
const socket = io('http://localhost:8080');

socket.on('connect', () => {
  console.log('📡 [Bot] Conectado ao Painel Web para receber atualizações em tempo real.');
});

socket.on('config_updated', async (newCfg) => {
  console.log('⚡ [Bot] Configuração alterada no site! Atualizando cache e aplicando no Discord...');
  
  // 1. Recarrega o cache do banco de dados
  await loadCfg();

  // 2. Atualiza a presença (status, tipo, texto, rotação e emojis)
  updateBotPresence(newCfg);
});

(async () => {
  try {
    await client.login(process.env.DISCORD_TOKEN);
  } catch (e) {
    console.error('Falha ao iniciar bot:', e);
  }
})();

module.exports = client;
