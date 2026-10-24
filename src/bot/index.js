// src/bot/index.js
const { Client, GatewayIntentBits, ActivityType, Collection, Events } = require('discord.js');
const { io } = require('socket.io-client');
const fs = require('fs');
const path = require('path');
const { isKnownGuild } = require('./core');
const { loadCfg } = require('../models');

// ────────────────────────────────────────────────────────────────────
// 1) Validação de config ANTES de qualquer init
// ────────────────────────────────────────────────────────────────────
try {
  require('../official/config').validate({ needToken: false });
  console.log('✅ Config oficial validada.');
} catch (e) {
  console.error('❌ Config oficial inválida:', e.message);
  process.exit(1);
}

// ────────────────────────────────────────────────────────────────────
// 2) Cliente Discord
// ────────────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,   // privileged
    GatewayIntentBits.GuildMembers,     // privileged — logs de membros + sync de cargos
    GatewayIntentBits.GuildModeration,  // privileged — ban/unban via audit log
  ],
});

// ────────────────────────────────────────────────────────────────────
// 3) Coleção de comandos + comandos bridged do bot oficial
//    (necessário para o dispatch de interactionCreate do official/)
// ────────────────────────────────────────────────────────────────────
client.commands = new Collection();
try {
  const { loadBridgedCommands } = require('../official/bridge');
  const bridged = loadBridgedCommands();
  for (const cmd of bridged) client.commands.set(cmd.name, cmd);
  console.log(`✅ ${client.commands.size} comando(s) do bot oficial carregado(s): ${bridged.map((c) => c.name).join(', ')}`);
} catch (e) {
  console.warn('⚠️ Não consegui carregar comandos oficiais:', e.message);
}

// ────────────────────────────────────────────────────────────────────
// 4) ctx.client = client  (ANTES dos modules que usam ctx.client)
//    — Sem isso, logs, publisher e sync de cargos falham silenciosamente
// ────────────────────────────────────────────────────────────────────
require('../official/utils/context').client = client;

// ────────────────────────────────────────────────────────────────────
// 5) Eventos PXK (function-based: module.exports = (client) => {...})
// ────────────────────────────────────────────────────────────────────
require('./events/ready')(client);
require('./events/voiceStateUpdate')(client);
require('./events/interactionCreate')(client);
require('./events/messageCreate')(client);

// ────────────────────────────────────────────────────────────────────
// 6) Eventos do bot oficial (object-based: module.exports = { name, execute })
//    — Os arquivos em src/official/events/*.js seguem ESSE padrão e
//      precisam de um loader; sem ele, NENHUM evento oficial dispara.
// ────────────────────────────────────────────────────────────────────
function loadOfficialEvents(client) {
  const dir = path.join(__dirname, '..', 'official', 'events');
  if (!fs.existsSync(dir)) {
    console.warn('⚠️ Pasta src/official/events não encontrada — eventos oficiais desativados.');
    return;
  }
  let count = 0;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.js')) continue;
    try {
      const ev = require(path.join(dir, file));
      if (!ev.name || typeof ev.execute !== 'function') {
        console.warn(`⚠️ official/events/${file} ignorado (precisa exportar name e execute).`);
        continue;
      }
      const handler = (...args) =>
        Promise.resolve(ev.execute(...args)).catch((err) =>
          console.error(`[official:${file}]`, err)
        );
      if (ev.once) client.once(ev.name, handler);
      else client.on(ev.name, handler);
      count++;
    } catch (err) {
      console.error(`❌ Erro ao carregar official/events/${file}:`, err.message);
    }
  }
  console.log(`✅ ${count} evento(s) do bot oficial registrado(s).`);
}
loadOfficialEvents(client);

// ────────────────────────────────────────────────────────────────────
// 7) Guarda de servidor não autorizado
// ────────────────────────────────────────────────────────────────────
client.on('guildCreate', (guild) => {
  if (!isKnownGuild(guild.id)) {
    console.warn(`Saindo do servidor não autorizado: ${guild.name} (${guild.id})`);
    guild.leave().catch(() => {});
  }
});

client.on('error', (e) => console.error('[client]', e));
process.on('unhandledRejection', (err) => console.error('Rejeição não tratada:', err));

// ────────────────────────────────────────────────────────────────────
// 8) Presença (status + rotação) — igual ao original
// ────────────────────────────────────────────────────────────────────
let presenceInterval = null;

function updateBotPresence(cfg) {
  if (!client.user) return;
  if (presenceInterval) {
    clearInterval(presenceInterval);
    presenceInterval = null;
  }
  if (cfg.bot_status) {
    const statusMap = { online: 'online', idle: 'idle', dnd: 'dnd', invisible: 'invisible' };
    client.user.setStatus(statusMap[cfg.bot_status] || 'online');
  }
  const presets = cfg.presences || [];
  const validPresets = presets.filter((p) => p && p.text && p.text.trim() !== '');
  if (validPresets.length === 0) return;
  let currentIndex = 0;
  const applyPreset = () => {
    const preset = validPresets[currentIndex];
    let activityType = ActivityType.Playing;
    switch (preset.type?.toUpperCase()) {
      case 'PLAYING': activityType = ActivityType.Playing; break;
      case 'STREAMING': activityType = ActivityType.Streaming; break;
      case 'LISTENING': activityType = ActivityType.Listening; break;
      case 'WATCHING': activityType = ActivityType.Watching; break;
      case 'COMPETING': activityType = ActivityType.Competing; break;
      case 'CUSTOM': activityType = ActivityType.Custom; break;
    }
    const activityOptions = { type: activityType, name: preset.text };
    if (activityType === ActivityType.Streaming) {
      activityOptions.url = preset.url || 'https://www.twitch.tv/discord';
    }
    client.user.setActivity(activityOptions);
  };
  applyPreset();
  if (cfg.presence_rotation && validPresets.length > 1) {
    const intervalMs = (cfg.presence_interval || 30) * 1000;
    presenceInterval = setInterval(() => {
      currentIndex = (currentIndex + 1) % validPresets.length;
      applyPreset();
    }, intervalMs);
  }
}

client.once(Events.ClientReady, async () => {
  try {
    const initialCfg = await loadCfg();
    updateBotPresence(initialCfg || {});
  } catch (e) {
    console.error('Erro ao carregar status inicial:', e);
  }
});

// ────────────────────────────────────────────────────────────────────
// 9) Socket.IO — recebe config atualizada do dashboard
// ────────────────────────────────────────────────────────────────────
const dashboardUrl = process.env.DASHBOARD_URL || 'http://localhost:8080';
const socket = io(dashboardUrl);

socket.on('connect', () => {
  console.log(`📡 [Bot] Conectado ao Painel Web (${dashboardUrl}).`);
});

socket.on('config_updated', async (newCfg) => {
  console.log('⚡ [Bot] Configuração alterada no site — atualizando cache.');
  await loadCfg();
  updateBotPresence(newCfg);
});

// ────────────────────────────────────────────────────────────────────
// 10) Login
// ────────────────────────────────────────────────────────────────────
(async () => {
  try {
    await client.login(process.env.DISCORD_TOKEN);
  } catch (e) {
    console.error('Falha ao iniciar bot:', e);
    process.exit(1);
  }
})();

module.exports = client;